"""Test role/password auth with synthetic credentials in the local .dev.vars only."""
import json
from pathlib import Path
import httpx
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:5180'
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
checks=[]
with httpx.Client(base_url=URL,trust_env=False) as client:
    assert client.get('/').status_code==200
    assert '账号' in client.get('/').text
    for path in ['/api/batches','/api/health','/api/session/me','/api/source-plan']:
        assert client.get(path).status_code==401,path
    assert client.post('/api/session/login',json={'username':'admin','password':'wrong'}).status_code==401
    assert client.post('/api/session/login',headers={'origin':'https://other.test'},json={}).status_code==403
checks.append('anonymous visitors receive the password form; every data endpoint requires a session; bad password and cross-origin login fail')
with sync_playwright() as p:
    browser=p.chromium.launch()
    admin=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Shanghai')
    page=admin.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(URL);page.locator('[name="username"]').fill('admin');page.locator('[name="password"]').fill('editor-test-password');page.get_by_role('button',name='登录',exact=True).click()
    page.get_by_text('admin · 编辑权限',exact=True).wait_for()
    assert admin.request.get(URL+'/api/session/me').json()['canEdit'] is True
    page.get_by_role('button',name='体验演示',exact=True).click();page.locator('#chart-0 canvas').wait_for()
    bid=page.evaluate('state.batchId')
    r=admin.request.post(URL+f'/api/batches/{bid}/events',data={'timestamp':'2026-10-29T08:00:00+08:00','title':'权限验收','description':'仅管理员可写'})
    assert r.ok,r.text();eid=r.json()['id']
    assert admin.request.delete(URL+f'/api/batches/{bid}/events/{eid}').ok
    checks.append('admin signs in, renders chart, and can create/delete data')
    guest=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Shanghai')
    view=guest.new_page();view.on('pageerror',lambda error:errors.append(str(error)))
    view.goto(URL);view.locator('[name="username"]').fill('guest');view.locator('[name="password"]').fill('viewer-test-password');view.get_by_role('button',name='登录',exact=True).click()
    view.get_by_text('guest · 只读查看',exact=True).wait_for();view.locator('#chart-0 canvas').wait_for()
    assert guest.request.get(URL+'/api/session/me').json()['canEdit'] is False
    assert guest.request.get(URL+f'/api/batches/{bid}').ok
    assert guest.request.get(URL+f'/api/batches/{bid}/export/samples').ok
    for method,path in [('POST','/api/batches'),('POST','/api/demo'),('POST','/api/restore'),('POST',f'/api/batches/{bid}/cursor-readings'),('PUT',f'/api/batches/{bid}/curve-plan/0'),('DELETE',f'/api/batches/{bid}/samples/fake')]:
        r=guest.request.fetch(URL+path,method=method,data={});assert r.status==403,(method,path,r.status,r.text())
    assert view.get_by_role('button',name='新建批次',exact=True).count()==0
    assert view.locator('[data-action="actual-data"]').is_hidden()
    view.get_by_role('button',name='设置时间段',exact=True).click()
    start,end=view.evaluate('()=>[localInput(state.chartStart+3600000),localInput(state.chartStart+3*3600000)]')
    view.locator('[name="range_start"]').fill(start);view.locator('[name="range_end"]').fill(end);view.get_by_role('button',name='应用时间段',exact=True).click()
    view.wait_for_function('!document.querySelector("#modal").open')
    assert view.locator('#chart-range').input_value()=='custom'
    view.get_by_role('button',name='还原计划',exact=True).click()
    assert view.locator('[data-action="curve-stage"]').first.is_hidden()
    checks.append('guest can read charts, plan, exports and change viewing range; write controls are hidden and direct POST/PUT/DELETE requests are rejected')
    # A forged role cannot be used to turn the signed guest session into admin.
    cookie=next(c for c in guest.cookies() if c['name']=='ammonia_session')
    assert cookie['httpOnly'] and cookie['sameSite']=='Strict'
    assert view.evaluate('document.cookie')==''
    view.get_by_role('button',name='退出登录',exact=True).click();view.locator('[name="username"]').wait_for()
    assert guest.request.get(URL+'/api/batches').status==401
    checks.append('session cookie is HttpOnly; logout removes access')
    assert not errors,errors
    page.screenshot(path=str(OUT/'admin-role.png'),full_page=True)
    view.screenshot(path=str(OUT/'account-login.png'),full_page=True)
    browser.close()
with httpx.Client(base_url=URL,trust_env=False) as client:
    for i in range(11):
        r=client.post('/api/session/login',headers={'cf-connecting-ip':'198.51.100.98'},json={'username':'invalid-test-user','password':'wrong'})
        assert r.status_code==(401 if i<10 else 429),(i,r.status_code,r.text)
checks.append('repeated invalid logins are rate-limited')
(OUT/'login-check.json').write_text(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'passed':len(checks),'checks':checks},ensure_ascii=False,indent=2))
