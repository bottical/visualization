"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function setup(){const elements={},storage=new Map(),c={console,Date,window:{devicePixelRatio:1},confirm:()=>true,document:{querySelector:q=>elements[q]||=( {textContent:'',classList:{toggle(){}}}),querySelectorAll:()=>[]},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};vm.createContext(c);for(const f of ['planning.js','visibility.js','app.js']){let s=fs.readFileSync(f,'utf8');if(f==='app.js')s=s.slice(0,s.indexOf('document.querySelectorAll(".tab")'));vm.runInContext(s,c);}return {c,elements};}
const cases={initial:'',staff:"state.dailyInput.staffing.before10='30'",manual0:"state.dailyInput.packingPlan.manualPeople.before10='0'",confirmed0:"state.dailyInput.packingPlan.lines.gemini.confirmed.batch6='0';state.dailyInput.packingPlan.lines.gemini.initialWip='0'",wip:"state.dailyInput.packingPlan.lines.gemini.initialWip='100'",actual:"state.actuals=[{time:'13:10',totalCompleted:8100},{time:'13:40',totalCompleted:9000}]",arrival:"state.dailyInput.currentTime='10:00';state.dailyInput.picks.total.batch13=''",missing:"state.dailyInput.bufferMinutes=''"};
function digest(c){return crypto.createHash('sha256').update(vm.runInContext(`JSON.stringify((()=>{const m=currentMetrics();return {state,plan:getPackingPlan(),supply:getSupplyView(),packing:calculatePlannedPackingRows(),staff:calculateCurrentStaffingSummary(),metrics:{comparison:m.comparison,plannedFinish:m.plannedFinish,finish:m.finish,diffCount:m.diffCount,delay:m.delay,trendState:m.trendState,required:m.actualRequiredDifference}}})())`,c)).digest('hex')}

const expected={
  "initial": "359b8feff054ee1d43ae52e30e35d61623cb01954a520d9f6900fc11f5b01220",
  "staff": "fb3ee62ead1c32dadc31116d3f9a3a0e99ed748e3e303f1729ced822d8b8811f",
  "manual0": "9a390cbe1d14a85a5d9822e856596b661637a6d917e503c5746b7050ab15b5ff",
  "confirmed0": "d3bb0a5787c9636061370e8446e30f4b2e8344dd85bd441e3b1669da3db07f01",
  "wip": "e33e5d089d25cc391048f900ed06439672004527667266defc68ea5682196560",
  "actual": "64a592a15a0f593aaa86ae90370eceb39d284334005e94323dabba5177ba317d",
  "arrival": "23aa3402ca18ce4debdfa259b8910b9c4287ec1b04d5810355a761d05f3f36d9",
  "missing": "c14f6d6c7c4b83a6b87b16306df8ef0be3a180d032372e417d45a416036a77e8"
}
;
test('display wording leaves baseline plans, metrics, line risks, staff and stored inputs identical',()=>{
 for(const [name,code]of Object.entries(cases)){
  const {c}=setup();vm.runInContext('state=initialPresetState();'+code,c);
  assert.equal(digest(c),expected[name],name+' matches PR17/main numeric and state snapshot');
 }
});
test('all tabs use business labels and settings preserve the existing paths and hidden value',()=>{
 const {c,elements}=setup();vm.runInContext("state=initialPresetState();state.settings.times.primaryGoal='12:50'",c);
 const before=vm.runInContext('JSON.stringify(state)',c);c.renderSettings();c.renderChart=()=>{};c.renderSummary();c.renderPackingDetail();c.renderPickTable();
 assert.equal(vm.runInContext('JSON.stringify(state)',c),before);
 const daily=elements['#daily-fields'].innerHTML,time=elements['#time-fields'].innerHTML,detail=elements['#plan-settings'].innerHTML;
 for(const word of ['計画の基準時刻','社外で梱包する件数','出荷締切前の作業完了余裕（分）','手梱包の配置可能人数','配置可能総人数の内数','ピッキング・梱包に使える総人数'])assert.ok(daily.includes(word),word);
 for(const path of ['currentTime','outsourced','bufferMinutes','manualPeople','staffing.before10','staffing.before13','staffing.after13'])assert.ok(daily.includes('data-path="dailyInput.'+path+'"'));
 assert.doesNotMatch(time,/primaryGoal|13時前主要作業目標/);assert.match(time,/settings.times.batch10/);assert.match(time,/参考設定/);assert.match(time,/作業ペースの比較時間/);
 for(const word of ['他業務に確保する人数','時間帯別の手梱包人数','開始時点のピック済み・未梱包件数','10時バッチの梱包対象確定数','13時バッチの手梱包ゆうパケット件数','未指定のため計算上0件と仮定','新たな注文として加算しません'])assert.ok(detail.includes(word),word);
 for(const word of ['ピック完了数（実績）','ピック計画との差','ピック速度（計画比）','ピッキング終了予定'])assert.ok(elements['#kpi-grid'].innerHTML.includes(word));
 assert.match(elements['#analysis-kpi-grid'].innerHTML,/現在の速度が続く場合の終了予測/);assert.match(elements['#plan-summary'].innerHTML,/出荷は間に合う見込みか/);
 assert.match(elements['#master-table-body'].innerHTML,/件／人・時/);assert.match(elements['#master-table-body'].innerHTML,/件／時/);
});
test('blank and explicit zero details remain distinct through render and legacy storage reload',()=>{
 const {c}=setup();vm.runInContext("state=initialPresetState();state.dailyInput.packingPlan.manualPeople.before10='0';state.dailyInput.packingPlan.lines.gemini.initialWip='0';state.dailyInput.packingPlan.lines.leo.confirmed.batch6='0';saveState();state=loadState();renderSettings()",c);
 const plan=JSON.parse(vm.runInContext('JSON.stringify(state.dailyInput.packingPlan)',c));
 assert.equal(plan.manualPeople.before10,'0');assert.equal(plan.manualPeople.before13,'');assert.equal(plan.lines.gemini.initialWip,'0');assert.equal(plan.lines.leo.initialWip,'');assert.equal(plan.lines.leo.confirmed.batch6,'0');assert.equal(plan.lines.gemini.confirmed.batch6,'');
 assert.equal(vm.runInContext('state.settings.times.primaryGoal',c),'13:00');
});
