"""Optional f32 numerical oracle; this does not compile WGSL or execute a GPU.
Install NumPy locally, then run python tests/math_reference.py.
The double-precision reference obtains all real stationary roots independently.
"""
from pathlib import Path
import numpy as np, math, json
F=np.float32

def candidate(p,a,b,c):
 p,a,b,c=[np.array(x,dtype='f4') for x in (p,a,b,c)];u=2*(c-a);v=a-2*c+b;w=a-p;vv=np.dot(v,v)
 if vv < 1e-12*max(np.dot(u,u),1e-12):
  delta=b-a;t=np.clip(np.dot(p-a,delta)/max(np.dot(delta,delta),1e-24),0,1);return float(np.linalg.norm(p-a-t*delta))
 aa=F(1.5)*np.dot(u,v)/vv;bb=(np.dot(u,u)+2*np.dot(w,v))/(2*vv);cc=np.dot(w,u)/(2*vv);pp=bb-aa*aa/3;qq=2*aa*aa*aa/27-aa*bb/3+cc;half=qq*.5;disc=half*half+pp*pp*pp/27
 if disc>=0:
  h=np.sqrt(disc);z=-half-(h if half>=0 else -h);first=np.sign(z)*np.power(abs(z),F(1/3));second=-pp/(3*first) if abs(first)>1e-20 else F(0);roots=[first+second-aa/3]
 else:
  radius=2*np.sqrt(max(F(0),-pp/3));theta=np.arccos(np.clip(-half/max(np.sqrt(max(F(0),-pp*pp*pp/27)),1e-30),-1,1))/3;roots=[radius*np.cos(theta-F(i)*F(2.0943951023931953))-aa/3 for i in range(3)]
 answer=min(np.dot(w,w),np.dot(b-p,b-p))
 for t in roots:
  t=np.clip(t,0,1)
  for _ in range(2):
   q=a+t*(u+t*v)-p;d=u+2*t*v;den=np.dot(d,d)+2*np.dot(q,v)
   if abs(den)>1e-18:t=np.clip(t-np.dot(q,d)/den,0,1)
  q=a+t*(u+t*v)-p;answer=min(answer,np.dot(q,q))
 return float(np.sqrt(max(0,answer)))
def ref(p,a,b,c):
 p,a,b,c=[np.array(x,dtype='f8') for x in (p,a,b,c)];u=2*(c-a);v=a-2*c+b;w=a-p
 coefficients=[np.dot(w,u),np.dot(u,u)+2*np.dot(w,v),3*np.dot(u,v),2*np.dot(v,v)]
 roots=np.polynomial.polynomial.polyroots(coefficients)
 ts=[0,1]+[float(z.real) for z in roots if abs(z.imag)<1e-7 and 0<=z.real<=1]
 return min(np.linalg.norm(a+t*(u+t*v)-p) for t in ts)
rng=np.random.default_rng(529);errors=[];worst=None
for i in range(10000):
 a,b,c,p=rng.uniform(-1,2,(4,2)).astype('f4')
 if i%3==0:c=((a+b)/2+rng.normal(0,10**rng.uniform(-8,-1),2)).astype('f4')
 g=candidate(p,a,b,c);r=ref(p,a,b,c);e=abs(g-r);errors.append(e)
 if worst is None or e>worst[0]:worst=(e,[p.tolist(),a.tolist(),b.tolist(),c.tolist()],g,r)
report = {'suite':'quadratic-distance-numerical-reference','status':'passed','gpuExecuted':False,
 'candidate':'CPU float32 emulation of the WGSL analytic distance formula',
 'reference':'independent float64 polynomial roots + endpoint minimum',
 'seed':529,'cases':len(errors),'maxAbsoluteErrorEm':max(errors),
 'p99AbsoluteErrorEm':float(np.quantile(errors,.99)),
 'maxAcceptedAbsoluteErrorEm':2e-6,'worstCase':worst,
 'scope':'Random endpoints/control/query coordinates [-1,2] em, including near-linear quadratics. Not a proof for all f32 inputs.'}
if not np.isfinite(errors).all() or max(errors) >= 2e-6: report['status']='failed'
output=Path(__file__).resolve().parents[1]/'artifacts/quadratic-distance-reference.json'
output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
if report['status']!='passed': raise SystemExit(1)
