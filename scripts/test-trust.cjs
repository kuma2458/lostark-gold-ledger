'use strict';
// Browser-free fallback: execute the actual app functions, not duplicated formulas.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const elements={};
const ctx={console,Number,Math,Date,Set,Object,JSON,document:{getElementById:id=>elements[id]},setTimeout:()=>{},saleTrustMode:'enough',saleTrustDraft:'',saleFeeDraft:'',saleDraft:'',render:()=>{},saveCurrentWeek:()=>{},fmtGold:String,fmtNum:String};
vm.createContext(ctx);
for(const name of ['parseGoldInput','totalEarned','totalSold','entryTrustFee','totalTrustFees','estimatedTrustFee','readSaleTrust','effectiveWeekTarget','totalWeekEarned','accountEarned','totalAccountEarned','nextCarriedByAccount']){
 const start=html.indexOf('  function '+name+'(');assert.ok(start>=0,name);
 const end=html.indexOf('\n  }',start)+4;vm.runInContext(html.slice(start,end),ctx);
}
const start=html.indexOf('    addEntry: function () {'),end=html.indexOf('    deleteEntry: function',start);
vm.runInContext('var addEntry = '+html.slice(start,end).trim().replace(/^addEntry: /,'').replace(/,$/,'')+';',ctx);
function field(value){return {value,setCustomValidity(v){this.error=v},reportValidity(){},focus(){}}}
function reset(mode='enough',trust='',fee=''){
 ctx.state={entryType:'sell',accounts:[{id:'a'}],weekCarriedByAccount:{a:300000},weekCarriedEarned:300000,weekTarget:1500000,entries:[]};
 elements['entry-account']=field('a');elements['entry-amount']=field('10');
 elements['sale-trust-mode']=field(mode);elements['sale-trust']=field(trust);elements['sale-fee']=field(fee);
}
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name)}
test('sufficient trust: legacy behavior',()=>{reset();ctx.addEntry();assert.equal(ctx.state.entries[0].trustFee,0)});
test('zero trust: 100000 sale + 25000 expense',()=>{reset('zero');ctx.addEntry();assert.equal(ctx.state.entries[0].trustFee,25000);assert.equal(ctx.totalAccountEarned({a:300000},ctx.state.entries,'a'),175000);assert.equal(ctx.totalWeekEarned(300000,ctx.state.entries),175000);assert.equal(ctx.effectiveWeekTarget(1500000,ctx.state.entries),1400000)});
test('carry preserves fees by account',()=>{assert.equal(ctx.nextCarriedByAccount({a:300000,b:70000},ctx.state.entries).a,175000);assert.equal(ctx.nextCarriedByAccount({a:300000,b:70000},ctx.state.entries).b,70000)});
test('partial trust',()=>{reset('partial','5');ctx.addEntry();assert.equal(ctx.state.entries[0].trustFee,12500)});
test('trust exceeds sale',()=>{reset('partial','20');ctx.addEntry();assert.equal(ctx.state.entries[0].trustFee,0)});
test('insufficient fee-inclusive balance rejected',()=>{reset('zero');elements['entry-amount'].value='25';ctx.addEntry();assert.equal(ctx.state.entries.length,0)});
test('exact balance accepted',()=>{reset('zero');elements['entry-amount'].value='24';ctx.addEntry();assert.equal(ctx.totalWeekEarned(300000,ctx.state.entries),0)});
test('rounding is upward estimate',()=>{assert.equal(ctx.estimatedTrustFee(1,0),1)});
test('manual in-game fee',()=>{reset('zero','','123');ctx.addEntry();assert.equal(ctx.state.entries[0].trustFee,123);assert.equal(ctx.state.entries[0].trustFeeManual,true)});
test('invalid fees rejected',()=>{for(const fee of ['-1','1.5','abc','9007199254740992']){reset('zero','',fee);ctx.addEntry();assert.equal(ctx.state.entries.length,0)}});
test('invalid partial trust rejected',()=>{reset('partial','-1');ctx.addEntry();assert.equal(ctx.state.entries.length,0)});
test('legacy entries and JSON roundtrip',()=>{const entries=JSON.parse(JSON.stringify([{type:'sell',amount:100000,accountId:'a'}]));assert.equal(ctx.totalWeekEarned(300000,entries),200000)});
const editStart=html.indexOf('    commitEditEntry: function (id) {'),editEnd=html.indexOf('    toggleHistory:',editStart);
vm.runInContext('var edit = '+html.slice(editStart,editEnd).trim().replace(/^commitEditEntry: /,'').replace(/,$/,'')+';',ctx);
test('edit recalculates fee from original trust',()=>{reset('partial','5');ctx.addEntry();elements['entry-edit-input']=field('20');elements['entry-edit-fee']=field('');ctx.edit(ctx.state.entries[0].id);assert.equal(ctx.state.entries[0].trustFee,37500);assert.equal(ctx.totalWeekEarned(300000,ctx.state.entries),62500)});
test('edit rejects fee-inclusive oversell',()=>{elements['entry-edit-input'].value='30';ctx.edit(ctx.state.entries[0].id);assert.equal(ctx.state.entries[0].amount,200000)});
test('edit exact fee override',()=>{elements['entry-edit-input'].value='20';elements['entry-edit-fee'].value='30000';ctx.edit(ctx.state.entries[0].id);assert.equal(ctx.state.entries[0].trustFee,30000)});
console.log(count+' trust logic checks passed. Browser layout/integration not covered.');
