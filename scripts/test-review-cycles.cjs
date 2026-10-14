'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.LEDGER_PLAYWRIGHT||'playwright');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const round=Number(process.env.REVIEW_ROUND||1), strict=process.env.REVIEW_STRICT==='1';
const groups=[[],[],[],[],[]];let browser;
async function fresh(options={}) {
 const c=await browser.newContext({viewport:{width:1100,height:950}});
 await c.route('**/*',r=>r.request().url().startsWith('https://review.test/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await c.addInitScript(({names,broken,blocked})=>{
  if(!sessionStorage.getItem('seeded')){
   const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(d.getDay()-3+7)%7);const k=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
   localStorage.setItem('lag_accounts',JSON.stringify([{id:'a1',name:names?.[0]||'테스트 A'},{id:'a2',name:names?.[1]||'테스트 B'}]));
   localStorage.setItem('lag_settings',JSON.stringify({baseTarget:1500000,exchangeRate:750,itemTarget:830000}));
   localStorage.setItem('lag_week_'+k,JSON.stringify({target:1500000,carriedEarned:1100000,carriedByAccount:{a1:300000,a2:800000},entries:[]}));
   localStorage.setItem('lag_items',JSON.stringify([{id:'i1',name:'융화 재료',price:243,qty:8900},{id:'i2',name:'보석',price:315998,qty:6}]));
   if(broken)localStorage.setItem('lag_accounts','{broken');sessionStorage.setItem('seeded','yes');
  }
  if(blocked==='write'){window.restoreStorage=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('simulated write denial')};}
  if(blocked==='read'){Object.defineProperty(window,'localStorage',{get(){throw Error('simulated read denial')}});}
 },options);
 const p=await c.newPage();p.setDefaultTimeout(3000);p.on('dialog',d=>d.accept());const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto('https://review.test/');return {p,c,errors};
}
async function use(fn,options){const f=await fresh(options);try{return await fn(f.p,f.errors)}finally{await f.c.close()}}
const week=p=>p.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('lag_week_')))));
async function sale(p,n){await p.locator('#entry-amount').fill(String(n));await p.evaluate(()=>__gl.addEntry());}
async function download(p,method){await p.evaluate(async method=>{URL.createObjectURL=blob=>{window.reviewBlob=blob;return 'blob:https://review.test/test'};await __gl[method]()},method);return p.evaluate(()=>window.reviewBlob.text());}
function test(r,name,fn){groups[r-1].push({name,fn});}
test(1,'정상 판매 10만',()=>use(async p=>{await sale(p,10);assert.equal((await week(p)).entries[0].amount,100000)}));
test(1,'보유액 초과 판매 차단',()=>use(async p=>{await sale(p,40);assert.equal((await week(p)).entries.length,0)}));
test(1,'주간 실행 취소',()=>use(async p=>{await sale(p,10);await p.evaluate(()=>__gl.undoLedger());assert.equal((await week(p)).entries.length,0)}));
test(1,'일반 계정 CSV 잔액',()=>use(async p=>{const csv=await download(p,'exportCSV');assert.match(csv,/300000,800000/)}));
test(1,'중복 이름 CSV 분리',()=>use(async p=>{const csv=await download(p,'exportCSV');assert.match(csv,/300000,800000/);assert.match(csv,/a1.*a2/);},{names:['동일','동일']}));
test(1,'삭제 계정 CSV 보존',()=>use(async p=>{await p.evaluate(()=>__gl.deleteAccount('a1'));const csv=await download(p,'exportCSV');assert.match(csv,/삭제된 계정/);assert.match(csv,/300000/)}));
test(1,'특수 이름 CSV 안전성',()=>use(async p=>{const csv=await download(p,'exportCSV');assert.match(csv,/'=1/);assert.match(csv,/300000,800000/);},{names:['=1+1','이월 조정 / 미배정']}));
test(1,'시작부터 저장 쓰기 차단 안내',()=>use(async(p,errors)=>{assert.match(await p.locator('#app').innerText(),/저장.*확인/);assert.deepEqual(errors,[])},{blocked:'write'}));
test(1,'시작부터 저장 읽기 차단 안내',()=>use(async(p,errors)=>{assert.match(await p.locator('#app').innerText(),/저장.*확인/);assert.deepEqual(errors,[])},{blocked:'read'}));
test(1,'손상된 저장값 원본 보존',()=>use(async p=>{assert.equal(await p.evaluate(()=>localStorage.getItem('lag_accounts')),'{broken');assert.match(await p.locator('#app').innerText(),/저장.*확인/)},{broken:true}));
test(2,'이름 수정 Esc 취소',()=>use(async p=>{await p.evaluate(()=>__gl.startRename('a1'));await p.locator('#rename-input').fill('취소');await p.locator('#rename-input').press('Escape');assert.equal(await p.locator('#rename-input').count(),0);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_accounts'))[0].name),'테스트 A')}));
test(2,'빈 계정 이름 안내',()=>use(async p=>{await p.evaluate(()=>__gl.startRename('a1'));await p.locator('#rename-input').fill(' ');await p.evaluate(()=>__gl.commitRename('a1'));assert.equal(await p.locator('#rename-input').count(),1);assert.ok(await p.locator('#rename-input').evaluate(e=>e.validationMessage))}));
test(2,'이름 변경 키보드 버튼',()=>use(async p=>{await p.locator('.account-manager summary').click();const button=p.getByRole('button',{name:'테스트 A 이름 변경',exact:true});assert.equal(await button.count(),1);await button.focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#rename-input').count(),1)}));
test(2,'탭 전환 포커스 유지',()=>use(async p=>{await p.getByRole('button',{name:'아이템 계산기',exact:true}).focus();await p.keyboard.press('Enter');assert.equal(await p.evaluate(()=>document.activeElement.textContent),'아이템 계산기')}));
test(2,'기본 목표 적용 설명',()=>use(async p=>{await p.evaluate(()=>__gl.openBaseModal());assert.match(await p.locator('.modal').innerText(),/다음 주/)}));
test(2,'기본 목표만 변경',()=>use(async p=>{await p.evaluate(()=>__gl.openBaseModal());await p.locator('#base-input').fill('200');await p.evaluate(()=>__gl.saveBase());assert.equal((await week(p)).target,1500000)}));
test(2,'이번 주 목표 선택 적용',()=>use(async p=>{await sale(p,10);await p.evaluate(()=>__gl.openBaseModal());await p.locator('#base-input').fill('200');await p.locator('#base-apply-current').check();await p.evaluate(()=>__gl.saveBase());assert.equal((await week(p)).target,2100000)}));
test(2,'카드값 Esc 취소',()=>use(async p=>{await p.evaluate(()=>__gl.startEditCardBill());await p.locator('#card-bill-input').fill('999');await p.locator('#card-bill-input').press('Escape');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_settings')).cardBill),0)}));
test(2,'현금 키보드 편집',()=>use(async p=>{const b=p.getByRole('button',{name:'현금 수정',exact:true});assert.equal(await b.count(),1);await b.focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#cash-input').count(),1)}));
test(2,'판매 계정 유지',()=>use(async p=>{await p.locator('#entry-account').selectOption('a2');await sale(p,10);assert.equal(await p.locator('#entry-account').inputValue(),'a2')}));
async function priceSetup(p,mode='success') {
 await p.evaluate(()=>{const s=JSON.parse(localStorage.getItem('lag_settings'));s.itemPriceApiKey='test-only';localStorage.setItem('lag_settings',JSON.stringify(s))});await p.reload();
 await p.evaluate(mode=>{__gl.setView('items');window.fetch=async(url,options)=>{
  if(mode==='fail')throw Error('mock offline');if(mode==='401')return {ok:false,status:401};
  if(mode==='timeout'){const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===15000?1:ms,...args);return new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))));}
  if(mode==='partial'&&url.includes('auctions'))throw Error('mock partial');
  return {ok:true,json:async()=>url.includes('auctions')?{Items:[{AuctionInfo:{BuyPrice:320000}}]}:{Items:[{Name:'상급 아비도스 융화 재료',CurrentMinPrice:300,BundleCount:1}]}};
 };},mode);
 await p.evaluate(()=>__gl.setPriceMode('i1','auto'));await p.evaluate(()=>__gl.setPriceMode('i2','auto'));
}
async function refreshPrices(p){await p.getByRole('button',{name:'지금 갱신',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('.calc-toolbar button').disabled,{},{timeout:18000});}
test(3,'API 미연결 안내',()=>use(async p=>{await p.evaluate(()=>__gl.setView('items'));assert.equal(await p.getByRole('button',{name:'API 연결하기'}).count(),1)}));
test(3,'수동 가격 갱신 제외',()=>use(async p=>{await p.evaluate(()=>__gl.setView('items'));await refreshPrices(p);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_items'))[0].price),243)}));
test(3,'모두 실패한 성공 시각',()=>use(async p=>{await priceSetup(p,'fail');await refreshPrices(p);const s=await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_settings')));assert.ok(s.itemPriceLastAttempt>0);assert.equal(s.itemPriceLastSuccess||0,0);assert.match(await p.locator('.calc-toolbar').innerText(),/성공.*없음/)}));
test(3,'정상 시세 성공 시각',()=>use(async p=>{await priceSetup(p);await refreshPrices(p);assert.ok(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_settings')).itemPriceLastSuccess>0))}));
test(3,'부분 실패 가격 유지',()=>use(async p=>{await priceSetup(p,'partial');await refreshPrices(p);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_items'))[1].price),315998)}));
test(3,'인증 만료 안내',()=>use(async p=>{await priceSetup(p,'401');await refreshPrices(p);assert.match(await p.locator('.calc-error').first().innerText(),/API 키|권한/)}));
test(3,'응답 지연 시간 제한',()=>use(async p=>{await priceSetup(p,'timeout');await p.evaluate(()=>{const timer=window.setTimeout;window.setTimeout=(fn,ms,...args)=>timer(fn,ms===15000?1:ms,...args)});await refreshPrices(p);assert.match(await p.locator('.calc-error').first().innerText(),/시간|지연/)}));
test(3,'실패 상태 새로고침 유지',()=>use(async p=>{await priceSetup(p,'fail');await refreshPrices(p);await p.reload();await p.evaluate(()=>__gl.setView('items'));assert.match(await p.locator('.calc-toolbar').innerText(),/이전 가격/)}));
test(3,'소수 수수료 저장',()=>use(async p=>{await p.evaluate(()=>__gl.setView('items'));await p.locator('.calc-value[data-field="fee"]').click();await p.locator('#calc-editor').fill('2.5');await p.evaluate(()=>__gl.commitCalc(document.querySelector('#calc-editor')));assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_settings')).saleFeePercent),2.5)}));
test(3,'계획 입력 실제 수량 유지',()=>use(async p=>{await p.evaluate(()=>__gl.setView('items'));await p.locator('.calc-plan summary').click();await p.locator('.plan-qty').first().fill('1000');assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_items'))[0].qty),8900)}));
async function pack(p){return JSON.parse(await download(p,'exportJSON'))}
async function upload(p,data,accept=true){await p.evaluate(accept=>{sessionStorage.removeItem('preview');window.confirm=msg=>{sessionStorage.setItem('preview',msg);return accept}},accept);await p.locator('#import-file-input').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await p.waitForTimeout(180);}
test(4,'다른 계정 부분 백업 합치기',()=>use(async p=>{const b=await pack(p);b.accounts=[{id:'new',name:'새 계정'}];Object.keys(b).filter(k=>k.startsWith('week_')).forEach(k=>delete b[k]);await upload(p,b);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_accounts')).length),3)}));
test(4,'계정 불일치 미리보기',()=>use(async p=>{const b=await pack(p);b.accounts=[{id:'new',name:'새 계정'}];await upload(p,b,false);assert.match(await p.evaluate(()=>sessionStorage.getItem('preview')),/기존 계정.*유지|계정 불일치/)}));
test(4,'전체 복원에서 없는 주차 제거',()=>use(async p=>{await p.evaluate(()=>{localStorage.setItem('lag_week_2020-01-01',JSON.stringify({target:0,entries:[]}))});await p.reload();const b=await pack(p);delete b['week_2020-01-01'];await p.evaluate(()=>__gl.openDataModal());await p.locator('#import-mode').selectOption('replace');await upload(p,b);assert.equal(await p.evaluate(()=>localStorage.getItem('lag_week_2020-01-01')),null)}));
test(4,'없는 날짜 백업 거부',()=>use(async p=>{const b=await pack(p);b['week_2026-02-31']={target:0,entries:[]};await upload(p,b);assert.equal(await p.evaluate(()=>localStorage.getItem('lag_week_2026-02-31')),null)}));
test(4,'중복 내역 ID 백업 거부',()=>use(async p=>{const b=await pack(p),k=Object.keys(b).find(k=>k.startsWith('week_'));const e={id:'duplicate',accountId:'a1',type:'sell',amount:1000,date:new Date().toISOString()};b[k].entries=[e,e];await upload(p,b);assert.equal((await week(p)).entries.length,0)}));
test(4,'아이템 총액 범위 검증',()=>use(async p=>{const b=await pack(p);b.items=[{id:'a',name:'a',price:1e12,qty:9000},{id:'b',name:'b',price:1e12,qty:9000}];await upload(p,b);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_items'))[0].id),'i1')}));
test(4,'가져온 외부 연결 무시',()=>use(async p=>{const b=await pack(p);b.settings.sheetUrl='https://untrusted.invalid/';b.settings.itemPriceApiKey='test-only-untrusted';await upload(p,b);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_settings')).sheetUrl),'')}));
test(4,'가져오기 취소',()=>use(async p=>{const b=await pack(p);b.accounts[0].name='취소';await upload(p,b,false);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_accounts'))[0].name),'테스트 A')}));
test(4,'합치기에서 기존 사진 유지',()=>use(async p=>{await p.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=1;localStorage.setItem('lag_portraitImages',JSON.stringify([canvas.toDataURL()]));localStorage.setItem('lag_portraitBindings',JSON.stringify({a1:0}))});await p.reload();const b=await pack(p);delete b.portraitImages;delete b.portraitBindings;await upload(p,b);assert.equal(await p.locator('.ar-portrait img').count(),1)}));
test(4,'가져오기 저장 실패 복구',()=>use(async p=>{const b=await pack(p);b.accounts[0].name='실패';await p.evaluate(()=>{const original=Storage.prototype.setItem;let count=0;Storage.prototype.setItem=function(k,v){if(k.startsWith('lag_')&&++count===2)throw Error('mock quota');return original.call(this,k,v)}});await upload(p,b);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('lag_accounts'))[0].name),'테스트 A')}));
(async()=>{browser=await chromium.launch({headless:true,...(process.env.LEDGER_BROWSER?{executablePath:process.env.LEDGER_BROWSER}:{})});const results=[];try{for(let r=1;r<=round;r++){for(const t of groups[r-1]){try{await t.fn();results.push({round:r,name:t.name,pass:true})}catch(e){results.push({round:r,name:t.name,pass:false,detail:e.message.slice(0,450)})}}}console.log(JSON.stringify({results},null,2));if(strict&&results.some(x=>!x.pass))process.exitCode=1;}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
