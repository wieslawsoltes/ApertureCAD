// Analytic line / bulge / conic boundaries and rational B-spline edge evaluation.
struct HatchArc { center:vec2<f32>,major:vec2<f32>,minor:vec2<f32>,start:f32,sweep:f32 }
fn hatchArc(o:u32)->HatchArc {
 if(aux[o]==3u){let a=av(o+6u);return HatchArc(av(o+4u),a,vec2<f32>(-a.y,a.x)*af(o+8u),af(o+9u),af(o+10u));}
 let a=av(o+4u);let b=av(o+6u);let v=af(o+8u);let d=b-a;let center=(a+b)*.5+vec2<f32>(-d.y,d.x)*(1.-v*v)/(4.*v);let r=length(a-center);
 return HatchArc(center,vec2<f32>(r,0.),vec2<f32>(0.,r),atan2(a.y-center.y,a.x-center.x),4.*atan(v));
}
fn hatchBounds(e:Entity)->vec4<f32>{let origin=e.world.xy+e.world.zw;let m=entityMatrix(e);let o=e.data.x;var lo=vec2<f32>(1e30);var hi=vec2<f32>(-1e30);
 for(var i=0u;i<aux[o+1u];i++){let row=aux[o+5u]+i*8u;var period=0.;for(var j=0u;j<aux[row+5u];j++){period+=abs(af(aux[row+6u]+j));}aux[row+7u]=bitcast<u32>(period);}
 for(var i=0u;i<aux[o];i++){let edge=aux[o+4u]+i*16u;let kind=aux[edge];
  if(kind==1u||(kind==2u&&abs(af(edge+8u))<1e-7)){let a=origin+m*av(edge+4u);let b=origin+m*av(edge+6u);lo=min(lo,min(a,b));hi=max(hi,max(a,b));}
  else if(kind==2u||kind==3u){let arc=hatchArc(edge);let c=origin+m*arc.center;let r=ellipseExtent(m,arc.major,arc.minor);lo=min(lo,c-r);hi=max(hi,c+r);}
  else if(kind==4u){let so=aux[edge+3u];let points=so+4u+aux[so+1u];var localLo=vec2<f32>(1e30);var localHi=vec2<f32>(-1e30);
   for(var j=0u;j<aux[so+2u];j++){let raw=av(points+j*4u);localLo=min(localLo,raw);localHi=max(localHi,raw);let p=origin+m*raw;lo=min(lo,p);hi=max(hi,p);}
   aux[edge+11u]=bitcast<u32>(localLo.x);aux[edge+12u]=bitcast<u32>(localLo.y);aux[edge+13u]=bitcast<u32>(localHi.x);aux[edge+14u]=bitcast<u32>(localHi.y);}
 }
 return vec4<f32>(lo,hi);
}
fn rayCrossing(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->u32{if((a.y>p.y)!=(b.y>p.y)){return u32(a.x+(p.y-a.y)*(b.x-a.x)/(b.y-a.y)>p.x);}return 0u;}
fn conicCrossings(p:vec2<f32>,arc:HatchArc)->u32 {
 let ry=length(vec2<f32>(arc.major.y,arc.minor.y));if(ry<1e-20){return 0u;}let z=(p.y-arc.center.y)/ry;if(abs(z)>=1.){return 0u;}
 let phi=atan2(arc.minor.y,arc.major.y);let theta=acos(z);var count=0u;
 for(var i=0u;i<2u;i++){let t=phi+select(-theta,theta,i==1u);let x=arc.center.x+arc.major.x*cos(t)+arc.minor.x*sin(t);
  if(x>p.x&&angleInArc(t,arc.start,arc.sweep)){count++;}}
 return count;
}
fn hatchInside(e:Entity,p:vec2<f32>,scale:f32)->bool {let o=e.data.x;var crossings=0u;
 for(var i=0u;i<aux[o];i++){let edge=aux[o+4u]+i*16u;let flags=aux[edge+2u];let style=aux[o+2u];
  if(style==2u&&(flags&1u)==0u){continue;}if(style==1u&&(flags&17u)==0u){continue;}
  let kind=aux[edge];if(kind==1u||(kind==2u&&abs(af(edge+8u))<1e-7)){crossings+=rayCrossing(p,av(edge+4u),av(edge+6u));}
  else if(kind==2u||kind==3u){crossings+=conicCrossings(p,hatchArc(edge));}
  else if(kind==4u){let so=aux[edge+3u];let degree=aux[so];let nk=aux[so+1u];let low=af(so+4u+degree);let high=af(so+4u+nk-degree-1u);
   let lo=av(edge+11u);let hi=av(edge+13u);if(p.y<lo.y||p.y>=hi.y||p.x>=hi.x){continue;}
   let steps=u32(clamp(max(f32(aux[so+2u])*12.,sqrt(max(1.,length(hi-lo)*scale)/max(frame.settings.y,.03))*4.),8.,16384.));var a=nurbsPoint(so,low);
   for(var j=1u;j<=steps;j++){let b=nurbsPoint(so,mix(low,high,f32(j)/f32(steps)));crossings+=rayCrossing(p,a,b);a=b;}
  }
 }
 return (crossings&1u)!=0u;
}
fn hatchPattern(e:Entity,p:vec2<f32>,inverse:mat2x2<f32>)->f32 {
 let o=e.data.x;if(aux[o+3u]!=0u){return 1.;}var coverage=0.;
 for(var i=0u;i<aux[o+1u];i++){let row=aux[o+5u]+i*8u;let a=af(row);let tangent=vec2<f32>(cos(a),sin(a));let normal=vec2<f32>(-tangent.y,tangent.x);
  let base=av(row+1u);let shift=av(row+3u);let spacing=dot(shift,normal);if(abs(spacing)<1e-20){continue;}
  let normalPerPixel=length(vec2<f32>(dot(inverse[0],normal),dot(inverse[1],normal)));let tangentPerPixel=length(vec2<f32>(dot(inverse[0],tangent),dot(inverse[1],tangent)));
  let nearest=round(dot(p-base,normal)/spacing);let y=abs(dot(p-base-nearest*shift,normal))/max(normalPerPixel,1e-20);
  let lineCoverage=clamp(.5+frame.settings.z*frame.viewport.w*.5-y,0.,1.);if(lineCoverage==0.){continue;}
  let nd=aux[row+5u];if(nd==0u){coverage=max(coverage,lineCoverage);continue;}
  let dash=aux[row+6u];let period=af(row+7u);if(period<=1e-20){continue;}
  let along=dot(p-base-nearest*shift,tangent);let phase=along-floor(along/period)*period;var cursor=0.;var ink=0.;
  for(var j=0u;j<nd;j++){let size=af(dash+j);let endpoint=cursor+abs(size);
   if(size>=0.){var distance=0.;if(size==0.){distance=min(abs(phase-cursor),period-abs(phase-cursor));}else{distance=max(cursor-phase,phase-endpoint);}
    ink=max(ink,clamp(.5-distance/max(tangentPerPixel,1e-20),0.,1.));}cursor=endpoint;}
  coverage=max(coverage,min(lineCoverage,ink));
 }
 return coverage;
}
