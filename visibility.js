"use strict";

// Read-only view data. These helpers never alter the planner, its inputs, or
// evaluation. Counts share the engine's cumulative, initial-WIP-inclusive basis.
function progressSpeed(points, minute) {
  const index = points.findIndex(p => p.minute === minute);
  if (index < 0) return null;
  const left = points[index + 1] ? points[index] : points[index - 1];
  const right = points[index + 1] || points[index];
  return left && right.minute > left.minute && Number.isFinite(left.count) && Number.isFinite(right.count)
    ? Math.max(0, (right.count - left.count) * 60 / (right.minute - left.minute)) : null;
}
function referenceDelay(points, minute, actualCount) {
  if (!Number.isFinite(minute) || !Number.isFinite(actualCount) || actualCount < 0 || !points.length) return null;
  if (points.some((p, i) => !Number.isFinite(p.count) || !Number.isFinite(p.minute) || p.count < 0 || i && (p.minute <= points[i - 1].minute || p.count < points[i - 1].count))) return null;
  const current = points.find(p => p.minute === minute);
  if (!current) return null;
  if (actualCount >= current.count) return 0;
  // On a plateau use its last time, rather than treating planned idle time
  // as additional delay. Interpolate only on a positive reference slope.
  let left = null;
  for (const right of points.filter(p => p.minute <= minute)) {
    if (right.count <= actualCount) { left = right; continue; }
    if (!left) return null;
    const reached = left.minute + (actualCount - left.count) / (right.count - left.count) * (right.minute - left.minute);
    return Math.max(0, minute - reached);
  }
  return null;
}
function requiredDrawPoints(points, batchMinutes) {
  const arrivals = new Set(batchMinutes);
  const result = [];
  points.forEach((p, i) => {
    const previous = points[i - 1];
    if (previous && arrivals.has(p.minute) && p.count > previous.count) result.push({ minute: p.minute, count: previous.count });
    result.push({ minute: p.minute, count: p.count });
  });
  return result;
}
const SUPPLY_STATUS = Object.freeze({ sufficient: "供給条件充足", shortage: "必要供給不足", "period-ended": "評価期間終了", unavailable: "算出不可" });
function supplyWindow(series, minute, deadline) {
  const current = series.find(p => p.minute === minute) || null;
  const window = series.filter(p => p.minute >= minute && p.minute <= deadline);
  const past = series.filter(p => p.minute < minute && p.minute <= deadline && p.difference < -PLAN_EPSILON);
  let previousNegative = !!current && current.difference < -PLAN_EPSILON;
  let firstFuture = null;
  for (const p of window.filter(p => p.minute > minute)) {
    const negative = p.difference < -PLAN_EPSILON;
    if (negative && !previousNegative && firstFuture === null) firstFuture = p.minute;
    previousNegative = negative;
  }
  const negative = window.filter(p => p.difference < -PLAN_EPSILON);
  const evaluationState = !current || !Number.isFinite(current.difference) ? "unavailable" : minute > deadline ? "period-ended" : negative.length ? "shortage" : "sufficient";
  const evaluating = evaluationState === "sufficient" || evaluationState === "shortage";
  return { evaluationState, supplyStatus: SUPPLY_STATUS[evaluationState], periodEnded: evaluationState === "period-ended", current, firstFuture: evaluating ? firstFuture : null, ongoing: !!current && current.difference < -PLAN_EPSILON,
    firstInWindow: negative[0]?.minute ?? null,
    maximumShortage: evaluating ? Math.max(0, ...negative.map(p => -p.difference)) : null,
    pastFirst: past[0]?.minute ?? null, pastMaximum: Math.max(0, ...past.map(p => -p.difference)) };
}
function calculateSupplyView(plan, minute) {
  const empty = { evaluationState: "unavailable", supplyStatus: SUPPLY_STATUS.unavailable, periodEnded: false, minute, current: null, lines: [], series: [], firstFuture: null, maximumShortage: null, reconciliation: null };
  if (!Number.isFinite(minute) || plan.model.errors.length || !plan.required.length || !plan.operational.points.length) return empty;
  const requiredByMinute = new Map(plan.required.map(p => [p.minute, p]));
  const plannedByMinute = new Map(plan.operational.points.map(p => [p.minute, p]));
  const displayedByMinute = new Map(plan.displayed.map(p => [p.minute, p]));
  const series = plan.required.map(r => {
    const p = displayedByMinute.get(r.minute);
    return p ? { minute: r.minute, planned: p.count, required: r.count, difference: p.count - r.count } : null;
  }).filter(Boolean);
  const end = plan.model.jobs.length ? Math.max(...plan.model.jobs.map(j => j.deadline)) : minute;
  const overall = supplyWindow(series, minute, end);
  const lines = plan.model.lines.map(line => {
    const jobs = plan.operational.jobs.filter(j => j.lineId === line.id);
    const count = jobs.reduce((n, j) => n + j.count, 0);
    const deadlines = [...new Set(jobs.map(j => j.deadline))].sort((a, b) => a - b);
    const deadline = deadlines.at(-1) ?? null;
    const lineSeries = plan.required.map(r => {
      const p = plannedByMinute.get(r.minute);
      return p ? { minute: r.minute, planned: p.suppliedByLine[line.id] || 0, required: r.byLine[line.id] || 0,
        difference: (p.suppliedByLine[line.id] || 0) - (r.byLine[line.id] || 0) } : null;
    }).filter(Boolean);
    const window = supplyWindow(lineSeries, minute, deadline ?? minute);
    const currentPoint = plannedByMinute.get(minute);
    const completion = packingCompletion(jobs, count);
    const { finish, deadlineStatus } = completion;
    return { id: line.id, name: line.name, count, deadlines, deadline, finish, ...window, ...completion,
      deadlineStatus, riskStatus: deadlineStatus === "期限未達見込み" ? deadlineStatus : window.supplyStatus,
      wip: currentPoint?.wipByLine[line.id] ?? null, packed: currentPoint?.packedByLine[line.id] ?? null, estimated: true };
  });
  // Total picking includes outsourced supply, absent from internal byLine maps.
  // required.count may include a nondecreasing cumulative adjustment.
  const r = requiredByMinute.get(minute), p = plannedByMinute.get(minute);
  let reconciliation = null;
  if (r && p && overall.current && lines.every(l => l.current)) {
    const internalPlanned = lines.reduce((n, l) => n + l.current.planned, 0);
    const internalRequired = lines.reduce((n, l) => n + l.current.required, 0);
    const outsourcedPlanned = p.count - internalPlanned, outsourcedRequired = r.byLine.outsourced || 0;
    const requiredAdjustment = r.count - internalRequired - outsourcedRequired;
    const internalDifference = internalPlanned - internalRequired;
    reconciliation = { internalDifference, outsourcedPlanned, outsourcedRequired,
      outsourcedDifference: outsourcedPlanned - outsourcedRequired, requiredAdjustment,
      reconstructedDifference: internalDifference + outsourcedPlanned - outsourcedRequired - requiredAdjustment };
  }
  return { minute, series, ...overall, lines, reconciliation };
}

// Single line/job completion contract used by every view. Missing data is
// distinct from a known unfinished job and a known completion after deadline.
function packingCompletion(jobs, targetCount, unavailable = false) {
  const invalid = unavailable || !Array.isArray(jobs) || !Number.isFinite(targetCount) || targetCount < 0 || jobs.some(j => !Number.isFinite(j.count) || j.count < 0);
  let state = invalid ? "unavailable" : targetCount === 0 && jobs.every(j => j.count === 0) ? "no-demand" : "on-time";
  const relevant = Array.isArray(jobs) ? jobs.filter(j => j.count > 0) : [];
  if (!invalid && state !== "no-demand") {
    if (!relevant.length || Math.abs(relevant.reduce((n,j)=>n+j.count,0)-targetCount)>PLAN_EPSILON || relevant.some(j=>!Number.isFinite(j.deadline) || j.finishedAt === undefined || j.finishedAt !== null && !Number.isFinite(j.finishedAt))) state="unavailable";
    else if (relevant.some(j=>j.finishedAt === null)) state="unfinished";
    else if (relevant.some(j=>j.finishedAt>j.deadline)) state="late";
  }
  const deadlineStatus = {"unavailable":"算出不可","no-demand":"対象なし","on-time":"計画内完了","unfinished":"期限未達見込み","late":"期限未達見込み"}[state];
  return { completionState:state, deadlineStatus, planStatus: state === "late" || state === "unfinished" ? "期限内未達" : deadlineStatus,
    finish: state === "on-time" || state === "late" ? Math.max(...relevant.map(j=>j.finishedAt)) : null };
}
function recentComparison(actuals, reference, windowMinutes) {
  const empty={start:null,end:null,actualIncrement:null,referenceIncrement:null,actualSpeed:null,referenceSpeed:null,ratio:null};
  if (!(windowMinutes>0) || actuals.length<2) return empty;
  const end=actuals.at(-1),start=[...actuals].reverse().find(p=>p.minute<=end.minute-windowMinutes);
  if (!start || !Number.isFinite(start.count) || !Number.isFinite(end.count) || end.count<start.count || end.minute<=start.minute) return empty;
  const elapsed=end.minute-start.minute,actualIncrement=end.count-start.count;
  const left=reference.find(p=>p.minute===start.minute),right=reference.find(p=>p.minute===end.minute);
  const referenceIncrement=left && right && Number.isFinite(left.count) && Number.isFinite(right.count) && right.count>=left.count ? right.count-left.count : null;
  return {start:start.minute,end:end.minute,actualIncrement,referenceIncrement,actualSpeed:actualIncrement/elapsed*60,
    referenceSpeed:referenceIncrement===null?null:referenceIncrement/elapsed*60,
    ratio:referenceIncrement>0?actualIncrement/referenceIncrement*100:null};
}
const TREND_LABELS=Object.freeze({ahead:"計画より先行",steady:"計画どおり",recovering:"計画より遅れ・回復傾向",slowing:"計画より遅れ・ペース低下",behind:"計画より遅れ（速度判定不可）",complete:"ピッキング完了",unavailable:"算出不可"});
function progressTrend({actualCount,referenceCount,totalCount,comparison,delay,tolerance}) {
  if (![actualCount,referenceCount,tolerance].every(Number.isFinite)) return "unavailable";
  if (Number.isFinite(totalCount) && actualCount>=totalCount) return "complete";
  const difference=actualCount-referenceCount,allowance=(comparison.referenceSpeed || 0)*tolerance/60;
  if (difference>allowance+PLAN_EPSILON) return "ahead";
  if (difference>=-PLAN_EPSILON || Number.isFinite(delay)&&delay<=tolerance) return "steady";
  if (comparison.ratio===null) return "behind";
  return comparison.ratio>=100?"recovering":"slowing";
}
function plannedPickingCompletion(plan) {
  if (!plan?.model || plan.model.errors.length || !plan.model.batches || !plan.operational?.points?.length) return {state:"unavailable",minute:null,target:null};
  const target=plan.model.batches.reduce((n,b)=>n+b.total,0);
  if (!Number.isFinite(target)) return {state:"unavailable",minute:null,target:null};
  if (target===0) return {state:"no-demand",minute:null,target};
  const point=plan.operational.points.find(p=>Number.isFinite(p.count)&&p.count>=target-PLAN_EPSILON);
  return {state:point?"complete":"unfinished",minute:point?.minute??null,target};
}
