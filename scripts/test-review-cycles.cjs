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
(async()=>{browser=await chromium.launch({headless:true,...(process.env.LEDGER_BROWSER?{executablePath:process.env.LEDGER_BROWSER}:{})});const results=[];try{for(let r=1;r<=round;r++){for(const t of groups[r-1]){try{await t.fn();results.push({round:r,name:t.name,pass:true})}catch(e){results.push({round:r,name:t.name,pass:false,detail:e.message.slice(0,450)})}}}console.log(JSON.stringify({results},null,2));if(strict&&results.some(x=>!x.pass))process.exitCode=1;}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
