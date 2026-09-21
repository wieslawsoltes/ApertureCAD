@group(0) @binding(0) var<storage,read> fontData:array<u32>;
@group(0) @binding(1) var<uniform> fontInfo:FontInfo;
@group(0) @binding(2) var atlasOut:texture_storage_2d<rgba8unorm,write>;
struct FontInfo { atlas: vec4<u32>, metrics: vec4<f32>, digits0:vec4<u32>,digits1:vec4<u32>,digits2:vec4<u32>,ink:vec4<f32> }
struct Glyph { range:vec4<u32>, box:vec4<f32>, metrics:vec4<f32> }
fn fontFloat(i:u32)->f32{return bitcast<f32>(fontData[i]);}
fn glyphAt(id:u32)->Glyph {let i=min(id,fontInfo.atlas.z-1u)*12u;return Glyph(vec4<u32>(fontData[i],fontData[i+1u],fontData[i+2u],fontData[i+3u]),vec4<f32>(fontFloat(i+4u),fontFloat(i+5u),fontFloat(i+6u),fontFloat(i+7u)),vec4<f32>(fontFloat(i+8u),fontFloat(i+9u),0.,0.));}
fn segmentDistance(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32 {let d=b-a;let t=clamp(dot(p-a,d)/max(dot(d,d),1e-24),0.,1.);return length(p-a-t*d);}
fn windingEdge(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->i32 {if((a.y<=p.y&&b.y>p.y)||(a.y>p.y&&b.y<=p.y)){let x=a.x+(p.y-a.y)*(b.x-a.x)/(b.y-a.y);if(x>p.x){return select(-1,1,b.y>a.y);}}return 0;}
// Closed-form closest-point roots remove the old 4..128-segment glyph approximation.
// Coefficients are normalized before Cardano; nearly linear quadratics use a segment.
fn signedCubeRoot(x:f32)->f32 {return sign(x)*pow(abs(x),1./3.);}
fn quadraticAt(a:vec2<f32>,u:vec2<f32>,v:vec2<f32>,t:f32)->vec2<f32>{return a+t*(u+t*v);}
fn quadraticDistance(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>,c:vec2<f32>)->f32 {
 let u=2.*(c-a);let v=a-2.*c+b;let w=a-p;let vv=dot(v,v);
 if(vv<1e-12*max(dot(u,u),1e-12)){return segmentDistance(p,a,b);}
 let aa=1.5*dot(u,v)/vv;let bb=(dot(u,u)+2.*dot(w,v))/(2.*vv);let cc=dot(w,u)/(2.*vv);
 let pp=bb-aa*aa/3.;let qq=2.*aa*aa*aa/27.-aa*bb/3.+cc;let halfQ=qq*.5;
 let disc=halfQ*halfQ+pp*pp*pp/27.;var roots:array<f32,3>;var rootCount=1u;
 if(disc>=0.){let h=sqrt(disc);let z=-halfQ-select(-h,h,halfQ>=0.);let first=signedCubeRoot(z);var second=0.;if(abs(first)>1e-20){second=-pp/(3.*first);}roots[0]=first+second-aa/3.;}
 else {let radius=2.*sqrt(max(0.,-pp/3.));let theta=acos(clamp(-halfQ/max(sqrt(max(0.,-pp*pp*pp/27.)),1e-30),-1.,1.))/3.;rootCount=3u;
  for(var i=0u;i<3u;i++){roots[i]=radius*cos(theta-f32(i)*2.0943951023931953)-aa/3.;}}
 var answer=min(dot(w,w),dot(b-p,b-p));
 for(var i=0u;i<rootCount;i++){var t=clamp(roots[i],0.,1.);
  // Two guarded Newton corrections recover precision lost in depressed-cubic cancellation.
  for(var j=0u;j<2u;j++){let q=quadraticAt(a,u,v,t)-p;let d=u+2.*t*v;let denominator=dot(d,d)+2.*dot(q,v);if(abs(denominator)>1e-18){t=clamp(t-dot(q,d)/denominator,0.,1.);}}
  let q=quadraticAt(a,u,v,t)-p;answer=min(answer,dot(q,q));}
 return sqrt(max(0.,answer));
}
fn quadraticWindingRoot(p:vec2<f32>,a:vec2<f32>,u:vec2<f32>,v:vec2<f32>,t:f32)->i32 {
 if(t<0.||t>1.){return 0;}let dy=u.y+2.*t*v.y;
 if(dy==0.||(t==0.&&dy<0.)||(t==1.&&dy>0.)){return 0;}
 if(quadraticAt(a,u,v,t).x>p.x){return select(-1,1,dy>0.);}return 0;
}
fn quadraticWinding(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>,c:vec2<f32>)->i32 {
 let u=2.*(c-a);let v=a-2.*c+b;let y=a.y-p.y;
 if(abs(v.y)<1e-12){if(abs(u.y)<1e-20){return 0;}return quadraticWindingRoot(p,a,u,v,-y/u.y);}
 let disc=u.y*u.y-4.*v.y*y;if(disc<=0.){return 0;}
 let q=-.5*(u.y+select(-sqrt(disc),sqrt(disc),u.y>=0.));
 if(abs(q)<1e-25){return quadraticWindingRoot(p,a,u,v,-u.y/(2.*v.y));}
 return quadraticWindingRoot(p,a,u,v,q/v.y)+quadraticWindingRoot(p,a,u,v,y/q);
}
fn glyphDistance(g:Glyph,p:vec2<f32>,pixelsPerEm:f32)->f32 {
 var distance=1e10;var winding=0;
 for(var i=0u;i<g.range.y;i++){let o=fontInfo.atlas.w+(g.range.x+i)*8u;let a=vec2<f32>(fontFloat(o),fontFloat(o+1u));let b=vec2<f32>(fontFloat(o+2u),fontFloat(o+3u));let control=vec2<f32>(fontFloat(o+4u),fontFloat(o+5u));
  if(fontFloat(o+6u)>1.5){let radius=b.x;let begin=b.y;let sweep=control.x;var delta=atan2(p.y-a.y,p.x-a.x)-begin;if(sweep<0.){delta=-delta;}delta-=floor(delta/6.283185307179586)*6.283185307179586;
    let p0=a+vec2<f32>(cos(begin),sin(begin))*radius;let p1=a+vec2<f32>(cos(begin+sweep),sin(begin+sweep))*radius;
    var d=min(length(p-p0),length(p-p1));if(delta<=abs(sweep)){d=min(d,abs(length(p-a)-abs(radius)));}distance=min(distance,d);
   }else if(fontFloat(o+6u)<.5){distance=min(distance,segmentDistance(p,a,b));winding+=windingEdge(p,a,b);}else{
   distance=min(distance,quadraticDistance(p,a,b,control));winding+=quadraticWinding(p,a,b,control);
  }
 }
 if(g.range.z==0u){return g.metrics.y-distance;}return select(-distance,distance,winding!=0);
}
fn digitGlyph(digit:u32)->u32 {if(digit<4u){return fontInfo.digits0[digit];}if(digit<8u){return fontInfo.digits1[digit-4u];}return fontInfo.digits2[digit-8u];}

@compute @workgroup_size(8,8)
fn bake(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=fontInfo.atlas.x||id.y>=fontInfo.atlas.y){return;}let cell=u32(fontInfo.metrics.y);let columns=u32(fontInfo.metrics.z);let gid=(id.y/cell)*columns+id.x/cell;if(gid>=fontInfo.atlas.z){textureStore(atlasOut,vec2<i32>(id.xy),vec4<f32>(0.));return;}
 let g=glyphAt(gid);let uv=(vec2<f32>(id.xy%cell)+.5)/f32(cell);let p=mix(g.box.xy,g.box.zw,vec2<f32>(uv.x,1.-uv.y));let scale=f32(cell)/max(g.box.z-g.box.x,g.box.w-g.box.y);let d=glyphDistance(g,p,scale);let v=clamp(.5+d*4.,0.,1.);textureStore(atlasOut,vec2<i32>(id.xy),vec4<f32>(v,v,v,1.));}
