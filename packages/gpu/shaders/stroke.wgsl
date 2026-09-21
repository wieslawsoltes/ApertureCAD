@group(0) @binding(0) var<storage,read_write> fontData:array<u32>;
@group(0) @binding(1) var<uniform> fontInfo:FontInfo;
@group(0) @binding(2) var<storage,read> programs:array<u32>;
// @font-common
const ST_PI=3.141592653589793;
const VX=array<f32,16>(1.,1.,1.,.5,0.,-.5,-1.,-1.,-1.,-1.,-1.,-.5,0.,.5,1.,1.);
const VY=array<f32,16>(0.,.5,1.,1.,1.,1.,1.,.5,0.,-.5,-1.,-1.,-1.,-1.,-1.,-.5);
fn operand(i:u32)->f32{return f32(bitcast<i32>(programs[i]));}
fn writeStrokeEdge(slot:u32,a:vec2<f32>,b:vec2<f32>,control:vec2<f32>,kind:f32){let o=fontInfo.atlas.w+slot*8u;
 fontData[o]=bitcast<u32>(a.x);fontData[o+1u]=bitcast<u32>(a.y);fontData[o+2u]=bitcast<u32>(b.x);fontData[o+3u]=bitcast<u32>(b.y);
 fontData[o+4u]=bitcast<u32>(control.x);fontData[o+5u]=bitcast<u32>(control.y);fontData[o+6u]=bitcast<u32>(kind);fontData[o+7u]=0u;}
@compute @workgroup_size(1)
fn compileStroke(@builtin(global_invocation_id) id:vec3<u32>){let gid=id.x;if(gid>=fontInfo.atlas.z){return;}
 let glyphRecord=gid*12u;let edgeBase=fontData[glyphRecord];let capacity=programs[gid*4u+2u];var position=vec2<f32>(0.);var scale=fontInfo.metrics.w;var down=true;
 var lo=vec2<f32>(1e20);var hi=vec2<f32>(-1e20);var count=0u;var error=0u;
 var locationStack:array<vec2<f32>,64>;var depth=0u;var calls:array<vec2<u32>,32>;var callDepth=0u;
 var pc=programs[gid*4u];var end=pc+programs[gid*4u+1u]*8u;var executed=0u;
 loop {if(pc>=end){error=1u;break;}if(executed>=2000000u){error=2u;break;}executed++;
  let op=programs[pc];let base=pc;pc+=8u;if(programs[base+7u]!=0u&&fontInfo.digits2.w==0u){continue;}
  if(op==0u){if(callDepth==0u){break;}callDepth--;pc=calls[callDepth].x;end=calls[callDepth].y;continue;}
  if(op==1u){down=true;continue;}if(op==2u){down=false;continue;}
  if(op==3u){scale/=operand(base+1u);continue;}if(op==4u){scale*=operand(base+1u);continue;}
  if(op==5u){if(depth>=64u){error=3u;break;}locationStack[depth]=position;depth++;continue;}
  if(op==6u){if(depth==0u){error=4u;break;}depth--;position=locationStack[depth];continue;}
  if(op==7u){if(callDepth>=32u){error=5u;break;}calls[callDepth]=vec2<u32>(pc,end);callDepth++;let sub=programs[base+1u];pc=programs[sub*4u];end=pc+programs[sub*4u+1u]*8u;down=true;continue;}
  var next=position;var center=vec2<f32>(0.);var radius=0.;var angle=0.;var sweep=0.;var arc=false;
  if(op==8u||op==12u){next+=vec2<f32>(operand(base+1u),operand(base+2u))*scale;
   let bulge=operand(base+3u)/127.;if(op==12u&&abs(bulge)>1e-10&&length(next-position)>1e-12){let delta=next-position;center=(position+next)*.5+vec2<f32>(-delta.y,delta.x)*(1.-bulge*bulge)/(4.*bulge);radius=length(position-center);angle=atan2(position.y-center.y,position.x-center.x);sweep=4.*atan(bulge);arc=true;}
  }else if(op==16u){let direction=programs[base+2u]&15u;next+=vec2<f32>(VX[direction],VY[direction])*operand(base+1u)*scale;}
  else if(op==10u||op==11u){let spec=bitcast<i32>(programs[base+select(2u,5u,op==11u)]);let v=u32(abs(spec));let sign=select(-1.,1.,spec>=0);let octant=(v>>4u)&15u;var span=v&15u;if(span==0u){span=8u;}
   angle=f32(octant)*ST_PI*.25;sweep=sign*f32(span)*ST_PI*.25;radius=operand(base+1u)*scale;
   if(op==11u){let begin=operand(base+1u)/256.;var finish=operand(base+2u)/256.;if(finish==0.){finish=1.;}
    radius=(operand(base+3u)*256.+operand(base+4u))*scale;angle+=sign*begin*ST_PI*.25;sweep=sign*(f32(span)-1.+finish-begin)*ST_PI*.25;}
   center=position-vec2<f32>(cos(angle),sin(angle))*radius;next=center+vec2<f32>(cos(angle+sweep),sin(angle+sweep))*radius;arc=true;
  }else {error=6u;break;}
  if(down){if(count>=capacity){error=7u;break;}if(arc){writeStrokeEdge(edgeBase+count,center,vec2<f32>(radius,angle),vec2<f32>(sweep,0.),2.);lo=min(lo,center-abs(radius));hi=max(hi,center+abs(radius));}
   else{writeStrokeEdge(edgeBase+count,position,next,vec2<f32>(0.),0.);lo=min(lo,min(position,next));hi=max(hi,max(position,next));}count++;}
  position=next;
 }
 if(count==0u){lo=vec2<f32>(0.);hi=vec2<f32>(max(position.x,.2),1.);}let pad=.08;
 fontData[glyphRecord+1u]=count;fontData[glyphRecord+3u]=error;fontData[glyphRecord+4u]=bitcast<u32>(lo.x-pad);fontData[glyphRecord+5u]=bitcast<u32>(lo.y-pad);
 fontData[glyphRecord+6u]=bitcast<u32>(hi.x+pad);fontData[glyphRecord+7u]=bitcast<u32>(hi.y+pad);fontData[glyphRecord+8u]=bitcast<u32>(position.x);
}
