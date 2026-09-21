// Entity ABI: 128 bytes. Only GPU preprocessing writes basis and world.
struct Entity {anchor:vec4<f32>,p:vec4<f32>,q:vec4<f32>,r:vec4<f32>,tag:vec4<u32>,data:vec4<u32>,basis:vec4<f32>,world:vec4<f32>}
struct Frame {camera:vec4<f32>,viewport:vec4<f32>,settings:vec4<f32>,state:vec4<u32>,background:vec4<f32>,grid:vec4<f32>,pointer:vec4<f32>,reserved:vec4<f32>}
struct Header {origin:vec4<f32>,counts:vec4<u32>,extra:vec4<u32>}
struct Layer {color:u32,visible:u32,flags:u32,pad:u32}
struct DS {hi:vec2<f32>,lo:vec2<f32>}
@group(0) @binding(0) var<uniform> frame:Frame;
@group(0) @binding(1) var<uniform> header:Header;
@group(0) @binding(2) var<storage,read_write> entities:array<Entity>;
@group(0) @binding(3) var<storage,read_write> aux:array<u32>;
@group(0) @binding(4) var<storage,read_write> bounds:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> visible:array<u32>;
@group(0) @binding(6) var<storage,read_write> stats:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read> layers:array<Layer>;
@group(0) @binding(8) var<storage,read> fontData:array<u32>;
@group(0) @binding(9) var<storage,read_write> pixels:array<atomic<u32>>;
@group(0) @binding(10) var atlas:texture_2d<f32>;
@group(0) @binding(11) var<storage,read_write> entityStyles:array<vec2<u32>>;
@group(0) @binding(12) var<uniform> fontInfo:FontInfo;
// Dedicated indirect buffer avoids a writable-storage/indirect usage conflict.
@group(0) @binding(13) var<storage,read_write> dispatchArgs:array<u32>;
@group(0) @binding(14) var<storage,read_write> order:array<u32>;
@group(0) @binding(15) var<storage,read_write> fragments:array<atomic<u32>>;
@group(0) @binding(16) var atlasSampler:sampler;
@group(0) @binding(17) var<storage,read_write> sheetStats:array<atomic<u32>>;
// @font-common
// @layout-common
// @hatch-common
// @dimension-common
const PI=3.141592653589793;
const TAU=6.283185307179586;
fn af(o:u32)->f32{return bitcast<f32>(aux[o]);}
fn av(o:u32)->vec2<f32>{return vec2<f32>(af(o),af(o+1u));}
fn dsAdd(a:DS,b:DS)->DS{let s=a.hi+b.hi;let v=s-a.hi;let e=(a.hi-(s-v))+(b.hi-v)+a.lo+b.lo;let hi=s+e;return DS(hi,e-(hi-s));}
fn dsSub(a:DS,b:DS)->DS{return dsAdd(a,DS(-b.hi,-b.lo));}
fn dsMatrix(m:mat2x2<f32>,a:DS)->DS{let h0=m[0]*a.hi.x;let l0=fma(m[0],vec2<f32>(a.hi.x),-h0)+m[0]*a.lo.x;let h1=m[1]*a.hi.y;let l1=fma(m[1],vec2<f32>(a.hi.y),-h1)+m[1]*a.lo.y;return dsAdd(DS(h0,l0),DS(h1,l1));}
fn entityMatrix(e:Entity)->mat2x2<f32>{return mat2x2<f32>(e.basis.xy,e.basis.zw);}
fn transformEntity(sourceEntity:Entity)->Entity{var e=sourceEntity;var a=DS(e.anchor.xy,e.anchor.zw);var m=mat2x2<f32>(vec2<f32>(1.,0.),vec2<f32>(0.,1.));var n=e.data.z;
 for(var depth=0u;depth<192u&&n!=0xffffffffu;depth++){
  var nm:mat2x2<f32>;var t=DS(vec2<f32>(af(n+4u),af(n+5u)),vec2<f32>(af(n+6u),af(n+7u)));
  if(aux[n+13u]==2u){let normal=normalize(vec3<f32>(af(n),af(n+1u),af(n+2u)));var axis:vec3<f32>;if(abs(normal.x)<.015625&&abs(normal.y)<.015625){axis=normalize(cross(vec3<f32>(0.,1.,0.),normal));}else{axis=normalize(cross(vec3<f32>(0.,0.,1.),normal));}let yaxis=cross(normal,axis);nm=mat2x2<f32>(axis.xy,yaxis.xy);t=dsAdd(t,DS(normal.xy*af(n+3u),vec2<f32>(0.)));}
  else{let c=cos(af(n+2u));let s=sin(af(n+2u));nm=mat2x2<f32>(vec2<f32>(c,s)*af(n),vec2<f32>(-s,c)*af(n+1u));}
  let base=DS(vec2<f32>(af(n+8u),af(n+9u)),vec2<f32>(af(n+10u),af(n+11u)));a=dsAdd(dsMatrix(nm,dsSub(a,base)),t);m=nm*m;n=aux[n+12u];
 }
 a=dsSub(a,DS(header.origin.xy,header.origin.zw));e.world=vec4<f32>(a.hi,a.lo);e.basis=vec4<f32>(m[0],m[1]);return e;
}
fn runWidth(e:Entity)->f32{return af(e.data.x+1u)+select(0.,8.*fontInfo.metrics.x,(e.data.w&256u)!=0u);}
fn calculateTextBasis(e:Entity)->mat2x2<f32>{var height=e.p.x;var width=e.p.y;var angle=e.p.z;
 if((e.data.w&28u)!=0u){angle=atan2(e.q.y,e.q.x);if((e.data.w&12u)!=0u){let fitWidth=length(e.q.xy)/max(runWidth(e),1e-12);if((e.data.w&8u)!=0u){height=fitWidth/max(width,1e-12);}else{width=fitWidth/max(height,1e-12);}}}
 let c=cos(angle);let s=sin(angle);return entityMatrix(e)*mat2x2<f32>(vec2<f32>(c,s)*height*width*select(1.,-1.,(e.data.w&32u)!=0u),vec2<f32>(c*tan(e.p.w)-s,s*tan(e.p.w)+c)*height*select(1.,-1.,(e.data.w&64u)!=0u));
}
// TEXT reserves r for the GPU-prepared text basis; source p/q stay intact for edits.
fn textBasis(e:Entity)->mat2x2<f32>{return mat2x2<f32>(e.r.xy,e.r.zw);}
fn textShift(e:Entity)->vec2<f32>{let width=runWidth(e);var x=0.;var y=0.;if(e.q.z==1.){x=-width*.5;}else if(e.q.z==2.){x=-width;}let bottom=-af(e.data.x+2u)+fontInfo.ink.z;let top=fontInfo.ink.w;if(e.q.w==1.){y=-bottom;}else if(e.q.w==2.){y=-(top+bottom)*.5;}else if(e.q.w==3.){y=-top;}return vec2<f32>(x,y);}
fn transformedBounds(origin:vec2<f32>,m:mat2x2<f32>,box:vec4<f32>)->vec4<f32>{let p0=origin+m*box.xy;let p1=origin+m*vec2<f32>(box.z,box.y);let p2=origin+m*box.zw;let p3=origin+m*vec2<f32>(box.x,box.w);return vec4<f32>(min(min(p0,p1),min(p2,p3)),max(max(p0,p1),max(p2,p3)));}
fn ellipseExtent(m:mat2x2<f32>,a:vec2<f32>,b:vec2<f32>)->vec2<f32>{let x=m*a;let y=m*b;return sqrt(x*x+y*y);}
fn calculateBounds(e:Entity)->vec4<f32>{let origin=e.world.xy+e.world.zw;let m=entityMatrix(e);var lo=origin;var hi=origin;let kind=e.tag.x;
 if(kind==1u){let p=origin+m*e.p.xy;let halfWidth=max(0.,e.p.z)*.5;lo=min(lo,p)-halfWidth;hi=max(hi,p)+halfWidth;}else if(kind==2u){let extent=ellipseExtent(m,e.p.xy,vec2<f32>(-e.p.y,e.p.x)*e.p.z);lo-=extent;hi+=extent;}
 else if(kind==3u||kind==8u){for(var i=0u;i<e.data.y;i++){let p=av(e.data.x+i*4u);let world=origin+m*p;lo=min(lo,world);hi=max(hi,world);let bulge=af(e.data.x+i*4u+2u);if(abs(bulge)>1e-7&&(i+1u<e.data.y||(e.data.w&1u)!=0u)){
   let next=av(e.data.x+((i+1u)%e.data.y)*4u);let delta=next-p;let c=(p+next)*.5+vec2<f32>(-delta.y,delta.x)*(1.-bulge*bulge)/(4.*bulge);let radius=length(p-c);let center=origin+m*c;let extent=ellipseExtent(m,vec2<f32>(radius,0.),vec2<f32>(0.,radius));lo=min(lo,center-extent);hi=max(hi,center+extent);}}
 }else if(kind==4u){let shift=textShift(e);return transformedBounds(origin,textBasis(e),vec4<f32>(vec2<f32>(fontInfo.ink.x,-af(e.data.x+2u)+fontInfo.ink.z)+shift,vec2<f32>(runWidth(e)+fontInfo.ink.y,fontInfo.ink.w)+shift));}
 else if(kind==5u){let a=origin+m*e.p.xy;let b=origin+m*e.p.zw;lo=min(lo,min(a,b));hi=max(hi,max(a,b));}
 else if(kind==6u){let o=e.data.x+4u+aux[e.data.x+1u];for(var i=0u;i<e.data.y;i++){let v=origin+m*av(o+i*4u);lo=min(lo,v);hi=max(hi,v);}}
 else if(kind==11u){let padding=max(e.q.x,.01)*.3;return transformedBounds(origin,m,vec4<f32>(-padding,-padding,e.p.x+padding,e.p.y+padding));}
 else if(kind==12u){return hatchBounds(e);}
 else if(kind==13u){return dimensionBounds(e);}
 else if(kind==9u||kind==10u){lo=vec2<f32>(-1e25);hi=vec2<f32>(1e25);}
 return vec4<f32>(lo,hi);
}
var<workgroup> mins:array<vec4<f32>,256>;
var<workgroup> maxs:array<vec4<f32>,256>;
var<workgroup> preparedText:array<u32,128>;
@compute @workgroup_size(128)
fn prepare(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){let i=gid.x;var box=vec4<f32>(1e30,1e30,-1e30,-1e30);var textPresent=0u;
 if(i<header.counts.x){var e=transformEntity(entities[i]);if(e.tag.x==4u){textPresent=1u;let text=calculateTextBasis(e);e.r=vec4<f32>(text[0],text[1]);}entities[i]=e;box=calculateBounds(e);let padding=max(max(abs(box.x),abs(box.z)),max(abs(box.y),abs(box.w)))*.00000048+1e-5;box=vec4<f32>(box.xy-padding,box.zw+padding);bounds[i]=box;entityStyles[e.tag.w]=vec2<u32>(e.tag.y,e.tag.z);}
 preparedText[lane]=textPresent;let finite=all(abs(box)<vec4<f32>(1e20));mins[lane]=vec4<f32>(box.xy,select(vec2<f32>(1e30),box.xy,finite));maxs[lane]=vec4<f32>(box.zw,select(vec2<f32>(-1e30),box.zw,finite));workgroupBarrier();for(var stride=64u;stride>0u;stride/=2u){if(lane<stride){mins[lane]=min(mins[lane],mins[lane+stride]);maxs[lane]=max(maxs[lane],maxs[lane+stride]);preparedText[lane]|=preparedText[lane+stride];}workgroupBarrier();}
 if(lane==0u){if(preparedText[0]!=0u){atomicOr(&stats[8],1u);}bounds[header.counts.x+group.x]=vec4<f32>(mins[0].xy,maxs[0].xy);bounds[header.counts.x+header.counts.y+1u+group.x]=vec4<f32>(mins[0].zw,maxs[0].zw);}
}
@compute @workgroup_size(256)
fn reduceBounds(@builtin(local_invocation_index) lane:u32){var lo=vec2<f32>(1e30);var hi=vec2<f32>(-1e30);for(var i=lane;i<header.counts.y;i+=256u){let b=bounds[header.counts.x+header.counts.y+1u+i];lo=min(lo,b.xy);hi=max(hi,b.zw);}mins[lane]=vec4<f32>(lo,0.,0.);maxs[lane]=vec4<f32>(hi,0.,0.);workgroupBarrier();for(var stride=128u;stride>0u;stride/=2u){if(lane<stride){mins[lane]=min(mins[lane],mins[lane+stride]);maxs[lane]=max(maxs[lane],maxs[lane+stride]);}workgroupBarrier();}if(lane==0u){bounds[header.counts.x+header.counts.y]=vec4<f32>(mins[0].xy,maxs[0].xy);}}
@compute @workgroup_size(64)
fn layoutText(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=header.counts.w){return;}let o=aux[header.extra.x+id.x];shapeRun(o);let n=aux[o];let wrap=af(o+3u);var x=0.;var y=0.;var maxWidth=0.;
 for(var i=0u;i<n;i++){let g=aux[o+4u+i*4u];var advance=0.;if(g<CONSUMED_GLYPH){var next=i+1u;loop{if(next>=n||aux[o+4u+next*4u]!=CONSUMED_GLYPH){break;}next++;}var adjustment=0.;if(next<n){adjustment=pairAdvance(g,aux[o+4u+next*4u]);}advance=max(0.,glyphAt(g).metrics.x+adjustment);if(wrap>0.&&x>0.&&x+advance>wrap){x=0.;y+=1.35;}}
  aux[o+5u+i*4u]=bitcast<u32>(x);aux[o+6u+i*4u]=bitcast<u32>(y);aux[o+7u+i*4u]=bitcast<u32>(advance);if(g==0xffffffffu){maxWidth=max(maxWidth,x);x=0.;y+=1.35;}else{x+=advance;maxWidth=max(maxWidth,x);}}
 aux[o+1u]=bitcast<u32>(maxWidth);aux[o+2u]=bitcast<u32>(y);
}
@compute @workgroup_size(128)
fn generate(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=header.counts.x){return;}let global=header.counts.z+id.x;let columns=u32(ceil(sqrt(f32(header.extra.z))));let x=f32(global%columns)*48.;let y=f32(global/columns)*28.;var kind=1u;var layer=0u;
 if(header.extra.y==2u||global%10u>=6u){kind=4u;layer=2u;}if(header.extra.y!=2u&&global%10u==9u){kind=2u;layer=1u;}
 var e=Entity(vec4<f32>(x,y,0.,0.),vec4<f32>(36.,0.,0.,0.),vec4<f32>(0.),vec4<f32>(0.),vec4<u32>(kind,0u,layer,global+1u),vec4<u32>(0u,0u,0xffffffffu,0u),vec4<f32>(1.,0.,0.,1.),vec4<f32>(0.));
 if(kind==1u&&global%3u==0u){e.p=vec4<f32>(0.,22.,0.,0.);}if(kind==2u){e.p=vec4<f32>(5.,0.,1.,0.);e.q=vec4<f32>(0.,TAU,0.,0.);}if(kind==4u){e.p=vec4<f32>(2.7,1.,0.,0.);e.data=vec4<u32>(header.extra.w,global+1u,0xffffffffu,256u);}entities[id.x]=e;
}
@compute @workgroup_size(64)
fn reset(@builtin(local_invocation_index) lane:u32){if(lane<8u){atomicStore(&stats[lane],0u);}}
fn boxOnScreen(b:vec4<f32>)->bool{let center=frame.camera.xy+frame.camera.zw;let h=frame.viewport.xy*(.5+frame.grid.x)/frame.viewport.z;let co=abs(frame.pointer.x);let si=abs(frame.pointer.y);let half=vec2<f32>(co*h.x+si*h.y,si*h.x+co*h.y)+max(4.*frame.viewport.w,(3.+.5*frame.settings.z)*frame.viewport.w+1.)/frame.viewport.z;return all(b.zw>=center-half)&&all(b.xy<=center+half);}
var<workgroup> clusterActive:u32;
var<workgroup> prefix:array<vec2<u32>,128>;
var<workgroup> baseOffset:vec2<u32>;
fn batchCandidate(index:u32,kind:u32,b:vec4<f32>)->bool {
 if(frame.grid.y<.5){return false;}
 let size=max(vec2<f32>(0.),b.zw-b.xy)*frame.viewport.z;
 if(kind==1u){return max(size.x,size.y)+frame.settings.z*frame.viewport.w<=32.;}
 if(kind==7u){return (6.+frame.settings.z)*frame.viewport.w<=32.;}
 if(kind==4u){
  if(max(size.x,size.y)<=24.){return true;}
  if((frame.state.y&2u)==0u||max(size.x,size.y)>96.){return false;}
  let basis=entities[index].r;
  return min(length(basis.xy),length(basis.zw))*frame.viewport.z<frame.settings.x;
 }
 return false;
}
@compute @workgroup_size(128)
fn cullScan(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 if(lane==0u){clusterActive=u32(boxOnScreen(bounds[header.counts.x+group.x]));}
 let enabled=workgroupUniformLoad(&clusterActive);if(enabled==0u){return;}
 let slot=gid.x;let i=order[min(slot,header.counts.x-1u)];var live=false;var small=false;
 if(slot<header.counts.x){let box=bounds[i];if(boxOnScreen(box)){let tag=entities[i].tag;live=layers[tag.z].visible!=0u;small=live&&batchCandidate(i,tag.x,box);}}
 prefix[lane]=vec2<u32>(u32(small),u32(live&&!small));workgroupBarrier();
 for(var offset=1u;offset<128u;offset*=2u){var v=vec2<u32>(0);if(lane>=offset){v=prefix[lane-offset];}workgroupBarrier();prefix[lane]+=v;workgroupBarrier();}
 if(lane==127u){baseOffset=vec2<u32>(atomicAdd(&stats[4],prefix[127].x),atomicAdd(&stats[5],prefix[127].y));atomicAdd(&stats[0],prefix[127].x+prefix[127].y);}
 workgroupBarrier();if(small){visible[baseOffset.x+prefix[lane].x-1u]=i;}else if(live){visible[header.counts.x-baseOffset.y-prefix[lane].y]=i;}
}
// Portable 128-lane ballot implemented with eight workgroup-local atomic masks.
// Three synchronization phases replace the 128-lane Hillis-Steele prefix scan.
// Tail lanes participate in barriers but never reserve or emit an entity.
var<workgroup> smallMasks:array<atomic<u32>,4>;
var<workgroup> largeMasks:array<atomic<u32>,4>;
@compute @workgroup_size(128)
fn cull(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){
 if(lane<4u){atomicStore(&smallMasks[lane],0u);atomicStore(&largeMasks[lane],0u);}
 if(lane==0u){clusterActive=u32(boxOnScreen(bounds[header.counts.x+group.x]));}
 if(workgroupUniformLoad(&clusterActive)==0u){return;}
 var index=0u;var live=false;var small=false;
 if(gid.x<header.counts.x){index=order[gid.x];let box=bounds[index];
  if(boxOnScreen(box)){let tag=entities[index].tag;live=layers[tag.z].visible!=0u;small=live&&batchCandidate(index,tag.x,box);}}
 let word=lane>>5u;let bit=1u<<(lane&31u);
 if(small){atomicOr(&smallMasks[word],bit);}else if(live){atomicOr(&largeMasks[word],bit);}
 workgroupBarrier();
 if(lane==0u){var totals=vec2<u32>(0u);for(var j=0u;j<4u;j++){totals+=vec2<u32>(countOneBits(atomicLoad(&smallMasks[j])),countOneBits(atomicLoad(&largeMasks[j])));}
  baseOffset=vec2<u32>(atomicAdd(&stats[4],totals.x),atomicAdd(&stats[5],totals.y));}
 let base=workgroupUniformLoad(&baseOffset);
 if(live){var rank=0u;for(var j=0u;j<word;j++){
   if(small){rank+=countOneBits(atomicLoad(&smallMasks[j]));}else{rank+=countOneBits(atomicLoad(&largeMasks[j]));}}
  let inclusive=bit|(bit-1u);
  if(small){rank+=countOneBits(atomicLoad(&smallMasks[word])&inclusive);visible[base.x+rank-1u]=index;}
  else{rank+=countOneBits(atomicLoad(&largeMasks[word])&inclusive);visible[header.counts.x-base.y-rank]=index;}}
}
@compute @workgroup_size(1)
fn indirect(){let batchCount=atomicLoad(&stats[4]);let large=atomicLoad(&stats[5]);atomicStore(&stats[0],batchCount+large);let small=(batchCount+63u)/64u;
 dispatchArgs[0]=min(large,65535u);dispatchArgs[1]=max(1u,(large+65534u)/65535u);dispatchArgs[2]=1u;
 dispatchArgs[4]=min(small,65535u);dispatchArgs[5]=max(1u,(small+65534u)/65535u);dispatchArgs[6]=1u;let sampleCount=select(0u,(batchCount+large+511u)/512u,atomicLoad(&stats[8])!=0u);dispatchArgs[8]=min(sampleCount,65535u);dispatchArgs[9]=max(1u,(sampleCount+65534u)/65535u);dispatchArgs[10]=1u;}
fn viewRotate(p:vec2<f32>)->vec2<f32>{return vec2<f32>(p.x*frame.pointer.x+p.y*frame.pointer.y,-p.x*frame.pointer.y+p.y*frame.pointer.x);}
fn screenOrigin(e:Entity)->vec2<f32>{let delta=viewRotate((e.world.xy-frame.camera.xy)+(e.world.zw-frame.camera.zw));return vec2<f32>(delta.x,-delta.y)*frame.viewport.z+frame.viewport.xy*.5;}
fn screenVector(p:vec2<f32>)->vec2<f32>{let q=viewRotate(p);return vec2<f32>(q.x,-q.y)*frame.viewport.z;}
fn screenPoint(e:Entity,p:vec2<f32>)->vec2<f32>{return screenOrigin(e)+screenVector(entityMatrix(e)*p);}
fn put(pixel:vec2<i32>,coverage:f32,id:u32){
 if(any(pixel<vec2<i32>(0))||any(pixel>=vec2<i32>(frame.viewport.xy))||coverage<=0.){return;}
 let c=u32(clamp(coverage*255.+.5,0.,255.));if(c==0u){return;}
 let address=u32(pixel.y)*u32(frame.viewport.x)+u32(pixel.x);let key=(id<<8u)|c;
 atomicMax(&pixels[address],key);
 // Exact quality mode retains every coverage contributor. No alpha approximation is hidden.
 if((frame.state.y&8u)!=0u){let slot=atomicAdd(&fragments[0],1u);let capacity=u32(frame.reserved.x);
  if(slot>=capacity){atomicStore(&fragments[1],1u);return;}
  let node=4u+u32(frame.viewport.x)*u32(frame.viewport.y)+slot*2u;
  atomicStore(&fragments[node+1u],key);let old=atomicExchange(&fragments[4u+address],slot+1u);atomicStore(&fragments[node],old);
 }
}
// Major-axis traversal touches O(projected length * stroke width), not the diagonal bounding rectangle.
fn stroke(a0:vec2<f32>,b0:vec2<f32>,width:f32,id:u32,lane:u32,stride:u32,dash:vec2<f32>){let d0=b0-a0;let radius=max(width*.5,.35);let pad=radius+1.;var t0=0.;var t1=1.;let low=vec2<f32>(-pad);let high=frame.viewport.xy+pad;
 for(var axis=0u;axis<2u;axis++){if(abs(d0[axis])<1e-12){if(a0[axis]<low[axis]||a0[axis]>high[axis]){return;}}else{let u=(low[axis]-a0[axis])/d0[axis];let v=(high[axis]-a0[axis])/d0[axis];t0=max(t0,min(u,v));t1=min(t1,max(u,v));}}
 if(t0>t1){return;}let a=a0+d0*t0;let b=a0+d0*t1;let d=b-a;let major=select(1u,0u,abs(d.x)>=abs(d.y));let minor=1u-major;let start=i32(floor(min(a[major],b[major])-pad));let end=i32(ceil(max(a[major],b[major])+pad));let count=u32(max(0,end-start+1));let extra=i32(ceil(pad));let norm=max(dot(d0,d0),1e-20);let fullLength=sqrt(norm);
 for(var k=lane;k<count;k+=stride){let majorPixel=start+i32(k);let pos=f32(majorPixel)+.5;var t=.5;if(abs(d[major])>1e-12){t=clamp((pos-a[major])/d[major],0.,1.);}let center=i32(floor(a[minor]+t*d[minor]));
  for(var off=-extra;off<=extra;off++){var pixel=vec2<i32>(0);pixel[major]=majorPixel;pixel[minor]=center+off;let p=vec2<f32>(pixel)+.5;let parameter=clamp(dot(p-a0,d0)/norm,0.,1.);let dist=length(p-(a0+parameter*d0));var cov=clamp(radius+.5-dist,0.,1.);
   if(dash.x>0.&&dash.y>0.){let phase=parameter*fullLength;let period=dash.x+dash.y;if(phase-floor(phase/period)*period>dash.x){cov=0.;}}put(pixel,cov,id);}}
}
fn curveSteps(a:vec2<f32>,b:vec2<f32>,sweep:f32)->u32{let radius=length(a)+length(b);return u32(clamp(ceil(abs(sweep)*sqrt(max(radius,1.)/(8.*max(frame.settings.y,.03)))),1.,32768.));}
// Split only at analytic viewport intersections before sampling a deeply zoomed conic.
// The radius bound |r''| <= |a|+|b| gives a chord error <= R * deltaAngle^2 / 8.
fn ellipseStroke(e:Entity,center:vec2<f32>,major:vec2<f32>,minor:vec2<f32>,start:f32,sweep:f32,lane:u32,stride:u32){
 let o=screenPoint(e,center);let a=screenVector(entityMatrix(e)*major);let b=screenVector(entityMatrix(e)*minor);let width=frame.settings.z*frame.viewport.w;
 let pad=width*.5+2.;let low=vec2<f32>(-pad);let high=frame.viewport.xy+pad;
 var cuts:array<f32,10>;cuts[0]=0.;cuts[1]=1.;var count=2u;
 if(length(a)+length(b)>max(frame.viewport.x,frame.viewport.y)*2.&&abs(sweep)>1e-12){
  for(var axis=0u;axis<2u;axis++){let r=length(vec2<f32>(a[axis],b[axis]));if(r<1e-12){continue;}let phase=atan2(b[axis],a[axis]);
   for(var side=0u;side<2u;side++){let value=(select(low[axis],high[axis],side==1u)-o[axis])/r;if(abs(value)>1.){continue;}let angle=acos(clamp(value,-1.,1.));
    for(var sign=0u;sign<2u;sign++){let theta=phase+select(-angle,angle,sign==1u);var delta=select(start-theta,theta-start,sweep>=0.);delta-=floor(delta/TAU)*TAU;let t=delta/abs(sweep);
     if(t>0.&&t<1.&&count<10u){cuts[count]=t;count++;}}}}
  for(var i=1u;i<count;i++){var j=i;let v=cuts[i];loop{if(j==0u){break;}if(cuts[j-1u]<=v){break;}cuts[j]=cuts[j-1u];j--;}cuts[j]=v;}
 }
 for(var part=0u;part+1u<count;part++){let begin=cuts[part];let to=cuts[part+1u];if(to-begin<1e-12){continue;}let middle=start+sweep*(begin+to)*.5;let p=o+a*cos(middle)+b*sin(middle);
  if(count>2u&&(any(p<low)||any(p>high))){continue;}
  let segmentSweep=sweep*(to-begin);let raw=ceil(abs(segmentSweep)*sqrt(max(length(a)+length(b),1.)/(8.*max(frame.settings.y,.03))));
  if(raw>32768.&&lane==0u){atomicAdd(&stats[6],1u);}let n=u32(clamp(raw,1.,32768.));
  for(var i=lane;i<n;i+=stride){let t=start+sweep*begin+segmentSweep*f32(i)/f32(n);let t1=start+sweep*begin+segmentSweep*f32(i+1u)/f32(n);
   stroke(o+a*cos(t)+b*sin(t),o+a*cos(t1)+b*sin(t1),width,e.tag.w,0u,1u,vec2<f32>(0.));}
 }
}
fn pathEdge(e:Entity,i:u32){let o=e.data.x+i*4u;let a=av(o);let b=av(e.data.x+((i+1u)%e.data.y)*4u);let bulge=af(o+2u);if(abs(bulge)<1e-7){stroke(screenPoint(e,a),screenPoint(e,b),frame.settings.z*frame.viewport.w,e.tag.w,0u,1u,e.r.xy*frame.viewport.z);}else{let delta=b-a;let c=(a+b)*.5+vec2<f32>(-delta.y,delta.x)*(1.-bulge*bulge)/(4.*bulge);let radius=length(a-c);ellipseStroke(e,c,vec2<f32>(radius,0.),vec2<f32>(0.,radius),atan2(a.y-c.y,a.x-c.x),4.*atan(bulge),0u,1u);}}
fn splinePoint(e:Entity,t:f32)->vec2<f32>{return nurbsPoint(e.data.x,t);}
fn nurbsPoint(o:u32,t:f32)->vec2<f32>{let degree=aux[o];let nk=aux[o+1u];let n=aux[o+2u];let knot=o+4u;let points=knot+nk;var lo=degree;var hi=n;for(var iter=0u;iter<32u&&lo+1u<hi;iter++){let mid=(lo+hi)/2u;if(t<af(knot+mid)){hi=mid;}else{lo=mid;}}let span=min(lo,n-1u);var work:array<vec3<f32>,32>;
 for(var j=0u;j<=degree;j++){let p=points+(span-degree+j)*4u;let w=af(p+2u);work[j]=vec3<f32>(av(p)*w,w);}
 for(var r=1u;r<=degree;r++){for(var jj=0u;jj<=degree-r;jj++){let j=degree-jj;let i=span-degree+j;let den=af(knot+i+degree-r+1u)-af(knot+i);var alpha=0.;if(abs(den)>1e-20){alpha=(t-af(knot+i))/den;}work[j]=mix(work[j-1u],work[j],alpha);}}
 return work[degree].xy/max(work[degree].z,1e-20);
}
fn angleInArc(angle:f32,start:f32,sweep:f32)->bool{var delta=angle-start;if(sweep<0.){delta=-delta;}delta=delta-floor(delta/TAU)*TAU;return delta<abs(sweep);}
// Even-odd fill evaluates circular bulge crossings analytically in object space.
fn insidePath(e:Entity,p:vec2<f32>)->bool{var crossings=0u;for(var i=0u;i+1u<e.data.y;i++){let o=e.data.x+i*4u;if(af(o+3u)>.5){continue;}let a=av(o);let b=av(o+4u);let bulge=af(o+2u);
 if(abs(bulge)<1e-7){if((a.y>p.y)!=(b.y>p.y)){let x=a.x+(p.y-a.y)*(b.x-a.x)/(b.y-a.y);if(x>p.x){crossings++;}}}else{let delta=b-a;let c=(a+b)*.5+vec2<f32>(-delta.y,delta.x)*(1.-bulge*bulge)/(4.*bulge);let r=length(a-c);let disc=r*r-(p.y-c.y)*(p.y-c.y);if(disc>1e-12){let root=sqrt(disc);let start=atan2(a.y-c.y,a.x-c.x);let sweep=4.*atan(bulge);for(var s=0u;s<2u;s++){let x=c.x+select(-root,root,s==1u);if(x>p.x&&angleInArc(atan2(p.y-c.y,x-c.x),start,sweep)){crossings++;}}}}}
 return (crossings&1u)!=0u;
}
fn atlasDistance(gid:u32,g:Glyph,p:vec2<f32>)->f32{let uv=(p-g.box.xy)/(g.box.zw-g.box.xy);
 if(any(uv<vec2<f32>(0.))||any(uv>vec2<f32>(1.))){return -.25;}
 let cell=fontInfo.metrics.y;let columns=u32(fontInfo.metrics.z);
 let origin=vec2<f32>(f32(gid%columns),f32(gid/columns))*cell;
 let tc=clamp(vec2<f32>(uv.x,1.-uv.y)*cell,vec2<f32>(.5),vec2<f32>(cell-.5));
 return (textureSampleLevel(atlas,atlasSampler,(origin+tc)/vec2<f32>(fontInfo.atlas.xy),0.).r-.5)*.25;
}
fn glyphCoverage(gid:u32,p:vec2<f32>,scale:f32)->f32{let g=glyphAt(gid);if(any(p<g.box.xy)||any(p>g.box.zw)){return 0.;}var dist=0.;if(scale>384.){dist=glyphDistance(g,p,scale);}else{dist=atlasDistance(gid,g,p);}return clamp(.5+dist*scale,0.,1.);}
const DIGIT_DIVISORS=array<u32,8>(10000000u,1000000u,100000u,10000u,1000u,100u,10u,1u);
fn shadeText(e:Entity,p:vec2<f32>,scale:f32)->f32{let o=e.data.x;let n=aux[o];var coverage=0.;let firstRow=u32(max(0.,floor((fontInfo.ink.z-p.y)/1.35)));let lastRow=u32(max(0.,min(ceil((fontInfo.ink.w-p.y)/1.35),ceil(af(o+2u)/1.35))));
 for(var row=firstRow;row<=lastRow;row++){let targetRow=f32(row)*1.35;var lo=0u;var hi=n;for(var iter=0u;iter<32u&&lo<hi;iter++){let mid=(lo+hi)/2u;let pos=vec2<f32>(af(o+5u+mid*4u),af(o+6u+mid*4u));let less=pos.y<targetRow-.01||(abs(pos.y-targetRow)<.01&&pos.x<p.x-fontInfo.ink.y);if(less){lo=mid+1u;}else{hi=mid;}}
  for(var index=i32(lo);index<i32(n);index++){let px=af(o+5u+u32(index)*4u);let py=af(o+6u+u32(index)*4u);if(py>targetRow+.01||px>p.x-fontInfo.ink.x){break;}if(abs(py-targetRow)>.01){continue;}let g=aux[o+4u+u32(index)*4u];if(g>=CONSUMED_GLYPH){continue;}let x=af(o+5u+u32(index)*4u);let y=af(o+6u+u32(index)*4u);coverage=max(coverage,glyphCoverage(g,vec2<f32>(p.x-x,p.y+y),scale));}}
 if((e.data.w&256u)!=0u){let start=af(o+1u);let column=i32(floor((p.x-start)/fontInfo.metrics.x));for(var offset=-1;offset<=1;offset++){let digitIndex=column+offset;if(digitIndex<0||digitIndex>=8){continue;}let digit=(e.data.y/DIGIT_DIVISORS[u32(digitIndex)])%10u;coverage=max(coverage,glyphCoverage(digitGlyph(digit),vec2<f32>(p.x-start-f32(digitIndex)*fontInfo.metrics.x,p.y),scale));}}
 return coverage;
}
fn inverse2(m:mat2x2<f32>)->mat2x2<f32>{let determinant=m[0].x*m[1].y-m[1].x*m[0].y;return mat2x2<f32>(vec2<f32>(m[1].y,-m[0].y),vec2<f32>(-m[1].x,m[0].x))*(1./determinant);}
fn screenBox(b:vec4<f32>)->vec4<i32>{let center=frame.camera.xy+frame.camera.zw;let m=mat2x2<f32>(screenVector(vec2<f32>(1.,0.)),screenVector(vec2<f32>(0.,1.)));let box=transformedBounds(frame.viewport.xy*.5,m,vec4<f32>(b.xy-center,b.zw-center));return vec4<i32>(max(vec2<i32>(floor(box.xy-2.)),vec2<i32>(0)),min(vec2<i32>(ceil(box.zw+2.)),vec2<i32>(frame.viewport.xy)-1));}
// The lane-batched pipeline can only reach these three small-entity kernels.
// In particular it cannot reach NURBS local arrays, hatch loops or dimension work.
fn rasterLine(e:Entity,lane:u32,stride:u32){let width=frame.settings.z*frame.viewport.w;stroke(screenOrigin(e),screenPoint(e,e.p.xy),max(width,e.p.z*frame.viewport.z),e.tag.w,lane,stride,e.r.xy*frame.viewport.z);}
fn rasterPoint(e:Entity,lane:u32,stride:u32){let width=frame.settings.z*frame.viewport.w;let o=screenOrigin(e);stroke(o-vec2<f32>(3.,0.)*frame.viewport.w,o+vec2<f32>(3.,0.)*frame.viewport.w,width,e.tag.w,lane,stride,vec2<f32>(0.));stroke(o-vec2<f32>(0.,3.)*frame.viewport.w,o+vec2<f32>(0.,3.)*frame.viewport.w,width,e.tag.w,lane,stride,vec2<f32>(0.));}
// Rasterization has no per-text telemetry atomics. Explicit sampling uses sampleText.
fn rasterText(e:Entity,index:u32,lane:u32,stride:u32){
 let box=screenBox(bounds[index]);let size=box.zw-box.xy+1;if(any(size<=vec2<i32>(0))){return;}let pixelCount=u32(size.x)*u32(size.y);
 let basis=textBasis(e);let screenBasis=mat2x2<f32>(screenVector(basis[0]),screenVector(basis[1]));let determinant=screenBasis[0].x*screenBasis[1].y-screenBasis[1].x*screenBasis[0].y;
 if(abs(determinant)<1e-10){return;}let scale=min(length(screenBasis[0]),length(screenBasis[1]));let shift=textShift(e);let origin=screenOrigin(e)+screenBasis*shift;
 if((frame.state.y&2u)!=0u&&scale<frame.settings.x){stroke(origin,origin+screenBasis*vec2<f32>(runWidth(e),0.),max(.35,min(scale*.35,1.)),e.tag.w,lane,stride,vec2<f32>(0.));return;}
 let inverse=inverse2(screenBasis);for(var i=lane;i<pixelCount;i+=stride){let pixel=box.xy+vec2<i32>(i32(i%u32(size.x)),i32(i/u32(size.x)));let p=inverse*(vec2<f32>(pixel)+.5-origin);put(pixel,shadeText(e,p,scale),e.tag.w);}
}
fn rasterEntity(index:u32,lane:u32,stride:u32){let e=entities[index];let kind=e.tag.x;
 if(kind==13u){rasterDimension(e,lane,stride);return;}let width=frame.settings.z*frame.viewport.w;
 if(kind==1u){rasterLine(e,lane,stride);return;}
 if(kind==9u||kind==10u){let o=screenOrigin(e);var direction=screenVector(entityMatrix(e)*e.p.xy);if(length(direction)<1e-10){return;}direction=normalize(direction);let middle=frame.viewport.xy*.5;let along=dot(middle-o,direction);let extent=length(frame.viewport.xy)*2.;let begin=select(along-extent,max(0.,along-extent),kind==10u);stroke(o+direction*begin,o+direction*(along+extent),width,e.tag.w,lane,stride,vec2<f32>(0.));return;}
 if(kind==11u){let nx=u32(clamp(ceil(abs(e.p.x)/max(e.q.x,.01)),1.,256.));let ny=u32(clamp(ceil(abs(e.p.y)/max(e.q.x,.01)),1.,256.));let count=2u*(nx+ny);for(var i=lane;i<count;i+=stride){var a:vec2<f32>;var b:vec2<f32>;if(i<nx){a=vec2<f32>(e.p.x*f32(i)/f32(nx),0.);b=vec2<f32>(e.p.x*f32(i+1u)/f32(nx),0.);}else if(i<nx+ny){let j=i-nx;a=vec2<f32>(e.p.x,e.p.y*f32(j)/f32(ny));b=vec2<f32>(e.p.x,e.p.y*f32(j+1u)/f32(ny));}else if(i<2u*nx+ny){let j=i-nx-ny;a=vec2<f32>(e.p.x*(1.-f32(j)/f32(nx)),e.p.y);b=vec2<f32>(e.p.x*(1.-f32(j+1u)/f32(nx)),e.p.y);}else{let j=i-2u*nx-ny;a=vec2<f32>(0.,e.p.y*(1.-f32(j)/f32(ny)));b=vec2<f32>(0.,e.p.y*(1.-f32(j+1u)/f32(ny)));}let delta=b-a;let center=(a+b)*.5+vec2<f32>(-delta.y,delta.x)*(1.-.45*.45)/(4.*.45);let radius=length(a-center);ellipseStroke(e,center,vec2<f32>(radius,0.),vec2<f32>(0.,radius),atan2(a.y-center.y,a.x-center.x),4.*atan(.45),0u,1u);}return;}
 if(kind==2u){ellipseStroke(e,vec2<f32>(0.),e.p.xy,vec2<f32>(-e.p.y,e.p.x)*e.p.z,e.q.x,e.q.y,lane,stride);return;}
 if(kind==3u){if(e.data.y<2u){return;}let count=e.data.y-select(1u,0u,(e.data.w&1u)!=0u);for(var i=lane;i<count;i+=stride){pathEdge(e,i);}return;}
 if(kind==6u){let b=bounds[index];let diagonal=length(b.zw-b.xy)*frame.viewport.z;let requested=max(f32(e.data.y)*12.,sqrt(max(diagonal,1.)/max(frame.settings.y,.03))*4.);let n=u32(clamp(requested,8.,16384.));if(lane==0u&&requested>16384.){atomicAdd(&stats[6],1u);}let degree=aux[e.data.x];let nk=aux[e.data.x+1u];let low=af(e.data.x+4u+degree);let high=af(e.data.x+4u+nk-degree-1u);
  for(var i=lane;i<n;i+=stride){let a=splinePoint(e,mix(low,high,f32(i)/f32(n)));let z=splinePoint(e,mix(low,high,f32(i+1u)/f32(n)));stroke(screenPoint(e,a),screenPoint(e,z),width,e.tag.w,0u,1u,vec2<f32>(0.));}return;}
 if(kind==7u){rasterPoint(e,lane,stride);return;}
 if(kind==4u){rasterText(e,index,lane,stride);return;}
 let box=screenBox(bounds[index]);let size=box.zw-box.xy+1;if(any(size<=vec2<i32>(0))){return;}let pixelCount=u32(size.x)*u32(size.y);

 if(kind==5u){let a=screenOrigin(e);let b=screenPoint(e,e.p.xy);let c=screenPoint(e,e.p.zw);let area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(abs(area)<1e-10){return;}let sign=select(-1.,1.,area>=0.);let ab=b-a;let bc=c-b;let ca=a-c;
  for(var i=lane;i<pixelCount;i+=stride){let pixel=box.xy+vec2<i32>(i32(i%u32(size.x)),i32(i/u32(size.x)));let p=vec2<f32>(pixel)+.5;let d0=sign*(ab.x*(p.y-a.y)-ab.y*(p.x-a.x))/max(length(ab),1e-12);let d1=sign*(bc.x*(p.y-b.y)-bc.y*(p.x-b.x))/max(length(bc),1e-12);let d2=sign*(ca.x*(p.y-c.y)-ca.y*(p.x-c.x))/max(length(ca),1e-12);put(pixel,clamp(.5+min(d0,min(d1,d2)),0.,1.),e.tag.w);}return;
 }
 if(kind==12u){let m=entityMatrix(e);let sm=mat2x2<f32>(screenVector(m[0]),screenVector(m[1]));if(abs(cross2(sm[0],sm[1]))<1e-12){return;}let inverse=inverse2(sm);let origin=screenOrigin(e);let scale=max(length(sm[0]),length(sm[1]));
  for(var i=lane;i<pixelCount;i+=stride){let pixel=box.xy+vec2<i32>(i32(i%u32(size.x)),i32(i/u32(size.x)));var coverage=0.;
   for(var j=0u;j<4u;j++){let offset=vec2<f32>(select(.25,.75,(j&1u)!=0u),select(.25,.75,(j&2u)!=0u));let p=inverse*(vec2<f32>(pixel)+offset-origin);if(hatchInside(e,p,scale)){coverage+=hatchPattern(e,p,inverse)*.25;}}
   put(pixel,coverage,e.tag.w);}return;
 }
 if(kind==8u){let m=entityMatrix(e);let sm=mat2x2<f32>(screenVector(m[0]),screenVector(m[1]));if(abs(sm[0].x*sm[1].y-sm[1].x*sm[0].y)<1e-10){return;}let inverse=inverse2(sm);let origin=screenOrigin(e);
  for(var i=lane;i<pixelCount;i+=stride){let pixel=box.xy+vec2<i32>(i32(i%u32(size.x)),i32(i/u32(size.x)));var coverage=0.;for(var j=0u;j<4u;j++){let offset=vec2<f32>(select(.25,.75,(j&1u)!=0u),select(.25,.75,(j&2u)!=0u));coverage+=f32(insidePath(e,inverse*(vec2<f32>(pixel)+offset-origin)))*.25;}put(pixel,coverage,e.tag.w);}return;
 }
}


@compute @workgroup_size(64)
fn raster(@builtin(workgroup_id) group:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let slot=group.x+group.y*65535u;if(slot>=atomicLoad(&stats[5])){return;}
 rasterEntity(visible[header.counts.x-1u-slot],lane,64u);
}
@compute @workgroup_size(64)
fn rasterBatch(@builtin(global_invocation_id) gid:vec3<u32>){
 let slot=gid.x+gid.y*65535u*64u;if(slot>=atomicLoad(&stats[4])){return;}let index=visible[slot];let e=entities[index];
 if(e.tag.x==1u){rasterLine(e,0u,1u);}else if(e.tag.x==7u){rasterPoint(e,0u,1u);}else if(e.tag.x==4u){rasterText(e,index,0u,1u);}
}
// Optional diagnostics traverse the resident queues, never download geometry.
// Same viewport / determinant / proxy predicates as rasterText, but no glyph rasterization.
var<workgroup> sampledText:array<vec3<u32>,64>;
@compute @workgroup_size(64)
fn sampleText(@builtin(global_invocation_id) gid:vec3<u32>,@builtin(local_invocation_index) lane:u32){
 let group=(gid.x/64u)+gid.y*65535u;let base=group*512u+lane;
 let small=atomicLoad(&stats[4]);let total=atomicLoad(&stats[0]);var counts=vec3<u32>(0u);
 for(var tile=0u;tile<8u;tile++){
  let slot=base+tile*64u;if(slot>=total){break;}
  var index=0u;if(slot<small){index=visible[slot];}else{index=visible[header.counts.x-1u-(slot-small)];}
  let e=entities[index];if(e.tag.x!=4u){continue;}
  let box=screenBox(bounds[index]);if(any(box.zw<box.xy)){continue;}
  counts.x++;counts.z+=aux[e.data.x]+select(0u,8u,(e.data.w&256u)!=0u);
  let basis=textBasis(e);let sm=mat2x2<f32>(screenVector(basis[0]),screenVector(basis[1]));let determinant=sm[0].x*sm[1].y-sm[1].x*sm[0].y;
  if(abs(determinant)>=1e-10&&(frame.state.y&2u)!=0u){counts.y+=u32(min(length(sm[0]),length(sm[1]))<frame.settings.x);}
 }
 sampledText[lane]=counts;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){sampledText[lane]+=sampledText[lane+stride];}workgroupBarrier();}
 if(lane==0u){let total=sampledText[0];if(total.x!=0u){atomicAdd(&stats[1],total.x);}if(total.y!=0u){atomicAdd(&stats[2],total.y);}if(total.z!=0u){atomicAdd(&stats[3],total.z);}}
}
// Small sparse annotation pages keep insertion order; no host index upload.
@compute @workgroup_size(128)
fn identity(@builtin(global_invocation_id) id:vec3<u32>){if(id.x<header.counts.x){order[id.x]=id.x;}}

// Summed candidate instances across reused model queues in paper-space viewports.
@compute @workgroup_size(1)
fn sumViewport(){let small=atomicLoad(&stats[4]);let large=atomicLoad(&stats[5]);atomicAdd(&sheetStats[0],small+large);atomicAdd(&sheetStats[4],small);atomicAdd(&sheetStats[5],large);atomicAdd(&sheetStats[6],atomicLoad(&stats[6]));atomicAdd(&sheetStats[7],large+(small+63u)/64u);}

// Reused coverage still contributes candidate counts, but executes no raster workgroups.
@compute @workgroup_size(1)
fn sumViewportCached(){let small=atomicLoad(&stats[4]);let large=atomicLoad(&stats[5]);atomicAdd(&sheetStats[0],small+large);atomicAdd(&sheetStats[4],small);atomicAdd(&sheetStats[5],large);atomicAdd(&sheetStats[6],atomicLoad(&stats[6]));}
