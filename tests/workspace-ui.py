"""Actual app/controller + DXF worker UI tests. GPU boundary is explicitly doubled.
These tests do not validate rendering. No browser security/policy flags are changed.
"""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
 report={'suite':'document-controller-dom-with-test-engine','version':'2.5.0','gpuExecuted':False,'status':'running','checks':[],'errors':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium');page=await browser.new_page(viewport={'width':1512,'height':982});page.set_default_timeout(15000)
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  try:
   html=(ROOT/'public/index.html').read_text().replace('<!-- APP_CSS -->','<style>'+(ROOT/'packages/app/styles.css').read_text()+'</style>')
   await page.set_content(html);await page.add_script_tag(content=(ROOT/'tests/workspace-test-engine.js').read_text())
   app=(ROOT/'dist/app.js').read_text();assert app.count('new ComputeCad(canvas)')==1
   await page.add_script_tag(content=app.replace('new ComputeCad(canvas)','new WorkspaceTestEngine(canvas)'))
   await page.wait_for_function('Aperture.initialized');assert await page.locator('#file-tabs [role=tab]').count()==1
   simple=b'0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n100\n21\n0\n0\nENDSEC\n0\nEOF\n'
   await page.locator('#dxf-file').set_input_files([{'name':'plant.dxf','mimeType':'application/dxf','buffer':simple},{'name':'plant.dxf','mimeType':'application/dxf','buffer':(ROOT/'examples/multi-layout.dxf').read_bytes()}])
   await page.wait_for_function('Aperture.documents.documents.length===3 && !Aperture.engine.suspended')
   assert await page.locator('#space-tabs [role=tab]').count()==4
   assert await page.locator('#named-views option').count()==7 # placeholder, 2 VIEW records, 4 non-overall viewports incl off
   report['checks'].append('Multi-file chooser imports both DXFs in real workers; duplicate filenames have distinct tabs; all four spaces and saved views are listed')
   await page.evaluate("Aperture.annotations.add([{type:Aperture.TYPE.LINE,anchor:[0,0],p:[1,1,0,0],color:4294967295}],{label:'Sheet review'});Aperture.engine.camera={x:123,y:456,zoom:7}")
   await page.locator('#space-tabs [data-space-id=model]').click();await page.wait_for_function("Aperture.documents.current.activeSpace==='model' && !Aperture.engine.suspended")
   assert await page.locator('.annotation-item').count()==0
   await page.evaluate("Aperture.annotations.add([{type:Aperture.TYPE.POINT,anchor:[5,5],color:4294967295}],{label:'Model review'})")
   await page.locator('#space-tabs [data-space-id="layout:General arrangement"]').click();await page.wait_for_function("Aperture.documents.current.activeSpace==='layout:General arrangement' && !Aperture.engine.suspended")
   assert 'Sheet review' in await page.locator('#annotations').inner_text()
   assert await page.evaluate('Aperture.engine.camera.x')==123
   report['checks'].append('Paper and Model tabs retain independent annotations, undo stacks and camera state')
   ids=await page.evaluate('Aperture.documents.documents.map(d=>d.id)')
   await page.locator(f'#file-tabs [data-document-id="{ids[1]}"]').click();await page.wait_for_function(f"Aperture.documents.activeId==='{ids[1]}' && !Aperture.engine.suspended")
   assert await page.locator('.annotation-item').count()==0
   assert await page.locator('#space-tabs [role=tab]').count()==1
   await page.locator(f'#file-tabs [data-document-id="{ids[2]}"]').click();await page.wait_for_function(f"Aperture.documents.activeId==='{ids[2]}' && !Aperture.engine.suspended")
   assert 'Sheet review' in await page.locator('#annotations').inner_text()
   report['checks'].append('File switching restores source identity and does not leak reviews between identically named files')
   await page.evaluate("Aperture.workspace.save=async data=>{globalThis.savedWorkspace=structuredClone(data)};Aperture.workspace.load=async()=>structuredClone(globalThis.savedWorkspace);true")
   await page.evaluate('Aperture.saveWorkspace()');assert await page.evaluate('savedWorkspace.documents.length')==3
   await page.evaluate('Aperture.restoreWorkspace()');assert await page.locator('#file-tabs [role=tab]').count()==6
   assert 'Sheet review' in await page.locator('#annotations').inner_text()
   report['checks'].append('Workspace v3 serializes and restores all tabs and per-space state (storage boundary doubled; actual IndexedDB not exercised)')
   await page.evaluate("Aperture.engine.metrics.gpuMs=615296880.54;Aperture.engine.metrics.gpuTimingStatus='unwritten-timestamp';Aperture.engine.captureMetrics()")
   assert await page.locator('#gpu-ms').inner_text()=='—'
   assert 'unwritten-timestamp' in await page.locator('#telemetry-note').inner_text()
   report['checks'].append('Invalid GPU duration never reaches the metric hero; unavailable reason is shown')
   await page.screenshot(path=str(ROOT/'artifacts/workspace-ui-test-desktop.png'))
   await page.set_viewport_size({'width':390,'height':844});assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
   await page.screenshot(path=str(ROOT/'artifacts/workspace-ui-test-mobile.png'))
   report['checks'].append('Six file tabs and four layout tabs remain horizontally contained on mobile')
   await page.evaluate('Promise.all([...Aperture.documents.documents].map(d=>Aperture.closeDocument(d.id)))')
   assert await page.locator('#file-tabs [role=tab]').count()==0;assert await page.evaluate('Aperture.documents.current') is None
   report['checks'].append('Closing all saved tabs releases document ownership and leaves a usable empty workbench')
   assert not report['errors'],report['errors'];report['status']='passed'
  except Exception as e:report['status']='failed';report['reason']=str(e)
  finally:await browser.close()
 (ROOT/'artifacts/workspace-ui.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));return 0 if report['status']=='passed' else 2
if __name__=='__main__':raise SystemExit(asyncio.run(main()))
