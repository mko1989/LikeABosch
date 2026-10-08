# CHM topic → plain text. Usage (repo root): python3 scripts/chm/chmtext.py ConferenceProtocol "ReadNotesFile Method" …
import re,html,sys,glob
def text(p):
    t=open(p,encoding='utf-8',errors='replace').read()
    t=re.sub(r'(?s)<script.*?</script>|<style.*?</style>','',t)
    t=re.sub(r'<br\s*/?>|</p>|</tr>|</h\d>|</li>|</pre>|</div>','\n',t)
    t=re.sub(r'<[^>]+>',' ',t); t=html.unescape(t)
    return re.sub(r'[ \t]+',' ',re.sub(r'\n\s*\n+','\n',t)).strip()
def find(d,title):
    t=open(glob.glob(f'docs/source/chm/{d}/*.hhc')[0],encoding='latin-1').read()
    for m in re.finditer(r'<param name="Name" value="([^"]*)">\s*<param name="Local" value="([^"]*)"',t):
        if html.unescape(m.group(1)).strip()==title: return f'docs/source/chm/{d}/{m.group(2)}'
if __name__=='__main__':
    d=sys.argv[1]
    for title in sys.argv[2:]:
        p=find(d,title); print('=====',title,p); print(text(p) if p else 'NOT FOUND')
