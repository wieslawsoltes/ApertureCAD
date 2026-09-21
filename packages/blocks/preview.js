import { UINT_MAX } from '../model/index.js';
/** Add ONE shared top-level transform node to each preview page. Per-pointer movement
 * changes only this node, never geometry/glyph buffers or file-source coordinates. */
export function placementPreview(model,{idBase=0,layer=0,color=0xffb4d875}={}){
 let next=idBase;const pages=model.pages.map(p=>{
  const entities=p.entities.slice(0),u=new Uint32Array(entities),aux=new ArrayBuffer(p.aux.byteLength+64),a=new Uint32Array(aux),f=new Float32Array(aux),root=p.aux.byteLength/4;a.set(new Uint32Array(p.aux));f.set([1,1,0,0,0,0,0,0,0,0,0,0],root);a[root+12]=UINT_MAX;
  const parents=new Set();for(let i=0;i<p.count;i++){const j=i*32,n=u[j+22];u[j+17]=color;u[j+18]=layer;u[j+19]=next+i+1;
   if(n===UINT_MAX)u[j+22]=root;else {let at=n,depth=0;while(a[at+12]!==UINT_MAX&&a[at+12]!==root){at=a[at+12];if(++depth>192)throw new Error('Malformed preview transform chain.');}if(!parents.has(at)){a[at+12]=root;parents.add(at);}}}
  const page={...p,entities,aux,idBase:next,placementNode:root};next+=p.count;return page;
 });return {...model,idBase,pages};
}
export function ownerOf(model,id){if(!Number.isInteger(id)||id<=0)return null;const roots=model.editRoots||[];let lo=0,hi=roots.length;while(lo<hi){const m=(lo+hi)>>>1;if(roots[m].first<=id)lo=m+1;else hi=m;}const r=roots[lo-1];return r&&id<r.first+r.count?r:null;}
