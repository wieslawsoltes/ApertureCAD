// Programs are font-global. Text is shaped once per unique run during GPU preparation.
const CONSUMED_GLYPH=0xfffffffeu;
fn layoutWord(base:u32,offset:u32)->u32{return fontData[base+offset];}
fn shapeRun(o:u32){let n=aux[o];let source=o+4u+n*4u;for(var i=0u;i<n;i++){aux[o+4u+i*4u]=aux[source+i];}
 let base=fontInfo.digits2.z;if(base==0u){return;}let count=layoutWord(base,1u);let tables=layoutWord(base,2u);
 for(var k=0u;k<count;k++){let lookup=tables+k*4u;let entries=layoutWord(base,lookup+1u);let entryCount=layoutWord(base,lookup);
  for(var i=0u;i<n;i++){let first=aux[o+4u+i*4u];if(first>=CONSUMED_GLYPH){continue;}var low=0u;var high=entryCount;
   loop{if(low>=high){break;}let middle=(low+high)/2u;if(layoutWord(base,entries+middle*4u)<first){low=middle+1u;}else{high=middle;}}
   if(low>=entryCount||layoutWord(base,entries+low*4u)!=first){continue;}let entry=entries+low*4u;let ruleCount=layoutWord(base,entry+1u);let rules=layoutWord(base,entry+2u);
   for(var r=0u;r<ruleCount;r++){let rule=rules+r*4u;let length=layoutWord(base,rule+1u);let components=layoutWord(base,rule+2u);var matched=true;var at=i;var matchedIndices:array<u32,32>;
    for(var c=1u;c<length;c++){at++;loop{if(at>=n||aux[o+4u+at*4u]!=CONSUMED_GLYPH){break;}at++;}if(at>=n||aux[o+4u+at*4u]!=layoutWord(base,components+c-1u)){matched=false;break;}matchedIndices[c]=at;}
    if(matched){aux[o+4u+i*4u]=layoutWord(base,rule);for(var c=1u;c<length;c++){aux[o+4u+matchedIndices[c]*4u]=CONSUMED_GLYPH;}break;}
   }
  }
 }
}
fn pairAdvance(left:u32,right:u32)->f32{let base=fontInfo.digits2.z;if(base==0u||left>=CONSUMED_GLYPH||right>=CONSUMED_GLYPH){return 0.;}
 let lookupCount=layoutWord(base,3u);let lookupTable=layoutWord(base,4u);let glyphCount=layoutWord(base,5u);var advance=0.;
 for(var li=0u;li<lookupCount;li++){let lookup=lookupTable+li*4u;let n=layoutWord(base,lookup);let tables=layoutWord(base,lookup+1u);let overrideValue=layoutWord(base,lookup+2u)!=0u;var matched=false;var adjustment=0.;
  for(var i=0u;i<n;i++){let o=tables+i*4u;let kind=layoutWord(base,o);if(kind==1u){let count=layoutWord(base,o+1u);let entries=layoutWord(base,o+2u);let key=left*glyphCount+right;var low=0u;var high=count;
    loop{if(low>=high){break;}let mid=(low+high)/2u;if(layoutWord(base,entries+mid*2u)<key){low=mid+1u;}else{high=mid;}}
    if(low<count&&layoutWord(base,entries+low*2u)==key){adjustment=bitcast<f32>(layoutWord(base,entries+low*2u+1u));matched=true;}
   }else{let classes=layoutWord(base,o+1u);let c1=layoutWord(base,classes+left*2u);if(c1>0u){let c2=layoutWord(base,classes+right*2u+1u);let columns=layoutWord(base,o+2u);let matrix=layoutWord(base,o+3u);adjustment=bitcast<f32>(layoutWord(base,matrix+(c1-1u)*columns+c2));matched=true;}}
   if(matched){break;}
  }if(matched){advance=select(advance+adjustment,adjustment,overrideValue);}
 }return advance;
}
