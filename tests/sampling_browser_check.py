"""Frontend acceptance with synthetic API data; no production database access."""
import json
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'
OUT.mkdir(exist_ok=True)
subprocess.run(['node','--input-type=module','-e',"import {restore} from './lib/monitor/service.mjs';import {detail,iso} from './lib/monitor/domain.mjs';import demo from './lib/monitor/demo.json' with {type:'json'};import fs from 'node:fs';const d=restore(demo);d.samples.pop();const t=iso(Date.parse(d.batch.start_time)+129*3600000);d.concentrations.push({id:'merged-a',batch_id:d.batch.id,kind:'ammonia',timestamp:t,value:12,unit:'%',point:'样点甲',note:'最新独立采样'},{id:'merged-b',batch_id:d.batch.id,kind:'ammonia',timestamp:t,value:15,unit:'mg/L',point:'样点乙',note:'第二个采样点'});fs.writeFileSync('test-results/sampling-detail.json',JSON.stringify(detail(d)));"],cwd=ROOT,check=True)
detail=json.loads((OUT/'sampling-detail.json').read_text(encoding='utf-8'))
bid=detail['batch']['id'];checks=[]

with sync_playwright() as p:
    browser=p.chromium.launch()
    def context(role):
        c=browser.new_context(viewport={'width':1600,'height':1000},timezone_id='Asia/Shanghai')
        def route(r):
            path=urlparse(r.request.url).path
            if path=='/':r.fulfill(body=(ROOT/'lib/monitor/index.html').read_text(encoding='utf-8'),content_type='text/html');return
            if path.startswith('/static/'):
                file=ROOT/'public'/path.lstrip('/')
                r.fulfill(path=str(file));return
            if path=='/api/session/me':r.fulfill(json={'username':role,'role':'editor' if role=='admin' else 'viewer','canEdit':role=='admin'});return
            if path=='/api/batches':r.fulfill(json=[detail['batch']]);return
            if path==f'/api/batches/{bid}':r.fulfill(json=detail);return
            if '/concentrations/' in path and r.request.method=='PUT':
                parts=path.split('/');kind,cid=parts[-2:];payload=r.request.post_data_json
                row=next(x for x in detail['concentrations'][kind] if x['id']==cid);row.update(payload)
                r.fulfill(json={'ok':True});return
            if '/concentrations/' in path and r.request.method=='DELETE':
                kind,cid=path.split('/')[-2:];detail['concentrations'][kind]=[x for x in detail['concentrations'][kind] if x['id']!=cid]
                r.fulfill(json={'ok':True});return
            raise AssertionError((path,r.request.method))
        c.route('**/*',route);return c
    admin=context('admin');page=admin.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://sampling.test/');page.wait_for_function('state.detail?.batch');page.get_by_role('button',name='读数与数据',exact=True).click()
    assert page.locator('.sampling-panel').count()==1
    assert page.locator('.chemistry-records').count()==0
    times=page.locator('#sample-table tr[data-sampling-time]').evaluate_all('rows=>rows.map(r=>Number(r.dataset.samplingTime))')
    assert times==sorted(set(times),reverse=True)
    first=page.locator('#sample-table tr').first
    assert '样点甲' in first.inner_text() and '样点乙' in first.inner_text()
    assert first.locator('td').nth(2).inner_text()=='—'
    assert first.get_by_role('button',name='编辑',exact=True).count()==1
    assert first.get_by_role('button',name='删除',exact=True).count()==1
    tools=page.locator('.sampling-tools')
    assert tools.get_by_role('button',name='添加数据',exact=True).count()==1
    assert tools.locator('[data-action="sample"],[data-action="water"],[data-action="inlet-water"],[data-action="ammonia"]').count()==0
    tools.get_by_role('button',name='添加数据',exact=True).click()
    for name in ['t1','water_value','inlet_water_value','ammonia_value']:
        assert page.locator(f'#cursor-readings-form [name="{name}"]').is_visible()
    page.keyboard.press('Escape')
    checks.append('unified add form and row actions for a concentration-only row')
    page.locator('#data-search').fill('样点甲');assert page.locator('#sample-table tr').count()==1
    page.locator('#data-search').fill('不存在的采样点');assert '没有符合' in page.locator('#sample-table').inner_text()
    page.locator('#data-search').fill('');assert page.locator('#sample-table tr').count()==len(times)
    checks.append('one search filters both time and concentration sample metadata without losing records')
    first.get_by_role('button',name='编辑',exact=True).click()
    page.locator('#modal [data-action="edit-concentration"][data-id="merged-a"]').click()
    page.locator('[name="value"]').fill('13');page.locator('[name="note"]').fill('修改后备注')
    page.get_by_role('button',name='保存浓度修正',exact=True).click()
    page.wait_for_function('!document.querySelector("#modal").open')
    page.get_by_text('修改后备注',exact=True).wait_for()
    assert '修改后备注' in page.locator('#sample-table tr').first.inner_text()
    first.get_by_role('button',name='删除',exact=True).click()
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#modal [data-action="delete-concentration"][data-id="merged-b"]').click()
    first.get_by_text('样点乙',exact=True).wait_for(state='hidden')
    assert first.get_by_text('样点甲',exact=True).is_visible()
    assert first.locator('[data-action="delete-concentration"][data-id="merged-a"]').is_visible()
    checks.append('concentration edit and delete refresh the combined table and preserve independent records')
    page.screenshot(path=str(OUT/'combined-sampling-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.locator('.sampling-table').evaluate('n=>n.scrollWidth>n.clientWidth')
    page.screenshot(path=str(OUT/'combined-sampling-mobile.png'),full_page=True)
    guest=context('guest');view=guest.new_page();view.goto('http://sampling.test/');view.wait_for_function('state.detail?.batch');view.get_by_role('button',name='读数与数据',exact=True).click()
    assert view.locator('[data-action="edit-concentration"]').first.is_hidden()
    assert view.locator('[data-action="edit-sample"]').first.is_hidden()
    assert view.locator('.sampling-tools [data-action="next-reading"]').is_hidden()
    assert view.locator('#sample-table [data-action^="delete-"]').first.is_hidden()
    assert view.locator('#sample-table tr').count()==len(times)
    checks.append('narrow screens can scroll; guest sees all data with edit controls hidden')
    assert not errors,errors
    browser.close()
(OUT/'sampling-check.json').write_text(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
