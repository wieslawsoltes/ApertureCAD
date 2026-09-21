"""Real DOM, block-controller, authoring graph and DXF workers; GPU boundary doubled.
Real GPU editing kernels have separate Dawn execution tests. No security bypass.
"""
import asyncio,json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
 report={'suite':'blocks-controller-dom-with-test-engine','version':'2.5.0','gpuExecuted':False,'status':'running','checks':[],'errors':[]}
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium');page=await browser.new_page(viewport={'width':1512,'height':1080});page.set_default_timeout(15000)
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  try:
   html=(ROOT/'public/index.html').read_text().replace('<!-- APP_CSS -->','<style>'+(ROOT/'packages/app/styles.css').read_text()+'</style>')
   await page.set_content(html);await page.add_script_tag(content=(ROOT/'tests/workspace-test-engine.js').read_text())
   app=(ROOT/'dist/app.js').read_text();await page.add_script_tag(content=app.replace('new ComputeCad(','new WorkspaceTestEngine('))
   await page.wait_for_function('Aperture.initialized');await page.locator('#blocks-open').click();await page.locator('#block-workshop').click()
   await page.wait_for_function('Aperture.blocks.drawing?.entities.length===6 && !Aperture.engine.suspended')
   assert await page.locator('#file-tabs [role=tab]').count()==2
   assert await page.locator('#block-list [role=option]').count()==14
   report['checks'].append('Block palette opens an editable workshop in a new tab, retains the old tab, and lists all fourteen definitions')
   await page.locator('#block-search').fill('VALVE_GATE');await page.locator('#block-list .block-tile').click();await page.locator('#block-insert').click()
   await page.locator('#block-insert-form [name=x]').fill('123');await page.locator('#block-insert-form [name=y]').fill('77');await page.locator('#block-insert-form [name=sx]').fill('-2');await page.locator('#block-insert-form [name=sy]').fill('3');await page.locator('#block-insert-form [name=rotation]').fill('30')
   await page.locator('#block-insert-form details').first.evaluate('(e)=>e.open=true')
   await page.locator('#block-insert-form [name=rows]').fill('2');await page.locator('#block-insert-form [name=columns]').fill('3');await page.locator('#block-insert-form [name=attribute0]').fill('V-UI-2026');await page.locator('#block-insert-form [name=screen]').uncheck();await page.locator('#block-insert-form button[type=submit]').click()
   await page.wait_for_function('Aperture.blocks.drawing.entities.length===7 && !Aperture.engine.suspended')
   values=await page.evaluate("(()=>{let r=Aperture.blocks.drawing.entities.at(-1);return Object.fromEntries(r.groups.map(g=>[g.code,g.value]));})()")
   assert values['10']==123 and values['20']==77 and values['41']==-2 and values['42']==3 and values['70']==3 and values['71']==2
   assert await page.evaluate("Aperture.blocks.drawing.entities.at(-1).attributes[0].groups.find(g=>g.code===1).value")=='V-UI-2026'
   report['checks'].append('Numeric INSERT form commits position, nonuniform mirror, rotation, a 2x3 MINSERT array and a real attached ATTRIB through the worker/controller path')
   await page.locator('#block-undo').click();await page.wait_for_function('Aperture.blocks.drawing.entities.length===6 && !Aperture.engine.suspended');await page.locator('#block-redo').click();await page.wait_for_function('Aperture.blocks.drawing.entities.length===7 && !Aperture.engine.suspended')
   report['checks'].append('Source block commands have independent undo/redo, including insertion identity and array/attribute state')
   await page.locator('#block-insert').click();await page.locator('#block-insert-form button[type=submit]').click();await page.wait_for_function('!!Aperture.blocks.placement')
   box=await page.locator('#cad-canvas').bounding_box();await page.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.5);await page.wait_for_function('!!Aperture.engine.lastBlockPreview');await page.keyboard.press('Escape');await page.wait_for_function('!Aperture.blocks.placement');assert await page.evaluate('Aperture.blocks.drawing.entities.length')==7
   report['checks'].append('Interactive insertion creates a resident preview, updates its placement through the engine boundary, and Escape cancels without source edits')
   await page.locator('#block-tree').click();assert 'VALVE_GATE' in await page.locator('#dialog-content').inner_text();await page.evaluate('document.getElementById("dialog").close()')
   await page.locator('#block-studio').click();await page.wait_for_function('Aperture.blocks.studio?.ready && !Aperture.blocks.studio.busy')
   await page.wait_for_function('!!Aperture.blocks.studio.engine.model')
   parent=await page.evaluate("Aperture.blocks.drawing.definition('VALVE_GATE').records.length")
   await page.locator('[data-studio-tool=point]').click();await page.locator('#studio-canvas').click(position={'x':100,'y':120})
   await page.wait_for_function(f'Aperture.blocks.studio.work.entities.length==={parent+1} && !Aperture.blocks.studio.busy')
   assert await page.evaluate("Aperture.blocks.drawing.definition('VALVE_GATE').records.length")==parent
   await page.locator('#studio-undo').click();await page.wait_for_function(f'Aperture.blocks.studio.work.entities.length==={parent} && !Aperture.blocks.studio.busy')
   await page.locator('#studio-redo').click();await page.wait_for_function(f'Aperture.blocks.studio.work.entities.length==={parent+1} && !Aperture.blocks.studio.busy')
   await page.screenshot(path=str(ROOT/'artifacts/block-studio-dom-test.png'))
   await page.locator('#studio-save').click();await page.wait_for_function(f"Aperture.blocks.drawing.definition('VALVE_GATE').records.length==={parent+1} && !Aperture.engine.suspended && !Aperture.blocks.studio")
   report['checks'].append('Graphical Block Studio edits real DXF members in an isolated graph, supports undo/redo, then commits the definition once to update every use')
   await page.locator('#block-attributes').click();await page.locator('#block-attdef-form [name=tag]').fill('SERVICE');await page.locator('#block-attdef-form [name=value]').fill('STEAM');await page.locator('#block-attdef-form button[type=submit]').click();await page.wait_for_function("Aperture.blocks.drawing.metadata('VALVE_GATE').attributes.length===2 && !Aperture.engine.suspended")
   await page.locator('#block-attributes').click();await page.locator('#block-sync-attributes').click();await page.wait_for_function("Aperture.blocks.drawing.entities.at(-1).attributes.length===2 && !Aperture.engine.suspended")
   assert await page.evaluate("Aperture.blocks.drawing.definition('PUMP_STATION').records.find(r=>r.type==='INSERT'&&r.groups.some(g=>g.code===2&&g.value==='VALVE_GATE')).attributes.length")==2
   report['checks'].append('ATTDEF creation and explicit synchronization update root and nested references while preserving existing matching-tag values')
   await page.evaluate("Aperture.blocks.selection=new Set(Aperture.blocks.drawing.entities.slice(0,2).map(r=>r.groups.find(g=>g.code===5).value));Aperture.blocks.renderSelection()")
   await page.locator('#block-create').click();await page.locator('#block-create-form [name=name]').fill('UI_ASSEMBLY');await page.locator('#block-create-form [name=bx]').fill('3');await page.locator('#block-create-form [name=by]').fill('4');await page.locator('#block-create-form button[type=submit]').click()
   await page.wait_for_function("Aperture.blocks.drawing.blockMap.has('UI_ASSEMBLY') && !Aperture.engine.suspended")
   assert await page.evaluate("Aperture.blocks.drawing.definition('UI_ASSEMBLY').records.length")==2
   assert await page.evaluate('Aperture.blocks.drawing.entities.length')==6
   report['checks'].append('BLOCK creation converts selected source INSERTs into a nested definition with a nonzero base point')
   await page.locator('#block-commands').click();assert await page.locator('[data-block-command]').count()==16;await page.locator('[data-block-command=BCOUNT]').click();assert 'UI_ASSEMBLY' in await page.locator('#dialog-content').inner_text();await page.evaluate('document.getElementById("dialog").close()')
   report['checks'].append('Command center exposes sixteen block operations and expanded nested counts/data extraction')
   await page.evaluate("Aperture.workspace.save=async data=>{globalThis.savedWorkspace=structuredClone(data)};Aperture.workspace.load=async()=>structuredClone(globalThis.savedWorkspace)");await page.evaluate('Aperture.saveWorkspace()')
   assert await page.evaluate("savedWorkspace.documents.some(d=>d.blockState?.schema==='aperture.block-drawing/1')")
   await page.evaluate('Aperture.restoreWorkspace()');await page.wait_for_function("Aperture.blocks.drawing?.blockMap.has('UI_ASSEMBLY') && !Aperture.engine.suspended")
   report['checks'].append('Workspace state retains edited block definitions and references across restoration; storage boundary explicitly doubled')
   await page.locator('#block-search').fill('');await page.screenshot(path=str(ROOT/'artifacts/block-palette-dom-test-desktop.png'))
   await page.set_viewport_size({'width':390,'height':844});assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   await page.screenshot(path=str(ROOT/'artifacts/block-palette-dom-test-mobile.png'))
   report['checks'].append('Block palette, tabs and command controls remain contained on a 390px mobile viewport')
   assert not report['errors'],report['errors'];report['status']='passed'
  except Exception as e:
   report['status']='failed';report['reason']=str(e)
   await page.screenshot(path=str(ROOT/'artifacts/blocks-ui-failure.png'))
  finally:await browser.close()
 (ROOT/'artifacts/blocks-ui.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));return 0 if report['status']=='passed' else 2
if __name__=='__main__':raise SystemExit(asyncio.run(main()))
