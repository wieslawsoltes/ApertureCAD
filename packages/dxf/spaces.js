/** DXF space/layout catalogue. Handles are resolved after OBJECTS (usually after ENTITIES).
 * No per-entity strings or duplicated tessellation are sent to the GPU.
 */
const value = (r, code, fallback = 0) => r.groups.find(g => g.code === code)?.value ?? fallback;
const point = (r, code, z = false) => z ? [value(r,code),value(r,code+10),value(r,code+20)] : [value(r,code),value(r,code+10)];
const handle = x => String(x || '').toUpperCase();
function subclass(r, name) {
    const start = r.groups.findIndex(g => g.code === 100 && g.value === name);
    if (start < 0) return r;
    let end = r.groups.findIndex((g,i) => i > start && g.code === 100);
    return { groups: r.groups.slice(start + 1, end < 0 ? undefined : end) };
}
function owner(r) { let depth = 0; for (const g of r.groups) { if (g.code === 102) { if (String(g.value).startsWith('{')) depth++; else if (g.value === '}') depth--; } if (!depth && g.code === 330) return handle(g.value); } return ''; }
function canonicalName(name) { return String(name).toLowerCase() === 'model' ? 'model' : 'layout:' + String(name); }
export function viewCamera(view) {
    const a = -(view.twist || 0), c = Math.cos(a), s = Math.sin(a), target = view.target || [0,0,0], p = view.viewCenter || [0,0];
    return { x: target[0] + c*p[0] - s*p[1], y: target[1] + s*p[0] + c*p[1], angle: a };
}
export function supportedPlanView(view) {
    const d = view.direction || [0,0,1];
    return view.viewHeight > 0 && Number.isFinite(view.viewHeight) && Math.abs(d[0]) < 1e-10 && Math.abs(d[1]) < 1e-10 && d[2] > 0 && !(view.flags & 1) && !(view.flags & 65536) && !view.clipHandle;
}
export class SpaceCatalog {
    constructor() { this.layouts = new Map(); this.blockNames = new Map(); this.blockLayouts = new Map(); this.layoutHandles = new Map(); this.viewportRecords = []; this.namedViews = []; this.layerHandles = new Map(); }
    key(r) {
        const name = value(r,410,''); if (name) return canonicalName(name);
        const o = owner(r), b = this.blockNames.get(o);
        if (b && /^[*$]model_space$/i.test(b)) return 'model';
        if (o && (value(r,67,0) === 1 || /^[*$]paper_space/i.test(b || ''))) return 'owner:' + o;
        return value(r,67,0) === 1 ? 'paper:unnamed' : 'model';
    }
    record(r, section) {
        if (section === 'TABLES' && r.type === 'BLOCK_RECORD') { const h=handle(value(r,5,'')); this.blockNames.set(h,String(value(r,2,''))); const layout=handle(value(r,340,'')); if(layout) this.blockLayouts.set(h,layout); }
        if (section === 'TABLES' && r.type === 'LAYER') this.layerHandles.set(handle(value(r,5,'')),String(value(r,2,'0')));
        if (r.type === 'LAYOUT' && section === 'OBJECTS') {
            const l=subclass(r,'AcDbLayout'), p=subclass(r,'AcDbPlotSettings'), name=String(value(l,1,'Layout')), id=canonicalName(name);
            const refs=l.groups.filter(g=>g.code===330); const block=handle(refs.at(-1)?.value);
            const width=value(p,44,0),height=value(p,45,0);
            const item={ id,name,kind:id==='model'?'model':'paper',order:value(l,71,id==='model'?0:1),block,
                paperSize:width>0&&height>0?[width,height]:null, limits:[...point(l,10),...point(l,11)], extents:[...point(l,14),...point(l,15)], viewports:[] };
            this.layouts.set(id,item); this.layoutHandles.set(handle(value(r,5,'')),id); if(block) this.blockLayouts.set(block,id);
        }
        if (section === 'TABLES' && r.type === 'VIEW') {
            const v=subclass(r,'AcDbViewTableRecord');
            this.namedViews.push({ id:'view:'+String(value(r,2,'')),name:String(value(r,2,'')),kind:'named',spaceId:(value(r,70,0)&1)?'paper:unnamed':'model',
                viewHeight:value(v,40,0),viewWidth:value(v,41,0),viewCenter:point(v,10),direction:hasCode(v,11)?point(v,11,true):[0,0,1],target:point(v,12,true),twist:value(v,50,0)*Math.PI/180,flags:value(v,71,0) });
        }
    }
    addViewport(r, key) {
        const v=subclass(r,'AcDbViewport');
        this.viewportRecords.push({ key,id:'viewport:'+String(value(r,5,this.viewportRecords.length+1)),handle:handle(value(r,5,'')),
            number:value(v,69,0),name:'Viewport '+value(v,69,this.viewportRecords.length+1),kind:'viewport',center:point(v,10),width:value(v,40,0),height:value(v,41,0),
            status:value(v,68,1),viewCenter:point(v,12),direction:hasCode(v,16)?point(v,16,true):[0,0,1],target:point(v,17,true),viewHeight:value(v,45,0),twist:value(v,51,0)*Math.PI/180,
            flags:value(v,90,0),clipHandle:handle(value(v,340,'')),frozenLayers:v.groups.filter(g=>g.code===331).map(g=>handle(g.value)) });
    }
    resolve(key) {
        if(key==='model') return key;
        if(key.startsWith('owner:')) { const block=key.slice(6), mapped=this.blockLayouts.get(block), id=this.layoutHandles.get(mapped)||mapped; if(id?.startsWith('layout:')||id==='model')return id;
            const b=this.blockNames.get(block); if(/^[*$]model_space$/i.test(b||''))return 'model'; return canonicalName(b?.replace(/^\*/,'')||'Paper '+block); }
        if(key==='paper:unnamed') return [...this.layouts.values()].filter(l=>l.kind==='paper').sort((a,b)=>a.order-b.order)[0]?.id || 'layout:Layout1';
        return key;
    }
    finish(builders, layers, name, diagnostics, metadata) {
        const spaces=new Map([['model',{id:'model',name:'Model',kind:'model',order:0,viewports:[]}],...this.layouts]);
        const ensure=id=>{ if(!spaces.has(id))spaces.set(id,{id,name:id.replace(/^layout:/,''),kind:id==='model'?'model':'paper',order:spaces.size,viewports:[]}); return spaces.get(id); };
        const groups=new Map(), origins=new Map();
        for(const [key,builder] of builders){const id=this.resolve(key);ensure(id);const m=builder.finish();if(m.pages.length&&!origins.has(id))origins.set(id,m.origin);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(...m.pages);}
        for(const raw of this.viewportRecords){const id=this.resolve(raw.key),v={...raw,spaceId:id};delete v.key;v.frozenLayers=v.frozenLayers.map(h=>this.layerHandles.get(h)).filter(Boolean);v.supported=supportedPlanView(v);ensure(id).viewports.push(v);}
        const ordered=[...spaces.values()].sort((a,b)=>a.kind==='model'?-1:b.kind==='model'?1:a.order-b.order||a.name.localeCompare(b.name));
        const pages=[];let count=0;
        for(const space of ordered){space.origin=origins.get(space.id)||[0,0];space.pageIndices=[];space.count=0;space.idBase=count;
            for(const page of groups.get(space.id)||[]){page.idBase=count;page.spaceId=space.id;page.origin=space.origin;const u=new Uint32Array(page.entities);for(let i=0;i<page.count;i++)u[i*32+19]=count+i+1;
                space.pageIndices.push(pages.length);pages.push(page);count+=page.count;space.count+=page.count;}
            space.viewports.sort((a,b)=>b.status-a.status||a.number-b.number);
            for(const v of space.viewports)if(v.number!==1&&!v.supported)diagnostics.push({code:'VIEWPORT_PROJECTION',severity:'warning',count:1,message:`${space.name} / ${v.name}: only rectangular top-XY orthographic viewports are composed; perspective, oblique 3D, and nonrectangular clipping are explicitly unsupported.`});
        }
        const views=this.namedViews.map(v=>{const spaceId=this.resolve(v.spaceId);return {...v,spaceId,supported:supportedPlanView(v)&&!(spaceId.startsWith('layout:')&&Math.abs(v.twist)>1e-10)};});
        for(const v of views)if(!v.supported)diagnostics.push({code:'NAMED_VIEW_PROJECTION',severity:'warning',count:1,message:`Named view ${v.name} is listed, but its projection is not supported by the top-XY renderer.`});
        const missing=[...new Set(pages.flatMap(p=>p.missing))];
        const model={version:1,name,origin:[0,0],layers,pages,count,idBase:0,diagnostics,missing,spaces:ordered,namedViews:views,...metadata};
        const active=metadata.header?.$CTAB?.[0]?.value;model.initialSpace=metadata.header?.$TILEMODE?.[0]?.value===0?(ordered.find(s=>s.name===active)?.id||ordered.find(s=>s.kind==='paper')?.id||'model'):'model';
        model.origin=ordered.find(s=>s.id===model.initialSpace)?.origin || [0,0];return model;
    }
}
function hasCode(r,c){return r.groups.some(g=>g.code===c);}
