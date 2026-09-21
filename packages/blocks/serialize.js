/** Standards-oriented group ordering for authored records. Imported subclasses are
 * preserved when already present; handles/owners are bound to the destination. */
const g=(r,c,d='')=>r.groups.find(x=>x.code===c)?.value??d;
const COMMON=new Set([8,6,48,60,62,67,410,420,430,440,370,390,347,284]);
const TYPES={LINE:'AcDbLine',POINT:'AcDbPoint',LWPOLYLINE:'AcDbPolyline',POLYLINE:'AcDb2dPolyline',CIRCLE:'AcDbCircle',ARC:'AcDbCircle',ELLIPSE:'AcDbEllipse',SPLINE:'AcDbSpline',SOLID:'AcDbTrace',TRACE:'AcDbTrace','3DFACE':'AcDbFace',XLINE:'AcDbXline',RAY:'AcDbRay',INSERT:'AcDbBlockReference',MTEXT:'AcDbMText',HATCH:'AcDbHatch',BLOCK:'AcDbBlockBegin',ENDBLK:'AcDbBlockEnd',SEQEND:'AcDbSequenceEnd'};
const TABLES={LAYER:'AcDbLayerTableRecord',LTYPE:'AcDbLinetypeTableRecord',STYLE:'AcDbTextStyleTableRecord',BLOCK_RECORD:'AcDbBlockTableRecord',APPID:'AcDbRegAppTableRecord',VIEW:'AcDbViewTableRecord',VPORT:'AcDbViewportTableRecord',UCS:'AcDbUCSTableRecord',DIMSTYLE:'AcDbDimStyleTableRecord'};
export function ownedRecord(r,owner){if(owner===undefined)return r;const groups=r.groups.map(x=>({...x}));let index=-1,depth=0;for(let i=0;i<groups.length;i++){const x=groups[i];if(x.code===102){if(String(x.value).startsWith('{'))depth++;else if(x.value==='}')depth--;}if(x.code===330&&depth===0){index=i;break;}}if(index>=0)groups[index].value=owner;else {const at=groups.findIndex(x=>x.code===100);groups.splice(at<0?Math.min(groups.length,1):at,0,{code:330,value:owner});}return {...r,groups};}
export function serializedRecord(record,owner){const r=ownedRecord(record,owner),type=r.type;
 // Existing records with standard subclasses retain their extended data and order.
 const textType=['TEXT','ATTRIB','ATTDEF'].includes(type),sub=TYPES[type]||TABLES[type];
 if(!textType&&(!sub||r.groups.some(x=>x.code===100&&x.value===sub)))return r;
 const source=r.groups.filter(x=>x.code!==100),out=[],emit=(code,value)=>out.push({code,value});
 const identifiers=source.filter(x=>x.code===5||x.code===105||x.code===330);out.push(...identifiers);
 const rest=source.filter(x=>![5,105,330,100].includes(x.code));
 if(TABLES[type]){emit(100,'AcDbSymbolTableRecord');emit(100,TABLES[type]);out.push(...rest);return {...r,groups:out};}
 emit(100,'AcDbEntity');out.push(...rest.filter(x=>COMMON.has(x.code)));if(!rest.some(x=>x.code===8))emit(8,'0');const data=rest.filter(x=>!COMMON.has(x.code));
 if(textType){emit(100,'AcDbText');const keys=new Set([10,20,30,40,1,50,41,51,7,71,72,11,21,31,210,220,230]);out.push(...data.filter(x=>keys.has(x.code)));if(type==='TEXT'){emit(100,'AcDbText');emit(73,Number(g(r,73,0)));out.push(...data.filter(x=>!keys.has(x.code)&&x.code!==73));}else {emit(100,type==='ATTRIB'?'AcDbAttribute':'AcDbAttributeDefinition');emit(280,0);if(type==='ATTDEF')emit(3,g(r,3,g(r,2,'')));emit(2,g(r,2,''));emit(70,Number(g(r,70,0)));emit(73,Number(g(r,73,0)));emit(74,Number(g(r,74,0)));emit(280,Number(g(r,280,0)));out.push(...data.filter(x=>!keys.has(x.code)&&![2,3,70,73,74,280].includes(x.code)));}}
 else if(type==='ARC'){emit(100,'AcDbCircle');out.push(...data.filter(x=>![50,51].includes(x.code)));emit(100,'AcDbArc');out.push(...data.filter(x=>[50,51].includes(x.code)));}
 else {emit(100,sub);out.push(...data);}
 return {...r,groups:out};
}
