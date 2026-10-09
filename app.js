"use strict";

const STORAGE_KEY = "warehouse-progress-demo-v1";
const PICK_KEYS = ["total", "gas", "sas", "order"];
const PICK_NAMES = { total: "トータルピック", gas: "GAS", sas: "SAS", order: "オーダーピック" };
const MASTER_DEFAULTS = Object.freeze({
  picking: { total: 601.6, gas: 49.4, sas: 49.4, order: 49.4 },
  packing: [
    { id: "gemini", name: "ジェミニ", capacity: 928, people: 5, share: 36.4, deadlineType: "packet" },
    { id: "leo", name: "レオ", capacity: 905, people: 6, share: 41.5, deadlineType: "packet" },
    { id: "ravioli", name: "ラビオリ", capacity: 550, people: 3, share: 0.7, deadlineType: "packet" },
    { id: "radish", name: "ラディッシュ", capacity: 327, people: 7, share: 14.1, deadlineType: "parcel" },
    { id: "manual", name: "手梱包", capacity: 29, people: null, share: 7.4, deadlineType: "parcel", maxPeople: 30 }
  ],
  times: { start: "09:30", batch10: "10:00", batch13: "13:00", primaryGoal: "13:00", alert: "14:00", packetDeadline: "16:00", parcelDeadline: "18:30" },
  toleranceMinutes: 15,
  recentWindowMinutes: 30
});
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function emptyPicks() { return Object.fromEntries(PICK_KEYS.map(k => [k, { batch6: "", batch10: "", batch13: "" }])); }
function defaultState() {
  return { version: 1, settings: clone(MASTER_DEFAULTS), dailyInput: { picks: emptyPicks(), staffing: { before10: "", before13: "", after13: "" }, currentTime: "", autoCurrentTime: false, outsourced: "", bufferMinutes: "", manualPeople: "", packingPlan: defaultPackingPlan() }, actuals: [], updatedAt: "" };
}
function initialPresetState() {
  const base = defaultState();
  // Initial explanatory preset. These values are provisional defaults for
  // faster demo input, not confirmed historical averages.
  base.dailyInput = {
    currentTime: "13:40",
    autoCurrentTime: false,
    outsourced: "0",
    bufferMinutes: "30",
    manualPeople: "8",
    staffing: { before10: "40", before13: "40", after13: "40" },
    packingPlan: defaultPackingPlan(),
    picks: {
      total: { batch6: "3000", batch10: "2200", batch13: "300" },
      gas: { batch6: "1400", batch10: "1100", batch13: "100" },
      sas: { batch6: "1000", batch10: "800", batch13: "100" },
      order: { batch6: "700", batch10: "600", batch13: "100" }
    }
  };
  base.actuals = [];
  return base;
}
function normalizeTimeValue(value) {
  if (typeof value !== "string") return "";
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : "";
}
function mergeState(raw) {
  const base = defaultState();
  if (!raw || raw.version !== 1) return base;
  const merged = {
    ...base, ...raw,
    settings: { ...base.settings, ...(raw.settings || {}), picking: { ...base.settings.picking, ...(raw.settings?.picking || {}) }, times: { ...base.settings.times, ...(raw.settings?.times || {}) }, packing: Array.isArray(raw.settings?.packing) ? base.settings.packing.map((line, index) => ({ ...line, ...raw.settings.packing[index], deadlineType: line.deadlineType })) : base.settings.packing },
    dailyInput: { ...base.dailyInput, ...(raw.dailyInput || {}), packingPlan: mergePackingPlan(raw.dailyInput?.packingPlan), picks: { ...base.dailyInput.picks, ...(raw.dailyInput?.picks || {}) }, staffing: { ...base.dailyInput.staffing, ...(raw.dailyInput?.staffing || {}) } },
    actuals: Array.isArray(raw.actuals) ? raw.actuals.map(row => ({ time: normalizeTimeValue(row.time), totalCompleted: row.totalCompleted ?? (PICK_KEYS.every(k => row[k] !== "" && row[k] != null) ? PICK_KEYS.reduce((total, k) => total + Number(row[k]), 0) : ""), breakdown: row.breakdown || null })) : []
  };
  merged.dailyInput.currentTime = normalizeTimeValue(merged.dailyInput.currentTime);
  Object.keys(merged.settings.times).forEach(key => { merged.settings.times[key] = normalizeTimeValue(merged.settings.times[key]); });
  return merged;
}
function getCurrentTenMinuteTime(now = new Date(), startTime = MASTER_DEFAULTS.times.start) {
  const startMinute = timeToMinutes(startTime);
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const gridOffset = startMinute === null ? nowMinute % 10 : ((nowMinute - startMinute) % 10 + 10) % 10;
  return minutesToTime(nowMinute - gridOffset);
}
function loadState(now = new Date()) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const loaded = saved === null ? initialPresetState() : mergeState(JSON.parse(saved));
    if (loaded.dailyInput.autoCurrentTime === true) loaded.dailyInput.currentTime = getCurrentTenMinuteTime(now, loaded.settings.times.start);
    return loaded;
  } catch (_) { return defaultState(); }
}
let state = loadState();
function normalizeStateTimes() { state.dailyInput.currentTime = normalizeTimeValue(state.dailyInput.currentTime); Object.keys(state.settings.times).forEach(key => { state.settings.times[key] = normalizeTimeValue(state.settings.times[key]); }); state.actuals.forEach(row => { row.time = normalizeTimeValue(row.time); }); }
function saveState() { normalizeStateTimes(); state.updatedAt = new Date().toISOString(); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable: UI remains usable */ } document.querySelector("#saved-at").textContent = new Date(state.updatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function syncCurrentTime(now = new Date()) {
  if (state.dailyInput.autoCurrentTime !== true) return false;
  const currentTime = getCurrentTenMinuteTime(now, state.settings.times.start);
  if (state.dailyInput.currentTime === currentTime) return false;
  state.dailyInput.currentTime = currentTime;
  saveState();
  renderAll();
  return true;
}
function resetDailyData() { if (!confirm("当日の件数・人数・実績をクリアします。マスター値は維持されます。よろしいですか？")) return; state.dailyInput = defaultState().dailyInput; state.actuals = []; saveState(); renderAll(); }
function resetAll() { if (!confirm("保存内容をすべて削除し、標準マスターへ戻します。よろしいですか？")) return; localStorage.removeItem(STORAGE_KEY); state = initialPresetState(); saveState(); renderAll(); }

const valueOrNull = v => v === "" || v === null || v === undefined ? null : Number(v);
const validNonNegative = v => { const n = valueOrNull(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const validNonNegativeInteger = v => { const n = validNonNegative(v); return n !== null && Number.isInteger(n) ? n : null; };
const isFiniteNumber = v => typeof v === "number" && Number.isFinite(v);
const sum = values => values.reduce((a, b) => a + b, 0);
const formatNumber = (v, digits = 0) => isFiniteNumber(v) ? v.toLocaleString("ja-JP", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "－";
function timeToMinutes(time) { const normalized = normalizeTimeValue(time); if (!normalized) return null; const [h, m] = normalized.split(":").map(Number); return h * 60 + m; }
function minutesToTime(minutes) { if (!isFiniteNumber(minutes)) return "－"; const safe = Math.round(minutes); const h = Math.floor(((safe % 1440) + 1440) % 1440 / 60); const m = ((safe % 60) + 60) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
function minutesToDeadlineTime(minutes) { if (!isFiniteNumber(minutes)) return "－"; const safe = Math.floor(minutes); const h = Math.floor(((safe % 1440) + 1440) % 1440 / 60); const m = ((safe % 60) + 60) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
function buildTenMinuteTimeOptions(selectedValue = "") {
  const start = timeToMinutes(state.settings.times.start), values = [];
  if (start !== null) for (let minute = start; minute < 1440; minute += 10) values.push(minutesToTime(minute));
  const options = ['<option value="">－</option>'];
  if (selectedValue && !values.includes(selectedValue)) {
    options.push(`<option value="${selectedValue}" selected disabled>${selectedValue}（10分刻み不一致）</option>`);
  }
  values.forEach(value => options.push(`<option value="${value}"${value === selectedValue ? " selected" : ""}>${value}</option>`));
  return options.join("");
}

function getPickTotals() {
  const rows = {};
  let complete = true;
  PICK_KEYS.forEach(k => {
    const source = state.dailyInput.picks[k];
    const values = ["batch6", "batch10", "batch13"].map(key => validNonNegativeInteger(source[key]));
    if (values.some(v => v === null || !Number.isFinite(v))) complete = false;
    const total = values.every(Number.isFinite) ? sum(values) : null;
    const productivity = Number(state.settings.picking[k]);
    rows[k] = { values, total, hours: total === null || !Number.isFinite(productivity) || productivity <= 0 ? null : total / productivity };
    if (rows[k].hours === null) complete = false;
  });
  const totalCount = complete ? sum(PICK_KEYS.map(k => rows[k].total)) : null;
  const totalHours = complete ? sum(PICK_KEYS.map(k => rows[k].hours)) : null;
  return { rows, complete, totalCount, totalHours };
}
function calculateStandardHours(counts) { const productivities = PICK_KEYS.map(k => Number(state.settings.picking[k])); return productivities.every(p => Number.isFinite(p) && p > 0) ? PICK_KEYS.reduce((hours, k) => hours + (counts[k] || 0) / state.settings.picking[k], 0) : null; }
function calculateAverageProductivity(totals = getPickTotals()) { return totals.totalCount > 0 && totals.totalHours > 0 ? totals.totalCount / totals.totalHours : null; }
function batchCounts(field) { return Object.fromEntries(PICK_KEYS.map(k => [k, validNonNegativeInteger(state.dailyInput.picks[k][field])])); }
function allBatchEntered(field) { return Object.values(batchCounts(field)).every(Number.isFinite); }
function getReleasedBatchFields(minute) {
  const t10 = timeToMinutes(state.settings.times.batch10), t13 = timeToMinutes(state.settings.times.batch13);
  if (![minute, t10, t13].every(isFiniteNumber)) return null;
  return minute < t10 ? ["batch6"] : minute < t13 ? ["batch6", "batch10"] : ["batch6", "batch10", "batch13"];
}
function getReleasedPickTotal(minute) {
  const fields = getReleasedBatchFields(minute);
  if (!fields) return null;
  if (!fields.every(allBatchEntered)) return null;
  return PICK_KEYS.reduce((total, key) => total + sum(fields.map(field => batchCounts(field)[key])), 0);
}
function staffForMinute(minute) { const t10 = timeToMinutes(state.settings.times.batch10), t13 = timeToMinutes(state.settings.times.batch13); return validNonNegativeInteger(minute < t10 ? state.dailyInput.staffing.before10 : minute < t13 ? state.dailyInput.staffing.before13 : state.dailyInput.staffing.after13); }
function packingPeopleAt(minute, allocations) {
  return allocations.filter(x => x.latestStartMinutes !== null && minute >= Math.floor(x.latestStartMinutes)).reduce((n, x) => n + (x.people || 0), 0);
}
function isPackingScheduleReady(allocations) {
  return allocations.every(line => line.count !== null && (line.count === 0 || (line.latestStartMinutes !== null && Number.isFinite(line.people) && line.effectiveCapacity !== null)));
}
let packingPlanCache = null;
function getPackingPlan() {
  const key = JSON.stringify({ settings: state.settings, dailyInput: state.dailyInput });
  if (packingPlanCache?.key !== key) packingPlanCache = { key, value: calculatePackingPlan(state) };
  return packingPlanCache.value;
}
function calculateIdealProgress() { return getPackingPlan().displayed; }
function calculateIdealSpeedAt(minute) {
  const points = calculateIdealProgress(), index = points.findIndex(point => point.minute === minute);
  if (index < 0) return null;
  const next = points[index + 1], previous = points[index - 1];
  // At batch arrival use the forward slope; a requirement jump is not an
  // attainable instantaneous speed and is reported by plan feasibility.
  const left = next ? points[index] : previous, right = next || points[index];
  return left && right.minute > left.minute ? Math.max(0, (right.count - left.count) * 60 / (right.minute - left.minute)) : 0;
}
function calculateActualProgress() {
  const start = timeToMinutes(state.settings.times.start);
  let previousMinute = null;
  return state.actuals.map(row => {
    const minute = timeToMinutes(row.time), count = validNonNegativeInteger(row.totalCompleted);
    const validTime = minute !== null && start !== null && minute >= start && (minute - start) % 10 === 0 && (previousMinute === null || minute > previousMinute);
    if (minute !== null) previousMinute = minute;
    return { minute, count, valid: validTime && count !== null, source: row };
  });
}
function getContiguousActuals(actuals = calculateActualProgress()) {
  const result = [];
  for (const row of actuals) { if (!row.valid) break; result.push(row); }
  return result;
}
function calculateRecentSpeed(actuals) {
  const valid = actuals.filter(x => x.count !== null); if (valid.length < 2) return null;
  const windowMinutes = validNonNegativeInteger(state.settings.recentWindowMinutes); if (!windowMinutes) return null;
  const current = valid.at(-1), target = current.minute - windowMinutes;
  const previous = [...valid].reverse().find(x => x.minute <= target); if (!previous || current.minute === previous.minute) return null;
  return (current.count - previous.count) / ((current.minute - previous.minute) / 60);
}
function calculateDelayMinutes(actualCount, idealCount, idealSpeed) { const shortage = idealCount - actualCount; return shortage > 0 && idealSpeed > 0 ? shortage / idealSpeed * 60 : shortage <= 0 ? 0 : null; }
function calculateFinishEstimate(progressTimestamp, actualCount, totalCount, recentSpeed) { return recentSpeed > 0 && totalCount >= actualCount ? progressTimestamp + (totalCount - actualCount) / recentSpeed * 60 : null; }
function judgeProgressStatus({ actualCount, idealCount, totalCount, recentSpeed, idealSpeed }) {
  if (![actualCount, idealCount, idealSpeed].every(isFiniteNumber)) return "未判定";
  if (isFiniteNumber(totalCount) && actualCount >= totalCount) return "完了";
  const tolerance = validNonNegativeInteger(state.settings.toleranceMinutes); if (tolerance === null) return "未判定";
  const toleranceCount = idealSpeed * tolerance / 60, diff = actualCount - idealCount;
  if (diff > toleranceCount) return "先行"; if (Math.abs(diff) <= toleranceCount) return "順調";
  if (!isFiniteNumber(recentSpeed)) return "未判定"; return recentSpeed >= idealSpeed ? "遅延・回復中" : "遅延拡大";
}
function calculatePackingLatestStart(deadline, buffer, hours) { const d = timeToMinutes(deadline); return d !== null && isFiniteNumber(buffer) && isFiniteNumber(hours) ? d - buffer - hours * 60 : null; }
function allocatePackingCounts(total, shares) {
  if (!Number.isInteger(total) || total < 0 || !shares.length) return shares.map(() => null);
  const shareSum = sum(shares); if (!(shareSum > 0)) return shares.map(() => null);
  const raw = shares.map(share => total * share / shareSum), counts = raw.map(Math.floor);
  const order = raw.map((value, index) => ({ index, remainder: value - counts[index] })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const remaining = total - sum(counts);
  for (let i = 0; i < remaining; i += 1) counts[order[i].index] += 1;
  return counts;
}
function calculatePackingAllocation(totalOverride = null) {
  const total = totalOverride === null ? getPickTotals().totalCount : validNonNegativeInteger(totalOverride), outsourced = validNonNegativeInteger(state.dailyInput.outsourced), buffer = validNonNegativeInteger(state.dailyInput.bufferMinutes);
  const internal = total !== null && outsourced !== null && outsourced <= total ? total - outsourced : null;
  const shares = state.settings.packing.map(x => Number(x.share)), sharesValid = shares.every(x => Number.isFinite(x) && x >= 0), shareSum = sharesValid ? sum(shares) : 0;
  const allocatedCounts = internal === null || !sharesValid ? shares.map(() => null) : allocatePackingCounts(internal, shares);
  return state.settings.packing.map((line, index) => {
    const normalizedShare = shareSum > 0 ? Number(line.share) / shareSum : null;
    const count = allocatedCounts[index];
    const people = line.id === "manual" ? validNonNegativeInteger(state.dailyInput.manualPeople) : Number(line.people);
    const capacitySetting = Number(line.capacity), capacity = capacitySetting > 0 ? (line.id === "manual" ? (people === null || people > 30 ? null : people * capacitySetting) : capacitySetting) : null;
    const hours = count !== null && capacity > 0 ? count / capacity : null;
    const deadline = line.deadlineType === "packet" ? state.settings.times.packetDeadline : state.settings.times.parcelDeadline;
    const deadlineMinutes = timeToMinutes(deadline), startMinutes = timeToMinutes(state.settings.times.start);
    const latestStartMinutes = deadlineMinutes !== null && startMinutes !== null && deadlineMinutes > startMinutes ? calculatePackingLatestStart(deadline, buffer, hours) : null;
    return { ...line, deadline, normalizedShare, count, people, effectiveCapacity: capacity, hours, latestStartMinutes };
  });
}

function input(path, value, options = {}) { const type = options.type || "number"; const attrs = [`type="${type}"`, `value="${escapeHtml(value ?? "")}"`, `data-path="${path}"`]; if (options.min !== undefined) attrs.push(`min="${options.min}"`); if (type === "number" && options.max !== undefined) attrs.push(`max="${options.max}"`); if (options.step !== undefined) attrs.push(`step="${options.step}"`); return `<input ${attrs.join(" ")} aria-label="${options.label || path}">`; }
function setPath(path, value) { const parts = path.split("."); let target = state; parts.slice(0, -1).forEach(p => { target = target[p]; }); target[parts.at(-1)] = value; }
function updateStatePath(path, value, now = new Date()) {
  // Save the observed prefix before changing the plan. New batch quantities
  // entered at their release update only that release and its future.
  if (path !== "dailyInput.currentTime" && !path.startsWith("dailyInput.packingPlan.history")) {
    const minute = timeToMinutes(state.dailyInput.currentTime), previous = getPackingPlan().displayed;
    if (minute !== null && previous.length) {
      state.dailyInput.packingPlan = mergePackingPlan(state.dailyInput.packingPlan);
      const through = Math.max(minute, state.dailyInput.packingPlan.history.through ?? minute);
      state.dailyInput.packingPlan.history = { through, points: previous.filter(point => point.minute < through).map(({ minute, count, hours }) => ({ minute, count, hours })) };
    }
  }
  setPath(path, value);
  if (path === "settings.times.start" && state.dailyInput.autoCurrentTime === true) {
    state.dailyInput.currentTime = getCurrentTenMinuteTime(now, value);
  }
}
function statusClass(status) { return ["完了", "先行", "順調", "開始前", "計画内完了", "対象なし"].includes(status) ? "good" : ["遅延・回復中", "開始期限到来"].includes(status) ? "warn" : ["遅延拡大", "締切超過", "期限内未達"].includes(status) ? "bad" : ""; }

function currentMetrics() {
  const totals = getPickTotals(), ideal = calculateIdealProgress(), actual = getContiguousActuals(), currentMinute = timeToMinutes(state.dailyInput.currentTime);
  const validActual = actual.filter(x => x.count !== null && currentMinute !== null && x.minute <= currentMinute), current = validActual.at(-1);
  const recentSpeed = calculateRecentSpeed(validActual);
  const finish = current && totals.totalCount !== null ? calculateFinishEstimate(current.minute, current.count, totals.totalCount, recentSpeed) : null;
  const base = { totals, ideal, actual, current, currentMinute, recentSpeed, finish, dataAge: current ? currentMinute - current.minute : null, status: "未判定" };
  if (!current || !ideal.length || currentMinute === null) return base;
  const idealPoint = [...ideal].reverse().find(x => x.minute <= current.minute); if (!idealPoint) return base;
  const idealSpeed = calculateIdealSpeedAt(current.minute);
  const status = judgeProgressStatus({ actualCount: current.count, idealCount: idealPoint.count, totalCount: totals.totalCount, recentSpeed, idealSpeed });
  return { ...base, idealPoint, idealSpeed, status, diffCount: current.count - idealPoint.count, delay: calculateDelayMinutes(current.count, idealPoint.count, idealSpeed) };
}
function calculateCurrentStaffingSummary() {
  const plan = getPackingPlan(), minute = timeToMinutes(state.dailyInput.currentTime);
  const point = plan.feasible.points.find(point => point.minute === minute);
  const totalPeople = minute === null ? null : staffForMinute(minute);
  if (!point) return { totalPeople, packingPeople: null, pickingPeople: null, nextPackingStart: null, staffingStatus: null };
  const future = plan.feasible.lines.map(line => line.firstStart).filter(start => start !== null && start > minute);
  return { totalPeople, packingPeople: point.packingPeople, pickingPeople: point.pickingPeople,
    nextPackingStart: future.length ? Math.min(...future) : null,
    staffingStatus: plan.evaluation.status === "unknown" ? "要確認" : point.otherPeople + point.packingPeople <= totalPeople ? "充足" : "不足" };
}
function calculatePickingStaffAllocation(pickingPeopleOverride) {
  const currentMinute = timeToMinutes(state.dailyInput.currentTime);
  const fields = getReleasedBatchFields(currentMinute);
  const staffing = calculateCurrentStaffingSummary();
  const totalPeople = pickingPeopleOverride === undefined ? staffing.pickingPeople : pickingPeopleOverride;
  if (totalPeople === null || !Number.isInteger(totalPeople) || totalPeople < 0 || !fields || !fields.every(allBatchEntered)) {
    return { totalPeople: null, totalWorkHours: null, rows: [], status: "unavailable" };
  }
  const rows = PICK_KEYS.map((key, index) => {
    const releasedCount = sum(fields.map(field => batchCounts(field)[key]));
    const productivity = Number(state.settings.picking[key]);
    const workHours = Number.isFinite(productivity) && productivity > 0 ? releasedCount / productivity : null;
    return { key, name: PICK_NAMES[key], index, releasedCount, productivity, workHours };
  });
  if (rows.some(row => row.workHours === null)) return { totalPeople, totalWorkHours: null, rows: [], status: "unavailable" };
  const totalWorkHours = sum(rows.map(row => row.workHours));
  if (!(totalWorkHours > 0)) {
    return { totalPeople, totalWorkHours: 0, rows: rows.map(row => ({ ...row, share: 0, rawPeople: 0, people: 0 })), status: "no-work" };
  }
  rows.forEach(row => {
    row.share = row.workHours / totalWorkHours;
    row.rawPeople = totalPeople * row.share;
    row.people = Math.floor(row.rawPeople);
  });
  const remainderOrder = [...rows].sort((a, b) => (b.rawPeople - b.people) - (a.rawPeople - a.people) || a.index - b.index);
  const remaining = totalPeople - sum(rows.map(row => row.people));
  for (let i = 0; i < remaining; i += 1) remainderOrder[i].people += 1;
  return { totalPeople, totalWorkHours, rows, status: "ready" };
}
function renderStaffingSummary() {
  const { totalPeople, packingPeople, pickingPeople, nextPackingStart, staffingStatus } = calculateCurrentStaffingSummary();
  const items = [
    ["共通投入可能総人員", totalPeople === null ? "－" : `${formatNumber(totalPeople)}人`],
    ["梱包稼働要員", packingPeople === null ? "－" : `${formatNumber(packingPeople)}人`],
    ["ピッキング可能人数", pickingPeople === null ? "－" : `${formatNumber(pickingPeople)}人`],
    ["次の梱包開始", nextPackingStart === null ? "－" : minutesToDeadlineTime(nextPackingStart)],
    ["人員余力", staffingStatus === null ? `<span class="status">未判定</span>` : `<span class="status ${staffingStatus === "充足" ? "good" : staffingStatus === "要確認" ? "warn" : "bad"}">${staffingStatus}</span>`]
  ];
  document.querySelector("#staffing-summary").innerHTML = items.map(([label, value]) => `<div class="staffing-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
  const allocation = calculatePickingStaffAllocation();
  const allocationBox = document.querySelector("#picking-staff-allocation");
  if (allocation.status === "unavailable") allocationBox.innerHTML = `<div class="allocation-message">人員条件未確定</div>`;
  else if (allocation.status === "no-work") allocationBox.innerHTML = `<div class="allocation-message">対象作業なし</div>`;
  else allocationBox.innerHTML = `<div class="allocation-grid">${allocation.rows.map(row => `<div class="allocation-item"><span>${row.name}</span><strong>${row.people}人</strong><small>作業量比 ${formatNumber(row.share * 100, 1)}%</small></div>`).join("")}</div><div class="allocation-total"><span>合計</span><strong>${allocation.totalPeople}人</strong></div>`;
}
function renderSummary() {
  const m = currentMetrics(); const ready = m.current && m.idealPoint; const pace = ready && m.recentSpeed !== null && m.idealSpeed > 0 ? m.recentSpeed / m.idealSpeed * 100 : null;
  const items = [
    ["現在状態", `<span class="status ${statusClass(m.status)}">${m.status}</span>`, "件数差・直近速度で判定", "highlight"],
    ["理想累計", ready ? `${formatNumber(m.idealPoint.count)}件` : "－", ready ? `理想速度 ${formatNumber(m.idealSpeed)} 件/時` : "入力待ち", ""],
    ["実績累計", m.current ? `${formatNumber(m.current.count)}件` : "－", m.current ? `最終実績 ${minutesToTime(m.current.minute)}` : "実績待ち", "actual-kpi"],
    ["差分", ready ? `${m.diffCount >= 0 ? "+" : ""}${formatNumber(m.diffCount)}件` : "－", "実績件数－理想件数", ""],
    ["遅れ時間", ready && m.delay !== null ? `${formatNumber(m.delay)}分` : "－", `許容 ${state.settings.toleranceMinutes}分`, ""],
    ["直近ペース", pace !== null ? `${formatNumber(pace)}%` : "－", m.recentSpeed !== null ? `${formatNumber(m.recentSpeed)} 件/時` : "算出不可", "actual-kpi"],
    ["ピッキング終了見込み", m.finish !== null && m.finish !== undefined ? minutesToTime(m.finish) : "－", m.finish ? "直近速度から概算" : "算出不可", ""]
  ];
  document.querySelector("#progress-time-info").innerHTML = `<div class="mini-metric"><span>現在時刻</span><strong>${state.dailyInput.currentTime || "－"}</strong></div><div class="mini-metric"><span>実績最終更新</span><strong>${m.current ? minutesToTime(m.current.minute) : "－"}</strong></div><div class="mini-metric"><span>データ経過時間</span><strong>${isFiniteNumber(m.dataAge) ? `${m.dataAge}分` : "－"}</strong></div>`;
  document.querySelector("#kpi-grid").innerHTML = items.map(x => `<div class="kpi ${x[3]}"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div>`).join("");
  renderStaffingSummary();
  renderPlanSummary();
  const t = state.settings.times; document.querySelector("#event-strip").innerHTML = [[t.start,"開始"],[t.batch10,"バッチ追加"],[t.batch13,"バッチ追加"],[t.alert,"警戒ライン"]].map(x => `<span class="event"><strong>${x[0]}</strong> ${x[1]}</span>`).join("");
  const packing = calculatePlannedPackingRows();
  renderPackingTable("#packing-summary-body", false); renderChart(m.ideal, m.actual, { currentMinute: isFiniteNumber(m.currentMinute) ? m.currentMinute : timeToMinutes(state.dailyInput.currentTime), finishMinute: m.finish, packing });
}
function renderPickTable() {
  const totals = getPickTotals();
  const allocation = calculatePickingStaffAllocation();
  const allocationByKey = Object.fromEntries(allocation.rows.map(row => [row.key, row]));
  const rows = PICK_KEYS.map(k => { const r = totals.rows[k], provisional = k !== "total"; return `<tr><td><strong>${PICK_NAMES[k]}</strong>${provisional ? ' <span class="tag provisional">暫定値</span>' : ""}</td><td class="number">${formatNumber(state.settings.picking[k],1)} 件/人時</td>${["batch6","batch10","batch13"].map(f => `<td class="input-cell">${input(`dailyInput.picks.${k}.${f}`,state.dailyInput.picks[k][f],{min:0,step:"1",label:`${PICK_NAMES[k]} ${f}`})}</td>`).join("")}<td class="number">${formatNumber(r.total)} 件</td><td class="number">${r.hours === null ? "－" : `${formatNumber(r.hours,2)} 人時`}</td></tr>`; }).join("");
  document.querySelector("#pick-table-body").innerHTML = rows + `<tr class="total"><td colspan="5">合計</td><td class="number">${formatNumber(totals.totalCount)} 件</td><td class="number">${totals.totalHours === null ? "－" : `${formatNumber(totals.totalHours,2)} 人時`}</td></tr>`;
  const avg = calculateAverageProductivity(totals); document.querySelector("#pick-metrics").innerHTML = `<div class="mini-metric"><span>全体標準作業量</span><strong>${totals.totalHours === null ? "－" : `${formatNumber(totals.totalHours,2)} 人時`}</strong></div><div class="mini-metric"><span>構成反映平均生産性</span><strong>${avg === null ? "－" : `${formatNumber(avg,1)} 件/人時`}</strong></div><div class="mini-metric"><span>現在ピッキング可能人数</span><strong>${allocation.totalPeople === null ? "－" : `${allocation.totalPeople}人`}</strong></div>`;
  const actuals = getContiguousActuals(); const latest = actuals.at(-1)?.source;
  document.querySelector("#pick-cards").innerHTML = PICK_KEYS.map(k => `<div class="card process-card"><h3>${PICK_NAMES[k]}</h3><div class="process-data"><div><span>当日対象</span><strong>${formatNumber(totals.rows[k].total)}件</strong></div><div><span>最新実績</span><strong>${latest?.breakdown?.[k] != null ? `${formatNumber(valueOrNull(latest.breakdown[k]))}件` : latest ? "内訳なし" : "実績未入力"}</strong></div><div><span>生産性</span><strong>${formatNumber(state.settings.picking[k],1)}</strong></div><div><span>当日総作業量</span><strong>${formatNumber(totals.rows[k].hours,2)}人時</strong></div><div><span>現在対象作業量</span><strong>${allocation.status === "ready" ? `${formatNumber(allocationByKey[k].workHours,2)}人時` : "－"}</strong></div><div><span>目安人数</span><strong>${allocation.status === "ready" ? `${allocationByKey[k].people}人` : "－"}</strong></div></div></div>`).join("");
}
function packingStatus(line) { const now = timeToMinutes(state.dailyInput.currentTime), deadline = timeToMinutes(line.deadline); if (line.count === null || now === null) return "未判定"; if (line.effectiveCapacity === null || line.latestStartMinutes === null || deadline === null) return "算出不可"; if (now < Math.floor(line.latestStartMinutes)) return "開始前"; if (now <= deadline) return "開始期限到来"; return "締切超過"; }
function formatPlannedPackingFinish(finish, status) {
  if (status === "算出不可" || status === "期限内未達" || status === "対象なし") return status;
  return isFiniteNumber(finish) ? minutesToTime(finish) : "算出不可";
}
function renderPackingTable(selector, detail) {
  const buffer = valueOrNull(state.dailyInput.bufferMinutes); const rows = calculatePlannedPackingRows();
  document.querySelector(selector).innerHTML = rows.map(x => { const status = x.planStatus, share = `<td class="number">${formatNumber(x.normalizedShare * 100,2)}%</td>`, count = `<td class="number approx">${x.count === null ? "－" : `${formatNumber(x.count)} 件${x.estimated ? "（概算）" : "（確定）"}`}</td>`; return `<tr><td><strong>${x.name}</strong>${x.id === "manual" ? ' <span class="tag provisional">配送区分注意</span>' : ""}</td>${detail ? share + count : count + share}<td class="number">${x.effectiveCapacity === null ? "算出不可" : `${formatNumber(x.effectiveCapacity)} 件/時`}</td><td>${x.people === null ? "未入力" : x.id === "manual" ? `${x.people}人` : `${x.people}人（固定）`}</td><td>${x.deadline}</td>${detail ? `<td>${buffer === null ? "未入力" : `${buffer}分`}</td><td>${formatPlannedPackingFinish(x.finish, x.planStatus)}</td>` : ""}<td class="approx">${x.latestStartMinutes === null ? "算出不可" : minutesToDeadlineTime(x.latestStartMinutes)}</td><td><span class="status ${statusClass(status)}">${status}</span></td></tr>`; }).join("");
}
function renderPackingDetail() { renderPackingTable("#packing-detail-body", true); const outsourced = valueOrNull(state.dailyInput.outsourced); document.querySelector("#packing-notice").textContent = outsourced === null ? "外部委託件数が未入力のため、社内梱包対象件数と概算値は確定できません。" : "梱包完了時刻は計画上の完了見込みです。計画開始時点から入力条件でシミュレーションしており、現時点のピッキング・梱包実績を反映した再予測ではありません。表示件数・開始リミット時刻も確定実績ではありません。"; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function renderPlanSummary() {
  const { model, evaluation } = getPackingPlan();
  let displayStatus = evaluation.status;
  let title = evaluation.status === "feasible" ? "計画成立：入力条件のモデル上、梱包期限内完了が可能" : evaluation.status === "infeasible" ? "計画不成立：現在の計画では期限内完了できません" : model.errors.length ? "判定不能：入力不足または不正な条件があります" : "要確認：未確定条件による概算判定です";
  const scenario = model.errors.length ? "必要進捗を算出できません。入力条件を確認してください。" : evaluation.status === "unknown" ? `仮定に基づく概算試算：${evaluation.scenarioStatus === "feasible" ? "期限内処理可能" : "計画不成立"}。確定した成立判定ではありません。` : "";
  const reasons = [...evaluation.reasons, ...evaluation.assumptions];
  const actual = getContiguousActuals().filter(row => row.minute <= model.current).at(-1);
  const requirement = getPackingPlan().displayed.find(point => point.minute === actual?.minute);
  if (requirement && actual.count + PLAN_EPSILON < requirement.count) {
    reasons.unshift("ピッキング実績が必要進捗に未達です。梱包先別の実供給・仕掛・梱包実績を確認してください。");
    displayStatus = evaluation.status === "unknown" ? "unknown" : "infeasible";
    title = displayStatus === "unknown" ? "要確認：ピッキング実績が概算必要進捗に未達" : "計画不成立：ピッキング実績が必要進捗に未達（モデル上）";
  }
  const lines = calculatePlannedPackingRows();
  const finishes = lines.filter(line => line.count > 0).map(line => line.finish);
  const finish = finishes.length && finishes.every(isFiniteNumber) ? Math.max(...finishes) : null;
  const finishStatus = model.errors.length ? "算出不可" : lines.every(line => line.count === 0) ? "対象なし" : lines.some(line => line.planStatus === "期限内未達") ? "期限内未達" : "計画内完了";
  const pastLatest = lines.some(line => line.count > 0 && line.latestStartMinutes !== null && model.current > line.latestStartMinutes);
  if (pastLatest) reasons.push("開始リミットを過ぎたラインがあります。実稼働・梱包実績は未取得のため、実際の残処理量・完了は未確認です。");
  const box = document.querySelector("#plan-summary");
  box.className = `plan-summary ${displayStatus === "feasible" ? "good" : displayStatus === "infeasible" ? "bad" : "warn"}`;
  box.innerHTML = `<strong>${title}</strong>${scenario ? `<p>${scenario}</p>` : ""}${reasons.length ? `<p>${escapeHtml(reasons[0])}</p><details><summary>判定根拠と未確定条件（${reasons.length}件）</summary><ul>${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></details>` : ""}<p>計画上の梱包完了見込み：${formatPlannedPackingFinish(finish, finishStatus)}　｜　出荷引渡し期限：ゆうパケット ${escapeHtml(state.settings.times.packetDeadline)}／ゆうパック等 ${escapeHtml(state.settings.times.parcelDeadline)}</p><small>計画開始時点から入力条件でシミュレーションした結果です。現時点のピッキング・梱包実績を反映した再予測ではありません。対象は到来済みバッチです（未来バッチは未反映）。理想線の達成だけで実際の完了を保証しません。ライン別供給はバッチ内構成比のモデルです。稼働は仕掛到着後、期限順で人員を配置します。配置の最適化・注文単位の実対応・梱包実績連携は未対応です。</small>`;
}
function calculatePlannedPackingRows() {
  const { model, feasible } = getPackingPlan();
  const shares = sum(model.lines.map(line => Number(line.share)));
  return state.settings.packing.map(master => {
    const line = model.lines.find(line => line.id === master.id);
    const jobs = model.jobs.filter(job => job.lineId === master.id);
    const count = model.errors.length ? null : sum(jobs.map(job => job.count));
    const deadlines = [...new Set(jobs.map(job => job.deadline))].sort((a, b) => a - b);
    let latest = null;
    if (count > 0) {
      // Latest crew start must satisfy every shared-line deadline, including
      // packet and parcel hand packing; it is not proof of available supply.
      const candidates = deadlines.map(deadline => {
        const due = sum(jobs.filter(job => job.deadline <= deadline).map(job => job.count));
        let capacity = 0;
        for (let minute = deadline - 1; minute >= model.times[0]; minute--) {
          capacity += calculatePackingCapacity(line, minute, model, state) / 60;
          if (capacity + PLAN_EPSILON >= due) return minute;
        }
        return null;
      });
      if (candidates.every(isFiniteNumber)) latest = Math.min(...candidates);
    }
    const point = feasible.points.find(point => point.minute === model.current);
    const people = master.id === "manual" ? calculateStaffingCapacity(model.current, model, state).manual : master.people;
    const effectiveCapacity = line && !model.errors.length ? calculatePackingCapacity({ ...line, start: model.times[0] }, model.current, model, state) : null;
    const stats = feasible.lines.find(stats => stats.id === master.id);
    const complete = count === 0 || (jobs.length > 0 && feasible.jobs.filter(job => job.lineId === master.id).every(job => job.finishedAt !== null));
    const finish = complete && count > 0 ? Math.max(...feasible.jobs.filter(job => job.lineId === master.id).map(job => job.finishedAt)) : null;
    return { ...master, count, people, effectiveCapacity, hours: effectiveCapacity > 0 && count !== null ? count / effectiveCapacity : null,
      normalizedShare: shares > 0 ? master.share / shares : null, latestStartMinutes: latest, finish,
      deadline: jobs.length ? deadlines.map(deadline => minutesToTime(deadline + Number(state.dailyInput.bufferMinutes))).join("／") : master.deadlineType === "packet" ? state.settings.times.packetDeadline : state.settings.times.parcelDeadline,
      estimated: jobs.some(job => job.estimated), planStatus: model.errors.length ? "算出不可" : count === 0 ? "対象なし" : complete ? "計画内完了" : "期限内未達",
      firstStart: stats?.firstStart ?? null, simulatedPeople: point?.activeLines.includes(master.id) ? people : 0 };
  });
}
function renderPlanSettings() {
  const plan = mergePackingPlan(state.dailyInput.packingPlan);
  state.dailyInput.packingPlan = plan;
  const periods = [["before10", "10時前"], ["before13", "10～13時"], ["after13", "13時以降"]];
  const periodRows = periods.map(([key, label]) => `<tr><td>${label}</td><td>${input(`dailyInput.packingPlan.otherPeople.${key}`, plan.otherPeople[key], { min: 0, step: 1, label: `${label} その他拘束人数` })}</td><td>${input(`dailyInput.packingPlan.manualPeople.${key}`, plan.manualPeople[key], { min: 0, max: 30, step: 1, label: `${label} 手梱包人数` })}</td></tr>`).join("");
  const lineRows = state.settings.packing.map(line => {
    const row = plan.lines[line.id], prefix = `dailyInput.packingPlan.lines.${line.id}`;
    return `<tr><td>${line.name}</td><td>${input(`${prefix}.availableFrom`, row.availableFrom, { type: "time", step: 60, label: `${line.name} 開始可能時刻` })}</td><td>${input(`${prefix}.initialWip`, row.initialWip, { min: 0, step: 1, label: `${line.name} 初期仕掛` })}</td>${PLAN_BATCHES.map(field => `<td>${input(`${prefix}.confirmed.${field}`, row.confirmed[field], { min: 0, step: 1, label: `${line.name} ${field} 確定件数` })}</td>`).join("")}</tr>`;
  }).join("");
  document.querySelector("#plan-settings").innerHTML = `<div class="table-scroll"><table><thead><tr><th>時間帯</th><th>その他拘束人数（梱包以外）</th><th>手梱包人数（空欄は当日人数を継承）</th></tr></thead><tbody>${periodRows}</tbody></table></div><p class="planning-note">共通投入可能総人数には梱包要員を含めてください。その他拘束人数へ梱包要員を再入力すると二重控除になります。</p><div class="table-scroll"><table><thead><tr><th>ライン</th><th>稼働開始可能時刻</th><th>開始時の仕掛（件）</th><th>6時確定件数</th><th>10時確定件数</th><th>13時確定件数</th></tr></thead><tbody>${lineRows}</tbody></table></div><p class="planning-note">確定件数はバッチ別の社内梱包対象です。空欄のラインにのみ残件数を概算配分します。「0」は確定0件です。初期仕掛は別の注文として加算しません。</p><div class="form-grid">${PLAN_BATCHES.map((field, index) => `<div class="field"><label>${[6, 10, 13][index]}時バッチ 手梱包ゆうパケット件数</label>${input(`dailyInput.packingPlan.manualPacket.${field}`, plan.manualPacket[field], { min: 0, step: 1, label: `${field} 手梱包ゆうパケット件数` })}<small>残りはゆうパック等。空欄は配送区分未確定。</small></div>`).join("")}</div><p class="planning-note">変更時には現在時刻より前の理想線を保存します。当日データのクリアで理想履歴も消去します。</p>`;
}
function renderSettings() {
  const daily = [["現在時刻","currentTime","理想進捗・期限判定の基準（10分単位・秒入力不可）", "time"],["外部委託件数","outsourced","件"],["出荷前バッファ","bufferMinutes","分（当日設定）"],["手梱包当日投入人数","manualPeople","人（0～30）"],["09:30～10:00 投入可能総人数","staffing.before10","人"],["10:00～13:00 投入可能総人数","staffing.before13","人"],["13:00以降 投入可能総人数","staffing.after13","人"]];
  document.querySelector("#daily-fields").innerHTML = daily.map(([label,key,note,type]) => { const path = `dailyInput.${key}`, val = key.includes(".") ? key.split(".").reduce((o,k)=>o[k],state.dailyInput) : state.dailyInput[key]; const control = type === "time" ? `<select data-path="${path}" aria-label="${label}"${state.dailyInput.autoCurrentTime ? " disabled" : ""}>${buildTenMinuteTimeOptions(val)}</select>` : input(path,val,{min:0,max:key==="manualPeople"?30:undefined,step:1,label}); return `<div class="field"><label>${label}</label>${control}<small>${note}・空欄は未入力</small></div>`; }).join("");
  const times = [["ピッキング開始","start"],["10時バッチ","batch10"],["13時バッチ","batch13"],["13時前主要作業目標（参考設定）","primaryGoal"],["ピッキング警戒ライン","alert"],["ゆうパケット締切","packetDeadline"],["ゆうパック等締切","parcelDeadline"]];
  document.querySelector("#time-fields").innerHTML = times.map(([label,key]) => `<div class="field"><label>${label}</label>${input(`settings.times.${key}`,state.settings.times[key],{type:"time",step:60,label})}</div>`).join("") + `<div class="field"><label>許容遅れ（分）</label>${input("settings.toleranceMinutes",state.settings.toleranceMinutes,{min:0,step:1})}</div><div class="field"><label>直近速度参照（分）</label>${input("settings.recentWindowMinutes",state.settings.recentWindowMinutes,{min:10,step:10})}</div>`;
  renderActualTable(); renderMasterTable(); renderPlanSettings();
}
function renderActualTable() { document.querySelector("#actual-table-body").innerHTML = state.actuals.length ? state.actuals.map((r,i) => `<tr><td class="input-cell"><select data-actual="${i}.time" aria-label="実績時刻">${buildTenMinuteTimeOptions(r.time)}</select></td><td class="input-cell"><input type="number" min="0" step="1" value="${r.totalCompleted??""}" data-actual="${i}.totalCompleted" aria-label="累計実績件数"></td><td><button class="btn icon" data-remove-actual="${i}">削除</button></td></tr>`).join("") : `<tr><td colspan="3" class="muted">実績は未入力です。「行を追加」から入力してください。</td></tr>`; }
function renderMasterTable() {
  const picks = PICK_KEYS.map(k => `<tr><td>ピッキング</td><td>${PICK_NAMES[k]}${k!=="total"?' <span class="tag provisional">暫定値</span>':""}</td><td class="input-cell">${input(`settings.picking.${k}`,state.settings.picking[k],{min:.1,step:"0.1"})}</td><td>－</td><td>－</td><td>${k!=="total"?"共通暫定値":"標準値"}</td></tr>`).join("");
  const packing = state.settings.packing.map((x,i) => `<tr><td>梱包</td><td>${x.name}</td><td class="input-cell">${input(`settings.packing.${i}.capacity`,x.capacity,{min:.1,step:"0.1"})}</td><td>${x.id==="manual"?"当日入力（最大30）":`${x.people}人（固定）`}</td><td class="input-cell">${input(`settings.packing.${i}.share`,x.share,{min:0,step:"0.1"})}</td><td>${x.id==="manual"?"％":"％"}</td></tr>`).join(""); document.querySelector("#master-table-body").innerHTML = picks + packing;
}
function getTimeValidationMessages() {
  const messages = [], start = timeToMinutes(state.settings.times.start), now = timeToMinutes(state.dailyInput.currentTime);
  if (now !== null && start !== null && now >= start && (now - start) % 10 !== 0) messages.push("現在時刻はピッキング開始時刻から10分刻みで入力してください。");
  const entered = state.actuals.map((row, index) => ({ index, minute: timeToMinutes(row.time) })).filter(row => row.minute !== null);
  const frequencies = new Map(); entered.forEach(row => frequencies.set(row.minute, (frequencies.get(row.minute) || 0) + 1));
  if ([...frequencies.values()].some(count => count > 1)) messages.push("同一時刻の実績が重複しています。");
  for (let i = 1; i < entered.length; i += 1) if (entered[i].minute < entered[i - 1].minute) messages.push(`${entered[i].index + 1}行目の実績時刻は前行より後の時刻を入力してください。`);
  return messages;
}
function renderValidationMessages() {
  const messages = getTimeValidationMessages(); document.querySelectorAll("input:invalid").forEach(el => messages.push(`${el.getAttribute("aria-label") || "入力値"}を確認してください。`));
  const rawActuals = calculateActualProgress(), actuals = rawActuals.filter(x => x.valid); for (let i=1;i<actuals.length;i++) if (actuals[i].count < actuals[i-1].count) messages.push(`${minutesToTime(actuals[i].minute)}の累計実績が前時刻より減少しています。`);
  const actualStart = timeToMinutes(state.settings.times.start);
  rawActuals.forEach((row, index) => { if (row.source.time && row.minute !== null && actualStart !== null && (row.minute < actualStart || (row.minute - actualStart) % 10 !== 0)) messages.push(`${index + 1}行目の実績時刻はピッキング開始から10分刻みで入力してください。`); });
  const totals=getPickTotals(); if(totals.totalCount!==null) actuals.forEach(x=>{if(x.count>totals.totalCount*1.2) messages.push(`${minutesToTime(x.minute)}の実績が当日対象件数を20%以上超えています。`);});
  if(validNonNegative(state.dailyInput.outsourced)!==null&&totals.totalCount!==null&&Number(state.dailyInput.outsourced)>totals.totalCount) messages.push("外部委託件数が当日対象件数を超えています。");
  const start=timeToMinutes(state.settings.times.start),t10=timeToMinutes(state.settings.times.batch10),t13=timeToMinutes(state.settings.times.batch13),packet=timeToMinutes(state.settings.times.packetDeadline),parcel=timeToMinutes(state.settings.times.parcelDeadline),now=timeToMinutes(state.dailyInput.currentTime);
  if(start!==null&&t10!==null&&t13!==null&&!(start<t10&&t10<t13)) messages.push("時刻設定は、ピッキング開始 < 10時バッチ < 13時バッチとしてください。");
  if(start!==null&&((packet!==null&&packet<=start)||(parcel!==null&&parcel<=start))) messages.push("配送締切はピッキング開始より後に設定してください。");
  if(now!==null&&start!==null&&now<start) messages.push("現在時刻はピッキング開始以降に設定してください。");
  if(now!==null&&actuals.some(x=>x.minute>now)) messages.push("現在時刻より未来の実績は進捗計算対象外です。");
  const box=document.querySelector("#validation"); box.innerHTML=messages.length?`<strong>入力内容を確認してください</strong><ul>${[...new Set(messages)].map(m=>`<li>${m}</li>`).join("")}</ul>`:""; box.classList.toggle("show",messages.length>0);
}
function truncateAtFirstMissing(points) { const missing = points.findIndex(point => point.count === null); return points.slice(0, missing < 0 ? points.length : missing); }
function getChartMarkers({ currentMinute, finishMinute, packing = [] } = {}) {
  const markers = packing.filter(line => line.count > 0 && isFiniteNumber(line.latestStartMinutes)).map(line => ({ type: "packing", minute: line.latestStartMinutes, label: `${line.name} 開始リミット ${minutesToDeadlineTime(line.latestStartMinutes)}`, isPast: isFiniteNumber(currentMinute) && line.latestStartMinutes <= currentMinute }));
  if (isFiniteNumber(finishMinute)) markers.push({ type: "finish", minute: finishMinute, label: `ピッキング終了見込み ${minutesToTime(finishMinute)}` });
  if (isFiniteNumber(currentMinute)) markers.push({ type: "current", minute: currentMinute, label: `現在 ${minutesToTime(currentMinute)}` });
  return markers;
}
function getChartTimeRange({ startMinute, alertMinute, currentMinute, latestActualMinute, finishMinute, packing = [] }) {
  const start = isFiniteNumber(startMinute) ? startMinute : 570;
  // 入力ミスで描画領域が無制限に広がらないよう、開始から12時間以内に制限する。
  const limit = Math.min(1439, start + 12 * 60);
  const packingMinutes = packing.filter(line => line.count > 0 && isFiniteNumber(line.latestStartMinutes)).map(line => line.latestStartMinutes);
  const candidates = [alertMinute, currentMinute, latestActualMinute, finishMinute, ...packingMinutes].filter(value => isFiniteNumber(value) && value >= start && value <= limit);
  const lastEvent = Math.max(start + 15, ...candidates);
  return { start, end: Math.min(limit, Math.max(start + 30, lastEvent + 15)) };
}
function markerLabelFont(marker) { return marker.type === "finish" ? "bold 11px sans-serif" : "11px sans-serif"; }
function markerLabelPosition(ctx, marker, markerX, left, right) {
  ctx.font = markerLabelFont(marker);
  const boxWidth = ctx.measureText(marker.label).width + 8;
  let labelX = markerX + 5;
  if (labelX + boxWidth > right) labelX = markerX - boxWidth - 5;
  return { labelX: Math.max(left, Math.min(labelX, right - boxWidth)), boxWidth };
}
function calculateMarkerLabelLayout(ctx, markers, markerX, left, right, options = {}) {
  const laneGap = options.laneGap ?? 6;
  const firstLabelY = options.firstLabelY || 18, laneHeight = options.laneHeight || 21;
  const priority = { current: 0, finish: 1, packing: 2 };
  const placed = [], laneRects = [];
  [...markers].sort((a, b) => (priority[a.type] ?? 3) - (priority[b.type] ?? 3) || markerX(a) - markerX(b)).forEach(marker => {
    const x = markerX(marker), { labelX, boxWidth } = markerLabelPosition(ctx, marker, x, left, right);
    let selectedLane = 0, rect;
    while (true) {
      if (!laneRects[selectedLane]) laneRects[selectedLane] = [];
      const lane = selectedLane;
      const labelY = firstLabelY + lane * laneHeight;
      const candidate = { left: labelX, right: labelX + boxWidth, top: labelY - 11, bottom: labelY + 4 };
      const overlaps = laneRects[lane].some(existing => candidate.left < existing.right + laneGap && candidate.right + laneGap > existing.left && candidate.top < existing.bottom + laneGap && candidate.bottom + laneGap > existing.top);
      if (!overlaps) { rect = candidate; break; }
      selectedLane += 1;
    }
    laneRects[selectedLane].push(rect);
    placed.push({ marker, markerX: x, labelX, labelY: firstLabelY + selectedLane * laneHeight, lane: selectedLane, rect });
  });
  return placed;
}
function drawMarkerLabel(ctx, marker, labelX, labelY) {
  ctx.font = markerLabelFont(marker);
  const textWidth = ctx.measureText(marker.label).width, boxWidth = textWidth + 8;
  ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillRect(labelX, labelY - 11, boxWidth, 15);
  ctx.fillStyle = marker.type === "current" ? "#667789" : marker.type === "finish" ? "#18354d" : marker.isPast ? "#7a6950" : "#765900";
  ctx.fillText(marker.label, labelX + 4, labelY);
}
function drawVerticalMarker(ctx, marker, markerX, top, bottom, labelX, labelY) {
  ctx.save(); ctx.beginPath(); ctx.moveTo(markerX, top); ctx.lineTo(markerX, bottom);
  if (marker.type === "packing") { ctx.strokeStyle = marker.isPast ? "#a9a39a" : "#b39600"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); }
  else if (marker.type === "finish") { ctx.strokeStyle = "#18354d"; ctx.lineWidth = 2.5; ctx.setLineDash([]); }
  else { ctx.strokeStyle = "#8b98a3"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); }
  ctx.stroke(); ctx.restore(); drawMarkerLabel(ctx, marker, labelX, labelY);
}
function appendActualRow() {
  if (state.dailyInput.autoCurrentTime === true) {
    const time = state.dailyInput.currentTime;
    if (!time) return false;
    const existingIndex = state.actuals.findIndex(row => row.time === time);
    if (existingIndex >= 0) {
      document.querySelector(`[data-actual="${existingIndex}.totalCompleted"]`)?.focus?.();
      return false;
    }
    if (state.actuals.some(row => !row.time || row.totalCompleted === "" || row.totalCompleted === null || row.totalCompleted === undefined)) return false;
    const actuals = calculateActualProgress();
    if (actuals.some(row => !row.valid)) return false;
    const currentMinute = timeToMinutes(time), lastMinute = actuals.at(-1)?.minute;
    if (currentMinute === null || (lastMinute !== undefined && currentMinute <= lastMinute)) return false;
    state.actuals.push({time,totalCompleted:"",breakdown:null});
    return true;
  }
  if (state.actuals.some(row => !row.time || row.totalCompleted === "" || row.totalCompleted === null || row.totalCompleted === undefined)) return false;
  const actuals = calculateActualProgress();
  if (actuals.some(row => !row.valid)) return false;
  const lastMinute = actuals.at(-1)?.minute, nextMinute = lastMinute === undefined ? timeToMinutes(state.settings.times.start) : lastMinute + 10;
  if (nextMinute === null || nextMinute >= 1440) return false;
  state.actuals.push({time:minutesToTime(nextMinute),totalCompleted:"",breakdown:null});
  return true;
}
function renderChart(ideal, actual, chartData = {}) {
  const canvas=document.querySelector("#progress-chart"), dpr=window.devicePixelRatio||1, width=canvas.clientWidth||1100, height=340; canvas.width=width*dpr; canvas.height=height*dpr; const ctx=canvas.getContext("2d"); ctx.scale(dpr,dpr); ctx.clearRect(0,0,width,height);
  const configuredStart=timeToMinutes(state.settings.times.start), latestActual=Math.max(isFiniteNumber(configuredStart)?configuredStart:570,...actual.filter(p=>p.count!==null&&isFiniteNumber(p.minute)).map(p=>p.minute));
  const chartRange=getChartTimeRange({startMinute:configuredStart,alertMinute:timeToMinutes(state.settings.times.alert),currentMinute:chartData.currentMinute,latestActualMinute:latestActual,finishMinute:chartData.finishMinute,packing:chartData.packing}); const start=chartRange.start,end=Math.max(chartRange.end,ideal.at(-1)?.minute||chartRange.end); const valid=[...ideal.map(x=>x.count),...actual.map(x=>x.count)].filter(isFiniteNumber); const max=Math.max(100,...valid)*1.1; const pad={l:62,r:18,t:82,b:42},x=m=>pad.l+(m-start)/(end-start)*(width-pad.l-pad.r);
  const markers=getChartMarkers(chartData).filter(marker=>marker.minute>=start&&marker.minute<=end), markerLayout=calculateMarkerLabelLayout(ctx,markers,marker=>x(marker.minute),pad.l,width-pad.r);
  const usedLanes=markerLayout.length?Math.max(...markerLayout.map(item=>item.lane))+1:0; pad.t=Math.max(pad.t,usedLanes?18+(usedLanes-1)*21+19:0); const y=v=>height-pad.b-v/max*(height-pad.t-pad.b);
  ctx.font="11px sans-serif"; ctx.fillStyle="#71808d"; ctx.strokeStyle="#e2e7eb"; for(let i=0;i<=4;i++){const val=max*i/4,yy=y(val);ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(width-pad.r,yy);ctx.stroke();ctx.fillText(formatNumber(val),8,yy+4)}
  [start,timeToMinutes(state.settings.times.batch10),timeToMinutes(state.settings.times.batch13),timeToMinutes(state.settings.times.alert),end].filter(isFiniteNumber).forEach(m=>{ctx.fillText(minutesToTime(m),x(m)-16,height-15)});
  markerLayout.forEach(item=>drawVerticalMarker(ctx,item.marker,item.markerX,pad.t-8,height-pad.b,item.labelX,item.labelY));
  function line(points,color,stopAtMissing=false){const selected=points.filter(p=>p.minute>=start&&p.minute<=end), usable=stopAtMissing?truncateAtFirstMissing(selected):selected.filter(p=>p.count!==null);if(!usable.length)return;ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=3;usable.forEach((p,i)=>i?ctx.lineTo(x(p.minute),y(p.count)):ctx.moveTo(x(p.minute),y(p.count)));ctx.stroke()}
  line(ideal,"#2878bd"); line(actual,"#f47b20",true); if(!ideal.length){ctx.fillStyle="#667789";ctx.font="bold 15px sans-serif";ctx.textAlign="center";ctx.fillText("対象件数・配送締切・バッファを確認してください",width/2,height/2);ctx.textAlign="start"}
}
function renderHeaderControls(){const checkbox=document.querySelector("#auto-current-time");checkbox.checked=state.dailyInput.autoCurrentTime===true;document.querySelector("#auto-current-time-status").textContent=state.dailyInput.autoCurrentTime?`現在 ${state.dailyInput.currentTime||"－"}`:"現在時刻 手動";}
function renderAll(){renderHeaderControls();renderSummary();renderPickTable();renderPackingDetail();renderSettings();renderValidationMessages();bindDynamicInputs();}
function bindDynamicInputs(){document.querySelectorAll("[data-path]").forEach(el=>el.addEventListener("change",()=>{updateStatePath(el.dataset.path,el.value);saveState();renderAll()}));document.querySelectorAll("[data-actual]").forEach(el=>el.addEventListener("change",()=>{const [i,k]=el.dataset.actual.split(".");state.actuals[Number(i)][k]=el.value;saveState();renderAll()}));document.querySelectorAll("[data-remove-actual]").forEach(el=>el.addEventListener("click",()=>{state.actuals.splice(Number(el.dataset.removeActual),1);saveState();renderAll()}));}
document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>{document.querySelectorAll(".tab,.panel").forEach(x=>x.classList.remove("active"));tab.classList.add("active");document.querySelector(`#${tab.dataset.tab}`).classList.add("active");if(tab.dataset.tab==="summary")renderSummary()}));
document.querySelector("#add-actual").addEventListener("click",()=>{if(appendActualRow()){saveState();renderAll();}});
document.querySelector("#auto-current-time").addEventListener("change",event=>{state.dailyInput.autoCurrentTime=event.target.checked;if(event.target.checked)state.dailyInput.currentTime=getCurrentTenMinuteTime(new Date(),state.settings.times.start);saveState();renderAll();});
document.querySelector("#clear-daily").addEventListener("click",resetDailyData); document.querySelector("#reset-all").addEventListener("click",resetAll); window.addEventListener("resize",()=>renderSummary());
window.addEventListener("focus",()=>syncCurrentTime());
document.addEventListener("visibilitychange",()=>{if(!document.hidden)syncCurrentTime();});
setInterval(()=>syncCurrentTime(),45000);
if(state.updatedAt) document.querySelector("#saved-at").textContent=new Date(state.updatedAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
if(state.dailyInput.autoCurrentTime) saveState();
renderAll();
