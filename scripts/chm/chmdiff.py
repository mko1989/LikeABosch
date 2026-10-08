# Compare the ConferenceProtocol CHM (docs/source/chm/ConferenceProtocol, extracted with `7zz x`) with the JSON spec (WO-044).
# Usage (repo root): python3 scripts/chm/chmdiff.py   → prints per-operation differences, writes data/chm-diff.json
import re,html,json,glob,os,sys
sys.path.insert(0,os.path.dirname(__file__))
from chmtext import text
toc=open('docs/source/chm/ConferenceProtocol/ConferenceProtocol.hhc',encoding='latin-1').read()
pages={html.unescape(m.group(1)).strip().replace(' Method',''):'docs/source/chm/ConferenceProtocol/'+m.group(2)
  for m in re.finditer(r'<param name="Name" value="([^"]*) Method\s*">\s*<param name="Local" value="([^"]*)"',toc)}
def skel(s):
    s=s.replace('Copy','').strip()
    if not s: return None
    s=re.sub(r'<([^<>]+)>',lambda m:json.dumps(m.group(1).strip()),s)
    s=re.sub(r'"\s*\|\s*"','|',s)
    s=re.sub(r'"([^"]*\|[^"]*)"',lambda m:json.dumps('enum:'+m.group(1)),s)
    s=re.sub(r',(\s*[}\]])',r'\1',s)
    s=re.sub(r'(?m)//.*$','',s)
    s=re.sub(r'\.\.\.','',s); s=re.sub(r',(\s*[}\]])',r'\1',s)
    try: return json.loads(s)
    except Exception as e: return {'__unparsed__':s[:300]}
def paths(o,p=''):
    out=set()
    if isinstance(o,dict):
        for k,v in o.items():
            q=f'{p}.{k}' if p else k; out.add(q.lower()); out|=paths(v,q)
    elif isinstance(o,list) and o: out|=paths(o[0],p+'[]')
    return out
def parse(p):
    t=text(p)
    summ=t.split('\n')[2].strip() if len(t.split('\n'))>2 else ''
    m=re.search(r'Request:?\s*\n(.*?)\n\s*Response:?\s*\n(.*?)\n\s*(Exceptions|Remarks|See Also)',t,re.S)
    req,res=(skel(m.group(1)),skel(m.group(2))) if m else (None,None)
    rem=re.search(r'Remarks\s*\n(.*?)\n\s*See Also',t,re.S)
    perms=re.findall(r'(\w+) permission',rem.group(1)) if rem else []
    return dict(summary=summ,request=req,response=res,remarks=rem.group(1).strip() if rem else '',permissions=perms)
spec={json.load(open(f))['operation'].lower():json.load(open(f)) for f in glob.glob('docs/protocol/conference/operations/*.json')}
report={}
for name,p in sorted(pages.items()):
    c=parse(p); s=spec.get(name.lower())
    r={'chm':c}
    if s:
        for side in ('request','response'):
            a,b=paths(c[side]),paths(s.get(side))
            if c[side] and '__unparsed__' in c[side]: r[side+'_unparsed']=True; continue
            if a-b: r[side+'_onlyChm']=sorted(a-b)
            if b-a: r[side+'_onlySpec']=sorted(b-a)
        if sorted(map(str.lower,c['permissions']))!=sorted(map(str.lower,s.get('permissions',[]))): r['perm']=[c['permissions'],s.get('permissions')]
        r['source']=s.get('source','pdf'); r['excluded']=s.get('excluded',False)
    else: r['new']=True
    report[name]=r
json.dump(report,open('data/chm-diff.json','w'),indent=1)  # full per-operation report (data/ is not versioned)
diff={k:{x:y for x,y in v.items() if x!='chm'} for k,v in report.items() if len(v)>3 or v.get('new')}
for k,v in diff.items(): print(k,json.dumps(v))
print(len(diff),'with differences of',len(report))
