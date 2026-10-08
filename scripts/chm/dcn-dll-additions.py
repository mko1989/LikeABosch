# What the real DCN-SW DLLs have beyond the 4.70 CHM (WO-068), from the metadata report of bridge/dcn/tools/inspect.
# Usage (repo root):
#   dotnet run --project bridge/dcn/tools/inspect -- <dll folder> docs/protocol/dcn-swapi/api.json /tmp/report.json
#   python3 scripts/chm/dcn-dll-additions.py /tmp/report.json      → docs/protocol/dcn-swapi/dll-additions.json
#   python3 scripts/chm/dcnswapi.py                                 (merges it into api.json / types.json)
# Only interface metadata (names, signatures, constant values) is kept: no Bosch code.
import json, sys

NS = 'Bosch.Dcn.Ecpc.Client.Api.Interfaces'
report = json.load(open(sys.argv[1]))
api = json.load(open('docs/protocol/dcn-swapi/api.json'))
types = json.load(open('docs/protocol/dcn-swapi/types.json'))
dll_version = next(a['references'] for a in report['assemblies'] if a.get('file') == 'Bosch.Dcn.Ecpc.Client.Api.Logic.dll')
installed = sorted({r.split(' ')[1] for r in dll_version if r.startswith('Bosch.Dcn.Ecpc.Server.Interfaces')})

out = {'source': 'DCN-SW DLLs (metadata only), DCN-SW ' + ', '.join(installed), 'interfaces': {}, 'types': {}, 'constants': {}}

for key, real in report['subApis'].items():
    doc = api['interfaces'].get(key, {'methods': [], 'events': [], 'properties': []})
    have_m = {m['name'] for m in doc['methods']}
    have_e = {e['name'] for e in doc['events']}
    have_p = {p['name'] for p in doc['properties']}
    add = {
        'methods': [{'name': m['name'], 'summary': '(not in the 4.70 CHM; found in the DCN-SW DLLs)', 'params': [dict(p, description='') for p in m['params']],
                     'returns': {'type': m['returns'], 'description': ''}, 'errors': [], 'remarks': ''} for m in real['methods'] if m['name'] not in have_m],
        'events': [{'name': e['name'], 'handler': e['handler'], 'args': e['args'], 'summary': '(not in the 4.70 CHM; found in the DCN-SW DLLs)', 'remarks': ''}
                   for e in real['events'] if e['name'] not in have_e],
        'properties': [{'name': p['name'], 'type': p['type'], 'get': True, 'set': False, 'summary': '(not in the 4.70 CHM)'} for p in real['properties']
                       if p['name'] not in have_p and p['type'] == 'bool'],
    }
    if any(add.values()):
        out['interfaces'][key] = add

for name, t in report['types'].items():
    if t.get('kind') != 'enum' and t.get('namespace') != NS:
        continue  # obfuscated internals (aa, kq, …) and the Logic classes
    if t['kind'] == 'enum':
        if name not in types or [v['name'] for v in types[name]['values']] != [v['name'] for v in t['values']]:
            if name in types or name in ('VOTING_PRESENCE',):
                out['types'][name] = {'kind': 'enum', 'summary': '(from the DCN-SW DLLs)', 'values': [{'name': v['name'], 'value': v['value'], 'description': ''} for v in t['values']]}
        continue
    fields = [f for f in t['fields'] if not (f['static'] and not f['literal'] and not f['readOnly'])]
    for f in fields:
        if f['literal']:
            out['constants'][f'{name}.{f["name"]}'] = int(f['value']) if str(f['value']).lstrip('-').isdigit() else f['value']
    if name in types:
        continue
    out['types'][name] = {
        'kind': t['kind'], 'namespace': NS, 'summary': '(not in the 4.70 CHM; from the DCN-SW DLLs)',
        **({'inherits': [t['baseType']]} if t['baseType'] not in (None, 'ValueType', 'Object') else {}),
        'fields': [{'name': f['name'], 'type': f['type'], 'summary': '', **({'constant': True} if f['literal'] else {})} for f in fields],
        'properties': [{'name': p['name'], 'type': p['type'], 'get': p['get'], 'set': p['set'], 'summary': ''} for p in t['properties']],
    }
    out['types'][name] = {k: v for k, v in out['types'][name].items() if v != []}

json.dump(out, open('docs/protocol/dcn-swapi/dll-additions.json', 'w'), indent=1)
print(f"{sum(len(v['methods']) for v in out['interfaces'].values())} methods, {sum(len(v['events']) for v in out['interfaces'].values())} events, "
      f"{sum(len(v['properties']) for v in out['interfaces'].values())} flags, {len(out['types'])} types, {len(out['constants'])} constants")
