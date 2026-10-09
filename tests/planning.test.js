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

test("A: a fully specified plan supplies each line and completes within all deadlines", () => {
  const result = calculate(fixture());
  assert.equal(result.evaluation.status, "feasible");
  assert.equal(result.evaluation.reasons.length, 0);
  assert.ok(result.feasible.jobs.every(job => job.finishedAt <= job.deadline));
  for (const point of result.feasible.points) {
    assert.ok(point.packingPeople + point.pickingPeople + point.otherPeople <= point.totalPeople);
    for (const wip of Object.values(point.wipByLine)) assert.ok(wip >= -1e-7);
  }
  near(result.required.at(-1).count, 600, "final required picking");
});
test("required supply uses remaining line capacity, not a straight interpolation", () => {
  const input = fixture(600); routeOnly(input, "gemini");
  input.settings.packing[0].capacity = 600;
  input.settings.times.packetDeadline = "11:30";
  const result = calculate(input);
  near(result.required.find(p => p.minute === 600).count, 0, "no minimum at 10:00");
  near(result.required.find(p => p.minute === 630).count, 0, "minimum at 10:30");
  near(result.required.find(p => p.minute === 660).count, 300, "minimum at 11:00");
  near(result.required.find(p => p.minute === 690).count, 600, "deadline supply");
  const initial = fixture(600); routeOnly(initial, "gemini");
  initial.dailyInput.packingPlan.lines.gemini.initialWip = "100";
  near(calculate(initial).feasible.points[0].count, 100, "initial WIP already picked");
  near(calculate(initial).feasible.points.at(-1).count, 600, "initial WIP not double counted");
});
test("B: fixed packing capacity shortage fails even if picking completes", () => {
  const input = fixture(); input.settings.packing[0].capacity = 0;
  input.dailyInput.packingPlan.lines.gemini.initialWip = input.dailyInput.packingPlan.lines.gemini.confirmed.batch6;
  const result = calculate(input);
  assert.equal(result.evaluation.status, "infeasible");
  assert.ok(result.evaluation.reasons.some(r => r.startsWith("梱包能力不足")));
  assert.equal(result.evaluation.violations.length, 0, "meeting picking requirements does not establish packing readiness");
  near(result.feasible.points.at(-1).count, 600, "picking can finish independently");
});
test("C: starting packing reduces picking staff, completion releases them", () => {
  const input = fixture(); const result = calculate(input);
  const before = result.feasible.points[0];
  const running = result.feasible.points.find(p => p.packingPeople > 0);
  const after = result.feasible.points.at(-1);
  assert.equal(before.packingPeople, 0);
  assert.ok(running.pickingPeople < before.pickingPeople);
  assert.equal(after.packingPeople, 0);
  assert.equal(after.pickingPeople, 100);
  const concurrent = fixture(6000);
  concurrent.dailyInput.staffing = { before10: "30", before13: "30", after13: "30" };
  const withTransfers = calculate(concurrent);
  const delayed = copy(concurrent);
  Object.values(delayed.dailyInput.packingPlan.lines).forEach(line => { line.availableFrom = "17:00"; });
  const withoutEarlyTransfers = calculate(delayed);
  assert.ok(withTransfers.feasible.points.find(p => p.minute === 720).count < withoutEarlyTransfers.feasible.points.find(p => p.minute === 720).count,
    "early packing crew transfers reduce future achievable picking, not only the displayed staff count");
});
test("D: sufficient machine capacity cannot compensate for missing picking supply", () => {
  const input = fixture(); input.settings.picking.total = 1;
  input.settings.packing.forEach(line => { line.capacity = 10000; });
  input.settings.times.packetDeadline = "14:00"; input.settings.times.parcelDeadline = "14:00";
  const result = calculate(input);
  assert.equal(result.evaluation.status, "infeasible");
  assert.ok(result.evaluation.reasons.some(r => r.startsWith("仕掛供給不足")));
  assert.ok(result.evaluation.violations.length > 0);
});
test("aggregate supply meeting A does not hide an individual line's supply shortage", () => {
  const input = fixture(); routeOnly(input, "manual");
  input.dailyInput.packingPlan.lines.gemini.confirmed.batch6 = "100";
  input.dailyInput.packingPlan.lines.manual.confirmed.batch6 = "500";
  input.settings.picking.total = 60;
  input.settings.packing[0].capacity = 6000;
  input.settings.times.packetDeadline = "09:33";
  const result = calculate(input);
  assert.equal(result.evaluation.violations.length, 0);
  assert.equal(result.evaluation.status, "infeasible");
  assert.ok(result.evaluation.reasons.some(reason => reason.startsWith("仕掛供給不足")));
  assert.ok(result.feasible.jobs.find(job => job.lineId === "gemini").packed < 100);
});
test("machine crews are never partially staffed; supply can wait for a later staffing period", () => {
  const input = fixture(); routeOnly(input, "leo");
  input.dailyInput.staffing = { before10: "5", before13: "100", after13: "100" };
  const result = calculate(input);
  assert.ok(result.feasible.points.filter(p => p.minute < 600).every(p => !p.activeLines.includes("leo")));
  assert.ok(result.feasible.points.some(p => p.minute >= 600 && p.activeLines.includes("leo")));
  assert.equal(result.evaluation.status, "feasible", "startup delay alone is not deadline failure");
  input.dailyInput.staffing = { before10: "5", before13: "5", after13: "5" };
  const blocked = calculate(input);
  assert.equal(blocked.evaluation.status, "infeasible");
  assert.ok(blocked.evaluation.reasons.some(r => r.startsWith("人員不足")));
  assert.ok(blocked.feasible.points.every(p => !p.activeLines.includes("leo")));
});
test("E: a large 13:00 batch invalidates the plan without rewriting either historical curve", () => {
  const input = fixture(); input.dailyInput.currentTime = "12:50";
  const before = calculate(input);
  const actual = [{ time: "12:40", totalCompleted: 400 }]; input.actuals = copy(actual);
  input.dailyInput.currentTime = "13:00";
  input.dailyInput.picks.total.batch13 = "20000";
  input.dailyInput.packingPlan.lines.leo.confirmed.batch13 = "20000";
  const after = calculate(input);
  assert.equal(after.evaluation.status, "infeasible");
  assert.deepEqual(after.required.filter(p => p.minute < 780), before.required.filter(p => p.minute < 780));
  assert.deepEqual(after.feasible.points.filter(p => p.minute < 780), before.feasible.points.filter(p => p.minute < 780));
  assert.deepEqual(input.actuals, actual);
  assert.ok(after.required.find(p => p.minute === 780).count > before.required.find(p => p.minute === 780).count);
});
test("F: manual packing runs concurrently and obeys its changing staffing and shared deadlines", () => {
  const input = fixture(600); routeOnly(input, "manual"); input.settings.picking.total = 50;
  input.dailyInput.staffing = { before10: "40", before13: "40", after13: "40" };
  input.dailyInput.packingPlan.manualPeople = { before10: "8", before13: "4", after13: "10" };
  const result = calculate(input);
  assert.ok(result.feasible.points.some(p => p.activeLines.includes("manual") && p.count < 600));
  const model = context.calculatePackingDemand(input), line = model.lines.find(l => l.id === "manual");
  assert.equal(context.calculatePackingCapacity(line, 599, model, input), 8 * 29);
  assert.equal(context.calculatePackingCapacity(line, 600, model, input), 4 * 29);
  assert.equal(context.calculatePackingCapacity(line, 780, model, input), 10 * 29);
  const shared = fixture(200); routeOnly(shared, "manual");
  shared.dailyInput.manualPeople = "2";
  shared.dailyInput.packingPlan.manualPacket.batch6 = "100";
  shared.settings.times.packetDeadline = "10:30"; shared.settings.times.parcelDeadline = "11:30";
  const insufficient = calculate(shared);
  near(insufficient.required.find(p => p.minute === 570).byLine.manual, 84, "shared manual requirement, max of deadline envelopes");
  assert.equal(insufficient.evaluation.status, "infeasible");
  assert.ok(insufficient.evaluation.reasons.some(r => r.startsWith("梱包能力不足")));
  assert.equal(insufficient.model.jobs.filter(j => j.lineId === "manual").length, 2);
  shared.dailyInput.manualPeople = "31";
  assert.equal(calculate(shared).evaluation.status, "unknown");
});
test("G: confirmed destinations are preserved; only residual demand is apportioned, with no rounding loss", () => {
  const input = fixture(); const plan = input.dailyInput.packingPlan;
  for (const line of input.settings.packing) plan.lines[line.id].confirmed.batch6 = "";
  plan.lines.gemini.confirmed.batch6 = "100";
  const result = calculate(input);
  assert.equal(result.evaluation.status, "unknown");
  assert.ok(result.evaluation.assumptions.some(r => r.includes("梱包先未確定")));
  near(result.model.jobs.filter(j => j.lineId === "gemini").reduce((n, j) => n + j.count, 0), 100, "confirmed destination");
  near(result.model.jobs.reduce((n, j) => n + j.count, 0), 600, "all demand counted once");
  for (const total of [0, 1, 2, 17, 999, 11400]) near(context.planApportion(total, [36.4, 41.5, .7, 14.1, 7.4]).reduce((n, x) => n + x, 0), total, "apportioned total");
  plan.lines.leo.confirmed.batch6 = "600";
  assert.equal(calculate(input).evaluation.status, "unknown");
  assert.ok(calculate(input).evaluation.reasons.some(r => r.includes("二重計上")));
});
test("zero-demand lines do not require capacity or crew inputs; missing differs from impossible", () => {
  const input = fixture(); routeOnly(input, "gemini");
  input.settings.packing.find(l => l.id === "manual").capacity = "";
  input.dailyInput.manualPeople = "";
  assert.equal(calculate(input).evaluation.status, "feasible");
  input.settings.packing[0].capacity = "";
  assert.equal(calculate(input).evaluation.status, "unknown");
  input.settings.packing[0].capacity = 0;
  assert.equal(calculate(input).evaluation.status, "infeasible");
  input.settings.packing[0].capacity = 928; input.settings.picking.total = 0;
  assert.equal(calculate(input).evaluation.status, "unknown");
  const empty = fixture(0); empty.dailyInput.staffing = { before10: "", before13: "", after13: "" };
  assert.equal(calculate(empty).evaluation.status, "feasible");
});
test("a line available after its completion deadline is an impossible plan, not missing data", () => {
  const input = fixture(); input.dailyInput.packingPlan.lines.gemini.availableFrom = "17:00";
  const result = calculate(input);
  assert.equal(result.evaluation.status, "infeasible");
  assert.ok(result.evaluation.reasons.some(r => r.startsWith("梱包能力不足")));
});
test("completed plans retain cumulative progress and release crews after the last deadline", () => {
  const input = fixture(); input.dailyInput.currentTime = "19:00";
  const result = calculate(input);
  assert.equal(result.evaluation.status, "feasible");
  near(result.required.at(-1).count, 600, "completed cumulative requirement");
  assert.equal(result.feasible.points.at(-1).minute, 1140);
  assert.equal(result.feasible.points.at(-1).packingPeople, 0);
  assert.equal(result.feasible.points.at(-1).pickingPeople, 100);
});
test("late edits freeze already displayed requirements and preserve history across reload", () => {
  context.inputForTest = fixture();
  vm.runInContext("state = inputForTest; renderAll = () => {};", context);
  const before = copy(vm.runInContext("calculateIdealProgress()", context));
  vm.runInContext('updateStatePath("settings.packing.0.capacity", "500");', context);
  const after = copy(vm.runInContext("calculateIdealProgress()", context));
  assert.deepEqual(after.filter(p => p.minute < 820).map(p => [p.minute, p.count]), before.filter(p => p.minute < 820).map(p => [p.minute, p.count]));
  const reloaded = copy(vm.runInContext("mergeState(JSON.parse(JSON.stringify(state)))", context));
  assert.deepEqual(calculate(reloaded).displayed.filter(p => p.minute < 820).map(p => [p.minute, p.count]), after.filter(p => p.minute < 820).map(p => [p.minute, p.count]));
  vm.runInContext("resetDailyData()", context);
  assert.equal(vm.runInContext("state.dailyInput.packingPlan.history.points.length", context), 0);
});
test("H: the recent-speed finish estimate remains available even when packing inputs are missing", () => {
  context.inputForTest = fixture();
  context.inputForTest.actuals = [{ time: "13:10", totalCompleted: 300 }, { time: "13:40", totalCompleted: 400 }];
  context.inputForTest.dailyInput.bufferMinutes = "";
  const metrics = copy(vm.runInContext("state = inputForTest; currentMetrics()", context));
  assert.equal(metrics.recentSpeed, 200);
  assert.equal(metrics.finish, 880);
  assert.equal(metrics.status, "未判定");
  assert.equal(metrics.current.count, 400);
});
test("an attainable model does not display green plan readiness when actual picking misses required supply", () => {
  const input = fixture(); input.dailyInput.currentTime = "17:00";
  input.actuals = [{ time: "16:30", totalCompleted: 300 }, { time: "17:00", totalCompleted: 400 }];
  context.inputForTest = input;
  const original = context.document.querySelector;
  const box = {};
  context.document.querySelector = selector => selector === "#plan-summary" ? box : original(selector);
  vm.runInContext("state = inputForTest; renderPlanSummary()", context);
  assert.match(box.className, /bad/);
  assert.match(box.innerHTML, /計画不成立：ピッキング実績/);
  context.document.querySelector = original;
});

test("packing finish displays distinguish completion, deadline failure, missing inputs and no demand", () => {
  const original = context.document.querySelector;
  const render = input => {
    const elements = {};
    context.inputForTest = input;
    context.document.querySelector = selector => elements[selector] ||= {};
    vm.runInContext("state = inputForTest; renderPlanSummary(); renderPackingDetail()", context);
    return elements;
  };
  try {
    const complete = fixture();
    const before = calculate(complete);
    complete.actuals = [{ time: "13:10", totalCompleted: 10 }, { time: "13:40", totalCompleted: 20 }];
    assert.deepEqual(calculate(complete).feasible, before.feasible, "actual picking must not change the planned simulation");
    const success = render(complete);
    assert.match(success['#plan-summary'].innerHTML, /計画上の梱包完了見込み：\d{2}:\d{2}/);
    assert.match(success['#plan-summary'].innerHTML, /計画開始時点/);
    assert.match(success['#plan-summary'].innerHTML, /実績を反映した再予測ではありません/);
    assert.match(success['#packing-notice'].textContent, /実績を反映した再予測ではありません/);
    const failed = fixture(); failed.settings.packing[0].capacity = 0;
    const failure = render(failed);
    assert.match(failure['#plan-summary'].innerHTML, /計画上の梱包完了見込み：期限内未達/);
    assert.match(failure['#packing-detail-body'].innerHTML, /<td>期限内未達<\/td>/);
    const missing = fixture(); missing.dailyInput.bufferMinutes = "";
    const unknown = render(missing);
    assert.match(unknown['#plan-summary'].innerHTML, /計画上の梱包完了見込み：算出不可/);
    assert.match(unknown['#packing-detail-body'].innerHTML, /<td>算出不可<\/td>/);
    assert.doesNotMatch(unknown['#packing-detail-body'].innerHTML, /期限内未達/);
    const empty = render(fixture(0));
    assert.match(empty['#plan-summary'].innerHTML, /計画上の梱包完了見込み：対象なし/);
    for (const result of [success, failure, unknown, empty]) {
      assert.doesNotMatch(result['#plan-summary'].innerHTML + result['#packing-detail-body'].innerHTML, /未達／算出不可/);
    }
  } finally { context.document.querySelector = original; }
});
