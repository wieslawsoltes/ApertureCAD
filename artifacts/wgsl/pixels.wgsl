struct Frame {camera:vec4<f32>,viewport:vec4<f32>,settings:vec4<f32>,state:vec4<u32>,background:vec4<f32>,grid:vec4<f32>,pointer:vec4<f32>,reserved:vec4<f32>}
struct Layer {color:u32,visible:u32,flags:u32,pad:u32}
@group(0) @binding(0) var<uniform> frame:Frame;
@group(0) @binding(1) var<storage,read_write> pixels:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read> entityStyles:array<vec2<u32>>;
@group(0) @binding(3) var<storage,read> layers:array<Layer>;
@group(0) @binding(4) var output:texture_storage_2d<rgba8unorm,write>;
@group(0) @binding(5) var<storage,read_write> pickResult:array<u32>;
@group(0) @binding(6) var<uniform> pickParams:vec4<u32>;
struct MeasureParams {a:vec4<f32>,b:vec4<f32>}
@group(0) @binding(7) var<uniform> measureParams:MeasureParams;
@group(0) @binding(8) var<storage,read_write> fragments:array<atomic<u32>>;
@group(0) @binding(9) var<storage,read_write> basePixels:array<atomic<u32>>;
@compute @workgroup_size(256)
fn clear(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x+id.y*65535u*256u;if(i<u32(frame.viewport.x)*u32(frame.viewport.y)){atomicStore(&pixels[i],0u);}}
@compute @workgroup_size(256)
fn clearFragments(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x+id.y*65535u*256u;
 if(i<u32(frame.viewport.x)*u32(frame.viewport.y)){atomicStore(&fragments[4u+i],0u);}if(i<4u){atomicStore(&fragments[i],0u);}}
fn entityColor(entity:u32)->vec4<f32>{let style=entityStyles[entity];let packed=select(style.x,layers[style.y&0x7fffffffu].color,style.x==0u);
 var ink=unpackColor(packed);if((frame.state.y&4u)!=0u){ink=vec3<f32>(dot(ink,vec3<f32>(.2126,.7152,.0722)));}
 if(entity==frame.state.x||(style.y&0x80000000u)!=0u){ink=vec3<f32>(1.,.74,.33);}if(entity==frame.state.z){ink=mix(ink,vec3<f32>(1.),.35);}
 return vec4<f32>(ink,f32(packed>>24u)/255.);}
// Front-to-back source-over in declared drawing/entity order; duplicate coverage samples
// from one entity are unioned with max coverage, never blended repeatedly.
fn composite(address:u32,bg:vec3<f32>)->vec3<f32>{
 let head=atomicLoad(&fragments[4u+address]);let count=u32(frame.viewport.x)*u32(frame.viewport.y);
 var previous=0xffffffffu;var transmission=1.;var result=vec3<f32>(0.);
 loop {var node=head;var next=0u;var coverage=0u;
  loop{if(node==0u){break;}let offset=4u+count+(node-1u)*2u;let key=atomicLoad(&fragments[offset+1u]);let entity=key>>8u;
   if(entity<previous){if(entity>next){next=entity;coverage=key&255u;}else if(entity==next){coverage=max(coverage,key&255u);}}
   node=atomicLoad(&fragments[offset]);}
  if(next==0u){break;}let ink=entityColor(next);let alpha=ink.a*f32(coverage)/255.;result+=transmission*alpha*ink.rgb;transmission*=1.-alpha;previous=next;
  if(transmission==0.){break;}
 }
 return result+transmission*bg;
}
fn unpackColor(c:u32)->vec3<f32>{return vec3<f32>(f32(c&255u),f32((c>>8u)&255u),f32((c>>16u)&255u))/255.;}
fn backgroundAt(id:vec2<u32>)->vec3<f32>{let p=vec2<f32>(id)+.5;var bg=frame.background.rgb;
 if((frame.state.y&1u)!=0u){let localPoint=vec2<f32>(p.x-frame.viewport.x*.5,frame.viewport.y*.5-p.y)/frame.viewport.z;let world=vec2<f32>(frame.pointer.x*localPoint.x-frame.pointer.y*localPoint.y,frame.pointer.y*localPoint.x+frame.pointer.x*localPoint.y)+frame.camera.xy+frame.camera.zw;
  let step=frame.grid.z;let local=world/step;let distance=abs(local-round(local))*step*frame.viewport.z;let major=abs(local/5.-round(local/5.))*step*5.*frame.viewport.z;
  bg+=vec3<f32>(.025,.033,.043)*clamp(1.-min(distance.x,distance.y),0.,1.)+vec3<f32>(.016,.022,.03)*clamp(1.-min(major.x,major.y),0.,1.);}
 return bg;
}
fn coverageAt(address:u32)->u32{let base=atomicLoad(&basePixels[address]);if(frame.reserved.y==0.){return base;}return max(base,atomicLoad(&pixels[address]));}
@compute @workgroup_size(8,8)
fn resolve(@builtin(global_invocation_id) id:vec3<u32>){if(any(id.xy>=vec2<u32>(frame.viewport.xy))){return;}
 var color=backgroundAt(id.xy);let key=coverageAt(id.y*u32(frame.viewport.x)+id.x);let entity=key>>8u;
 if(entity!=0u){let ink=entityColor(entity);color=mix(color,ink.rgb,f32(key&255u)/255.*ink.a);}
 textureStore(output,vec2<i32>(id.xy),vec4<f32>(color,1.));
}
@compute @workgroup_size(8,8)
fn resolveExact(@builtin(global_invocation_id) id:vec3<u32>){if(any(id.xy>=vec2<u32>(frame.viewport.xy))){return;}
 var color=composite(id.y*u32(frame.viewport.x)+id.x,backgroundAt(id.xy));
 if(atomicLoad(&fragments[1])!=0u&&id.y<12u){color=select(vec3<f32>(1.,0.,.7),vec3<f32>(0.),((id.x/12u)&1u)!=0u);}
 textureStore(output,vec2<i32>(id.xy),vec4<f32>(color,1.));
}
var<workgroup> distances:array<u32,64>;
var<workgroup> ids:array<u32,64>;
@compute @workgroup_size(64)
fn pick(@builtin(local_invocation_index) lane:u32){let r=min(pickParams.z,24u);let size=2u*r+1u;var best=0xffffffffu;var entity=0u;
 for(var i=lane;i<size*size;i+=64u){let offset=vec2<i32>(i32(i%size)-i32(r),i32(i/size)-i32(r));let p=vec2<i32>(pickParams.xy)+offset;if(any(p<vec2<i32>(0))||any(p>=vec2<i32>(frame.viewport.xy))){continue;}let address=u32(p.y)*u32(frame.viewport.x)+u32(p.x);let key=select(coverageAt(address),atomicLoad(&basePixels[address]),pickParams.w!=0u);if((key&255u)<40u){continue;}let id=key>>8u;let distance=u32(offset.x*offset.x+offset.y*offset.y);if(distance<best||(distance==best&&id>entity)){best=distance;entity=id;}}
 distances[lane]=best;ids[lane]=entity;workgroupBarrier();for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){let d=distances[lane+stride];let id=ids[lane+stride];if(d<distances[lane]||(d==distances[lane]&&id>ids[lane])){distances[lane]=d;ids[lane]=id;}}workgroupBarrier();}if(lane==0u){pickResult[0]=ids[0];pickResult[1]=distances[0];}}
@compute @workgroup_size(1)
fn measure(){let delta=(measureParams.b.xy-measureParams.a.xy)+(measureParams.b.zw-measureParams.a.zw);pickResult[0]=bitcast<u32>(length(delta));pickResult[1]=bitcast<u32>(abs(delta.x));pickResult[2]=bitcast<u32>(abs(delta.y));pickResult[3]=bitcast<u32>(atan2(delta.y,delta.x));}

// Exact integer coverage copy. The source rectangle is cropped before allocation.
@compute @workgroup_size(8,8)
fn copyViewport(@builtin(global_invocation_id) id:vec3<u32>){if(any(id.xy>=vec2<u32>(frame.viewport.xy))){return;}let destination=id.xy+vec2<u32>(frame.pointer.zw);if(any(destination>=vec2<u32>(frame.reserved.zw))){return;}let key=atomicLoad(&pixels[id.y*u32(frame.viewport.x)+id.x]);atomicStore(&basePixels[destination.y*u32(frame.reserved.z)+destination.x],key);}
