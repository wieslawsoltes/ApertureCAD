// On-demand CAD editing kernels. Not reachable from per-frame raster pipelines.
struct Entity {anchor:vec4<f32>,p:vec4<f32>,q:vec4<f32>,r:vec4<f32>,tag:vec4<u32>,data:vec4<u32>,basis:vec4<f32>,world:vec4<f32>}
struct ToolParams {origin:vec4<f32>,point:vec4<f32>,control:vec4<u32>,extra:vec4<u32>}
struct DS {hi:vec2<f32>,lo:vec2<f32>}
@group(0) @binding(0) var<uniform> tool:ToolParams;
@group(0) @binding(1) var<storage,read_write> toolEntities:array<Entity>;
@group(0) @binding(2) var<storage,read_write> toolAux:array<u32>;
@group(0) @binding(3) var<storage,read_write> toolResult:array<vec4<u32>>;
@group(0) @binding(4) var<storage,read> toolRanges:array<vec4<u32>>;
@group(0) @binding(5) var<storage,read_write> toolStyles:array<vec2<u32>>;
const TAU=6.283185307179586;
fn af(o:u32)->f32{return bitcast<f32>(toolAux[o]);}
fn av(o:u32)->vec2<f32>{return vec2<f32>(af(o),af(o+1u));}
fn setAv(o:u32,v:vec2<f32>){toolAux[o]=bitcast<u32>(v.x);toolAux[o+1u]=bitcast<u32>(v.y);}
fn dsAdd(a:DS,b:DS)->DS{let s=a.hi+b.hi;let v=s-a.hi;let e=(a.hi-(s-v))+(b.hi-v)+a.lo+b.lo;let hi=s+e;return DS(hi,e-(hi-s));}
fn matrix(e:Entity)->mat2x2<f32>{return mat2x2<f32>(e.basis.xy,e.basis.zw);}
fn selectionIndex(index:u32,start:u32,count:u32)->u32{var low=start;var high=start+count;loop{if(low>=high){break;}let mid=(low+high)/2u;let row=toolRanges[mid];if(index<row.z){high=mid;}else if(index>=row.z+row.y){low=mid+1u;}else{return row.x+index-row.z;}}return 0u;}
@compute @workgroup_size(256)
fn clearSelection(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x+gid.y*65535u*256u;if(i>=tool.control.z){return;}let id=selectionIndex(i,0u,tool.control.x);if(id>0u&&id<arrayLength(&toolStyles)){toolStyles[id].y&=0x7fffffffu;}}
@compute @workgroup_size(256)
fn markSelection(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x+gid.y*65535u*256u;if(i>=tool.control.w){return;}let id=selectionIndex(i,tool.control.x,tool.control.y);if(id>0u&&id<arrayLength(&toolStyles)){toolStyles[id].y|=0x80000000u;}}
// Snap candidates stay GPU-resident. Exactly one 32-byte winning point is read back.
var<workgroup> snapDistance:array<f32,64>;
var<workgroup> snapPoint:array<vec4<f32>,64>;
var<workgroup> snapKind:array<u32,64>;
fn snapCandidate(e:Entity,index:u32)->vec3<f32>{let kind=e.tag.x;let modes=tool.control.y;
 if((modes&1u)!=0u){if(kind==1u&&index<3u){return vec3<f32>(e.p.xy*select(select(.5,1.,index==1u),0.,index==0u),select(2.,1.,index<2u));}
  if((kind==3u||kind==8u)&&index<e.data.y*2u){let vertex=index/2u;let a=av(e.data.x+vertex*4u);let next=(vertex+1u)%e.data.y;if(index%2u==0u){return vec3<f32>(a,1.);}if(next==0u&&(e.data.w&1u)==0u){return vec3<f32>(0.);}let b=av(e.data.x+next*4u);let bulge=af(e.data.x+vertex*4u+2u);if(abs(bulge)<1e-7){return vec3<f32>((a+b)*.5,2.);}let delta=b-a;let center=(a+b)*.5+vec2<f32>(-delta.y,delta.x)*(1.-bulge*bulge)/(4.*bulge);let angle=atan2(a.y-center.y,a.x-center.x)+2.*atan(bulge);return vec3<f32>(center+length(a-center)*vec2<f32>(cos(angle),sin(angle)),2.);}
 }
 if(kind==2u){if(index==0u&&(modes&2u)!=0u){return vec3<f32>(0.,0.,3.);}var t=0.;if(index==1u){t=e.q.x;}else if(index==2u){t=e.q.x+e.q.y;}else if(index>=3u&&index<=6u){t=f32(index-3u)*TAU*.25;}else{return vec3<f32>(0.);}let delta=((t-e.q.x)%TAU+TAU)%TAU;if(index>=3u&&abs(e.q.y)<TAU-1e-5&&delta>e.q.y){return vec3<f32>(0.);}if(index<=2u&&(modes&1u)==0u){return vec3<f32>(0.);}if(index>=3u&&(modes&4u)==0u){return vec3<f32>(0.);}return vec3<f32>(e.p.xy*cos(t)+vec2<f32>(-e.p.y,e.p.x)*e.p.z*sin(t),select(4.,1.,index<=2u));}
 if(index==0u&&(kind==4u||kind==7u||kind==9u||kind==10u)&&(modes&8u)!=0u){return vec3<f32>(0.,0.,5.);}return vec3<f32>(0.);
}
@compute @workgroup_size(64)
fn snapEntity(@builtin(local_invocation_index) lane:u32){let e=toolEntities[tool.control.x];var total=7u;if(e.tag.x==3u||e.tag.x==8u){total=e.data.y*2u;}var best=bitcast<f32>(tool.extra.x);best*=best;var pos=vec4<f32>(0.);var chosen=0u;
 for(var i=lane;i<total;i+=64u){let candidate=snapCandidate(e,i);if(candidate.z==0.){continue;}let world=dsAdd(DS(e.world.xy,e.world.zw),DS(matrix(e)*candidate.xy,vec2<f32>(0.)));let d=dsAdd(world,DS(-tool.point.xy,-tool.point.zw));let distance=dot(d.hi+d.lo,d.hi+d.lo);if(distance<best||(distance==best&&u32(candidate.z)<chosen)){best=distance;pos=vec4<f32>(world.hi,world.lo);chosen=u32(candidate.z);}}
 snapDistance[lane]=best;snapPoint[lane]=pos;snapKind[lane]=chosen;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){let a=snapDistance[lane];let b=snapDistance[lane+stride];if(b<a||(b==a&&snapKind[lane+stride]>0u&&(snapKind[lane]==0u||snapKind[lane+stride]<snapKind[lane]))){snapDistance[lane]=b;snapPoint[lane]=snapPoint[lane+stride];snapKind[lane]=snapKind[lane+stride];}}workgroupBarrier();}
 if(lane==0u){toolResult[0]=bitcast<vec4<u32>>(snapPoint[0]);toolResult[1]=vec4<u32>(snapKind[0],e.tag.w,bitcast<u32>(snapDistance[0]),u32(snapKind[0]!=0u));}}
// Explicit export geometry must not inherit a driver's low-accuracy atan2
// approximation. Range reduction bounds the alternating series by tan(pi/8).
fn bakeAtan2(y:f32,x:f32)->f32 {
 let ax=abs(x);let ay=abs(y);if(max(ax,ay)<1e-30){return 0.;}
 var z=min(ax,ay)/max(ax,ay);var bias=0.;
 if(z>0.41421356237){z=(z-1.)/(z+1.);bias=0.785398163397;}
 let z2=z*z;var poly=1./21.;
 for(var k=9i;k>=0i;k--){let coefficient=select(1.,-1.,(k&1i)!=0i)/f32(2i*k+1i);poly=coefficient+z2*poly;}
 var angle=bias+z*poly;if(ay>ax){angle=1.570796326795-angle;}if(x<0.){angle=3.14159265359-angle;}return select(angle,-angle,y<0.);
}
// Bake a transactional COPY of prepared geometry for explicit EXPLODE/BURST export.
// A zero type means the affine result is outside this exact 2D conversion profile.
@compute @workgroup_size(64)
fn bakeExplode(@builtin(global_invocation_id) gid:vec3<u32>){let i=gid.x+gid.y*65535u*64u;if(i>=tool.control.x){return;}var e=toolEntities[i];let kind=e.tag.x;let m=matrix(e);let absolute=dsAdd(DS(e.world.xy,e.world.zw),DS(tool.origin.xy,tool.origin.zw));e.anchor=vec4<f32>(absolute.hi,absolute.lo);var valid=true;
 if(kind==1u||kind==9u||kind==10u){e.p=vec4<f32>(m*e.p.xy,e.p.zw);}
 else if(kind==5u){e.p=vec4<f32>(m*e.p.xy,m*e.p.zw);}
 else if(kind==7u){}
 else if(kind==3u||kind==8u){let sx=length(m[0]);let sy=length(m[1]);let similarity=abs(sx-sy)<max(sx,sy)*1e-5&&abs(dot(m[0],m[1]))<max(sx*sy,1e-20)*1e-5;for(var j=0u;j<e.data.y;j++){let o=e.data.x+j*4u;let bulge=af(o+2u);if(abs(bulge)>1e-7&&!similarity){valid=false;}setAv(o,m*av(o));toolAux[o+2u]=bitcast<u32>(bulge*select(1.,-1.,determinant(m)<0.));}}
 else if(kind==6u){let o=e.data.x;let points=o+4u+toolAux[o+1u];for(var j=0u;j<toolAux[o+2u];j++){setAv(points+j*4u,m*av(points+j*4u));}}
 else if(kind==2u){let a=m*e.p.xy;let b=m*(vec2<f32>(-e.p.y,e.p.x)*e.p.z);let xx=a.x*a.x+b.x*b.x;let yy=a.y*a.y+b.y*b.y;let xy=a.x*a.y+b.x*b.y;let gap=length(vec2<f32>((xx-yy)*.5,xy));let eigenvalue=(xx+yy)*.5+gap;var axis=select(vec2<f32>(xy,eigenvalue-xx),vec2<f32>(eigenvalue-yy,xy),xx>=yy);if(dot(axis,axis)<1e-30){axis=vec2<f32>(1.,0.);}let u=normalize(axis);let v=vec2<f32>(-u.y,u.x);let major=sqrt(max(0.,eigenvalue));let minor=abs(a.x*b.y-a.y*b.x)/max(major,1e-20);if(major<1e-12||minor<1e-12){valid=false;}else{let phase=bakeAtan2(dot(v,a)/minor,dot(u,a)/major);let direction=select(1.,-1.,determinant(mat2x2<f32>(a,b))<0.);let start=phase+direction*e.q.x;let sweep=direction*e.q.y;e.p=vec4<f32>(u*major,minor/major,0.);e.q=vec4<f32>(select(start,start+sweep,sweep<0.),abs(sweep),e.q.zw);}}
 else if(kind==4u){if((e.data.w&256u)!=0u||abs(af(e.data.x+2u))>1e-7){valid=false;}let x=e.r.xy;let y=e.r.zw;let w=length(x);let dir=x/max(w,1e-20);let vertical=dir.x*y.y-dir.y*y.x;let height=abs(vertical);if(height<1e-12||w<1e-12){valid=false;}else{e.p=vec4<f32>(height,w/height,bakeAtan2(dir.y,dir.x),bakeAtan2(dot(dir,y)*sign(vertical),height));e.data.w=(e.data.w&~124u)|select(0u,64u,vertical<0.);}}
 else{valid=false;}
 e.data.z=0xffffffffu;e.basis=vec4<f32>(1.,0.,0.,1.);if(!valid){e.tag.x=0u;}toolEntities[i]=e;
}
struct SnapLayer {color:u32,visible:u32,flags:u32,pad:u32}
@group(0) @binding(7) var<storage,read> snapLayers:array<SnapLayer>;
@group(0) @binding(6) var<storage,read> snapBounds:array<vec4<f32>>;
// One workgroup per existing 128-entity cluster. Conservative bounds reject whole
// groups without a CPU visible list or readback. Centers remain snappable even
// when there is no raster coverage under the pointer.
@compute @workgroup_size(64)
fn snapCandidates(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3<u32>){let cluster=wid.x;let cursor=tool.point.xy+tool.point.zw;let radius=bitcast<f32>(tool.extra.x);let bbox=snapBounds[tool.control.x+cluster];var best=radius*radius;var chosen=0u;var chosenId=0u;var pos=vec4<f32>(0.);
 if(all(bbox.zw>=cursor-vec2<f32>(radius))&&all(bbox.xy<=cursor+vec2<f32>(radius))){for(var index=cluster*128u+lane;index<min(tool.control.x,(cluster+1u)*128u);index+=64u){let box=snapBounds[index];if(any(box.xy>cursor+vec2<f32>(radius))||any(box.zw<cursor-vec2<f32>(radius))){continue;}let e=toolEntities[index];if(snapLayers[e.tag.z].visible==0u){continue;}var total=7u;if(e.tag.x==3u||e.tag.x==8u){total=e.data.y*2u;}for(var i=0u;i<total;i++){let candidate=snapCandidate(e,i);if(candidate.z==0.){continue;}let local=dsAdd(DS(e.world.xy,e.world.zw),DS(matrix(e)*candidate.xy,vec2<f32>(0.)));let delta=dsAdd(local,DS(-tool.point.xy,-tool.point.zw));let distance=dot(delta.hi+delta.lo,delta.hi+delta.lo);if(distance<best||(distance==best&&u32(candidate.z)<chosen)){let absolute=dsAdd(local,DS(tool.origin.xy,tool.origin.zw));best=distance;pos=vec4<f32>(absolute.hi,absolute.lo);chosen=u32(candidate.z);chosenId=e.tag.w;}}}}
 snapDistance[lane]=best;snapPoint[lane]=pos;snapKind[lane]=chosen;var ids=chosenId; // id stored alongside candidate in a dedicated workgroup array
 snapIds[lane]=ids;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){let a=snapDistance[lane];let b=snapDistance[lane+stride];if(b<a||(b==a&&snapKind[lane+stride]>0u&&(snapKind[lane]==0u||snapIds[lane+stride]<snapIds[lane]))){snapDistance[lane]=b;snapPoint[lane]=snapPoint[lane+stride];snapKind[lane]=snapKind[lane+stride];snapIds[lane]=snapIds[lane+stride];}}workgroupBarrier();}if(lane==0u){let out=(tool.control.z+cluster)*2u;toolResult[out]=bitcast<vec4<u32>>(snapPoint[0]);toolResult[out+1u]=vec4<u32>(snapKind[0],snapIds[0],bitcast<u32>(snapDistance[0]),u32(snapKind[0]!=0u));}}
var<workgroup> snapIds:array<u32,64>;
@compute @workgroup_size(64)
fn reduceSnap(@builtin(local_invocation_index) lane:u32){var best=1e30;var pos=vec4<f32>(0.);var kind=0u;var entity=0u;for(var i=lane+1u;i<=tool.control.x;i+=64u){let info=toolResult[i*2u+1u];let distance=bitcast<f32>(info.z);if(info.w==0u){continue;}if(distance<best||(distance==best&&info.y<entity)){best=distance;kind=info.x;entity=info.y;pos=bitcast<vec4<f32>>(toolResult[i*2u]);}}snapDistance[lane]=best;snapPoint[lane]=pos;snapKind[lane]=kind;snapIds[lane]=entity;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){let a=snapDistance[lane];let b=snapDistance[lane+stride];if(b<a||(b==a&&snapIds[lane+stride]>0u&&(snapIds[lane]==0u||snapIds[lane+stride]<snapIds[lane]))){snapDistance[lane]=b;snapPoint[lane]=snapPoint[lane+stride];snapKind[lane]=snapKind[lane+stride];snapIds[lane]=snapIds[lane+stride];}}workgroupBarrier();}if(lane==0u){toolResult[0]=bitcast<vec4<u32>>(snapPoint[0]);toolResult[1]=vec4<u32>(snapKind[0],snapIds[0],bitcast<u32>(snapDistance[0]),u32(snapKind[0]!=0u));}}
