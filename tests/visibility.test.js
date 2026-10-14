"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function context(){const c={console,Date,window:{devicePixelRatio:1},confirm:()=>true,localStorage:{getItem:()=>null,setItem:()=>{}},document:{querySelector:()=>({}),querySelectorAll:()=>[]}};vm.createContext(c);for(const f of ['planning.js','visibility.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);const s=fs.readFileSync('app.js','utf8');vm.runInContext(s.slice(0,s.indexOf('document.querySelectorAll(".tab")')),c);return c;}
const copy=x=>JSON.parse(JSON.stringify(x));
function riskFixture(){
 const ar=[0,20,40,60,80,80,130,150,160],as=[0,30,50,50,50,100,110,130,160],bs=[0,50,100,150,180,200,200,200,200];
 const jobs=[{lineId:'a',count:160,deadline:8,finishedAt:null},{lineId:'b',count:200,deadline:8,finishedAt:8}];
 const points=ar.map((_,i)=>({minute:i,count:as[i]+bs[i],suppliedByLine:{a:as[i],b:bs[i]},packedByLine:{a:Math.min(as[i],150),b:bs[i]},wipByLine:{a:Math.max(0,as[i]-150),b:0}}));
 const required=ar.map((n,i)=>({minute:i,count:n+(i===8?200:0),byLine:{a:n,b:i===8?200:0,outsourced:0}}));
 return {model:{errors:[],lines:[{id:'a',name:'A'},{id:'b',name:'B'}],jobs},required,operational:{points,jobs,lines:[]},displayed:points.map(({minute,count})=>({minute,count})),evaluation:{status:'unknown',scenarioStatus:'infeasible',reasons:['梱包能力不足']}};
}
test('current and future line deficits remain distinct even when total supply is sufficient',()=>{
 const c=context(),p=riskFixture(),before=copy(p),v=c.calculateSupplyView(p,1),a=v.lines[0];
 assert.equal(v.current.difference,60);assert.equal(a.current.difference,10);assert.equal(a.firstFuture,3);assert.equal(a.maximumShortage,30);assert.equal(a.supplyStatus,'必要供給不足');assert.equal(a.deadlineStatus,'期限未達見込み');assert.equal(a.riskStatus,'期限未達見込み');
 assert.equal(v.current.difference,a.current.difference+v.lines[1].current.difference);
 assert.equal(p.evaluation.scenarioStatus,'infeasible');assert.deepEqual(p,before);
 const now=c.calculateSupplyView(p,3).lines[0];assert.equal(now.ongoing,true);assert.equal(now.firstFuture,6,'existing deficit at 4 is not a new onset');
 const recovered=c.calculateSupplyView(p,5).lines[0];assert.equal(recovered.ongoing,false);assert.equal(recovered.firstFuture,6);assert.equal(recovered.pastFirst,3);assert.equal(recovered.maximumShortage,20,'past peak is not added');
});
test('no deficit produces no invented shortage timestamp and current-time changes read correct values',()=>{
 const c=context(),p=riskFixture();assert.equal(c.calculateSupplyView(p,1).lines[1].firstFuture,null);assert.equal(c.calculateSupplyView(p,1).lines[1].maximumShortage,0);
 assert.equal(c.calculateSupplyView(p,3).current.difference,140);assert.equal(c.calculateSupplyView(p,8).lines[0].supplyStatus,'供給条件充足');assert.equal(c.calculateSupplyView(p,8).lines[0].deadlineStatus,'期限未達見込み','supply condition alone cannot change completion');
 p.model.errors=['不足入力'];const unknown=c.calculateSupplyView(p,3);assert.equal(unknown.current,null);assert.equal(unknown.maximumShortage,null);
});
test('external supply and cumulative adjustments reconcile totals without forcing internal line equality',()=>{
 const c=context(),p=riskFixture();const i=3;p.operational.points[i].count+=40;p.displayed[i].count+=40;p.required[i].byLine.outsourced=10;p.required[i].count+=17;
 const v=c.calculateSupplyView(p,i);assert.equal(v.reconciliation.outsourcedPlanned,40);assert.equal(v.reconciliation.outsourcedRequired,10);assert.equal(v.reconciliation.requiredAdjustment,7);
 assert.equal(v.reconciliation.reconstructedDifference,v.current.difference);assert.equal(v.current.difference,v.reconciliation.internalDifference+30-7);
});
test('initial WIP and shared manual deadlines use the existing cumulative basis',()=>{
 const c=context(),input=copy(vm.runInContext('initialPresetState()',c));
 input.dailyInput.packingPlan.lines.gemini.initialWip='100';input.dailyInput.outsourced='100';
 const p=c.calculatePackingPlan(input),v=c.calculateSupplyView(p,570),gemini=v.lines.find(l=>l.id==='gemini');
 assert.equal(gemini.current.planned,100);assert.equal(gemini.current.required,100);assert.equal(gemini.current.difference,0);assert.equal(gemini.wip,100);
 assert.ok(Math.abs(v.current.difference-v.reconciliation.reconstructedDifference)<1e-6);
 const manual=p.operational.jobs.filter(j=>j.lineId==='manual');input.dailyInput.packingPlan.manualPacket.batch6='100';const q=c.calculatePackingPlan(input),w=c.calculateSupplyView(q,820).lines.find(l=>l.id==='manual');
 assert.ok(manual.length>0);assert.equal(w.deadlines.length,2);assert.equal(w.deadline,1080);
 for(const r of q.required){const s=q.operational.points.find(p=>p.minute===r.minute);if(r.minute===820)assert.equal(w.current.difference,s.suppliedByLine.manual-r.byLine.manual);}
});
test('required drawing retains values and represents arrival updates with a vertical segment',()=>{
 const c=context(),r=[{minute:599,count:50},{minute:600,count:100},{minute:601,count:110},{minute:779,count:200},{minute:780,count:300}],before=copy(r);
 const drawn=copy(c.requiredDrawPoints(r,[600,780]));assert.deepEqual(drawn,[{minute:599,count:50},{minute:600,count:50},{minute:600,count:100},{minute:601,count:110},{minute:779,count:200},{minute:780,count:200},{minute:780,count:300}]);assert.deepEqual(r,before);
});
test('reference delay follows reference arrival time, handles plateaus and cannot fabricate a zero',()=>{
 const c=context(),r=[{minute:0,count:0},{minute:10,count:100},{minute:20,count:100},{minute:30,count:200}];
 assert.equal(c.referenceDelay(r,30,100),10,'last point on plateau');assert.equal(c.referenceDelay(r,30,150),5);assert.equal(c.referenceDelay(r,30,250),0);
 assert.equal(c.referenceDelay([{minute:0,count:100},{minute:10,count:200}],10,50),null);assert.equal(c.referenceDelay(r,25,150),null);assert.equal(c.referenceDelay([{minute:0,count:100},{minute:10,count:null}],10,100),null);
 assert.equal(c.progressSpeed(r,20),600);assert.equal(c.progressSpeed(r,10),0);
});
test('baseline 9255 and observed 9000 stay -255 apart while the replanned blue anchor equals observation',()=>{
 const c=context();c.fake={initialPlan:{points:[{minute:810,count:8500},{minute:820,count:9255},{minute:830,count:10000}]},required:[{minute:820,count:9150}],displayed:[{minute:820,count:9000},{minute:821,count:9300}]};
 vm.runInContext("state=initialPresetState();state.actuals=[{time:'13:10',totalCompleted:8100},{time:'13:40',totalCompleted:9000}];getPackingPlan=()=>fake",c);
 const m=c.currentMetrics();assert.equal(m.diffCount,-255);assert.equal(m.actualRequiredDifference,-150);assert.equal(m.ideal[0].count,m.current.count);assert.equal(m.referenceSpeed,4470);assert.equal(m.replanSpeed,18000);assert.equal(m.idealSpeed,m.referenceSpeed);assert.equal(m.recentSpeed,1800);
 assert.ok(Math.abs(m.delay-(820-(810+500/755*10)))<1e-9);
 assert.notEqual(m.delay,255/18000*60,'not divided by replan speed');
});
function drawingContext(){
 const strokes=[],stack=[];const c={strokeStyle:'',lineWidth:1,dash:[],path:[],scale(){},clearRect(){},fillText(){},fillRect(){},measureText:t=>({width:t.length*6}),beginPath(){this.path=[]},moveTo(x,y){this.path.push([x,y])},lineTo(x,y){this.path.push([x,y])},setLineDash(a){this.dash=a.slice()},stroke(){strokes.push({color:this.strokeStyle,width:this.lineWidth,dash:this.dash.slice(),path:copy(this.path)})},save(){stack.push({color:this.strokeStyle,width:this.lineWidth,dash:this.dash.slice()})},restore(){const s=stack.pop();this.strokeStyle=s.color;this.lineWidth=s.width;this.dash=s.dash}};return {c,strokes};
}
test('three canvas series, dash style and batch markers are independent; hiding only changes drawing',()=>{
 const c=context(),draw=drawingContext(),element={clientWidth:900,getContext:()=>draw.c};c.document.querySelector=()=>element;
 const blue=[{minute:570,count:0},{minute:599,count:40},{minute:600,count:45},{minute:601,count:50}],required=[{minute:570,count:0},{minute:599,count:50},{minute:600,count:100},{minute:601,count:110}],actual=[{minute:570,count:0},{minute:600,count:42}];
 const before=copy({blue,required,actual});c.renderChart(blue,actual,{required,batchMinutes:[600,780],currentMinute:600});
 const series=draw.strokes.filter(s=>s.width===3);assert.deepEqual(series.map(s=>s.color),['#2878bd','#ae3546','#f47b20']);assert.deepEqual(copy(series[1].dash),[7,5]);assert.ok(series[1].path.some((p,i)=>i&&p[0]===series[1].path[i-1][0]&&p[1]!==series[1].path[i-1][1]));
 const markers=c.getChartMarkers({batchMinutes:[600,780]});assert.equal(markers.filter(m=>m.type==='batch').length,2);assert.ok(markers.every(m=>m.label.includes('必要条件更新')));
 draw.strokes.length=0;vm.runInContext('showRequiredSupply=false',c);c.renderChart(blue,actual,{required,batchMinutes:[600,780]});assert.deepEqual(draw.strokes.filter(s=>s.width===3).map(s=>s.color),['#2878bd','#f47b20']);assert.deepEqual({blue,required,actual},before);
});
test('PR14 planning outputs remain identical after deriving risk and KPI views',()=>{
 const c=context(),input=copy(vm.runInContext('initialPresetState()',c)),p=c.calculatePackingPlan(input),before=JSON.stringify(p);
 const v=c.calculateSupplyView(p,820);c.referenceDelay(p.initialPlan.points,820,9000);c.progressSpeed(p.initialPlan.points,820);c.requiredDrawPoints(p.required,[600,780]);
 assert.equal(JSON.stringify(p),before);assert.equal(p.operational.search.tested,42);assert.equal(p.evaluation.scenarioStatus,'feasible');
 assert.deepEqual(copy(p.operational.lines.map(l=>l.firstStart)),[660,615,920,785,710]);assert.deepEqual(copy(p.operational.lines.map(l=>l.finish)),[928,929,929,1080,930]);
 assert.ok(Math.abs(v.current.difference-(p.displayed.find(p=>p.minute===820).count-p.required.find(p=>p.minute===820).count))<1e-6);
});

test('a real adopted plan can have positive total supply and an individual deadline miss',()=>{
 const c=context(),input=copy(vm.runInContext('initialPresetState()',c));
 input.dailyInput.bufferMinutes='0';input.dailyInput.staffing={before10:'100',before13:'100',after13:'100'};
 for(const [key,row]of Object.entries(input.dailyInput.picks))for(const field of ['batch6','batch10','batch13'])row[field]=key==='total'&&field==='batch6'?'600':'0';
 input.settings.picking.total=60;input.settings.packing[0].capacity=6000;input.settings.times.packetDeadline='09:33';
 input.dailyInput.packingPlan.otherPeople={before10:'0',before13:'0',after13:'0'};
 for(const line of input.settings.packing){const p=input.dailyInput.packingPlan.lines[line.id];p.availableFrom='09:30';p.initialWip='0';p.confirmed={batch6:line.id==='gemini'?'100':line.id==='manual'?'500':'0',batch10:'0',batch13:'0'};}
 input.dailyInput.packingPlan.manualPacket={batch6:'0',batch10:'0',batch13:'0'};
 const p=c.calculatePackingPlan(input),before=JSON.stringify(p),v=c.calculateSupplyView(p,573);
 assert.ok(v.current.difference>0);assert.ok(v.lines.find(l=>l.id==='gemini').current.difference<0);assert.equal(v.lines.find(l=>l.id==='gemini').deadlineStatus,'期限未達見込み');assert.equal(p.evaluation.scenarioStatus,'infeasible');assert.equal(JSON.stringify(p),before);
});

test('expired prediction windows are identified instead of reporting an invented zero future shortage',()=>{
 const c=context(),p=riskFixture();p.required.push({minute:9,count:360,byLine:{a:160,b:200,outsourced:0}});p.operational.points.push({...p.operational.points.at(-1),minute:9});p.displayed.push({minute:9,count:360});
 const r=c.calculateSupplyView(p,9).lines[0];assert.equal(r.periodEnded,true);assert.equal(r.maximumShortage,null);assert.equal(r.firstFuture,null);assert.equal(r.deadlineStatus,'期限未達見込み');
});
test('correcting an observed total updates both baseline and required KPI gaps without changing the planner',()=>{
 const c=context();vm.runInContext("state=initialPresetState();state.actuals=[{time:'13:00',totalCompleted:8000}]",c);const a=c.currentMetrics();
 vm.runInContext("state.actuals[0].totalCompleted=9000",c);const b=c.currentMetrics();
 assert.equal(b.diffCount-a.diffCount,1000);assert.equal(b.actualRequiredDifference-a.actualRequiredDifference,1000);assert.equal(b.idealPoint.count,a.idealPoint.count);assert.equal(b.ideal.find(p=>p.minute===780).count,9000);assert.equal(b.evaluationMinute,780);assert.equal(b.dataAge,40);
});
