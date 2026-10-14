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
  return { current, firstFuture, ongoing: !!current && current.difference < -PLAN_EPSILON,
    firstInWindow: negative[0]?.minute ?? null,
    maximumShortage: Math.max(0, ...negative.map(p => -p.difference)),
    pastFirst: past[0]?.minute ?? null, pastMaximum: Math.max(0, ...past.map(p => -p.difference)) };
}
function calculateSupplyView(plan, minute) {
  const empty = { minute, current: null, lines: [], series: [], firstFuture: null, maximumShortage: null, reconciliation: null };
  if (!Number.isFinite(minute) || plan.model.errors.length || !plan.required.length || !plan.operational.points.length) return empty;
  const requiredByMinute = new Map(plan.required.map(p => [p.minute, p]));
  const plannedByMinute = new Map(plan.operational.points.map(p => [p.minute, p]));
  const displayedByMinute = new Map(plan.displayed.map(p => [p.minute, p]));
  const series = plan.required.map(r => {
    const p = displayedByMinute.get(r.minute);
    return p ? { minute: r.minute, planned: p.count, required: r.count, difference: p.count - r.count } : null;
  }).filter(Boolean);
  const end = Math.max(minute, ...plan.model.jobs.map(j => j.deadline));
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
    const complete = jobs.every(j => j.finishedAt !== null && j.finishedAt <= j.deadline);
    const finish = count && complete ? Math.max(...jobs.map(j => j.finishedAt)) : null;
    const periodEnded = deadline !== null && minute > deadline;
    if (periodEnded) window.maximumShortage = null;
    const supplyStatus = !window.current ? "算出不可" : window.ongoing || window.firstInWindow !== null ? "必要供給不足" : "供給条件充足";
    const deadlineStatus = !count ? "対象なし" : complete ? "計画内完了" : "期限未達見込み";
    return { id: line.id, name: line.name, count, deadlines, deadline, finish, ...window, periodEnded,
      supplyStatus, deadlineStatus, riskStatus: deadlineStatus === "期限未達見込み" ? deadlineStatus : supplyStatus,
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
