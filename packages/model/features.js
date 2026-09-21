import { ModelBuilder, TYPE, rgba } from './index.js';
/** Original parameter-only qualification scene: all boundary, pattern, text and dimension evaluation is GPU work. */
export function makeFeatureGallery(font) {
    const layers = [['FRAME', '#526982'], ['LABELS', '#c2d4e5'], ['PATTERNS', '#58cdb6'], ['DIMENSIONS', '#d9ac76'], ['ALPHA', '#9e9bea']]
        .map(([name, color]) => ({ name, color: rgba(color), visible: true }));
    const b = new ModelBuilder(font, { name: 'Aperture / Compute Features', layers });
    const label = (s,x,y,h=4) => b.text(s,x,y,h,1);
    b.rect(0,0,520,340); label('APERTURE / COMPUTE FEATURES',12,321,8);
    label('PARAMETRIC HATCHES  .  GPU DIMENSIONS  .  TEXT  .  ORDERED ALPHA',12,308,3.8);
    const ring = (x,y,r,loop=0) => ({ kind:3, loop, flags:loop?0:1, center:[x,y], major:[r,0], ratio:1, start:0, sweep:Math.PI*2 });
    const rectangle = (x,y,w,h,loop=0) => { const p=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
        return p.map((a,i)=>({kind:1,loop,flags:loop?0:1,a,b:p[(i+1)%4]})); };
    const hatch = (edges, families, solid=false) => b.add({type:TYPE.HATCH,anchor:[0,0],layer:2,hatch:{style:0,edges,families,solid}});
    const family = (angle,spacing,dashes=[]) => ({angle,base:[0,0],offset:[-Math.sin(angle)*spacing,Math.cos(angle)*spacing],dashes});
    b.rect(10,167,244,130); label('01 / ANALYTIC PATTERN FAMILIES',17,284);
    hatch([...rectangle(22,204,90,60),ring(67,234,17,1)],[family(Math.PI/4,6)]);
    hatch([ring(180,234,32),ring(180,234,15,1)],[family(0,5,[8,-3]),family(Math.PI/2,9,[2,-4])]);
    label('Nested hole / line boundaries',22,184,3); label('Conic rings / cross hatch',140,184,3);
    b.rect(266,167,244,130); label('02 / PARAMETRIC DIMENSIONS',274,284);
    b.rect(296,215,165,36,0); b.circle(321,232,11,0); b.circle(436,232,11,0);
    b.add({type:TYPE.DIMENSION,anchor:[296,215],layer:3,dimension:{kind:0,
        points:[[296,195],[378.5,199],[0,0],[296,215],[461,215],[0,0],[0,0]],
        precision:2,textHeight:4,arrowSize:3,extensionOffset:2,extensionLength:3,gap:2}});
    b.add({type:TYPE.DIMENSION,anchor:[321,232],layer:3,dimension:{kind:4,
        points:[[321,232],[341,267],[0,0],[0,0],[0,0],[332,232],[0,0]],
        precision:1,textHeight:3.5,arrowSize:2,gap:2}});
    label('Definition points -> geometry + numeric label',274,175,3.2);
    b.rect(10,10,244,145); label('03 / GLYPH QUALITY & SHAPING',17,142);
    label('AVATAR  To Wa  office affinity',22,119,7);
    label('fi ffi fl ffl  /  0123456789',22,99,6);
    label('Tiny labels stay independent GPU entities.',22,77,3);
    label('Load a local TTF for ligatures and kerning.',22,64,3);
    label('Load SHX / SHP for GPU stroke compilation.',22,51,3);
    label('Original built-in face has no GSUB / GPOS.',22,32,3);
    b.rect(266,10,244,145); label('04 / BOUNDED SOURCE-OVER',274,142);
    const fill=(x,y,w,h,color)=>b.add({type:TYPE.HATCH,anchor:[0,0],layer:4,color,
        hatch:{solid:true,style:0,edges:rectangle(x,y,w,h),families:[]}});
    fill(291,63,78,53,(rgba('#55c6b1') & 0xffffff) | (150<<24));
    fill(336,80,78,53,(rgba('#dc9977') & 0xffffff) | (150<<24));
    fill(381,63,78,53,(rgba('#9995e8') & 0xffffff) | (150<<24));
    label('Enable Ordered alpha in the Compute lab.',278,42,3.2);
    label('Fragment overflow is flagged, never hidden.',278,26,3.2);
    return b.finish();
}
