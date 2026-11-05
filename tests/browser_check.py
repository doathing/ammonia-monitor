"""Cloud preview acceptance; uses only the local preview database."""
import io
import json
import os
from pathlib import Path
from datetime import datetime,timedelta,timezone
import httpx
from openpyxl import load_workbook
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results';RESULTS.mkdir(exist_ok=True)
URL=os.environ.get('MONITOR_TEST_URL','http://127.0.0.1:5173')
checks=[]

with httpx.Client(trust_env=False) as client:
    r=client.get(URL+'/api/health');assert r.status_code==401,(r.status_code,r.text)
checks.append('anonymous API is rejected')
with sync_playwright() as p:
    browser=p.chromium.launch()
    a=browser.new_context(viewport={'width':1600,'height':1100},timezone_id='Asia/Shanghai')
    page=a.new_page();errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(URL);page.locator('[name="username"]').fill('admin');page.locator('[name="password"]').fill('editor-test-password');page.get_by_role('button',name='登录',exact=True).click();page.get_by_text('admin · 编辑权限',exact=True).wait_for()
    page.get_by_role('button',name='体验演示',exact=True).click()
    page.locator('#chart-0 canvas').wait_for(timeout=60000)
    page.wait_for_function('state.detail?.batch.demo && state.detail.samples.length===259')
    assert page.evaluate('state.detail.samples.length')==259
    assert '云端' in page.locator('.sidebar-footer').inner_text()
    checks.append('local sign-in and demo load from D1; full chart and cloud labels render')
    page.get_by_role('button',name='设置时间段',exact=True).click()
    begin,end=page.evaluate('()=>[localInput(state.chartStart+6*3600000,true),localInput(state.chartStart+13*3600000,true)]')
    page.locator('[name="range_start"]').fill(begin[:16]);page.locator('[name="range_end"]').fill(end[:16])
    page.get_by_role('button',name='应用时间段',exact=True).click()
    page.wait_for_function('!document.querySelector("#modal").open')
    assert page.evaluate('trendTimeWindow()')==page.evaluate('[state.chartStart+6*3600000,state.chartStart+13*3600000]')
    page.evaluate('refresh()');assert page.locator('#chart-range').input_value()=='custom'
    page.get_by_role('button',name='全屏综合趋势',exact=True).click()
    page.get_by_role('button',name='设置时间段',exact=True).click()
    page.get_by_role('button',name='取消',exact=True).click();page.keyboard.press('Escape')
    checks.append('custom time window, refresh persistence and fullscreen dialog')
    req=a.request
    start=(datetime.now(timezone(timedelta(hours=8)))-timedelta(hours=2)).replace(microsecond=0)
    r=req.post(URL+'/api/batches',data={'name':'云端跨设备验收','start_time':start.isoformat(),'initial':[20,21,22]})
    assert r.ok,r.text();bid=r.json()['id'];path=URL+'/api/batches/'+bid
    timestamp=(start+timedelta(minutes=30)).isoformat()
    payload={'timestamp':timestamp,'sample':{'t1':45,'t2':35,'t3':30,'pressure':5},'inlet_water':{'value':250},'water':{'value':1,'basis':'standard0','temperature_c':0,'pressure_kpa':101.325},'ammonia':{'value':12,'unit':'%','point':'出口','note':'跨电脑测试'}}
    r=req.post(path+'/cursor-readings',data=payload);assert r.ok,r.text()
    bad={**payload,'timestamp':(start+timedelta(minutes=45)).isoformat(),'ammonia':{'value':101,'unit':'%','point':'出口'}}
    assert req.post(path+'/cursor-readings',data=bad).status==422
    assert len(req.get(path).json()['samples'])==1
    checks.append('atomic readings and independent concentrations persist in local D1; invalid multi-part write leaves no partial data')
    # An independent browser context has no batch localStorage or cache.
    b=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Shanghai')
    second=b.new_page();second.goto(URL);second.locator('[name="username"]').fill('guest');second.locator('[name="password"]').fill('viewer-test-password');second.get_by_role('button',name='登录',exact=True).click();second.get_by_text('guest · 只读查看',exact=True).wait_for()
    second.locator('#batch-select').select_option(bid)
    second.wait_for_function('state.detail?.samples.length===1')
    assert second.evaluate('state.detail.concentrations.ammonia[0].note')=='跨电脑测试'
    checks.append('independent browser context sees the saved batch and concentrations from cloud API')
    template=req.get(URL+'/api/templates/xlsx');assert template.ok,template.text()
    wb=load_workbook(io.BytesIO(template.body()));wb.active.append([(start+timedelta(hours=1)).replace(tzinfo=None),60,50,40,5.1]);stream=io.BytesIO();wb.save(stream);wb.close()
    r=req.post(URL+'/api/import/inspect',multipart={'file':{'name':'readings.xlsx','mimeType':'application/octet-stream','buffer':stream.getvalue()}});assert r.ok,r.text()
    r=req.post(path+'/import',data={'rows':r.json()['rows'],'mapping':{'timestamp':0,'t1':1,'t2':2,'t3':3,'pressure':4}});assert r.ok and r.json()['written']==1,r.text()
    backup=req.get(path+'/export/backup');assert backup.ok
    r=req.post(URL+'/api/restore',multipart={'file':{'name':'backup.json','mimeType':'application/json','buffer':backup.body()}});assert r.ok,r.text()
    assert len(req.get(URL+'/api/batches/'+r.json()['id']).json()['samples'])==2
    checks.append('XLSX generation/upload/import and complete JSON backup/restore work in the actual Worker runtime')
    second.reload();second.locator('#chart-0 canvas').wait_for();assert second.evaluate('state.detail.samples.length')==2
    second.screenshot(path=str(RESULTS/'cloud-desktop.png'),full_page=True)
    second.set_viewport_size({'width':390,'height':844});second.screenshot(path=str(RESULTS/'cloud-mobile.png'),full_page=True)
    assert not errors,errors
    checks.append('reload preserves records; desktop/mobile screenshots; no JavaScript errors')
    browser.close()
(RESULTS/'browser-check.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'javascript_errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
