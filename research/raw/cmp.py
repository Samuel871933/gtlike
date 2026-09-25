import xml.etree.ElementTree as ET, gzip, urllib.parse as u, collections
W=['frs1','frc1','frp13','frc3','fr104','fr105']
def flat(f):
    r={}
    def rec(e,p):
        ch=list(e)
        if not ch: r[p]=(e.text or '').strip()
        for c in ch: rec(c,(p+'.' if p else '')+c.tag)
    rec(ET.parse(f).getroot(),''); return r
for kind in ['config','unit_info','building_info']:
    d={w:flat(f'{w}_{kind}.xml') for w in W}
    keys=sorted(set().union(*d.values()))
    print(f'\n=== {kind}: differing keys ===')
    print('key'.ljust(45),*[w.ljust(8) for w in W])
    for k in keys:
        v=[d[w].get(k,'-') for w in W]
        if len(set(v))>1: print(k[:45].ljust(45),*[x[:8].ljust(8) for x in v])
print('\n=== map stats ===')
for w in W:
    V=[l.split(',') for l in gzip.open(f'{w}_village.txt.gz','rt') if l.strip()]
    P=[l.split(',') for l in gzip.open(f'{w}_player.txt.gz','rt') if l.strip()]
    A=[l.split(',') for l in gzip.open(f'{w}_ally.txt.gz','rt') if l.strip()]
    C=[l.split(',') for l in gzip.open(f'{w}_conquer.txt.gz','rt') if l.strip()]
    barb=[v for v in V if v[4]=='0']; bonus=[v for v in V if len(v)>6 and v[6].strip()!='0']
    xs=[int(v[2]) for v in V]; ys=[int(v[3]) for v in V]
    pts=sorted([int(p[5]) for p in P],reverse=True)
    vpp=sorted([int(p[4]) for p in P],reverse=True)
    ts=[int(c[1]) for c in C]
    import datetime as dt
    first=dt.datetime.utcfromtimestamp(min(ts)).date() if ts else None
    print(f"{w}: villages={len(V)} barb={len(barb)} ({100*len(barb)//max(1,len(V))}%) bonus={len(bonus)} x[{min(xs)}-{max(xs)}] y[{min(ys)}-{max(ys)}] players={len(P)} tribes={len(A)} conquers={len(C)} since={first}")
    print(f"   top pts={pts[:3]} median pts={pts[len(pts)//2] if pts else 0} top villages={vpp[:3]} avg vill pts={sum(int(v[5]) for v in V)//len(V)}")
    if A:
        A.sort(key=lambda a:-int(a[6]))
        print('   top tribes:',[(u.unquote_plus(a[2]),a[3],a[4],a[6]) for a in A[:3]])
    bt=collections.Counter(v[6].strip() for v in bonus); print('   bonus types:',dict(sorted(bt.items())))
