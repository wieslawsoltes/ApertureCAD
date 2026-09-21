"""Optional local font comparison against native HarfBuzz. Does not execute WGSL or copy fonts."""
import argparse,ctypes as c,ctypes.util,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class Info(c.Structure): _fields_=[(x,c.c_uint32) for x in ['codepoint','mask','cluster','var1','var2']]
class Position(c.Structure): _fields_=[(x,c.c_int32) for x in ['x_advance','y_advance','x_offset','y_offset','var']]
def main():
 p=argparse.ArgumentParser();p.add_argument('--font',default='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');args=p.parse_args()
 lib=ctypes.util.find_library('harfbuzz')
 if not lib or not Path(args.font).is_file():raise RuntimeError('Supply --font and install native HarfBuzz; no fixture fonts are bundled.')
 hb=c.CDLL(lib)
 def fn(name,restype,argtypes):f=getattr(hb,name);f.restype=restype;f.argtypes=argtypes;return f
 blob_create=fn('hb_blob_create',c.c_void_p,[c.c_void_p,c.c_uint,c.c_int,c.c_void_p,c.c_void_p]);face_create=fn('hb_face_create',c.c_void_p,[c.c_void_p,c.c_uint]);font_create=fn('hb_font_create',c.c_void_p,[c.c_void_p]);upem_fn=fn('hb_face_get_upem',c.c_uint,[c.c_void_p]);set_scale=fn('hb_font_set_scale',None,[c.c_void_p,c.c_int,c.c_int]);ot_funcs=fn('hb_ot_font_set_funcs',None,[c.c_void_p]);buffer_create=fn('hb_buffer_create',c.c_void_p,[]);add_utf8=fn('hb_buffer_add_utf8',None,[c.c_void_p,c.c_char_p,c.c_int,c.c_uint,c.c_int]);guess=fn('hb_buffer_guess_segment_properties',None,[c.c_void_p]);shape=fn('hb_shape',None,[c.c_void_p,c.c_void_p,c.c_void_p,c.c_uint]);infos=fn('hb_buffer_get_glyph_infos',c.POINTER(Info),[c.c_void_p,c.POINTER(c.c_uint)]);positions=fn('hb_buffer_get_glyph_positions',c.POINTER(Position),[c.c_void_p,c.POINTER(c.c_uint)])
 destroys={name:fn('hb_'+name+'_destroy',None,[c.c_void_p])for name in ['blob','face','font','buffer']}
 data=Path(args.font).read_bytes();storage=c.create_string_buffer(data);blob=blob_create(storage,len(data),0,None,None);face=face_create(blob,0);font=font_create(face);upem=upem_fn(face);set_scale(font,upem,upem);ot_funcs(font)
 corpus=['AVATAR','office affinity','fi ffi ff fl ffl','To Wa Yo PA','Aperture CAD 0123456789','LOW FRAME TIME','Review: Equipment 125-A','minimum MILLION','(A+B) / 2 = 125.25']
 result=json.loads(subprocess.check_output(['node',str(ROOT/'tests/font-reference.mjs'),args.font,json.dumps(corpus)],text=True))
 checks=[];max_error=0
 try:
  for item in result['results']:
   buffer=buffer_create()
   try:
    encoded=item['text'].encode();add_utf8(buffer,encoded,len(encoded),0,len(encoded));guess(buffer);shape(font,buffer,None,0);n=c.c_uint();g=infos(buffer,c.byref(n));pos=positions(buffer,c.byref(n));expected_glyphs=[g[i].codepoint for i in range(n.value)];expected_advances=[pos[i].x_advance/upem for i in range(n.value)]
    assert item['glyphs']==expected_glyphs,(item['text'],item['glyphs'],expected_glyphs)
    error=max([abs(a-b) for a,b in zip(item['advances'],expected_advances)]+[0]);max_error=max(max_error,error);assert error<2e-6,(item['text'],error)
    checks.append({'text':item['text'],'glyphCount':n.value,'glyphIdsMatch':True,'maxAdvanceErrorEm':error})
   finally:destroys['buffer'](buffer)
 finally:
  destroys['font'](font);destroys['face'](face);destroys['blob'](blob)
 report={'suite':'OpenType-program-reference','status':'passed','gpuExecuted':False,'reference':'native HarfBuzz with default horizontal Latin shaping','fontName':Path(args.font).name,'fontIncluded':False,'checks':checks,'maxAdvanceErrorEm':max_error,'reportedUnsupportedLookups':result['diagnostics']}
 (ROOT/'artifacts/font-layout-reference.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
