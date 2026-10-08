# Extract the DCN-SW API reference (docs/source/chm/DCN-SWAPI, unpacked with `7zz x`) into JSON (WO-059).
# Usage (repo root): python3 scripts/chm/dcnswapi.py   → writes docs/protocol/dcn-swapi/{api,types}.json
# Source: Sandcastle-generated .NET reference for Bosch.Dcn.Ecpc.Client.Api.* 4.70.0006 (2018).
import re, html, json, glob, os
from collections import defaultdict

SRC = 'docs/source/chm/DCN-SWAPI/html'
OUT = 'docs/protocol/dcn-swapi'
NS = 'Bosch.Dcn.Ecpc.Client.Api.'

def strip(s):
    s = re.sub(r'(?s)<script.*?</script>', '', s)
    s = re.sub(r'<span class="cpp">[^<]*</span>|<span class="(?:vb|nu|fs)">[^<]*</span>', '', s)  # keep only the C# separator
    s = re.sub(r'<br\s*/?>|</p>|<p\s*/?>', '\n', s)
    s = html.unescape(re.sub(r'<[^>]+>', '', s))
    return re.sub(r'[ \t\r]+', ' ', re.sub(r'\n\s*\n+', '\n', s)).strip()

def section(t, title):
    """Text of a collapsible section (<h1 class="heading">…title…</h1><div class="section">…</div>)."""
    m = re.search(r'<h1 class="heading">(?:(?!</h1>).)*?' + re.escape(title) + r'(?:(?!</h1>).)*</h1>\s*<div[^>]*class="section"[^>]*>(.*?)</div>\s*(?=<h1 class="heading">|<div id="footer"|</div>\s*<div id="footer")', t, re.S)
    return m.group(1) if m else None

def page(path):
    t = open(path, encoding='utf-8', errors='replace').read()
    hid = re.search(r'Microsoft.Help.Id" content="([^"]*)"', t)
    summ = re.search(r'<div class="summary">(.*?)</div>', t, re.S)
    cs = re.search(r'<span codeLanguage="CSharp">.*?<pre[^>]*>(.*?)</pre>', t, re.S)
    params = []
    for m in re.finditer(r'<dl paramName="([^"]+)"><dt>.*?</dt><dd>Type:\s*(.*?)<br\s*/>(.*?)</dd></dl>', t, re.S):
        params.append({'name': m.group(1), 'type': strip(m.group(2)), 'description': strip(m.group(3))})
    ret = re.search(r'<h4 class="subHeading">Return Value</h4>(.*?)(?=</div>\s*<h1|<h1 class="heading">)', t, re.S)
    rem = section(t, 'Remarks')
    ex = re.search(r'id="exampleSection"[^>]*>(.*?)</div>\s*(?=<h1 class="heading">|</div>\s*<div id="footer")', t, re.S)
    exc = section(t, 'Exceptions')
    return {
        'id': hid.group(1) if hid else None,
        'file': os.path.basename(path),
        'summary': strip(summ.group(1)) if summ else '',
        'csharp': strip(cs.group(1)) if cs else '',
        'params': params,
        'returns': strip(ret.group(1)) if ret else '',
        'remarks': strip(rem) if rem else '',
        'exceptions': strip(exc) if exc else '',
        'example': strip(ex.group(1)).replace('Copy Code', '\n', 1).strip() if ex else '',
        'raw': t,
    }

pages = [page(p) for p in sorted(glob.glob(f'{SRC}/*.htm'))]
by_id = defaultdict(list)
for p in pages:
    if p['id']: by_id[p['id']].append(p)

def short(t):
    """System.Int32 → int etc.; strip our namespaces."""
    t = t.replace(NS + 'Interfaces.', '').replace(NS + 'Logic.', '')
    return t

def cs_params(cs):
    """Parameters from the C# declaration: [(modifier, type, name)]."""
    m = re.search(r'\((.*)\)\s*$', cs, re.S)
    if not m or not m.group(1).strip(): return []
    out = []
    depth, cur = 0, ''
    for ch in m.group(1):
        if ch == '<': depth += 1
        if ch == '>': depth -= 1
        if ch == ',' and depth == 0: out.append(cur); cur = ''
        else: cur += ch
    out.append(cur)
    res = []
    for p in out:
        p = ' '.join(p.split())
        mod = 'in'
        for k in ('out', 'ref', 'params'):
            if p.startswith(k + ' '): mod = k if k != 'params' else 'in'; p = p[len(k) + 1:]
        typ, name = p.rsplit(' ', 1)
        res.append((mod, typ, name))
    return res

def errors_from(text):
    return sorted(set(re.findall(r'\b([A-Z][A-Z_]{2,})\b(?=\s*[-–:(]|\s+[-–]|\s*$)', text)) & ERRORS)

# ------------------------------------------------------------------ enums (API_ERROR first: needed for error lists)
enums = {}
for p in pages:
    if not (p['id'] or '').startswith('T:') or ' enum ' not in ' ' + p['csharp'] + ' ': continue
    name = p['id'][2:].replace(NS + 'Interfaces.', '')
    rows = re.findall(r'<td target="F:[^"]*\.(\w+)">.*?</td>\s*<td>(.*?)</td>\s*<td>(.*?)</td>', p['raw'], re.S)
    values = []
    for n, v, d in rows:
        v, d = strip(v), strip(d)
        values.append({'name': n, 'value': int(v) if re.fullmatch(r'-?\d+', v) else v, 'description': d})
    enums[name] = {'kind': 'enum', 'summary': p['summary'], 'values': values, 'file': p['file']}
ERRORS = {v['name'] for v in enums['API_ERROR']['values']}

# ------------------------------------------------------------------ types (structs, classes) with members
types = {}
for p in pages:
    pid = p['id'] or ''
    if not pid.startswith('T:' + NS): continue
    name = pid[2:].replace(NS + 'Interfaces.', '').replace(NS + 'Logic.', '')
    if name in enums: continue
    cs = p['csharp']
    kind = 'interface' if re.search(r'\binterface\b', cs) else 'struct' if re.search(r'\bstruct\b', cs) else 'delegate' if re.search(r'\bdelegate\b', cs) else 'class'
    base = re.search(r'(?:class|interface|struct)\s+\w+\s*:\s*(.+)$', cs, re.S)
    types[name] = {'kind': kind, 'namespace': pid[2:].rsplit('.', 1)[0], 'summary': p['summary'], 'csharp': cs,
                   'inherits': [b.strip() for b in base.group(1).split(',')] if base else [], 'file': p['file'],
                   'fields': [], 'properties': [], 'constructors': [], 'methods': [], 'events': []}

def owner(member_id):
    """'M:Bosch...Interfaces.IVoteApi.StartVoting(System.Int32)' → ('IVoteApi', 'StartVoting')"""
    body = member_id[2:].split('(')[0]
    body = body.replace(NS + 'Interfaces.', '').replace(NS + 'Logic.', '')
    typ, _, member = body.rpartition('.')
    return typ, member

for p in pages:
    pid = p['id'] or ''
    if pid[:2] not in ('F:', 'P:', 'M:', 'E:') or NS not in pid: continue
    typ, member = owner(pid)
    if typ not in types: continue
    t = types[typ]
    cs = p['csharp']
    if pid.startswith('F:'):
        m = re.match(r'public\s+((?:(?:static|readonly|const)\s+)*)(.+?)\s+(\w+)\s*(?:=.*)?$', cs, re.S)
        mods = m.group(1).split() if m else []
        t['fields'].append({'name': member, 'type': short(m.group(2)) if m else cs, 'summary': p['summary'],
                            **({'constant': True} if 'const' in mods or ('static' in mods and 'readonly' in mods) else {})})
    elif pid.startswith('P:'):
        m = re.match(r'(?:public\s+)?(?:static\s+)?(.+?)\s+(\w+)\s*\{(.*)\}', cs, re.S)
        acc = m.group(3) if m else ''
        t['properties'].append({'name': member, 'type': short(m.group(1)) if m else cs, 'get': 'get' in acc, 'set': 'set' in acc, 'summary': p['summary']})
    elif pid.startswith('E:'):
        m = re.search(r'event\s+(.+?)\s+(\w+)\s*$', cs, re.S)
        handler = short(m.group(1)) if m else ''
        args = re.search(r'EventHandler<(\w+)>', handler)
        if not args and handler in types:  # custom delegate: args type from its Invoke signature
            dm = re.search(r'\(\s*Object\s+\w+,\s*(\w+)\s+\w+\s*\)', types[handler]['csharp'])
            args = dm
        t['events'].append({'name': member, 'handler': handler, 'args': args.group(1) if args else ('EventArgs' if handler == 'EventHandler' else None),
                            'summary': p['summary'], 'remarks': p['remarks'], 'file': p['file']})
    elif pid.startswith('M:'):
        if member in ('Equals', 'GetHashCode', 'ToString', 'Finalize', 'MemberwiseClone', 'GetType'): continue
        ps = cs_params(cs)
        docs = {x['name']: x for x in p['params']}
        params = [{'name': n, 'direction': mod, 'type': short(ty), 'description': docs.get(n, {}).get('description', '')} for mod, ty, n in ps]
        if member == '#ctor':
            t['constructors'].append({'params': params, 'summary': p['summary'], 'file': p['file']})
            continue
        if member.startswith('op_'): continue
        rm = re.match(r'(?:public\s+)?(?:static\s+)?(?:override\s+)?(.+?)\s+' + re.escape(member) + r'\s*\(', cs, re.S)
        t['methods'].append({
            'name': member, 'summary': p['summary'], 'params': params,
            'returns': {'type': short(rm.group(1)) if rm else '', 'description': p['returns']},
            'errors': [e for e in (v['name'] for v in enums['API_ERROR']['values']) if re.search(r'\b' + e + r'\b', p['returns'] + ' ' + p['remarks'])],
            'remarks': p['remarks'], 'exceptions': p['exceptions'], **({'example': p['example']} if p['example'] else {}), 'file': p['file'],
        })

# ------------------------------------------------------------------ API tree: entry point → interfaces → members
def all_members(iface, seen=None):
    """Methods/properties/events of an interface incl. inherited interfaces (IApi, I*Events)."""
    seen = seen or set()
    if iface in seen or iface not in types: return [], [], []
    seen.add(iface)
    t = types[iface]
    ms, ps, es = list(t['methods']), list(t['properties']), list(t['events'])
    for b in t['inherits']:
        b = short(b)
        if b == 'IDisposable': continue
        m2, p2, e2 = all_members(b, seen)
        ms += [dict(x, inheritedFrom=b) for x in m2]; ps += [dict(x, inheritedFrom=b) for x in p2]; es += [dict(x, inheritedFrom=b) for x in e2]
    return ms, ps, es

GROUPS = {'IControlApi': 'control', 'IConfigApi': 'config'}
interfaces = {}
for root, group in GROUPS.items():
    for prop in types[root]['properties']:
        sub = prop['type']
        if sub not in types or types[sub]['kind'] != 'interface': continue
        ms, ps, es = all_members(sub)
        ms = [m for m in ms if m.get('inheritedFrom') not in ('IApi',)]
        es = [e for e in es if e.get('inheritedFrom') not in ('IApiEvents',)]
        key = f'{group}.{prop["name"]}'  # e.g. control.DiscussionApi
        interfaces[key] = {
            'interface': sub, 'access': f'DcnApi.{root[1:]}.{prop["name"]}', 'summary': types[sub]['summary'],
            'methods': [{k: v for k, v in m.items() if k != 'inheritedFrom'} for m in ms],
            'properties': ps, 'events': es,
        }

api = {
    'title': 'Bosch DCN Conference Software API (DCN-SW API)',
    'version': '4.70.0006',
    'source': 'docs/source/DCN-SWAPI.chm (unpacked: docs/source/chm/DCN-SWAPI)',
    'assemblies': ['Bosch.Dcn.Ecpc.Client.Api.Interfaces.dll', 'Bosch.Dcn.Ecpc.Client.Api.Logic.dll'],
    'entry': {
        'class': 'Bosch.Dcn.Ecpc.Client.Api.Logic.DcnApi',
        'roots': {g: {'interface': r, 'property': f'DcnApi.{r[1:]}', 'members': {
            'methods': [m['name'] for m in all_members(r)[0]],
            'properties': [{'name': p['name'], 'type': p['type'], 'summary': p['summary']} for p in all_members(r)[1]],
            'events': [e['name'] for e in all_members(r)[2]]}} for r, g in GROUPS.items()},
        'connectionString': 'tcp://<host>:<port>, e.g. tcp://localhost:9461 (IApi.Initialize)',
        'example': next(p['example'] for p in pages if p['file'] == 'N_Bosch_Dcn_Ecpc_Client_Api_Interfaces.htm'),
    },
    'interfaces': interfaces,
}
type_out = {n: {k: v for k, v in t.items() if not (isinstance(v, list) and not v)} for n, t in types.items()
            if t['kind'] != 'interface'}
type_out.update(enums)

# ------------------------------------------------------------------ what the real DLLs add (WO-068, dll-additions.json)
ADD = f'{OUT}/dll-additions.json'
if os.path.exists(ADD):
    add = json.load(open(ADD))
    api['dllSource'] = add['source']
    for key, extra in add['interfaces'].items():
        iface = interfaces[key]
        iface['methods'] += [dict(m, source='dll') for m in extra['methods']]
        iface['events'] += [dict(e, source='dll') for e in extra['events']]
        iface['properties'] += [dict(p, source='dll') for p in extra['properties']]
    for name, t in add['types'].items():
        type_out[name] = dict(t, source='dll')
    for k, v in add['constants'].items():
        tname, fname = k.split('.', 1)
        for f in type_out.get(tname, {}).get('fields', []):
            if f['name'] == fname:
                f['value'] = v

os.makedirs(OUT, exist_ok=True)
json.dump(api, open(f'{OUT}/api.json', 'w'), indent=1, ensure_ascii=False)
json.dump(dict(sorted(type_out.items())), open(f'{OUT}/types.json', 'w'), indent=1, ensure_ascii=False)
nm = sum(len(i['methods']) for i in interfaces.values()); ne = sum(len(i['events']) for i in interfaces.values())
print(f'{len(interfaces)} interfaces, {nm} methods, {ne} events, {len(type_out)} types ({len(enums)} enums)')
