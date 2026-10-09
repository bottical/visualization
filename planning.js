"use strict";

// All time intervals are half-open [minute, minute + 1). Counts may be
// fractional in the fluid simulation; input demand is integer-valued.
const PLAN_BATCHES = ["batch6", "batch10", "batch13"];
const PLAN_EPSILON = 1e-7;
function defaultPackingPlan() {
  return {
    otherPeople: { before10: "", before13: "", after13: "" },
    manualPeople: { before10: "", before13: "", after13: "" },
    lines: Object.fromEntries(["gemini", "leo", "ravioli", "radish", "manual"].map(id => [id, {
      availableFrom: "", initialWip: "",
      confirmed: { batch6: "", batch10: "", batch13: "" }
    }])),
    manualPacket: { batch6: "", batch10: "", batch13: "" },
    history: { through: null, points: [] }
  };
}
function mergePackingPlan(saved) {
  const base = defaultPackingPlan(), source = saved || {};
  return { ...base, otherPeople: { ...base.otherPeople, ...source.otherPeople },
    manualPeople: { ...base.manualPeople, ...source.manualPeople },
    manualPacket: { ...base.manualPacket, ...source.manualPacket },
    lines: Object.fromEntries(Object.entries(base.lines).map(([id, line]) => [id, {
      ...line, ...source.lines?.[id], confirmed: { ...line.confirmed, ...source.lines?.[id]?.confirmed }
    }])),
    history: { through: source.history?.through ?? null, points: Array.isArray(source.history?.points) ? source.history.points.filter(p => Number.isFinite(p.minute) && Number.isFinite(p.count) && p.count >= 0) : [] }
  };
}
function planInteger(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
function planTime(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute;
}
function planPeriod(minute, times) { return minute < times[1] ? "before10" : minute < times[2] ? "before13" : "after13"; }
function planApportion(total, weights) {
  const weight = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return weights.map(() => 0);
  if (!(weight > 0)) return null;
  const raw = weights.map(w => total * w / weight), result = raw.map(Math.floor);
  const order = raw.map((n, i) => ({ i, rest: n - result[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  const remainder = total - result.reduce((a, b) => a + b, 0);
  for (let n = 0; n < remainder; n++) result[order[n].i]++;
  return result;
}

function calculatePackingDemand(input) {
  const plan = mergePackingPlan(input.dailyInput.packingPlan);
  const times = [planTime(input.settings.times.start), planTime(input.settings.times.batch10), planTime(input.settings.times.batch13)];
  const current = planTime(input.dailyInput.currentTime), buffer = planInteger(input.dailyInput.bufferMinutes);
  const packet = planTime(input.settings.times.packetDeadline), parcel = planTime(input.settings.times.parcelDeadline);
  const errors = [], assumptions = [];
  const add = (list, text) => { if (!list.includes(text)) list.push(text); };
  if (times.some(t => t === null) || !(times[0] < times[1] && times[1] < times[2]) || current === null || current < times[0] || buffer === null || packet === null || parcel === null || Math.min(packet, parcel) - buffer <= times[0]) {
    return { errors: ["開始・バッチ・配送締切・バッファ・現在時刻を確認してください"], assumptions, jobs: [], lines: [], times, current, plan };
  }
  const deadlines = { packet: packet - buffer, parcel: parcel - buffer };
  const lines = input.settings.packing.map(line => {
    const config = plan.lines[line.id] || { availableFrom: "", initialWip: "", confirmed: {} }, start = planTime(config.availableFrom), wip = planInteger(config.initialWip);
    const capacity = line.capacity === "" || line.capacity === null || line.capacity === undefined ? NaN : Number(line.capacity), people = planInteger(line.people);
    return { ...line, start: start ?? times[0], initialWip: wip ?? 0, configuredStart: start, configuredWip: wip,
      capacity: config && config.availableFrom !== "" && start === null ? NaN : capacity,
      people, deadline: deadlines[line.deadlineType], config };
  });
  const jobs = [], batches = [];
  let outsourced = planInteger(input.dailyInput.outsourced);
  if (outsourced === null) errors.push("外部委託件数が未入力または不正です");
  const keys = Object.keys(input.settings.picking);
  for (let index = 0; index < PLAN_BATCHES.length; index++) {
    const field = PLAN_BATCHES[index], release = times[index];
    // Future quantities are forecasts, never part of a historical prefix.
    if (release > current) break;
    const counts = keys.map(key => planInteger(input.dailyInput.picks[key]?.[field]));
    if (counts.some(n => n === null)) { errors.push(`${field}の対象件数が未入力または不正です`); break; }
    const total = counts.reduce((a, b) => a + b, 0);
    let hours = 0;
    for (let k = 0; k < keys.length; k++) {
      const productivity = Number(input.settings.picking[keys[k]]);
      if (counts[k] > 0 && (!Number.isFinite(productivity) || productivity <= 0)) errors.push(`${keys[k]}の生産性が未設定または0です`);
      else if (counts[k] > 0) hours += counts[k] / productivity;
    }
    const external = Math.min(outsourced ?? 0, total); outsourced = (outsourced ?? 0) - external;
    const internal = total - external;
    const confirmed = lines.map(line => planInteger(line.config.confirmed[field]));
    if (lines.some(line => line.config.confirmed[field] !== "" && planInteger(line.config.confirmed[field]) === null)) errors.push(`${field}の確定件数が不正です`);
    const fixed = confirmed.reduce((a, b) => a + (b ?? 0), 0), unknown = confirmed.map((n, i) => n === null ? i : -1).filter(i => i >= 0);
    if (fixed > internal || (!unknown.length && fixed !== internal)) { errors.push(`${field}の確定件数合計が社内対象件数と一致しません（二重計上を確認）`); continue; }
    const remainder = internal - fixed;
    const weights = unknown.map(i => Number(lines[i].share));
    if (weights.some(w => !Number.isFinite(w) || w < 0)) { errors.push("未確定ラインのシェア率が不正です"); continue; }
    const estimated = planApportion(remainder, weights);
    if (!estimated) { errors.push(`${field}の未確定件数を配分できません`); continue; }
    if (remainder > 0) add(assumptions, "梱包先未確定：未確定分のみシェア正規化による概算配分");
    const allocated = confirmed.map((n, i) => n ?? estimated[unknown.indexOf(i)]);
    batches.push({ field, release, total, hours, average: hours > 0 ? total / hours : 0, external });
    lines.forEach((line, i) => {
      if (allocated[i] === 0) {
        if (line.id === "manual" && plan.manualPacket[field] !== "" && planInteger(plan.manualPacket[field]) !== 0) errors.push(`${field}の手梱包配送内訳が対象件数を超えています`);
        return;
      }
      let packetCount = 0;
      if (line.id === "manual") {
        packetCount = planInteger(plan.manualPacket[field]);
        if (packetCount === null) {
          if (plan.manualPacket[field] !== "") errors.push(`${field}の手梱包配送内訳が不正です`);
          add(assumptions, "手梱包の配送内訳未確定：全件を早い方の締切で試算");
          packetCount = deadlines.packet <= deadlines.parcel ? allocated[i] : 0;
        }
        if (packetCount > allocated[i]) { errors.push(`${field}の手梱包配送内訳が対象件数を超えています`); return; }
      }
      const quantities = line.id === "manual" ? [[packetCount, deadlines.packet], [allocated[i] - packetCount, deadlines.parcel]] : [[allocated[i], line.deadline]];
      quantities.forEach(([count, deadline]) => { if (count > 0) jobs.push({ lineId: line.id, field, release, count, deadline, estimated: confirmed[i] === null }); });
    });
    if (external > 0) {
      add(assumptions, "外部委託は古いバッチから控除。委託分ピック期限は早い配送締切で仮置き（委託先の完了は対象外）");
      jobs.push({ lineId: "outsourced", field, release, count: external, deadline: Math.min(deadlines.packet, deadlines.parcel), external: true });
    }
  }
  if (outsourced > 0) errors.push("外部委託件数が到来済みバッチ対象件数を超えています");
  for (const line of lines) {
    const relevant = jobs.filter(job => job.lineId === line.id);
    if (!relevant.length) continue;
    if (!Number.isFinite(line.capacity) || line.capacity < 0 || (line.id !== "manual" && line.people === null)) errors.push(`${line.name}の能力・必要人数・開始可能時刻が不正です`);
    if (line.configuredStart === null && line.config.availableFrom === "") add(assumptions, `${line.name}開始可能時刻未確定：ピッキング開始時刻で試算`);
    if (line.configuredWip === null) {
      if (line.config.initialWip !== "") errors.push(`${line.name}の初期仕掛が不正です`);
      add(assumptions, `${line.name}初期仕掛未確定：0件で試算`);
    }
    const initialDemand = relevant.filter(job => job.field === "batch6").reduce((n, job) => n + job.count, 0);
    if (line.initialWip > initialDemand) errors.push(`${line.name}の初期仕掛が6時バッチ対象件数を超えています`);
  }
  const periods = ["before10", "before13", "after13"];
  for (const period of periods) {
    if (!jobs.length) break;
    if (planInteger(input.dailyInput.staffing[period]) === null) errors.push(`${period}の投入可能総人数が未入力または不正です`);
    if (planInteger(plan.otherPeople[period]) === null) {
      if (plan.otherPeople[period] !== "") errors.push(`${period}のその他拘束人数が不正です`);
      add(assumptions, "その他拘束人数未確定：0人で試算（梱包要員と重複させない）");
    }
    if (jobs.some(job => job.lineId === "manual")) {
      const manual = plan.manualPeople[period] === "" ? planInteger(input.dailyInput.manualPeople) : planInteger(plan.manualPeople[period]);
      if (manual === null || manual > 30) errors.push(`${period}の手梱包人数は0～30人で指定してください`);
    }
  }
  return { jobs, batches, lines, plan, times, current, deadlines, errors: [...new Set(errors)], assumptions };
}
function calculatePackingCapacity(line, minute, model, input) {
  if (minute < line.start) return 0;
  if (line.id !== "manual") return line.capacity;
  const period = planPeriod(minute, model.times);
  const people = model.plan.manualPeople[period] === "" ? planInteger(input.dailyInput.manualPeople) : planInteger(model.plan.manualPeople[period]);
  return line.capacity * (people ?? 0);
}
function calculateStaffingCapacity(minute, model, input) {
  const period = planPeriod(minute, model.times);
  return { total: planInteger(input.dailyInput.staffing[period]), other: planInteger(model.plan.otherPeople[period]) ?? 0,
    manual: model.plan.manualPeople[period] === "" ? planInteger(input.dailyInput.manualPeople) : planInteger(model.plan.manualPeople[period]) };
}
function calculateRequiredPickingProgress(model, input) {
  if (model.errors.length) return [];
  const end = Math.max(model.times[0], model.current, ...model.jobs.map(job => job.deadline));
  // Precompute shared line capacity suffixes. Manual packet/parcel queues use
  // the SAME capacity, so their deadline constraints are maxima, not sums.
  const suffixes = new Map(model.lines.map(line => {
    const suffix = Array(end + 1).fill(0);
    for (let minute = end - 1; minute >= model.times[0]; minute--) suffix[minute] = suffix[minute + 1] + calculatePackingCapacity(line, minute, model, input) / 60;
    return [line.id, suffix];
  }));
  const points = []; let previous = 0;
  for (let minute = model.times[0]; minute <= end; minute++) {
    const known = model.jobs.filter(job => job.release <= Math.min(minute, model.current));
    const byLine = {};
    for (const line of model.lines) {
      const jobs = known.filter(job => job.lineId === line.id), deadlines = [...new Set(jobs.map(job => job.deadline))];
      const suffix = suffixes.get(line.id);
      const required = Math.max(0, ...deadlines.map(deadline => {
        const due = jobs.filter(job => job.deadline <= deadline).reduce((n, job) => n + job.count, 0);
        const remainingCapacity = minute >= deadline ? 0 : suffix[minute] - suffix[deadline];
        return due - remainingCapacity;
      }));
      byLine[line.id] = jobs.length ? Math.max(line.initialWip, required) : 0;
    }
    // Outsourced packing is outside this model; only its picking is counted.
    byLine.outsourced = known.filter(job => job.external && minute >= job.deadline).reduce((n, job) => n + job.count, 0);
    const count = Math.max(previous, Object.values(byLine).reduce((a, b) => a + b, 0)); previous = count;
    const batches = model.batches.filter(batch => batch.release <= minute), total = batches.reduce((n, batch) => n + batch.total, 0), hours = batches.reduce((n, batch) => n + batch.hours, 0);
    points.push({ minute, count, hours: total > 0 ? count * hours / total : 0, byLine });
  }
  return points;
}

function calculateFeasiblePickingProgress(model, input) {
  if (model.errors.length) return { points: [], jobs: [], reasons: [], lines: [] };
  const jobs = model.jobs.map(job => ({ ...job, supplied: 0, packed: 0, finishedAt: null }));
  const reasons = [], add = text => { if (!reasons.includes(text)) reasons.push(text); };
  for (const line of model.lines) {
    let wip = line.initialWip;
    for (const job of jobs.filter(job => job.lineId === line.id && job.field === "batch6").sort((a, b) => a.deadline - b.deadline)) {
      const amount = Math.min(wip, job.count); job.supplied = amount; wip -= amount;
    }
  }
  let picked = jobs.reduce((n, job) => n + job.supplied, 0);
  const points = [], active = new Set(), lineStats = new Map(model.lines.map(line => [line.id, { id: line.id, firstStart: null, finish: null, starvedMinutes: 0, staffDelayedMinutes: 0 }]));
  const end = Math.max(model.times[0], model.current, ...jobs.map(job => job.deadline));
  for (let minute = model.times[0]; minute <= end; minute++) {
    const staffing = calculateStaffingCapacity(minute, model, input);
    let available = Math.max(0, staffing.total - staffing.other), packingPeople = 0;
    if (staffing.other > staffing.total) add("人員不足：その他拘束人数が投入可能総人数を超過");
    const live = line => jobs.filter(job => job.lineId === line.id && job.release <= minute && job.deadline > minute && job.packed < job.count - PLAN_EPSILON);
    const candidates = model.lines.filter(line => minute >= line.start && live(line).length &&
      (active.has(line.id) || live(line).some(job => job.supplied > job.packed + PLAN_EPSILON))).sort((a, b) => {
      const activeOrder = Number(active.has(b.id)) - Number(active.has(a.id));
      return activeOrder || Math.min(...live(a).map(job => job.deadline)) - Math.min(...live(b).map(job => job.deadline));
    });
    const running = [];
    for (const line of candidates) {
      const people = line.id === "manual" ? staffing.manual : line.people;
      // A machine is either fully staffed at fixed capacity or stopped.
      if (!(people > 0) || !(line.capacity > 0)) continue;
      if (people > available) {
        lineStats.get(line.id).staffDelayedMinutes++;
        continue;
      }
      // Reserve a planned line's full crew during its operating interval,
      // including supply starvation; otherwise picking gets fictitious staff.
      available -= people; packingPeople += people; running.push(line);
    }
    const byLine = Object.fromEntries(model.lines.map(line => [line.id, jobs.filter(job => job.lineId === line.id).reduce((n, job) => n + job.supplied, 0)]));
    const packedByLine = Object.fromEntries(model.lines.map(line => [line.id, jobs.filter(job => job.lineId === line.id).reduce((n, job) => n + job.packed, 0)]));
    points.push({ minute, count: picked, pickingPeople: available, packingPeople, otherPeople: staffing.other, totalPeople: staffing.total,
      activeLines: running.map(line => line.id), suppliedByLine: byLine, packedByLine,
      wipByLine: Object.fromEntries(model.lines.map(line => [line.id, byLine[line.id] - packedByLine[line.id]])) });
    if (minute === end) break;
    let personHours = available / 60;
    // FIFO batches with their own mix productivity. A later batch never
    // changes productivity, allocation, or supply in a historical interval.
    for (const batch of model.batches.filter(batch => batch.release <= minute)) {
      const pending = jobs.filter(job => job.field === batch.field && job.supplied < job.count - PLAN_EPSILON);
      const remaining = pending.reduce((n, job) => n + job.count - job.supplied, 0);
      if (!(remaining > PLAN_EPSILON) || !(batch.average > 0)) continue;
      const quantity = Math.min(remaining, personHours * batch.average);
      for (const job of pending) job.supplied += quantity * (job.count - job.supplied) / remaining;
      picked += quantity; personHours -= quantity / batch.average;
      if (personHours < PLAN_EPSILON) break;
    }
    for (const line of running) {
      let capacity = calculatePackingCapacity(line, minute, model, input) / 60;
      const stats = lineStats.get(line.id), pending = live(line).sort((a, b) => a.deadline - b.deadline || a.release - b.release);
      let completed = 0;
      for (const job of pending) {
        const amount = Math.min(capacity, job.supplied - job.packed, job.count - job.packed);
        job.packed += amount; capacity -= amount; completed += amount;
        if (job.packed >= job.count - PLAN_EPSILON) job.finishedAt = minute + 1;
      }
      if (completed > PLAN_EPSILON) { stats.firstStart ??= minute; active.add(line.id); }
      if (capacity > PLAN_EPSILON && pending.some(job => job.packed < job.count - PLAN_EPSILON)) stats.starvedMinutes++;
      if (!jobs.some(job => job.lineId === line.id && job.release <= minute && job.packed < job.count - PLAN_EPSILON)) { active.delete(line.id); stats.finish = minute + 1; }
    }
  }
  for (const job of jobs) {
    if (job.external) continue;
    if (job.packed < job.count - PLAN_EPSILON) {
      const line = model.lines.find(line => line.id === job.lineId);
      const fullCapacity = Array.from({ length: Math.max(0, job.deadline - Math.max(line.start, job.release)) }, (_, i) => calculatePackingCapacity(line, Math.max(line.start, job.release) + i, model, input) / 60).reduce((a, b) => a + b, 0);
      const due = jobs.filter(other => other.lineId === line.id && other.deadline <= job.deadline).reduce((n, other) => n + other.count, 0);
      let sharedCapacity = 0;
      for (let minute = model.times[0]; minute < job.deadline; minute++) sharedCapacity += calculatePackingCapacity(line, minute, model, input) / 60;
      if (fullCapacity < job.count - PLAN_EPSILON || sharedCapacity < due - PLAN_EPSILON) add(`梱包能力不足：${line.name}は完了期限までの能力が対象件数に不足`);
      else if (lineStats.get(line.id).staffDelayedMinutes) add(`人員不足：${line.name}の稼働時間を確保できません`);
      else add(`仕掛供給不足：${line.name}は完了期限までに必要量を処理できません`);
    }
  }
  return { points, jobs, reasons, lines: [...lineStats.values()] };
}

function evaluatePlanFeasibility(model, required, feasible) {
  if (model.errors.length) return { status: "unknown", scenarioStatus: "unknown", reasons: model.errors, assumptions: model.assumptions };
  const reasons = [...feasible.reasons];
  const violations = [];
  const possibleByMinute = new Map(feasible.points.map(point => [point.minute, point]));
  required.forEach(point => {
    const possible = possibleByMinute.get(point.minute);
    if (possible && point.count > possible.count + PLAN_EPSILON) violations.push({ minute: point.minute, required: point.count, feasible: possible.count });
    for (const [id, count] of Object.entries(point.byLine || {})) {
      if (id !== "outsourced" && possible && count > (possible.suppliedByLine[id] || 0) + PLAN_EPSILON && !reasons.some(reason => reason.startsWith("仕掛供給不足"))) reasons.push("仕掛供給不足：ライン別の必要供給に未達の時間帯があります");
    }
  });
  if (violations.length) reasons.unshift("ピッキング能力不足：必要進捗が実行可能進捗を超過する時間帯があります");
  const failed = reasons.length > 0;
  return { status: model.assumptions.length ? "unknown" : failed ? "infeasible" : "feasible", scenarioStatus: failed ? "infeasible" : "feasible", reasons: [...new Set(reasons)], assumptions: model.assumptions, violations };
}
function calculatePackingPlan(input) {
  const model = calculatePackingDemand(input), required = calculateRequiredPickingProgress(model, input), feasible = calculateFeasiblePickingProgress(model, input);
  const history = model.plan.history;
  const frozen = history.points.filter(p => p.minute < history.through);
  const lastFrozen = frozen.at(-1)?.count ?? 0;
  const displayed = [...frozen, ...required.filter(p => history.through === null || p.minute >= history.through).map(p => ({ ...p, count: Math.max(lastFrozen, p.count) }))];
  // Do not hide a future supply shortfall by evaluating a lower, recomputed
  // curve than the one actually displayed after a history-preserving edit.
  const future = new Map(displayed.map(point => [point.minute, point]));
  const evaluated = required.map(point => history.through !== null && point.minute >= history.through ? future.get(point.minute) || point : point);
  const evaluation = evaluatePlanFeasibility(model, evaluated, feasible);
  return { model, required, feasible, evaluation, displayed };
}
