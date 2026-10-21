"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { console, Date, confirm: () => true, window: {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { querySelector: () => ({ textContent: "" }), querySelectorAll: () => [] } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("planning.js", "utf8"), context);
vm.runInContext(fs.readFileSync("visibility.js", "utf8"), context);
const source = fs.readFileSync("app.js", "utf8");
vm.runInContext(source.slice(0, source.indexOf('document.querySelectorAll(".tab")')), context);
const copy = value => JSON.parse(JSON.stringify(value));
const calculate = input => copy(context.calculatePackingPlan(input));
function fixture(total = 600) {
  const input = copy(vm.runInContext("initialPresetState()", context));
  input.dailyInput.currentTime = "13:40";
  for (const [key, picks] of Object.entries(input.dailyInput.picks)) for (const field of Object.keys(picks)) picks[field] = key === "total" && field === "batch6" ? String(total) : "0";
  input.dailyInput.staffing = { before10: "100", before13: "100", after13: "100" };
  input.dailyInput.bufferMinutes = "0";
  const plan = input.dailyInput.packingPlan;
  plan.otherPeople = { before10: "0", before13: "0", after13: "0" };
  const counts = context.planApportion(total, input.settings.packing.map(line => line.share));
  input.settings.packing.forEach((line, index) => {
    plan.lines[line.id].availableFrom = "09:30";
    plan.lines[line.id].initialWip = "0";
    plan.lines[line.id].confirmed = { batch6: String(counts[index]), batch10: "0", batch13: "0" };
  });
  plan.manualPacket = { batch6: "0", batch10: "0", batch13: "0" };
  return input;
}
function routeOnly(input, id) {
  for (const line of input.settings.packing) for (const field of ["batch6", "batch10", "batch13"]) {
    input.dailyInput.packingPlan.lines[line.id].confirmed[field] = line.id === id ? String(Object.values(input.dailyInput.picks).reduce((n, row) => n + Number(row[field]), 0)) : "0";
  }
}
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);

function model(input) { return context.calculatePackingDemand(input); }
function point(plan, minute) { return plan.operational.points.find(p => p.minute === minute); }
function checkConstraints(plan) {
  const ps = plan.operational.points;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    assert.ok(p.pickingPeople + p.packingPeople + p.otherPeople <= p.totalPeople || p.otherPeople > p.totalPeople);
    assert.ok(Object.values(p.wipByLine).every(n => n >= -1e-6));
    for (const [id, supplied] of Object.entries(p.suppliedByLine)) assert.ok(p.packedByLine[id] <= supplied + 1e-6);
    const arrived = plan.model.batches.filter(b => b.release <= p.minute).reduce((n, b) => n + b.total, 0);
    assert.ok(p.count <= arrived + 1e-6);
    for (const line of plan.model.lines.filter(l => l.id !== "manual")) assert.ok(!p.linePeople[line.id] || p.linePeople[line.id] === line.people);
    if (p.linePeople.manual) assert.ok(p.linePeople.manual <= context.calculateStaffingCapacity(p.minute, plan.model, context.inputForConstraints).manual);
    if (i && p.minute > (plan.observation.last?.minute ?? 0)) {
      const previous = ps[i-1], maxRate = Math.max(0, ...plan.model.batches.filter(b => b.release <= previous.minute).map(b => b.average));
      assert.ok(p.count >= previous.count - 1e-6);
      assert.ok(p.count - previous.count <= previous.pickingPeople * maxRate / 60 + 1e-6);
      for (const line of plan.model.lines) {
        const packed = p.packedByLine[line.id] - previous.packedByLine[line.id];
        const capacity = line.id === "manual" ? line.capacity * (previous.linePeople.manual || 0) : previous.linePeople[line.id] ? line.capacity : 0;
        assert.ok(packed <= capacity / 60 + 1e-6);
      }
    }
  }
}
function checked(input) { context.inputForConstraints = input; const p = calculate(input); checkConstraints(p); return p; }
test("deadline candidate search obtains a feasible conserved plan with fixed machine crews", () => {
  const p = checked(fixture());
  assert.equal(p.evaluation.scenarioStatus, "feasible");
  assert.equal(p.evaluation.status, "unknown", "zero move/restart times are an explicit assumption");
  assert.ok(p.operational.jobs.every(j => j.finishedAt <= j.deadline));
  assert.ok(p.operational.search.tested <= 160);
});
test("reverse supply envelopes remain unchanged and initial WIP is not extra demand", () => {
  const input = fixture(); routeOnly(input,"gemini"); input.settings.packing[0].capacity = 600; input.settings.times.packetDeadline="11:30";
  const p = calculate(input);
  near(p.required.find(p=>p.minute===630).count,0,"10:30 envelope");
  near(p.required.find(p=>p.minute===660).count,300,"11:00 envelope");
  near(p.required.find(p=>p.minute===690).count,600,"deadline envelope");
  input.dailyInput.packingPlan.lines.gemini.initialWip="100";
  const seeded=calculate(input);near(point(seeded,570).count,100,"seeded WIP");near(seeded.displayed.at(-1).count,600,"no duplicate demand");
});
test("physical equipment deficit is distinguished from a search that found no staffing solution",()=>{
  const physical=fixture();physical.settings.packing[0].capacity=0;
  const p=calculate(physical);assert.equal(p.evaluation.failureKind,"physical");assert.equal(p.evaluation.scenarioStatus,"infeasible");
  const staffing=fixture();routeOnly(staffing,"leo");staffing.dailyInput.staffing={before10:"5",before13:"5",after13:"5"};
  const s=checked(staffing);assert.equal(s.evaluation.failureKind,"search-exhausted");assert.ok(s.evaluation.reasons.some(r=>r.startsWith("人員不足")));
  assert.match(context.getPlanPresentation(s.evaluation).description,/発見できません/);
});
test("aggregate supply cannot establish individual line readiness",()=>{
 const input=fixture();routeOnly(input,"manual");input.dailyInput.packingPlan.lines.gemini.confirmed.batch6="100";input.dailyInput.packingPlan.lines.manual.confirmed.batch6="500";
 input.settings.picking.total=60;input.settings.packing[0].capacity=6000;input.settings.times.packetDeadline="09:33";
 const p=checked(input);assert.equal(p.evaluation.scenarioStatus,"infeasible");assert.ok(p.operational.jobs.find(j=>j.lineId==="gemini").packed<100);
});
test("preset no longer starts all packing lines on first small supply",()=>{
 const input=copy(vm.runInContext("initialPresetState()",context)), p=checked(input);
 for (const t of [570,580,600]) {assert.equal(point(p,t).packingPeople,0);assert.equal(point(p,t).pickingPeople,40);}
 assert.equal(p.evaluation.scenarioStatus,"feasible");
 assert.ok(p.operational.lines.filter(l=>l.firstStart!==null).every(l=>l.firstStart>600));
 assert.ok(p.operational.lines.reduce((n,l)=>n+l.starvedMinutes,0)===0);
});
test("larger packing demand brings the chosen start forward",()=>{
 const small=fixture(600),large=fixture(1800);routeOnly(small,"gemini");routeOnly(large,"gemini");
 const a=checked(small),b=checked(large);
 assert.ok(b.operational.lines[0].firstStart<a.operational.lines[0].firstStart);
});
test("a five-person transfer reduces picking capacity and completion releases the crew",()=>{
 const input=fixture(8000);routeOnly(input,"gemini");input.settings.picking.total=100;input.settings.packing[0].capacity=10000;
 input.dailyInput.staffing={before10:"20",before13:"20",after13:"20"};
 const m=model(input), simulation=copy(context.calculateFeasiblePickingProgress(m,input,{starts:{gemini:600}}));
 assert.equal(simulation.points.find(p=>p.minute===600).packingPeople,5);assert.equal(simulation.points.find(p=>p.minute===600).pickingPeople,15);
 const finish=simulation.lines[0].finish;assert.ok(finish!==null);
 assert.equal(simulation.points.find(p=>p.minute===finish).packingPeople,0);
});
test("manual packing shares deadlines, respects time-dependent maxima, and can use fewer than all staff",()=>{
 const input=fixture(200);routeOnly(input,"manual");input.dailyInput.manualPeople="8";input.dailyInput.packingPlan.manualPacket.batch6="100";
 input.settings.times.packetDeadline="14:00";input.settings.times.parcelDeadline="17:00";
 const p=checked(input);assert.equal(p.model.jobs.filter(j=>j.lineId==="manual").length,2);assert.equal(p.evaluation.scenarioStatus,"feasible");
 assert.ok(p.operational.points.some(p=>p.linePeople.manual>0&&p.linePeople.manual<8));
 input.dailyInput.packingPlan.manualPeople.before13="2";
 const q=checked(input);assert.ok(q.operational.points.filter(p=>p.minute>=600&&p.minute<780).every(p=>(p.linePeople.manual||0)<=2));
 assert.equal(input.dailyInput.manualPeople,"8");
});
test("manual capacity cannot be duplicated across shipping deadlines",()=>{
 const input=fixture(200);routeOnly(input,"manual");input.dailyInput.manualPeople="2";input.dailyInput.packingPlan.manualPacket.batch6="100";
 input.settings.times.packetDeadline="10:30";input.settings.times.parcelDeadline="11:30";
 const p=checked(input);near(p.required[0].byLine.manual,84,"shared deadline maximum");assert.equal(p.evaluation.failureKind,"physical");
});
test("partial confirmed allocation preserves counts and explicit zero destinations",()=>{
 const input=fixture();input.dailyInput.packingPlan=context.defaultPackingPlan();input.dailyInput.packingPlan.lines.gemini.confirmed.batch6="100";input.dailyInput.packingPlan.lines.leo.confirmed.batch6="0";
 const p=calculate(input);assert.equal(p.model.jobs.filter(j=>j.lineId==="gemini").reduce((n,j)=>n+j.count,0),100);assert.ok(!p.model.jobs.some(j=>j.lineId==="leo"));
 near(p.model.jobs.reduce((n,j)=>n+j.count,0),600,"allocation conservation");
});
test("missing inputs are unavailable, explicit zero capacity is a physical failure, zero demand is valid",()=>{
 const missing=fixture();missing.settings.packing[0].capacity="";assert.equal(calculate(missing).evaluation.failureKind,"unavailable");
 const zero=fixture();zero.settings.packing[0].capacity=0;assert.equal(calculate(zero).evaluation.failureKind,"physical");
 assert.equal(calculate(fixture(0)).evaluation.scenarioStatus,"feasible");
 const cleared=copy(vm.runInContext("defaultState()",context));assert.equal(calculate(cleared).evaluation.scenarioStatus,"unknown");
});
test("an equipment start after deadline cannot be presented as a found solution",()=>{
 const input=fixture();input.dailyInput.packingPlan.lines.gemini.availableFrom="17:00";
 assert.equal(calculate(input).evaluation.failureKind,"physical");
});
test("input corrections recalculate the whole plan and restore the original result",()=>{
 context.inputForTest=fixture();vm.runInContext("state=inputForTest;renderAll=()=>{}",context);
 const before=copy(vm.runInContext("getPackingPlan()",context));
 vm.runInContext('updateStatePath("dailyInput.staffing.before10","20")',context);
 const changed=copy(vm.runInContext("getPackingPlan()",context));assert.notDeepEqual(changed,before);
 assert.equal(vm.runInContext("state.dailyInput.packingPlan.history.points.length",context),0);
 vm.runInContext('updateStatePath("dailyInput.staffing.before10","100")',context);assert.deepEqual(copy(vm.runInContext("getPackingPlan()",context)),before);
});
test("legacy history is preserved on read/save but cannot constrain current calculations",()=>{
 const input=fixture(), before=calculate(input);input.dailyInput.packingPlan.history={through:1000,points:[{minute:570,count:999999,hours:0}]};
 const after=calculate(input);assert.deepEqual(after.displayed,before.displayed);assert.deepEqual(after.evaluation,before.evaluation);
 const reloaded=copy(context.mergeState(copy(input)));assert.equal(reloaded.dailyInput.packingPlan.history.points[0].count,999999);assert.deepEqual(calculate(reloaded).displayed,before.displayed);
});
test("current-time changes select arrived batches with no history freezing",()=>{
 const input=fixture();input.dailyInput.picks.total.batch10="200";input.dailyInput.picks.total.batch13="300";
 for(const field of ["batch10","batch13"])for(const line of input.settings.packing)input.dailyInput.packingPlan.lines[line.id].confirmed[field]="";
 for(const [time,total]of[["10:00",800],["12:00",800],["13:40",1100],["15:00",1100]]){input.dailyInput.currentTime=time;const p=checked(input);assert.equal(p.model.batches.reduce((n,b)=>n+b.total,0),total);assert.ok(point(p,context.planTime(time)));}
});
test("arrival has no instantaneous new-batch supply or artificial idle minute",()=>{
 const input=fixture(200000);input.dailyInput.picks.total.batch10="200000";input.dailyInput.picks.total.batch13="200000";routeOnly(input,"gemini");
 const p=checked(input);
 for(const [t,field]of[[600,"batch10"],[780,"batch13"]]){
  assert.ok(point(p,t).count>point(p,t-1).count);
  const m=model(input), starts=p.operational.policy.starts;
  const without=copy(input);without.dailyInput.picks.total[field]="0";routeOnly(without,"gemini");
  const other=context.calculateFeasiblePickingProgress(model(without),without,{starts,manualExtra:p.operational.policy.manualExtra});
  near(point(p,t).count,other.points.find(p=>p.minute===t).count,"same policy and zero event contribution");
 }
 assert.equal(p.evaluation.scenarioStatus,"infeasible");assert.ok(p.shortages.some(p=>p.minute===780));
});
test("a tight deadline remains feasible without artificial boundary stops",()=>{
 const input=fixture(32);routeOnly(input,"gemini");input.settings.picking.total=60;input.settings.packing[0].capacity=100000;input.settings.packing[0].people=1;input.settings.times.packetDeadline="10:01";
 input.dailyInput.staffing={before10:"2",before13:"2",after13:"2"};assert.equal(checked(input).evaluation.scenarioStatus,"feasible");
});
test("observations seed the future exactly and corrections change remaining work",()=>{
 const input=fixture(1000);routeOnly(input,"gemini");input.actuals=[{time:"13:00",totalCompleted:200}];
 const low=checked(input);near(point(low,780).count,200,"observed anchor");assert.equal(low.observation.age,40);assert.equal(low.evaluation.status,"unknown");
 input.actuals[0].totalCompleted=800;const high=checked(input);near(point(high,780).count,800,"corrected observed anchor");
 assert.notDeepEqual(high.operational.points.filter(p=>p.minute>780),low.operational.points.filter(p=>p.minute>780));
 assert.ok(high.model.assumptions.some(a=>a.includes("実梱包実績未取得")));
 assert.deepEqual(calculate(copy(input)),high);
});
test("observed-prefix estimate is identical across future candidates",()=>{
 const input=fixture(1000);input.actuals=[{time:"13:00",totalCompleted:700}];const m=model(input);
 const a=context.calculateFeasiblePickingProgress(m,input,{observations:[{minute:780,count:700}],pastStarts:{gemini:750,leo:750,manual:750},pastManualExtra:0,starts:{gemini:800},manualExtra:0});
 const b=context.calculateFeasiblePickingProgress(m,input,{observations:[{minute:780,count:700}],pastStarts:{gemini:750,leo:750,manual:750},pastManualExtra:0,starts:{gemini:900},manualExtra:2});
 assert.deepEqual(copy(a.points.filter(p=>p.minute<780)),copy(b.points.filter(p=>p.minute<780)));
 near(a.points.find(p=>p.minute===780).count,700,"shared state count");
});
test("inconsistent observations are unavailable instead of fabricated packing facts",()=>{
 for(const rows of [[{time:"13:00",totalCompleted:601}],[{time:"13:00",totalCompleted:300},{time:"13:10",totalCompleted:200}],[{time:"13:05",totalCompleted:200}]]){
  const input=fixture();input.actuals=rows;assert.equal(calculate(input).evaluation.failureKind,"unavailable");
 }
});
test("future observations are not used before their time and auto-time flag changes no engine result",()=>{
 const input=fixture();input.actuals=[{time:"15:00",totalCompleted:600}];const a=calculate(input);assert.equal(a.observation.last,null);
 input.dailyInput.autoCurrentTime=true;assert.deepEqual(calculate(input),a);
});
test("actual changes invalidate the application plan cache",()=>{
 context.inputForTest=fixture();vm.runInContext("state=inputForTest;state.actuals=[{time:'13:00',totalCompleted:100}]",context);
 const a=copy(vm.runInContext("getPackingPlan()",context));vm.runInContext("state.actuals[0].totalCompleted=400",context);
 const b=copy(vm.runInContext("getPackingPlan()",context));assert.notDeepEqual(a.displayed,b.displayed);near(point(b,780).count,400,"cache corrected");
});
test("summary shows estimated replan, stale observation, bounded search and moves from the chosen schedule",()=>{
 const original=context.document.querySelector,elements={};context.document.querySelector=s=>elements[s]||={};
 try{context.inputForTest=fixture(1000);context.inputForTest.actuals=[{time:"13:00",totalCompleted:100}];vm.runInContext("state=inputForTest;renderPlanSummary();renderStaffingSummary();renderPackingDetail()",context);
 assert.match(elements['#plan-summary'].innerHTML,/実績反映の概算再計画/);assert.match(elements['#plan-summary'].innerHTML,/現在との差 40分/);assert.match(elements['#plan-summary'].innerHTML,/推定です/);
 assert.match(elements['#staffing-summary'].innerHTML,/梱包への計画配置人数/);
 const summary=context.calculateCurrentStaffingSummary();if(summary.nextMovement){const ps=context.getPackingPlan().operational.points;const t=summary.nextMovement.minute;assert.ok(ps.find(p=>p.minute===t).packingPeople>=0);}
 assert.match(elements['#packing-notice'].textContent,/梱包済・仕掛・残梱包は推定/);
 }finally{context.document.querySelector=original;}
});
test("finish rendering differentiates unavailable, deadline miss, estimated success and no demand",()=>{
 const original=context.document.querySelector,elements={};context.document.querySelector=s=>elements[s]||={};
 try{for(const [input,expected]of[[fixture(),/梱包終了予定：\d{2}:\d{2}/],[fixture(0),/梱包終了予定：対象なし/]]){context.inputForTest=input;vm.runInContext("state=inputForTest;renderPlanSummary()",context);assert.match(elements['#plan-summary'].innerHTML,expected);}
 const input=fixture();input.dailyInput.bufferMinutes="";context.inputForTest=input;vm.runInContext("state=inputForTest;renderPlanSummary()",context);assert.match(elements['#plan-summary'].innerHTML,/算出不可/);
 }finally{context.document.querySelector=original;}
});

test("outsourced picking remains in total supply and is not duplicated as internal packing",()=>{
 const input=fixture();input.dailyInput.outsourced="100";for(const line of Object.values(input.dailyInput.packingPlan.lines))line.confirmed.batch6="";
 const p=checked(input);near(p.model.jobs.filter(j=>j.external).reduce((n,j)=>n+j.count,0),100,"external demand");near(p.model.jobs.filter(j=>!j.external).reduce((n,j)=>n+j.count,0),500,"internal demand");near(p.displayed.at(-1).count,600,"total supply");
 assert.ok(p.model.assumptions.some(a=>a.includes("委託先の完了は対象外")));
});
test("the presentation still separates confirmation, scenario result and unavailable inputs",()=>{
 for(const [scenario,status,assumptions,title]of[["feasible","feasible",[],"計画成立（モデル上）"],["infeasible","infeasible",[],"計画不成立"],["feasible","unknown",["推定"],"概算：期限内完了可能"],["infeasible","unknown",["推定"],"概算：期限内完了困難"],["unknown","unknown",[],"算出不可"]]){
  const p=context.getPlanPresentation({scenarioStatus:scenario,status,assumptions});assert.equal(p.title,title);
 }
});
