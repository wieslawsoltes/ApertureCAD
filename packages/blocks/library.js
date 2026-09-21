import { BlockDrawing, record, group, setGroup, readInsert, canonical, validateLibrary } from './document.js';
import { LocalWorkspace } from '../annotations/index.js';
/** Browser-local reusable library. A failed save is surfaced; never claims durability. */
export class BlockShelf extends LocalWorkspace {
 constructor(){super();this.libraries=[];this.favorites=new Set();this.recent=[];this.serial=0;}
 key(library,name){return library+'\0'+canonical(name);}
 add(data){validateLibrary(data);const id='library-'+(++this.serial);this.libraries.push({id,name:data.name||'Block library',data:structuredClone(data)});return id;}
 remove(id){this.libraries=this.libraries.filter(l=>l.id!==id);this.recent=this.recent.filter(r=>r.library!==id);for(const k of this.favorites)if(k.startsWith(id+'\0'))this.favorites.delete(k);}
 remember(library,name){this.recent=[{library,name},...this.recent.filter(r=>r.library!==library||canonical(r.name)!==canonical(name))].slice(0,40);}
 favorite(library,name){const k=this.key(library,name);this.favorites.has(k)?this.favorites.delete(k):this.favorites.add(k);}
 toJSON(){return {schema:'aperture.block-shelf/1',libraries:this.libraries.map(({id,name,data})=>({id,name,data})),recent:this.recent,favorites:[...this.favorites],serial:this.serial};}
 async save(){const db=await this.open();try{const data=this.toJSON();await new Promise((resolve,reject)=>{const tx=db.transaction('workspaces','readwrite');tx.objectStore('workspaces').put(data,'block-library');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Block library save aborted.'));});}finally{db.close();}}
 async load(){const db=await this.open();try{const data=await new Promise((resolve,reject)=>{const r=db.transaction('workspaces').objectStore('workspaces').get('block-library');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(!data)return false;if(data.schema!=='aperture.block-shelf/1'||!Array.isArray(data.libraries)||data.libraries.length>100)throw new Error('Invalid saved block shelf.');for(const l of data.libraries)validateLibrary(l.data);this.libraries=data.libraries;this.serial=data.serial||0;this.recent=data.recent||[];this.favorites=new Set(data.favorites||[]);return true;}finally{db.close();}}
}
const line=(x,y,a,b)=>record('LINE',[[8,'0'],[62,0],[10,x],[20,y],[11,a],[21,b]]);
const circle=(x,y,r)=>record('CIRCLE',[[8,'0'],[62,0],[10,x],[20,y],[40,r]]);
const arc=(x,y,r,a,b)=>record('ARC',[[8,'0'],[62,0],[10,x],[20,y],[40,r],[50,a],[51,b]]);
const text=(t,x,y,h=2.5)=>record('TEXT',[[8,'0'],[62,0],[1,t],[10,x],[20,y],[40,h]]);
const poly=(points,closed=true)=>record('LWPOLYLINE',[[8,'0'],[62,0],[90,points.length],[70,closed?1:0],...points.flatMap(p=>[[10,p[0]],[20,p[1]]])]);
const insert=(name,x,y,rotation=0)=>record('INSERT',[[8,'0'],[62,0],[2,name],[10,x],[20,y],[50,rotation]]);
const att=(tag,x,y,value='')=>record('ATTDEF',[[8,'0'],[62,0],[2,tag],[3,tag.replaceAll('_',' ')],[1,value],[10,x],[20,y],[40,2.5],[70,0]]);
export function engineeringLibrary(){const d=new BlockDrawing(null,{name:'Aperture Engineering · original symbols'});const add=(name,description,entities,base=[0,0,0])=>{
  const table=d.blockRecord(name,4);d.blocks.push({header:record('BLOCK',[[5,d.nextHandle()],[330,group(table,5)],[8,'0'],[2,name],[3,name],[70,0],[10,base[0]],[20,base[1]],[30,base[2]],[4,description]]),end:record('ENDBLK',[[5,d.nextHandle()],[330,group(table,5)],[8,'0']]),records:entities.map(r=>r.type==='INSERT'?d.makeInsert(String(group(r,2)),readInsert(r)):setGroup(r,5,d.nextHandle()))});d.refresh();};
 add('VALVE_GATE','Process / Gate valve',[poly([[-10,-6],[10,6],[10,-6],[-10,6]]),line(-16,0,-10,0),line(10,0,16,0),att('TAG',-5,10,'V-101')]);
 add('VALVE_CONTROL','Process / Actuated control valve',[insert('VALVE_GATE',0,0),line(0,0,0,15),arc(0,15,6,0,180),line(-6,15,6,15)]);
 add('PUMP_CENTRIFUGAL','Process / Centrifugal pump',[circle(0,0,9),poly([[-5,-5],[6,0],[-5,5]]),line(-18,0,-9,0),line(0,9,0,16),line(0,16,18,16),att('TAG',-7,-15,'P-101')]);
 add('FLANGE','Mechanical / Pipe flange',[circle(0,0,12),circle(0,0,6),...[[0,9],[9,0],[0,-9],[-9,0]].map(p=>circle(...p,1.5))]);
 add('INSTRUMENT','Instrumentation / Field indicator',[circle(0,0,8),line(-8,0,8,0),att('FUNCTION',-4,2,'PI'),att('NUMBER',-3,-5,'101')]);
 add('TANK_VERTICAL','Process / Storage tank',[line(-12,-15,-12,15),line(12,-15,12,15),arc(0,15,12,0,180),arc(0,-15,12,180,360),att('TAG',-6,0,'TK-101')]);
 add('DOOR_SINGLE','Architecture / Single leaf door',[line(0,0,0,30),arc(0,0,30,0,90),line(-3,0,3,0),line(27,0,33,0)]);
 add('DESK','Furniture / Workstation',[poly([[-20,-10],[20,-10],[20,10],[-20,10]]),poly([[-13,-3],[-3,-3],[-3,4],[-13,4]]),circle(8,0,3)]);
 add('CHAIR','Furniture / Task chair',[poly([[-5,-5],[5,-5],[5,5],[-5,5]]),arc(0,5,6,0,180),line(-8,-5,-8,5),line(8,-5,8,5)]);
 add('WORKSTATION','Furniture / Nested desk and chair',[insert('DESK',0,0),insert('CHAIR',0,-20),att('ASSET_ID',-18,15,'WS-01')]);
 add('BOLT_HEX','Mechanical / Hexagonal bolt',[poly([[10,0],[5,8.660254],[-5,8.660254],[-10,0],[-5,-8.660254],[5,-8.660254]]),circle(0,0,5),line(-3,0,3,0),line(0,-3,0,3)]);
 add('NORTH_ARROW','Drawing / North marker',[poly([[0,16],[-5,-6],[0,-3],[5,-6]]),text('N',-2,20,4)]);
 add('DATUM_TARGET','Drawing / Datum with attributes',[circle(0,0,5),line(-8,0,8,0),line(0,-8,0,8),att('DATUM',8,0,'A')]);
 add('PUMP_STATION','Process / Nested pump, valves and instrumentation',[insert('PUMP_CENTRIFUGAL',0,0),insert('VALVE_GATE',-40,0),line(-24,0,-18,0),insert('VALVE_CONTROL',45,16),line(18,16,29,16),insert('INSTRUMENT',20,35),line(20,27,20,16),att('STATION',-35,-25,'STATION 01')]);
 d.ensureHandles();d.refresh();return d.exportLibrary();}
export function blockSampleDxf(){const d=new BlockDrawing(null,{name:'Block workshop.dxf'});d.importLibrary(engineeringLibrary(),{conflict:'replace'});const names=['PUMP_STATION','WORKSTATION','FLANGE','DOOR_SINGLE','TANK_VERTICAL','NORTH_ARROW'];names.forEach((n,i)=>d.insert(n,{position:[(i%3)*130,Math.floor(i/3)*100,0],layer:'0',scale:[1,1,1]}));return d.write();}
