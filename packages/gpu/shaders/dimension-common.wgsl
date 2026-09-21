// Parametric dimensions are never expanded into CPU line/text entities.
struct DimensionGeometry {a:vec2<f32>,b:vec2<f32>,ea:vec2<f32>,eb:vec2<f32>,center:vec2<f32>,label:vec2<f32>,value:f32,radius:f32,start:f32,sweep:f32,angle:f32,kind:u32}
fn cross2(a:vec2<f32>,b:vec2<f32>)->f32{return a.x*b.y-a.y*b.x;}
fn safeUnit(v:vec2<f32>)->vec2<f32>{return v/max(length(v),1e-20);}
fn dimensionGeometry(e:Entity)->DimensionGeometry {
 let o=e.data.x;let kind=aux[o];let location=av(o+4u);let p1=av(o+10u);let p2=av(o+12u);let p3=av(o+14u);let p4=av(o+16u);
 var d=DimensionGeometry(vec2<f32>(0.),vec2<f32>(0.),p1,p2,vec2<f32>(0.),vec2<f32>(0.),0.,0.,0.,0.,0.,kind);
 if(kind<=1u){d.angle=select(af(o+18u),atan2(p2.y-p1.y,p2.x-p1.x),kind==1u);let t=vec2<f32>(cos(d.angle),sin(d.angle));let n=vec2<f32>(-t.y,t.x);
  d.a=p1+n*dot(location-p1,n);d.b=p2+n*dot(location-p2,n);d.value=abs(dot(p2-p1,t));d.label=(d.a+d.b)*.5+n*(af(o+19u)*.35+af(o+23u));
 }else if(kind==3u||kind==4u){d.a=location;d.b=p3;d.value=length(d.b-d.a);d.angle=atan2(d.b.y-d.a.y,d.b.x-d.a.x);let n=vec2<f32>(-sin(d.angle),cos(d.angle));d.label=(d.a+d.b)*.5+n*(af(o+19u)*.35+af(o+23u));
 }else if(kind==2u||kind==5u){var center=p3;var da=p1-center;var db=p2-center;var arcLocation=location;
  if(kind==2u){let u=p2-p1;let v=location-p3;let den=cross2(u,v);if(abs(den)>1e-20){center=p1+u*(cross2(p3-p1,v)/den);}else{center=p1;}
   da=p2-center;db=location-center;arcLocation=p4;}
  d.center=center;d.radius=length(arcLocation-center);d.start=atan2(da.y,da.x);let end=atan2(db.y,db.x);var sweep=end-d.start;sweep-=floor(sweep/TAU)*TAU;
  let at=atan2(arcLocation.y-center.y,arcLocation.x-center.x);if(!angleInArc(at,d.start,sweep)){sweep-=TAU;}
  d.sweep=sweep;d.value=abs(sweep)*180./PI;d.a=center+safeUnit(da)*d.radius;d.b=center+safeUnit(db)*d.radius;
  let middle=d.start+sweep*.5;d.label=center+vec2<f32>(cos(middle),sin(middle))*(d.radius+af(o+19u)*.35+af(o+23u));d.angle=middle+PI*.5;
 }else {d.a=p1;d.b=p2;let xaxis=(aux[o+1u]&64u)!=0u;d.value=select(p1.y-location.y,p1.x-location.x,xaxis);d.label=p2+vec2<f32>(af(o+23u),af(o+23u));d.angle=0.;}
 d.value*=af(o+24u);let rounding=af(o+25u);if(rounding>0.){d.value=round(d.value/rounding)*rounding;}
 if((aux[o+1u]&128u)!=0u){d.label=av(o+6u);}
 if(cos(d.angle)<0.){d.angle+=PI;}
 return d;
}
fn dimensionBounds(e:Entity)->vec4<f32>{let d=dimensionGeometry(e);let o=e.data.x;var lo=min(min(d.a,d.b),min(d.ea,d.eb));var hi=max(max(d.a,d.b),max(d.ea,d.eb));
 if(d.kind==2u||d.kind==5u){lo=min(lo,d.center-d.radius);hi=max(hi,d.center+d.radius);}
 let padding=max(af(o+20u)*2.,max(af(o+19u)*48.,af(o+21u)+af(o+22u)));lo=min(lo,d.label)-padding;hi=max(hi,d.label)+padding;
 return transformedBounds(e.world.xy+e.world.zw,entityMatrix(e),vec4<f32>(lo,hi));
}
fn dimensionArrow(e:Entity,tip:vec2<f32>,direction:vec2<f32>,lane:u32,stride:u32){let size=af(e.data.x+20u);let t=safeUnit(direction)*size;let n=vec2<f32>(-t.y,t.x)*.16;
 let a=screenPoint(e,tip);let b=screenPoint(e,tip+t+n);let c=screenPoint(e,tip+t-n);let lo=max(vec2<i32>(floor(min(a,min(b,c)))-1.),vec2<i32>(0));let hi=min(vec2<i32>(ceil(max(a,max(b,c)))+1.),vec2<i32>(frame.viewport.xy)-1);
 let width=hi.x-lo.x+1;let height=hi.y-lo.y+1;if(width<=0||height<=0){return;}let area=cross2(b-a,c-a);if(abs(area)<1e-12){return;}let sign=select(-1.,1.,area>=0.);
 for(var i=lane;i<u32(width*height);i+=stride){let pixel=lo+vec2<i32>(i32(i%u32(width)),i32(i/u32(width)));let p=vec2<f32>(pixel)+.5;
  let distance=min(sign*cross2(b-a,p-a)/max(length(b-a),1e-20),min(sign*cross2(c-b,p-b)/max(length(c-b),1e-20),sign*cross2(a-c,p-c)/max(length(a-c),1e-20)));
  put(pixel,clamp(.5+distance,0.,1.),e.tag.w);}
}
fn dimensionLabel(e:Entity,d:DimensionGeometry,lane:u32,stride:u32) {
 let o=e.data.x;let height=af(o+19u);if(height<=0.){return;}let decimalPlaces=min(aux[o+3u],8u);let factor=pow(10.,f32(decimalPlaces));let value=round(abs(d.value)*factor)/factor;
 let integral=u32(clamp(floor(log(max(1.,value))/log(10.))+1.,1.,32.));let negative=u32(d.value<0.);let symbol=u32(d.kind==3u||d.kind==4u);let degree=u32(d.kind==2u||d.kind==5u);
 var count=negative+symbol+integral+select(0u,decimalPlaces+1u,decimalPlaces>0u)+degree;var width=f32(count)*fontInfo.metrics.x;
 var label=e;label.data=vec4<u32>(aux[o+2u],0u,0xffffffffu,0u);if(aux[o+26u]!=0u){count=aux[label.data.x];width=af(label.data.x+1u);}
 let c=cos(d.angle);let s=sin(d.angle);let basis=entityMatrix(e)*mat2x2<f32>(vec2<f32>(c,s)*height,vec2<f32>(-s,c)*height);
 let sm=mat2x2<f32>(screenVector(basis[0]),screenVector(basis[1]));if(abs(cross2(sm[0],sm[1]))<1e-12){return;}
 let origin=screenPoint(e,d.label)-sm[0]*width*.5;let inverse=inverse2(sm);let scale=min(length(sm[0]),length(sm[1]));
 let box=transformedBounds(origin,sm,vec4<f32>(fontInfo.ink.x,fontInfo.ink.z-select(0.,af(label.data.x+2u),aux[o+26u]!=0u),width+fontInfo.ink.y,fontInfo.ink.w));
 let lo=max(vec2<i32>(floor(box.xy)),vec2<i32>(0));let hi=min(vec2<i32>(ceil(box.zw)),vec2<i32>(frame.viewport.xy)-1);let sz=hi-lo+1;if(any(sz<=vec2<i32>(0))){return;}
 for(var i=lane;i<u32(sz.x*sz.y);i+=stride){let pixel=lo+vec2<i32>(i32(i%u32(sz.x)),i32(i/u32(sz.x)));let pos=inverse*(vec2<f32>(pixel)+.5-origin);var coverage=0.;
  if(aux[o+26u]!=0u){coverage=shadeText(label,pos,scale);}else {
   let middle=i32(floor(pos.x/fontInfo.metrics.x));for(var ci=middle-1;ci<=middle+1;ci++){if(ci<0||ci>=i32(count)){continue;}var glyph=0u;var col=u32(ci);
    if(negative!=0u&&col==0u){glyph=aux[o+28u];}
    else if(symbol!=0u&&col==negative){glyph=select(aux[o+30u],aux[o+29u],d.kind==4u);}
    else if(degree!=0u&&col==count-1u){glyph=aux[o+31u];}
    else {col-=negative+symbol;if(decimalPlaces>0u&&col==integral){glyph=aux[o+27u];}
     else {let exponent=select(i32(integral)-1-i32(col),i32(integral)-i32(col),col>integral);let power=pow(10.,f32(exponent));let q=floor(value/power+.00001);let digit=u32(clamp(q-floor(q/10.)*10.,0.,9.));glyph=digitGlyph(digit);}}
    coverage=max(coverage,glyphCoverage(glyph,pos-vec2<f32>(f32(ci)*fontInfo.metrics.x,0.),scale));}
  }
  put(pixel,coverage,e.tag.w);
 }
}
fn rasterDimension(e:Entity,lane:u32,stride:u32){let d=dimensionGeometry(e);let o=e.data.x;let width=frame.settings.z*frame.viewport.w;
 if(d.kind==2u||d.kind==5u){ellipseStroke(e,d.center,vec2<f32>(d.radius,0.),vec2<f32>(0.,d.radius),d.start,d.sweep,lane,stride);
  let sign=select(-1.,1.,d.sweep>=0.);dimensionArrow(e,d.a,vec2<f32>(-sin(d.start),cos(d.start))*sign,lane,stride);let end=d.start+d.sweep;dimensionArrow(e,d.b,vec2<f32>(sin(end),-cos(end))*sign,lane,stride);
 }else if(d.kind==6u){let elbow=select(vec2<f32>(d.a.x,d.b.y),vec2<f32>(d.b.x,d.a.y),(aux[o+1u]&64u)!=0u);stroke(screenPoint(e,d.a),screenPoint(e,elbow),width,e.tag.w,lane,stride,vec2<f32>(0.));stroke(screenPoint(e,elbow),screenPoint(e,d.b),width,e.tag.w,lane,stride,vec2<f32>(0.));}
 else{stroke(screenPoint(e,d.a),screenPoint(e,d.b),width,e.tag.w,lane,stride,vec2<f32>(0.));let t=safeUnit(d.b-d.a);if(d.kind!=4u){dimensionArrow(e,d.a,t,lane,stride);}dimensionArrow(e,d.b,-t,lane,stride);
  if(d.kind<=1u){let na=safeUnit(d.a-d.ea);let nb=safeUnit(d.b-d.eb);stroke(screenPoint(e,d.ea+na*af(o+21u)),screenPoint(e,d.a+na*af(o+22u)),width,e.tag.w,lane,stride,vec2<f32>(0.));stroke(screenPoint(e,d.eb+nb*af(o+21u)),screenPoint(e,d.b+nb*af(o+22u)),width,e.tag.w,lane,stride,vec2<f32>(0.));}}
 dimensionLabel(e,d,lane,stride);
}
