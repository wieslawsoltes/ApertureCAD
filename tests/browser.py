"""Real WebGPU integration test. Requires a browser allowed to navigate localhost.
No renderer stub, secure-context spoof, or enterprise-policy override is used.
Run npm start in another terminal, then: python tests/browser.py
"""
import argparse,asyncio,json,os,sys
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://localhost:4173/dist/index.html');parser.add_argument('--dom-only',action='store_true');parser.add_argument('--software',action='store_true');args=parser.parse_args()
    report={'suite':'browser-dom' if args.dom_only else 'webgpu-integration','version':'2.5.0','status':'running','checks':[],'gpuExecuted':False,'errors':[]}
    async with async_playwright() as p:
        options={'headless':True}
        executable=os.environ.get('CHROME_BIN','/usr/bin/chromium')
        if Path(executable).exists():options['executable_path']=executable
        if args.software:options['args']=['--enable-unsafe-webgpu','--use-angle=swiftshader','--use-vulkan=swiftshader']
        browser=await p.chromium.launch(**options);page=await browser.new_page(viewport={'width':1512,'height':982},device_scale_factor=1)
        page.set_default_timeout(6000)
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        try:
            if args.dom_only:
                # about:blank cannot acquire WebGPU. This tests the real failure UI only.
                await page.set_content((ROOT/'dist/index.html').read_text(),wait_until='load')
                await page.wait_for_function('globalThis.Aperture?.initializationError')
                assert await page.locator('#unsupported').is_visible()
                report['checks'].append('Unsupported WebGPU state is explicit and readable')
                await page.locator('#help').click();assert await page.locator('#dialog').is_visible();await page.locator('#dialog-close').click()
                report['checks'].append('Help dialog opens and closes')
                await page.locator('#lab-tab').click();assert await page.locator('.lab-card').count()==6;await page.locator('#dialog-close').click()
                report['checks'].append('Compute lab exposes six actual stress configurations')
                await page.locator('#lab-tab').click()
                for selector in ['#load-features','#perf-batch','#perf-paper-cache','#perf-cache','#perf-compaction','#perf-guard','#perf-alpha','#perf-resolution','#benchmark-quality']:
                    assert await page.locator(selector).count()==1
                report['checks'].append('New performance, quality and feature-gallery controls exist')
                await page.locator('#dialog-close').click()
                await page.screenshot(path=str(ROOT/'artifacts/workbench-dom-desktop.png'))
                await page.set_viewport_size({'width':390,'height':844})
                assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                await page.locator('#lab-tab').click()
                assert await page.evaluate('document.querySelector("#dialog").getBoundingClientRect().width <= innerWidth')
                await page.locator('#dialog-close').click()
                report['checks'].append('Mobile layout has no horizontal page overflow')
                await page.screenshot(path=str(ROOT/'artifacts/workbench-dom-mobile.png'))
            else:
                await page.goto(args.url,wait_until='load');await page.wait_for_function('globalThis.Aperture?.initialized || globalThis.Aperture?.initializationError',timeout=120000)
                error=await page.evaluate('Aperture.initializationError');assert not error,error
                report['gpuExecuted']=True
                await page.evaluate('Aperture.engine.device.queue.onSubmittedWorkDone()')
                assert await page.evaluate('Aperture.model.count')==3294
                report['checks'].append('All WGSL modules compile and all pipelines initialize')
                await page.screenshot(path=str(ROOT/'artifacts/gpu-campus.png'))
                # Test a deterministic line in an isolated model with enough screen scale.
                result=await page.evaluate('''async()=>{
                  const a=Aperture;await a.loadDxf(new File(['0\\nSECTION\\n2\\nENTITIES\\n0\\nLINE\\n10\\n0\\n20\\n0\\n11\\n100\\n21\\n0\\n0\\nENDSEC\\n0\\nEOF\\n'],'test.dxf'));
                  const e=a.engine;e.render();await e.device.queue.onSubmittedWorkDone();
                  const id=await e.pick(e.cssWidth/2,e.cssHeight/2,5);const measure=await e.measure([0,0],[3,4]);
                  return {id,measure,errors:e.errors};}''')
                assert result['id']==1,result;assert abs(result['measure'][0]-5)<1e-5,result
                report['checks'].append('GPU line rasterization, ID picking and 3-4-5 measurement')
                await page.add_script_tag(content=(ROOT/'tests/gpu-regressions.js').read_text())
                report['checks'].extend(await page.evaluate('runGpuRegressions(Aperture)'))
                await page.add_script_tag(content=(ROOT/'tests/gpu-audit-regressions.js').read_text())
                report['checks'].extend(await page.evaluate('runAuditGpuRegressions(Aperture)'))
                await page.add_script_tag(content=(ROOT/'tests/gpu-performance22-regressions.js').read_text())
                report['checks'].extend(await page.evaluate('runPerformance22GpuRegressions(Aperture)'))
                await page.evaluate('(fixtures) => { Aperture.layoutFixture=fixtures.dxf; Aperture.layoutReference=fixtures.reference; }', {
                    'dxf': (ROOT/'examples/multi-layout.dxf').read_text(),
                    'reference': json.loads((ROOT/'tests/layout-reference.json').read_text())})
                await page.add_script_tag(content=(ROOT/'tests/gpu-views23-regressions.js').read_text())
                report['checks'].extend(await page.evaluate('runViews23GpuRegressions(Aperture)'))
                await page.add_script_tag(content=(ROOT/'tests/gpu-performance24-regressions.js').read_text())
                report['checks'].extend(await page.evaluate('runPerformance24GpuRegressions(Aperture)'))
                await page.evaluate('Aperture.loadStress(100000,2)');await page.evaluate('Aperture.engine.device.queue.onSubmittedWorkDone()')
                telemetry=await page.evaluate('Aperture.engine.captureMetrics()');assert telemetry['visible']>0
                assert await page.evaluate('Aperture.engine.errors.length')==0
                report['checks'].append('100,000 unique GPU-generated text entities and GPU telemetry')
                report['telemetry']=telemetry
                await page.screenshot(path=str(ROOT/'artifacts/gpu-stress.png'))
            assert not report['errors'],report['errors'];report['status']='passed'
        except Exception as e:
            text=str(e);report['status']='blocked' if 'ERR_BLOCKED_BY_ADMINISTRATOR' in text else 'failed';report['reason']=text
        finally:
            await browser.close()
    filename='browser-dom.json' if args.dom_only else 'browser-gpu.json';(ROOT/'artifacts'/filename).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));return 0 if report['status']=='passed' else 2
if __name__=='__main__':sys.exit(asyncio.run(main()))
