"""Verify actual-only water rendering with preserved cursor plans, using mock data."""
import json,subprocess
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
code="""import {restore} from './lib/monitor/service.mjs';import {detail} from './lib/monitor/domain.mjs';import demo from './lib/monitor/demo.json' with {type:'json'};import fs from 'node:fs';const d=restore(demo);for(const c of d.concentrations)if(c.kind==='water')c.value=.02;for(const [i,s]of d.samples.slice(0,2).entries())d.concentrations.push({id:'inlet-'+i,batch_id:d.batch.id,kind:'inlet_water',timestamp:s.timestamp,value:25+i*15,unit:'ppmv',point:'进塔测试点',note:''});fs.writeFileSync('test-results/water-detail.json',JSON.stringify(detail(d)));"""
subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,check=True)
detail=json.loads((OUT/'water-detail.json').read_text(encoding='utf-8'));checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch();context=browser.new_context(viewport={'width':1600,'height':1000})
    def route(r):
        path=urlparse(r.request.url).path
        if path=='/':r.fulfill(body=(ROOT/'lib/monitor/index.html').read_text(encoding='utf-8'),content_type='text/html')
        elif path.startswith('/static/'):r.fulfill(path=str(ROOT/'public'/path.lstrip('/')))
        elif path=='/api/session/me':r.fulfill(json={'username':'guest','canEdit':False})
        elif path=='/api/batches':r.fulfill(json=[detail['batch']])
        elif path=='/api/batches/'+detail['batch']['id']:r.fulfill(json=detail)
        else:raise AssertionError(path)
    context.route('**/*',route);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://water.test/');page.wait_for_function('state.detail && state.charts[0]')
    def check_sources():
        result=page.evaluate("""()=>{
          const source=state.trendSources[0].filter(s=>[4,10].includes(s.channel));
          const rendered=state.charts[0].getOption().series;
          return {source:source.map(s=>({role:s.role,channel:s.channel})),planIds:rendered.filter(s=>s&&/^plan-(inlet-)?water/.test(s.id)).map(s=>s.id)};
        }""")
        assert result['source'] and all(s['role']=='actual' for s in result['source']),result
        assert {s['channel'] for s in result['source']}=={4,10},result
        assert result['planIds']==[],result
    check_sources()
    page.evaluate('state.channels=state.channels.map((_,i)=>[4,10].includes(i));applyCurveVisibility()')
    assert page.evaluate('state.charts[0].getOption().yAxis[2].max')<200
    cursor=page.evaluate("""()=>{const t=state.chartStart+8*3600000;return {rows:selectedCursorReadings(t),html:mainTooltip(t)};}""")
    assert {r['channel']:r['plan']['value'] for r in cursor['rows']}=={4:1000,10:200}
    assert '1000.00' in cursor['html'] and '200.00' in cursor['html']
    checks.append('both water channels contain actual series only; axis uses actual values; cursor retains outlet 1000 and inlet 200 ppmv plans')
    for mode in ['actual','plan','both']:
        page.locator('#curve-visibility').select_option(mode);check_sources()
        if mode=='plan':assert page.evaluate('visibleTrendSeries().filter(s=>[4,10].includes(s.channel)).length')==0
    checks.append('plan/actual display mode switches never create water plan lines')
    page.get_by_role('button',name='全屏综合趋势',exact=True).click();check_sources()
    result=page.evaluate('async()=>{const canvas=await trendExportCanvas(state.charts[0]);return {width:canvas.width,height:canvas.height};}')
    assert result['width']>0 and result['height']>0
    page.screenshot(path=str(OUT/'actual-water-fullscreen.png'))
    page.keyboard.press('Escape');page.evaluate('refresh()');page.wait_for_function('state.charts[0]');check_sources()
    checks.append('fullscreen, PNG canvas export and refreshed charts keep the same actual-only water rendering')
    assert not errors,errors
    browser.close()
(OUT/'water-actual-check.json').write_text(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
