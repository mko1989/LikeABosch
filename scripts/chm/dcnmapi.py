# Extract the DICENTIS DCNM API reference (docs/source/chm/DcnmApiDocumentation, unpacked with `7zz x`) into JSON (WO-077).
# Usage (repo root): python3 scripts/chm/dcnmapi.py   → writes docs/protocol/dcnm-api/{api,types}.json
# Source: Sandcastle-generated .NET reference for Bosch.Dcnm.Interfaces.Api 7.00.43431 (DICENTIS 7.0, 2026).
# Every topic page carries its member id (`Microsoft.Help.Id`, e.g. "M:Ns.IControlSpeaker.GrantSpeechAsync(System.Guid,…)")
# and a C# declaration; both are parsed here. Interfaces are keyed by the WindowsApiInstance property that returns them.
import re, html, json, glob, os
from collections import defaultdict, OrderedDict

SRC = 'docs/source/chm/DcnmApiDocumentation/html'
OUT = 'docs/protocol/dcnm-api'
NS = 'Bosch.Dcnm.Interfaces.Api.'
ENTRY = NS + 'WindowsApiInstance'


def text(s):
    s = re.sub(r'(?s)<script.*?</script>', '', s or '')
    s = re.sub(r'<br\s*/?>|</p>|<p\s*/?>', '\n', s)
    s = html.unescape(re.sub(r'<[^>]+>', '', s))
    return re.sub(r'[ \t\r]+', ' ', re.sub(r'\n\s*\n+', '\n', s)).strip()


def page(path):
    t = open(path, encoding='utf-8', errors='replace').read()
    hid = re.search(r'Microsoft.Help.Id" content="([^"]*)"', t)
    summ = re.search(r'<div class="summary">(.*?)</div>', t, re.S)
    cs = re.search(r'_code_Div1"[^>]*><pre[^>]*>(.*?)</pre>', t, re.S)
    params = OrderedDict()
    pm = re.search(r'<h4 class="subHeading">Parameters</h4><dl>(.*?)</dl>', t, re.S)
    if pm:
        for m in re.finditer(r'<dt><span class="parameter">([^<]+)</span>[^<]*</dt><dd>(.*?)</dd>', pm.group(1), re.S):
            d = text(m.group(2))
            d = re.sub(r'^Type:\s*\S+\s*', '', d, count=1)  # "Type: SystemString" (language-specific separators stripped)
            params[m.group(1)] = d.strip()
    ret = re.search(r'<h4 class="subHeading">Return Value</h4>(.*?)(?=<div class="collapsibleAreaRegion"|<h4 class="subHeading">)', t, re.S)
    rem = re.search(r'id="remarksSection".*?<div[^>]*class="collapsibleSection">(.*?)</div>\s*<div class="collapsibleAreaRegion"', t, re.S)
    exc = re.search(r'<table id="exceptionList"[^>]*>(.*?)</table>', t, re.S)
    enum = []
    em = re.search(r'<table id="enumMemberList"[^>]*>(.*?)</table>', t, re.S)
    if em:
        for m in re.finditer(r'<td target="F:[^"]*\.([^".]+)"><span[^>]*>[^<]*</span></td><td>([^<]*)</td>(?:<td />|<td>(.*?)</td>)', em.group(1), re.S):
            v = m.group(2).strip()
            enum.append({'name': m.group(1), 'value': int(v) if re.fullmatch(r'-?\d+', v) else v, 'summary': text(m.group(3))})
    decl = html.unescape(re.sub(r'<[^>]+>', '', cs.group(1))).strip() if cs else ''
    obsolete = re.search(r'\[ObsoleteAttribute(?:\("((?:[^"\\]|\\.)*)"\))?\]', decl)
    while True:  # attributes before the declaration ([ObsoleteAttribute("…")], [FlagsAttribute], …)
        m = re.match(r'(?s)^\s*\[\w+(?:\((?:"(?:[^"\\]|\\.)*"|[^)])*\))?\]\s*', decl)
        if not m: break
        decl = decl[m.end():]
    return {
        'id': hid.group(1) if hid else None,
        'file': os.path.basename(path),
        'summary': text(summ.group(1)) if summ else '',
        'cs': decl,
        'obsolete': (obsolete.group(1) or 'obsolete') if obsolete else None,
        'flagsAttr': '[FlagsAttribute]' in (html.unescape(re.sub(r'<[^>]+>', '', cs.group(1))) if cs else ''),
        'params': params,
        'returns': re.sub(r'^Type:\s*\S+\s*', '', text(ret.group(1))) if ret else '',
        'remarks': text(rem.group(1)) if rem else '',
        'exceptions': [' '.join(text(r).split()) for r in re.findall(r'<tr>(.*?)</tr>', exc.group(1), re.S)[1:]] if exc else [],
        'enum': enum,
    }


pages = [page(p) for p in sorted(glob.glob(f'{SRC}/*.htm'))]
by_id = {p['id']: p for p in pages if p['id'] and re.match(r'^[TMPEF]:', p['id'])}


def short(t):
    t = t.replace(NS + 'Interfaces.', '').replace(NS + 'Services.', '').replace(NS + 'Logic.Plugins.', '').replace(NS, '')
    return t


def split_top(s, sep=','):
    out, depth, cur = [], 0, ''
    for ch in s:
        if ch in '<([': depth += 1
        if ch in '>)]': depth -= 1
        if ch == sep and depth == 0:
            out.append(cur); cur = ''
        else:
            cur += ch
    if cur.strip(): out.append(cur)
    return [x.strip() for x in out]


def norm_type(t):
    t = ' '.join(t.split())
    return re.sub(r'\s*([<>,])\s*', lambda m: m.group(1) + (' ' if m.group(1) == ',' else ''), t).strip()


def parse_params(inner):
    res = []
    for p in split_top(inner):
        p = ' '.join(p.split())
        default = None
        if '=' in p:
            p, default = [x.strip() for x in p.split('=', 1)]
        mod = 'in'
        for k in ('out', 'ref', 'params', 'this'):
            if p.startswith(k + ' '):
                mod = k if k in ('out', 'ref') else 'in'; p = p[len(k) + 1:]
        typ, name = p.rsplit(' ', 1)
        res.append({'name': name, 'type': norm_type(typ), 'modifier': mod, **({'default': default} if default is not None else {})})
    return res


def parse_method(cs):
    """'Task<bool> Foo(\\n int a,\\n Action<…> onFinish = null\\n)' → (return type, name, params)."""
    cs = re.sub(r'^\s*(public|static|virtual|abstract|override|sealed|async|new)\s+', '', cs)
    while re.match(r'^(public|static|virtual|abstract|override|sealed|async|new)\s', cs):
        cs = re.sub(r'^\S+\s+', '', cs)
    m = re.match(r'(?s)^(.*?)\s*\((.*)\)\s*$', cs)
    head, inner = m.group(1), m.group(2)
    parts = head.rsplit(' ', 1)
    if len(parts) == 1: return None, parts[0], parse_params(inner)  # constructor
    return norm_type(parts[0]), parts[1], parse_params(inner)


def parse_property(cs):
    cs = re.sub(r'\b(public|static|virtual|abstract|override)\s+', '', cs)
    m = re.match(r'(?s)^(.*?)\s+(\w+)\s*\{(.*)\}', cs)
    acc = m.group(3)
    return norm_type(m.group(1)), m.group(2), ('get; set' if 'set' in acc else 'get' if 'get' in acc else 'set')


def parse_event(cs):
    cs = re.sub(r'\b(public|static|virtual|abstract|override)\s+', '', cs)
    m = re.match(r'(?s)^event\s+(.*)\s+(\w+)\s*$', cs.strip())
    handler = norm_type(m.group(1))
    payload = None
    gm = re.match(r'^EventHandler<(.*)>$', handler)
    if gm:
        args = gm.group(1)
        am = re.match(r'^ApiEventArgs<(.*)>$', args)
        payload = am.group(1) if am else args
    elif handler == 'EventHandler':
        payload = 'EventArgs'
    return handler, m.group(2), payload


def member_parent(mid):
    """'M:Ns.IFoo.Bar(System.Int32)' → ('Ns.IFoo', 'Bar')."""
    base = mid[2:].split('(')[0]
    parent, _, name = base.rpartition('.')
    return parent, name


# ------------------------------------------------------------------ types
types = {}
for p in pages:
    if not p['id'] or not p['id'].startswith('T:'): continue
    full = p['id'][2:]
    name = short(full).replace('`1', '<T>')
    cs = p['cs']
    km = re.search(r'\b(interface|class|struct|enum|delegate)\b', cs)
    kind = km.group(1) if km else 'unknown'
    base = []
    bm = re.search(r'\b(?:interface|class|struct|enum)\s+[\w<>`]+\s*:\s*(.+)$', cs.split('\n')[0])
    if bm: base = [short(norm_type(x)) for x in split_top(bm.group(1))]
    types[full] = {'name': name, 'full': full, 'kind': kind, 'summary': p['summary'], 'base': base,
                   'flags': p['flagsAttr'], 'cs': cs.split('\n')[0].strip(), 'enum': p['enum'],
                   'methods': [], 'properties': [], 'events': [], 'constructors': [], 'fields': []}
    if kind == 'delegate':
        r, n, ps = parse_method(re.sub(r'\bdelegate\s+', '', cs))
        types[full]['delegate'] = {'returns': short(r or 'void'), 'params': [{**x, 'type': short(x['type'])} for x in ps]}

for p in pages:
    pid = p['id']
    if not pid or pid[0] not in 'MPEF' or pid[1] != ':': continue
    parent, name = member_parent(pid)
    t = types.get(parent)
    if t is None: continue
    if pid.startswith('M:'):
        if not p['cs']: continue
        ret, mname, ps = parse_method(p['cs'])
        for x in ps:
            x['type'] = short(x['type'])
            if x['name'] in p['params']: x['description'] = p['params'][x['name']]
        entry = {'name': mname if ret is not None else '#ctor', 'summary': p['summary'], 'params': ps,
                 'returns': {'type': short(ret), 'description': p['returns']} if ret is not None else None,
                 'remarks': p['remarks'], 'exceptions': p['exceptions'], 'id': pid, 'obsolete': p['obsolete']}
        (t['constructors'] if name == '#ctor' else t['methods']).append(entry)
    elif pid.startswith('P:'):
        if not p['cs']: continue
        typ, pname, acc = parse_property(p['cs'])
        t['properties'].append({'name': pname, 'type': short(typ), 'access': acc, 'summary': p['summary'], 'remarks': p['remarks'], 'obsolete': p['obsolete']})
    elif pid.startswith('E:'):
        handler, ename, payload = parse_event(p['cs'])
        t['events'].append({'name': ename, 'handler': short(handler), 'payload': short(payload) if payload else None,
                            'summary': p['summary'], 'remarks': p['remarks'], 'obsolete': p['obsolete']})
    elif pid.startswith('F:'):
        if t['kind'] == 'enum' or not p['cs']: continue
        cs = p['cs'].strip()
        # The CHM prints some float constants with a decimal comma ("= 0,4f", EQUALIZER_DEFAULT_MIN_QFACTOR): fix to C#.
        cs = re.sub(r'(=\s*-?\d+),(\d+[fFdDmM]?)$', r'\1.\2', cs)
        t['fields'].append({'name': name, 'cs': cs, 'summary': p['summary']})

for t in types.values():
    for k in ('methods', 'properties', 'events', 'constructors'):
        t[k].sort(key=lambda m: (m['name'], len(m.get('params') or [])))

# ------------------------------------------------------------------ api.json
entry = types[ENTRY]
iface_by_short = {t['name']: t for t in types.values() if t['kind'] == 'interface'}

def iface_json(t):
    methods = []
    for m in t['methods']:
        if m['name'] == 'Dispose': continue
        ps = m['params']
        cb = ps and ps[-1]['name'] == 'onFinish'
        methods.append({
            'name': m['name'],
            'summary': m['summary'],
            'params': [p for p in ps if p['name'] != 'onFinish'],
            'returns': m['returns'],
            'callback': bool(cb),
            **({'remarks': m['remarks']} if m['remarks'] else {}),
            **({'exceptions': m['exceptions']} if m['exceptions'] else {}),
            **({'obsolete': m['obsolete']} if m['obsolete'] else {}),
        })
    names = defaultdict(int)
    for m in methods: names[m['name']] += 1
    for m in methods:
        if names[m['name']] > 1: m['overloaded'] = True
    return {
        'interface': t['name'], 'summary': t['summary'], 'inherits': [b for b in t['base'] if b != 'IDisposable'],
        'methods': methods,
        'events': [{k: v for k, v in e.items() if v not in ('', None) or k == 'payload'} for e in t['events']],
        'properties': [{k: v for k, v in pr.items() if v not in ('', None)} for pr in t['properties']],
    }

interfaces = OrderedDict()
entry_props = []
for pr in entry['properties']:
    entry_props.append({'name': pr['name'], 'type': pr['type'], 'summary': pr['summary']})
    if pr['type'] in iface_by_short:
        interfaces[pr['name']] = iface_json(iface_by_short[pr['type']])
reachable = {v['interface'] for v in interfaces.values()}
# Interfaces not returned by WindowsApiInstance directly (base interfaces, objects returned by methods/events).
other = OrderedDict((n, iface_json(t)) for n, t in sorted(iface_by_short.items()) if n not in reachable)

api = OrderedDict([
    ('title', 'Bosch DICENTIS API (DCNM API)'),
    ('version', '7.00.43431'),
    ('source', 'docs/source/DcnmApiDocumentation.chm (unpacked: docs/source/chm/DcnmApiDocumentation)'),
    ('assemblies', ['Bosch.Dcnm.Interfaces.Api.dll', 'Bosch.Dcnm.Interfaces.Api.Interfaces.dll']),
    ('installFolder', 'C:\\Program Files\\Bosch\\DICENTIS'),
    ('entry', {'class': ENTRY, 'summary': entry['summary'], 'properties': entry_props,
               'methods': [{'name': m['name'], 'summary': m['summary']} for m in entry['methods']]}),
    ('interfaces', interfaces),
    ('otherInterfaces', other),
])

# ------------------------------------------------------------------ types.json
tj = OrderedDict([('classes', OrderedDict()), ('enums', OrderedDict()), ('delegates', OrderedDict())])
for t in sorted(types.values(), key=lambda x: x['name']):
    if t['full'] == ENTRY or t['kind'] == 'interface': continue
    if t['kind'] == 'enum':
        tj['enums'][t['name']] = {'summary': t['summary'], 'flags': t['flags'], 'members': t['enum']}
    elif t['kind'] == 'delegate':
        tj['delegates'][t['name']] = {'summary': t['summary'], **t['delegate']}
    else:
        tj['classes'][t['name']] = {
            'kind': t['kind'], 'summary': t['summary'], 'base': t['base'],
            'constructors': [{'params': [{'name': p['name'], 'type': p['type'], **({'default': p['default']} if 'default' in p else {})} for p in c['params']]} for c in t['constructors']],
            'properties': [{'name': p['name'], 'type': p['type'], 'access': p['access'], 'summary': p['summary']} for p in t['properties']],
            **({'fields': [{'name': f['name'], 'cs': f['cs'], 'summary': f['summary']} for f in t['fields']]} if t['fields'] else {}),
            **({'methods': [{'name': m['name'], 'summary': m['summary']} for m in t['methods'] if m['name'] not in ('Equals', 'GetHashCode', 'ToString')]} if [m for m in t['methods'] if m['name'] not in ('Equals', 'GetHashCode', 'ToString')] else {}),
        }

os.makedirs(OUT, exist_ok=True)
json.dump(api, open(f'{OUT}/api.json', 'w'), indent=1, ensure_ascii=False)
json.dump(tj, open(f'{OUT}/types.json', 'w'), indent=1, ensure_ascii=False)
n_m = sum(len(i['methods']) for i in interfaces.values()) + sum(len(i['methods']) for i in other.values())
n_e = sum(len(i['events']) for i in interfaces.values()) + sum(len(i['events']) for i in other.values())
n_p = sum(len(i['properties']) for i in interfaces.values()) + sum(len(i['properties']) for i in other.values())
print(f"entry properties {len(entry_props)}, interfaces {len(interfaces)} (+{len(other)} other), methods {n_m}, events {n_e}, "
      f"interface properties {n_p}, classes {len(tj['classes'])}, enums {len(tj['enums'])}, delegates {len(tj['delegates'])}")
