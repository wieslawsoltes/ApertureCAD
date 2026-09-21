/** Defensive OpenType table decoding. Only GPU kernels apply these programs to text.
 * The current profile supports GSUB single/ligature and horizontal GPOS pair/class kerning.
 * Script/language selection and unsupported lookups are reported, never guessed as full shaping.
 */
import {WordArena} from '../model/index.js';
export function readOpenTypeLayout(view,tables,units,{script='latn',language=null,features=['ccmp','liga','rlig','kern'],maxRecords=1000000}={}) {
    const diagnostics=[], substitutions=[], positioning=[];let recordCount=0;
    const warn=message=>{if(!diagnostics.includes(message))diagnostics.push(message);};
    function reader(table){const start=table.o,end=start+table.n;const need=(o,n)=>{if(!Number.isInteger(o)||o<start||o+n>end)throw new Error('OpenType layout offset outside table.');};return {u16:o=>(need(o,2),view.getUint16(o)),i16:o=>(need(o,2),view.getInt16(o)),u32:o=>(need(o,4),view.getUint32(o)),tag:o=>(need(o,4),String.fromCharCode(...new Uint8Array(view.buffer,view.byteOffset+o,4)))};}
    function addRecords(n){recordCount+=n;if(recordCount>maxRecords)throw new Error('OpenType layout record budget exceeded.');}
    function coverage(r,o){const f=r.u16(o),n=r.u16(o+2),a=[];if(f===1){for(let i=0;i<n;i++)a.push(r.u16(o+4+i*2));}else if(f===2){for(let i=0;i<n;i++){const p=o+4+i*6,start=r.u16(p),end=r.u16(p+2),index=r.u16(p+4);if(end<start||index!==a.length)throw new Error('Invalid OpenType coverage range.');for(let g=start;g<=end;g++)a.push(g);}}else throw new Error('Unknown OpenType coverage format.');addRecords(a.length);return a;}
    function classes(r,o){const f=r.u16(o),map=new Map();if(f===1){const start=r.u16(o+2),n=r.u16(o+4);for(let i=0;i<n;i++)map.set(start+i,r.u16(o+6+i*2));}else if(f===2){const n=r.u16(o+2);for(let i=0;i<n;i++){const p=o+4+i*6,start=r.u16(p),end=r.u16(p+2),c=r.u16(p+4);if(end<start)throw new Error('Invalid OpenType class range.');for(let g=start;g<=end;g++)map.set(g,c);}}else throw new Error('Unknown OpenType class format.');addRecords(map.size);return map;}
    function selected(table){const r=reader(table),b=table.o,sl=b+r.u16(b+4),fl=b+r.u16(b+6),ll=b+r.u16(b+8);let scriptOffset=0,fallback=0;
        for(let i=0,n=r.u16(sl);i<n;i++){const p=sl+2+i*6,tag=r.tag(p),offset=sl+r.u16(p+4);if(tag===script)scriptOffset=offset;if(tag==='DFLT')fallback=offset;}
        scriptOffset ||= fallback;if(!scriptOffset)return {r,ll,indices:[]};let languageOffset=r.u16(scriptOffset)?scriptOffset+r.u16(scriptOffset):0;
        if(language)for(let i=0,n=r.u16(scriptOffset+2);i<n;i++){const p=scriptOffset+4+i*6;if(r.tag(p)===language)languageOffset=scriptOffset+r.u16(p+4);}
        if(!languageOffset)return {r,ll,indices:[]};const selectedFeatures=[],required=r.u16(languageOffset+2);if(required!==65535)selectedFeatures.push(required);
        for(let i=0,n=r.u16(languageOffset+4);i<n;i++)selectedFeatures.push(r.u16(languageOffset+6+i*2));const indices=new Set(),nf=r.u16(fl),nl=r.u16(ll);
        for(const fi of selectedFeatures){if(fi>=nf)throw new Error('OpenType feature index outside table.');const p=fl+2+fi*6,tag=r.tag(p);if(fi!==required&&!features.includes(tag))continue;const f=fl+r.u16(p+4);for(let i=0,n=r.u16(f+2);i<n;i++){const index=r.u16(f+4+i*2);if(index>=nl)throw new Error('OpenType lookup index outside table.');indices.add(index);}}
        return {r,ll,indices:[...indices].sort((a,b)=>a-b)};
    }
    if(tables.GSUB){const {r,ll,indices}=selected(tables.GSUB);for(const index of indices){const lookup=ll+r.u16(ll+2+index*2),type=r.u16(lookup),flags=r.u16(lookup+2),rules=[];
        if(flags){warn(`GSUB lookup ${index}: lookup flags ${flags} need mark filtering; skipped.`);continue;}
        for(let si=0,n=r.u16(lookup+4);si<n;si++){let o=lookup+r.u16(lookup+6+si*2),t=type;if(t===7){if(r.u16(o)!==1)throw new Error('Invalid GSUB extension.');t=r.u16(o+2);o+=r.u32(o+4);}
            const format=r.u16(o);if(t===1){const glyphs=coverage(r,o+r.u16(o+2));if(format===1){const delta=r.i16(o+4);for(const g of glyphs)rules.push({input:[g],output:(g+delta)&65535});}else if(format===2){if(r.u16(o+4)!==glyphs.length)throw new Error('GSUB coverage/substitution mismatch.');glyphs.forEach((g,i)=>rules.push({input:[g],output:r.u16(o+6+i*2)}));}else throw new Error('Unknown GSUB single format.');}
            else if(t===4&&format===1){const glyphs=coverage(r,o+r.u16(o+2));if(r.u16(o+4)!==glyphs.length)throw new Error('GSUB ligature coverage mismatch.');glyphs.forEach((g,i)=>{const set=o+r.u16(o+6+i*2);for(let j=0,n=r.u16(set);j<n;j++){const l=set+r.u16(set+2+j*2),count=r.u16(l+2);if(count<2||count>32){warn('GSUB ligatures outside 2..32 components were skipped.');continue;}const input=[g];for(let k=1;k<count;k++)input.push(r.u16(l+2+k*2));rules.push({input,output:r.u16(l)});}});}
            else warn(`GSUB lookup type ${t}, format ${format} is not in the current horizontal profile.`);
        }addRecords(rules.length);if(rules.length)substitutions.push({index,rules});}}
    if(tables.GPOS){const {r,ll,indices}=selected(tables.GPOS);for(const index of indices){const lookup=ll+r.u16(ll+2+index*2),type=r.u16(lookup),flags=r.u16(lookup+2),subtables=[];
        if(flags){warn(`GPOS lookup ${index}: lookup flags ${flags} need mark filtering; skipped.`);continue;}
        for(let si=0,n=r.u16(lookup+4);si<n;si++){let o=lookup+r.u16(lookup+6+si*2),t=type;if(t===9){if(r.u16(o)!==1)throw new Error('Invalid GPOS extension.');t=r.u16(o+2);o+=r.u32(o+4);}
            const format=r.u16(o);if(t!==2||![1,2].includes(format)){warn(`GPOS lookup type ${t}, format ${format} is not in the current horizontal profile.`);continue;}
            const vf1=r.u16(o+4),vf2=r.u16(o+6);if((vf1&~4)!==0||vf2!==0){warn('GPOS non-advance placement/device adjustments were skipped.');continue;}const size=vf1&4?2:0,glyphs=coverage(r,o+r.u16(o+2));
            if(format===1){if(r.u16(o+8)!==glyphs.length)throw new Error('GPOS pair coverage mismatch.');const pairs=[];glyphs.forEach((left,i)=>{const set=o+r.u16(o+10+i*2),count=r.u16(set);for(let j=0;j<count;j++){const p=set+2+j*(2+size);pairs.push({left,right:r.u16(p),advance:size?r.i16(p+2)/units:0});}});addRecords(pairs.length);subtables.push({type:1,pairs});}
            else {const class1=classes(r,o+r.u16(o+8)),class2=classes(r,o+r.u16(o+10)),n1=r.u16(o+12),n2=r.u16(o+14);if(!n1||!n2)throw new Error('Empty GPOS class matrix.');addRecords(n1*n2);const matrix=new Float32Array(n1*n2);for(let i=0;i<matrix.length;i++)matrix[i]=size?r.i16(o+16+i*size)/units:0;
                if([...class1.values()].some(c=>c>=n1)||[...class2.values()].some(c=>c>=n2))throw new Error('GPOS class outside matrix.');subtables.push({type:2,coverage:new Set(glyphs),class1,class2,n1,n2,matrix});}
        }if(subtables.length)positioning.push({index,subtables});}}
    if(!positioning.length&&tables.kern){const r=reader(tables.kern),b=tables.kern.o;if(r.u16(b)===0){let o=b+4;for(let i=0,n=r.u16(b+2);i<n;i++){const length=r.u16(o+2),flags=r.u16(o+4);if(length<6)throw new Error('Invalid kern length.');if((flags>>8)===0&&(flags&7)===1){const pairs=[];for(let j=0,n=r.u16(o+6);j<n;j++){const p=o+14+j*6;pairs.push({left:r.u16(p),right:r.u16(p+2),advance:r.i16(p+4)/units});}addRecords(pairs.length);positioning.push({index:i,override:!!(flags&8),subtables:[{type:1,pairs}]});}else warn('Unsupported legacy kern subtable skipped.');o+=length;}}else warn('Apple kern v1 is not in the current profile.');}
    return {substitutions,positioning,diagnostics,script,language,features};
}
export function glyphClosure(layout,initial,maxGlyphs=4096){const set=new Set(initial);if(!Number.isInteger(maxGlyphs)||maxGlyphs<1||set.size>maxGlyphs)throw new Error('Initial glyph set exceeds the atlas budget.');let changed=true;while(changed){changed=false;for(const lookup of layout.substitutions)for(const rule of lookup.rules)if(rule.input.every(g=>set.has(g))&&!set.has(rule.output)){set.add(rule.output);changed=true;if(set.size>maxGlyphs)throw new Error('GSUB glyph closure exceeds atlas glyph budget.');}}return [...set];}
/** Compact sorted GSUB tables; GPOS class matrices stay matrices, never O(glyphCount²) pairs. */
export function packOpenTypeLayout(layout,glyphIds){
    const dense=new Map(glyphIds.map((g,i)=>[g,i])),arena=new WordArena(),header=arena.alloc(8),substitutionData=[];
    for(const lookup of layout.substitutions){const map=new Map();for(const rule of lookup.rules){if(!dense.has(rule.output)||!rule.input.every(g=>dense.has(g)))continue;const input=rule.input.map(g=>dense.get(g)),key=input[0];if(!map.has(key))map.set(key,[]);map.get(key).push({input,output:dense.get(rule.output)});}if(map.size)substitutionData.push(map);}
    const lookupTable=arena.alloc(substitutionData.length*4);
    substitutionData.forEach((map,index)=>{const entries=[...map].sort((a,b)=>a[0]-b[0]),offset=arena.alloc(entries.length*4);arena.u.set([entries.length,offset,0,0],lookupTable+index*4);
        entries.forEach(([gid,rules],i)=>{const ro=arena.alloc(rules.length*4);arena.u.set([gid,rules.length,ro,0],offset+i*4);rules.forEach((rule,j)=>{const components=arena.alloc(rule.input.length-1);arena.u.set(rule.input.slice(1),components);arena.u.set([rule.output,rule.input.length,components,0],ro+j*4);});});});
    const positioning=[];for(const lookup of layout.positioning){const subs=[];for(const sub of lookup.subtables){if(sub.type===1){const records=sub.pairs.filter(p=>dense.has(p.left)&&dense.has(p.right)).map(p=>[dense.get(p.left)*glyphIds.length+dense.get(p.right),p.advance]).sort((a,b)=>a[0]-b[0]);if(records.length)subs.push({type:1,records});}else subs.push(sub);}if(subs.length)positioning.push({...lookup,subtables:subs});}
    const positionTable=arena.alloc(positioning.length*4);
    positioning.forEach((lookup,i)=>{const offset=arena.alloc(lookup.subtables.length*4);arena.u.set([lookup.subtables.length,offset,Number(!!lookup.override),0],positionTable+i*4);lookup.subtables.forEach((sub,j)=>{const o=offset+j*4;if(sub.type===1){const data=arena.alloc(sub.records.length*2);arena.u.set([1,sub.records.length,data,0],o);sub.records.forEach(([key,value],k)=>{arena.u[data+k*2]=key;arena.f[data+k*2+1]=value;});}else{const classes=arena.alloc(glyphIds.length*2),matrix=arena.alloc(sub.matrix.length);arena.f.set(sub.matrix,matrix);glyphIds.forEach((g,k)=>arena.u.set([sub.coverage.has(g)?(sub.class1.get(g)||0)+1:0,sub.class2.get(g)||0],classes+k*2));arena.u.set([2,classes,sub.n2,matrix],o);}});});
    arena.u.set([0x4f544c32,substitutionData.length,lookupTable,positioning.length,positionTable,glyphIds.length,0,0],header);
    return new Uint32Array(arena.finish());
}
