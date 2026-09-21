#!/usr/bin/env python3
"""Independent DXF reader qualification. Optional: pip install ezdxf==1.4.4.
No ezdxf dependency is used by the application, parser, build or renderer.
"""
from __future__ import annotations
import json, os, subprocess, sys
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'artifacts'/'block-interop'
OUT.mkdir(parents=True,exist_ok=True)
report={'suite':'independent-block-dxf-interoperability','version':'2.5.0','status':'running','gpuExecuted':False,'startedAt':datetime.now(timezone.utc).isoformat(),'checks':[],'files':[]}
try:
 import ezdxf
 from ezdxf.math import Vec3
 report['reader']='ezdxf '+ezdxf.__version__
 source=ezdxf.new('R2007');source.layouts.new('Sheet A');source.layouts.new('Sheet B');source.saveas(OUT/'source-layouts.dxf')
 code=r'''
 import fs from 'node:fs';import path from 'node:path';
 import {BlockDrawing,group,setGroup,record} from './packages/blocks/document.js';
 import {engineeringLibrary,blockSampleDxf} from './packages/blocks/library.js';
 const out=process.env.BLOCK_INTEROP;const write=(n,d)=>fs.writeFileSync(path.join(out,n+'.dxf'),d.write());
 const d=new BlockDrawing(blockSampleDxf());write('workshop',d);
 const a=new BlockDrawing();a.importLibrary(engineeringLibrary());a.insert('VALVE_GATE',{position:[12345.125,-892.5,0],scale:[-2,3,1],rotation:37,rows:2,columns:3,rowSpacing:22,columnSpacing:40,attributes:{TAG:'V-INTEROP-Ω'}});write('mirrored-array',a);
 write('dependency-library',d.previewDocument('PUMP_STATION',{position:[50,30,0]}));
 const i=new BlockDrawing();i.importLibrary(d.exportLibrary(['WORKSTATION']));i.importLibrary(d.exportLibrary(['WORKSTATION']),{conflict:'rename'});i.insert('WORKSTATION_2');write('dependency-rename',i);
 const c=new BlockDrawing();c.replaceEntities([],[record('ELLIPSE',[[10,20],[20,30],[11,12],[21,3],[40,.3],[41,0],[42,6.283185307179586]])]);c.create('CUSTOM_ASSEMBLY',c.entities.map(r=>String(group(r,5))),[17,13,0]);write('create-basepoint',c);
 const w=d.definitionDrawing('PUMP_STATION');write('isolated-editor',w);d.setDefinition('PUMP_STATION',{records:w.entities});d.insert('PUMP_STATION',{position:[0,200,0]});write('editor-commit',d);
 const p=new BlockDrawing(fs.readFileSync(path.join(out,'source-layouts.dxf'),'utf8'));p.importLibrary(engineeringLibrary());p.insert('FLANGE',{space:'layout:Sheet B',position:[100,50,0]});p.insert('VALVE_GATE',{space:'layout:Sheet A',position:[20,30,0],attributes:{TAG:'A-1'}});write('separate-sheet-owners',p);
 const at=new BlockDrawing();at.importLibrary(engineeringLibrary());at.insert('VALVE_GATE',{attributes:{TAG:'PRESERVED'}});at.addAttribute('VALVE_GATE',{tag:'SECOND',prompt:'Service',value:'STEAM'});at.moveAttribute('VALVE_GATE','SECOND',-1);at.syncAttributes('VALVE_GATE');write('attribute-sync',at);
 '''
 env={**os.environ,'BLOCK_INTEROP':str(OUT)}
 subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,env=env,check=True,capture_output=True,text=True)
 parsed={}
 for name in ['workshop','mirrored-array','dependency-library','dependency-rename','create-basepoint','isolated-editor','editor-commit','separate-sheet-owners','attribute-sync']:
  doc=ezdxf.readfile(OUT/(name+'.dxf'));audit=doc.audit();assert not audit.has_errors,(name,[str(e) for e in audit.errors]);assert not audit.has_fixes,(name,[str(e) for e in audit.fixes]);parsed[name]=doc
  report['files'].append({'name':name+'.dxf','auditErrors':len(audit.errors),'auditRepairs':len(audit.fixes),'modelEntities':len(doc.modelspace())})
 report['checks'].append('Nine independently read R2007 DXFs have zero audit errors and zero requested repairs, including compound INSERT/ATTRIB/SEQEND ownership')
 doc=parsed['workshop'];assert len(doc.modelspace().query('INSERT'))==6;assert len([b for b in doc.blocks if not b.name.startswith('*')])==14
 report['checks'].append('Fourteen authored static definitions and six top-level references retain their nested dependency graph')
 a=parsed['mirrored-array'];ref=a.modelspace().query('INSERT').first
 assert ref.dxf.row_count==2 and ref.dxf.column_count==3 and ref.dxf.xscale==-2 and ref.dxf.yscale==3 and ref.dxf.rotation==37
 attr=ref.get_attrib('TAG');assert attr.dxf.text=='V-INTEROP-Ω'
 definition=a.blocks['VALVE_GATE'].query('ATTDEF').first
 expected=ref.matrix44().transform(definition.dxf.insert)
 assert attr.dxf.insert.isclose(expected,abs_tol=1e-8), (attr.dxf.insert,expected)
 assert len(list(ref.multi_insert()))==6
 report['checks'].append('Independent INSERT matrix agrees with the serialized nonuniform mirrored ATTRIB position; Unicode value and six MINSERT cells survive')
 dep=parsed['dependency-library'];names={b.name for b in dep.blocks if not b.name.startswith('*')};assert {'PUMP_STATION','PUMP_CENTRIFUGAL','VALVE_GATE','INSTRUMENT'}<=names
 ren=parsed['dependency-rename'];assert {i.dxf.name for i in ren.blocks['WORKSTATION_2'].query('INSERT')}=={'DESK_2','CHAIR_2'}
 report['checks'].append('Dependency-closure export and rename-on-conflict keep every nested reference bound to the intended copied definition')
 c=parsed['create-basepoint'];ref=c.modelspace().query('INSERT').first;definition=c.blocks['CUSTOM_ASSEMBLY'];member=definition.query('ELLIPSE').first
 assert ref.matrix44().transform(member.dxf.center).isclose(Vec3(20,30,0),abs_tol=1e-8)
 assert definition.block.dxf.base_point.isclose(Vec3(17,13,0))
 report['checks'].append('Create BLOCK with a nonzero base point preserves the independently evaluated ellipse center')
 p=parsed['separate-sheet-owners'];assert len(p.layouts.get('Sheet A').query('INSERT'))==1;assert len(p.layouts.get('Sheet B').query('INSERT'))==1;assert len(p.modelspace())==0;assert len(p.layouts.get('Layout1'))==0
 for name in ['Sheet A','Sheet B']:
  layout=p.layouts.get(name);ref=layout.query('INSERT').first;assert ref.dxf.owner==layout.block_record_handle
 report['checks'].append('New references belong to their actual first/second paper-layout BLOCK_RECORD owners, not the default sheet')
 a=parsed['attribute-sync'];ref=a.modelspace().query('INSERT').first;assert [a.dxf.tag for a in ref.attribs]==['SECOND','TAG'];assert ref.get_attrib_text('TAG')=='PRESERVED';assert ref.get_attrib_text('SECOND')=='STEAM'
 report['checks'].append('Attribute synchronization preserves values by tag and follows the reordered definition prompts')
 report['status']='passed'
except Exception as error:
 report['status']='failed';report['reason']=repr(error)
 if isinstance(error,subprocess.CalledProcessError):report['stderr']=error.stderr
(ROOT/'artifacts'/'blocks-interop.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2));sys.exit(0 if report['status']=='passed' else 1)
