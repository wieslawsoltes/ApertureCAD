"""Optional independent test-fixture generator (ezdxf); not an application dependency."""
from pathlib import Path
import json
import ezdxf
root=Path(__file__).resolve().parents[1]
doc=ezdxf.new('R2018');doc.layers.new('PIPE',dxfattribs={'color':3});doc.layers.new('HIDDEN_IN_DETAIL',dxfattribs={'color':1});doc.layers.new('SHEET',dxfattribs={'color':7})
m=doc.modelspace();m.add_line((-40,0),(40,0),dxfattribs={'layer':'PIPE'});m.add_line((-30,20),(30,20),dxfattribs={'layer':'HIDDEN_IN_DETAIL'});m.add_circle((0,-20),8,dxfattribs={'layer':'PIPE'});m.add_text('P-101',dxfattribs={'height':5,'insert':(-10,-36),'layer':'PIPE'})
doc.layouts.rename('Layout1','General arrangement');a=doc.layouts.get('General arrangement');b=doc.layouts.new('Equipment detail');empty=doc.layouts.new('Empty sheet')
for layout in [a,b,empty]:
 layout.page_setup(size=(210,148),margins=(5,5,5,5),units='mm')
 if layout is not empty:
  layout.add_lwpolyline([(5,5),(205,5),(205,143),(5,143)],close=True,dxfattribs={'layer':'SHEET'})
  layout.add_text(layout.name.upper(),dxfattribs={'height':5,'insert':(12,15),'layer':'SHEET'})
v1=a.add_viewport(center=(60,85),size=(80,80),view_center_point=(0,0),view_height=80,status=2)
v2=a.add_viewport(center=(155,85),size=(80,80),view_center_point=(0,0),view_height=80,status=3)
v2.dxf.view_twist_angle=90;v2.frozen_layers=['HIDDEN_IN_DETAIL']
off=a.add_viewport(center=(60,85),size=(10,10),view_center_point=(0,0),view_height=80,status=0)
v3=b.add_viewport(center=(105,80),size=(150,95),view_center_point=(10,15),view_height=95,status=2);v3.dxf.view_twist_angle=30;v3.dxf.view_target_point=(50,20,0)
doc.views.new('Pump detail',dxfattribs={'height':60,'width':80,'center':(0,0),'direction':(0,0,1),'target':(0,-10,0),'view_twist':30})
doc.views.new('Perspective example',dxfattribs={'height':100,'width':120,'center':(0,0),'direction':(1,1,1),'view_mode':1})
doc.header['$TILEMODE']=0;doc.layouts.set_active_layout('General arrangement')
output=root/'examples/multi-layout.dxf';doc.saveas(output)
points=[(-30,0,0),(0,0,0),(30,0,0),(-20,20,0),(20,20,0)]
reference={'generator':'ezdxf '+ezdxf.__version__,'viewports':[]}
for vp in [v1,v2,v3]:
 mat=vp.get_transformation_matrix();reference['viewports'].append({'handle':vp.dxf.handle,'points':[{'model':p,'paper':list(mat.transform(p))}for p in points]})
(root/'tests/layout-reference.json').write_text(json.dumps(reference,indent=2)+'\n')
print(output)
