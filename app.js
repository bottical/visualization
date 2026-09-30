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
  return { version: 1, settings: clone(MASTER_DEFAULTS), dailyInput: { picks: emptyPicks(), staffing: { before10: "", before13: "", after13: "" }, currentTime: "", outsourced: "", bufferMinutes: "", manualPeople: "" }, actuals: [], updatedAt: "" };
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
    dailyInput: { ...base.dailyInput, ...(raw.dailyInput || {}), picks: { ...base.dailyInput.picks, ...(raw.dailyInput?.picks || {}) }, staffing: { ...base.dailyInput.staffing, ...(raw.dailyInput?.staffing || {}) } },
    actuals: Array.isArray(raw.actuals) ? raw.actuals.map(row => ({ time: normalizeTimeValue(row.time), totalCompleted: row.totalCompleted ?? (PICK_KEYS.every(k => row[k] !== "" && row[k] != null) ? PICK_KEYS.reduce((total, k) => total + Number(row[k]), 0) : ""), breakdown: row.breakdown || null })) : []
  };
  merged.dailyInput.currentTime = normalizeTimeValue(merged.dailyInput.currentTime);
  Object.keys(merged.settings.times).forEach(key => { merged.settings.times[key] = normalizeTimeValue(merged.settings.times[key]); });
  return merged;
}
function loadState() { try { return mergeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch (_) { return defaultState(); } }
let state = loadState();
function normalizeStateTimes() { state.dailyInput.currentTime = normalizeTimeValue(state.dailyInput.currentTime); Object.keys(state.settings.times).forEach(key => { state.settings.times[key] = normalizeTimeValue(state.settings.times[key]); }); state.actuals.forEach(row => { row.time = normalizeTimeValue(row.time); }); }
function saveState() { normalizeStateTimes(); state.updatedAt = new Date().toISOString(); try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* storage unavailable: UI remains usable */ } document.querySelector("#saved-at").textContent = new Date(state.updatedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function resetDailyData() { if (!confirm("当日の件数・人数・実績をクリアします。マスター値は維持されます。よろしいですか？")) return; state.dailyInput = defaultState().dailyInput; state.actuals = []; saveState(); renderAll(); }
function resetAll() { if (!confirm("保存内容をすべて削除し、標準マスターへ戻します。よろしいですか？")) return; localStorage.removeItem(STORAGE_KEY); state = defaultState(); saveState(); renderAll(); }

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
function getReleasedPickTotal(minute) {
  const t10 = timeToMinutes(state.settings.times.batch10), t13 = timeToMinutes(state.settings.times.batch13);
  if (![minute, t10, t13].every(isFiniteNumber)) return null;
  const fields = minute < t10 ? ["batch6"] : minute < t13 ? ["batch6", "batch10"] : ["batch6", "batch10", "batch13"];
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
function calculateIdealProgress() {
  const start = timeToMinutes(state.settings.times.start), t10 = timeToMinutes(state.settings.times.batch10), t13 = timeToMinutes(state.settings.times.batch13), current = timeToMinutes(state.dailyInput.currentTime);
  if ([start, t10, t13, current].some(v => v === null) || !(start < t10 && t10 < t13) || current < start || (current - start) % 10 !== 0) return [];
  const requiredFields = current < t10 ? ["batch6"] : current < t13 ? ["batch6", "batch10"] : ["batch6", "batch10", "batch13"];
  if (!requiredFields.every(allBatchEntered)) return [];
  const releasedTotal = getReleasedPickTotal(current); if (releasedTotal === null) return [];
  const allocations = calculatePackingAllocation(releasedTotal);
  if (!isPackingScheduleReady(allocations)) return [];
  const points = [{ minute: start, hours: 0, count: 0, requiredSpeed: staffForMinute(start) }];
  let idealCount = 0, idealHours = 0;
  for (let minute = start; minute < current; minute += 10) {
    const nextMinute = Math.min(minute + 10, current);
    const activeFields = nextMinute < t10 ? ["batch6"] : nextMinute < t13 ? ["batch6", "batch10"] : ["batch6", "batch10", "batch13"];
    if (!activeFields.every(allBatchEntered)) break;
    const cumulative = Object.fromEntries(PICK_KEYS.map(k => [k, sum(activeFields.map(field => batchCounts(field)[k]))]));
    const targetCount = sum(Object.values(cumulative)), standardHours = calculateStandardHours(cumulative);
    const average = targetCount > 0 && standardHours > 0 ? targetCount / standardHours : 0;
    const staff = staffForMinute(nextMinute); if (staff === null) return [];
    // Excelの10分時系列表と同じく、対象構成・投入人数・梱包要員のすべてを「到達ポイント」の時刻で評価する。
    // 将来、1分単位またはイベント時刻単位へ細分化してもこの関数境界は維持できる。
    const pickPeople = Math.max(0, staff - packingPeopleAt(nextMinute, allocations));
    const nextCount = Math.min(targetCount, idealCount + pickPeople * average * (nextMinute - minute) / 60);
    idealHours += average > 0 ? (nextCount - idealCount) / average : 0; idealCount = nextCount;
    points.push({ minute: nextMinute, hours: idealHours, count: idealCount, requiredSpeed: pickPeople, averageProductivity: average });
  }
  return points;
}
function calculateIdealSpeedAt(minute) {
  const t10 = timeToMinutes(state.settings.times.batch10), t13 = timeToMinutes(state.settings.times.batch13);
  if (![minute, t10, t13].every(isFiniteNumber)) return null;
  const activeFields = minute < t10 ? ["batch6"] : minute < t13 ? ["batch6", "batch10"] : ["batch6", "batch10", "batch13"];
  if (!activeFields.every(allBatchEntered)) return null;
  const cumulative = Object.fromEntries(PICK_KEYS.map(k => [k, sum(activeFields.map(field => batchCounts(field)[k]))]));
  const totalCount = sum(Object.values(cumulative)), standardHours = calculateStandardHours(cumulative), staff = staffForMinute(minute);
  if (!(totalCount > 0 && standardHours > 0) || staff === null) return null;
  const releasedTotal = getReleasedPickTotal(minute); if (releasedTotal === null) return null;
  const allocations = calculatePackingAllocation(releasedTotal); if (!isPackingScheduleReady(allocations)) return null;
  return Math.max(0, staff - packingPeopleAt(minute, allocations)) * totalCount / standardHours;
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

function input(path, value, options = {}) { const type = options.type || "number"; const attrs = [`type="${type}"`, `value="${value ?? ""}"`, `data-path="${path}"`]; if (options.min !== undefined) attrs.push(`min="${options.min}"`); if (type === "number" && options.max !== undefined) attrs.push(`max="${options.max}"`); if (options.step !== undefined) attrs.push(`step="${options.step}"`); return `<input ${attrs.join(" ")} aria-label="${options.label || path}">`; }
function setPath(path, value) { const parts = path.split("."); let target = state; parts.slice(0, -1).forEach(p => { target = target[p]; }); target[parts.at(-1)] = value; }
function statusClass(status) { return ["完了", "先行", "順調", "開始前"].includes(status) ? "good" : ["遅延・回復中", "開始期限到来"].includes(status) ? "warn" : ["遅延拡大", "締切超過"].includes(status) ? "bad" : ""; }

function currentMetrics() {
  const totals = getPickTotals(), ideal = calculateIdealProgress(), actual = getContiguousActuals(), currentMinute = timeToMinutes(state.dailyInput.currentTime);
  const validActual = actual.filter(x => x.count !== null && currentMinute !== null && x.minute <= currentMinute), current = validActual.at(-1);
  if (!current || !ideal.length || currentMinute === null) return { totals, ideal, actual, status: "未判定" };
  const idealPoint = [...ideal].reverse().find(x => x.minute <= current.minute); if (!idealPoint) return { totals, ideal, actual, status: "未判定" };
  const recentSpeed = calculateRecentSpeed(validActual), idealSpeed = calculateIdealSpeedAt(current.minute);
  const status = judgeProgressStatus({ actualCount: current.count, idealCount: idealPoint.count, totalCount: totals.totalCount, recentSpeed, idealSpeed });
  return { totals, ideal, actual, current, currentMinute, idealPoint, recentSpeed, idealSpeed, status, diffCount: current.count - idealPoint.count, delay: calculateDelayMinutes(current.count, idealPoint.count, idealSpeed), finish: totals.totalCount === null ? null : calculateFinishEstimate(current.minute, current.count, totals.totalCount, recentSpeed), dataAge: currentMinute - current.minute };
}
function calculateCurrentStaffingSummary() {
  const currentMinute = timeToMinutes(state.dailyInput.currentTime), totalPeople = currentMinute === null ? null : staffForMinute(currentMinute);
  const allocations = calculatePackingAllocation();
  if (!isPackingScheduleReady(allocations)) return { totalPeople, packingPeople: null, pickingPeople: null, nextPackingStart: null, staffingStatus: null };
  const packingPeople = currentMinute === null ? null : packingPeopleAt(currentMinute, allocations);
  const pickingPeople = totalPeople === null || packingPeople === null ? null : Math.max(0, totalPeople - packingPeople);
  const futureStarts = currentMinute === null ? [] : allocations.map(line => line.latestStartMinutes === null ? null : Math.floor(line.latestStartMinutes)).filter(minute => minute !== null && minute > currentMinute);
  const nextPackingStart = futureStarts.length ? Math.min(...futureStarts) : null;
  const staffingStatus = totalPeople === null || packingPeople === null ? null : totalPeople >= packingPeople ? "充足" : "不足";
  return { totalPeople, packingPeople, pickingPeople, nextPackingStart, staffingStatus };
}
function renderStaffingSummary() {
  const { totalPeople, packingPeople, pickingPeople, nextPackingStart, staffingStatus } = calculateCurrentStaffingSummary();
  const items = [
    ["共通投入可能総人員", totalPeople === null ? "－" : `${formatNumber(totalPeople)}人`],
    ["梱包稼働要員", packingPeople === null ? "－" : `${formatNumber(packingPeople)}人`],
    ["ピッキング可能人数", pickingPeople === null ? "－" : `${formatNumber(pickingPeople)}人`],
    ["次の梱包開始", nextPackingStart === null ? "－" : minutesToDeadlineTime(nextPackingStart)],
    ["人員余力", staffingStatus === null ? `<span class="status">未判定</span>` : `<span class="status ${staffingStatus === "充足" ? "good" : "bad"}">${staffingStatus}</span>`]
  ];
  document.querySelector("#staffing-summary").innerHTML = items.map(([label, value]) => `<div class="staffing-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
}
function renderSummary() {
  const m = currentMetrics(); const ready = m.current && m.idealPoint; const pace = ready && m.recentSpeed !== null && m.idealSpeed > 0 ? m.recentSpeed / m.idealSpeed * 100 : null;
  const items = [
    ["現在状態", `<span class="status ${statusClass(m.status)}">${m.status}</span>`, "件数差・直近速度で判定", "highlight"],
    ["理想累計", ready ? `${formatNumber(m.idealPoint.count)}件` : "－", ready ? `理想速度 ${formatNumber(m.idealSpeed)} 件/時` : "入力待ち", ""],
    ["実績累計", ready ? `${formatNumber(m.current.count)}件` : "－", ready ? `最終実績 ${minutesToTime(m.current.minute)}` : "実績待ち", "actual-kpi"],
    ["差分", ready ? `${m.diffCount >= 0 ? "+" : ""}${formatNumber(m.diffCount)}件` : "－", "実績件数－理想件数", ""],
    ["遅れ時間", ready && m.delay !== null ? `${formatNumber(m.delay)}分` : "－", `許容 ${state.settings.toleranceMinutes}分`, ""],
    ["直近ペース", pace !== null ? `${formatNumber(pace)}%` : "－", m.recentSpeed !== null ? `${formatNumber(m.recentSpeed)} 件/時` : "算出不可", "actual-kpi"],
    ["終了見込み", m.finish !== null && m.finish !== undefined ? minutesToTime(m.finish) : "－", m.finish ? "直近速度から概算" : "算出不可", ""]
  ];
  document.querySelector("#progress-time-info").innerHTML = `<div class="mini-metric"><span>現在時刻</span><strong>${state.dailyInput.currentTime || "－"}</strong></div><div class="mini-metric"><span>実績最終更新</span><strong>${m.current ? minutesToTime(m.current.minute) : "－"}</strong></div><div class="mini-metric"><span>データ経過時間</span><strong>${isFiniteNumber(m.dataAge) ? `${m.dataAge}分` : "－"}</strong></div>`;
  document.querySelector("#kpi-grid").innerHTML = items.map(x => `<div class="kpi ${x[3]}"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div>`).join("");
  renderStaffingSummary();
  const t = state.settings.times; document.querySelector("#event-strip").innerHTML = [[t.start,"開始"],[t.batch10,"バッチ追加"],[t.batch13,"バッチ追加"],[t.alert,"警戒ライン"]].map(x => `<span class="event"><strong>${x[0]}</strong> ${x[1]}</span>`).join("");
  const packing = calculatePackingAllocation();
  renderPackingTable("#packing-summary-body", false); renderChart(m.ideal, m.actual, { currentMinute: isFiniteNumber(m.currentMinute) ? m.currentMinute : timeToMinutes(state.dailyInput.currentTime), finishMinute: m.finish, packing });
}
function renderPickTable() {
  const totals = getPickTotals();
  const rows = PICK_KEYS.map(k => { const r = totals.rows[k], provisional = k !== "total"; return `<tr><td><strong>${PICK_NAMES[k]}</strong>${provisional ? ' <span class="tag provisional">暫定値</span>' : ""}</td><td class="number">${formatNumber(state.settings.picking[k],1)} 件/人時</td>${["batch6","batch10","batch13"].map(f => `<td class="input-cell">${input(`dailyInput.picks.${k}.${f}`,state.dailyInput.picks[k][f],{min:0,step:"1",label:`${PICK_NAMES[k]} ${f}`})}</td>`).join("")}<td class="number">${formatNumber(r.total)} 件</td><td class="number">${r.hours === null ? "－" : `${formatNumber(r.hours,2)} 人時`}</td></tr>`; }).join("");
  document.querySelector("#pick-table-body").innerHTML = rows + `<tr class="total"><td colspan="5">合計</td><td class="number">${formatNumber(totals.totalCount)} 件</td><td class="number">${totals.totalHours === null ? "－" : `${formatNumber(totals.totalHours,2)} 人時`}</td></tr>`;
  const avg = calculateAverageProductivity(totals); document.querySelector("#pick-metrics").innerHTML = `<div class="mini-metric"><span>全体標準作業量</span><strong>${totals.totalHours === null ? "－" : `${formatNumber(totals.totalHours,2)} 人時`}</strong></div><div class="mini-metric"><span>構成反映平均生産性</span><strong>${avg === null ? "－" : `${formatNumber(avg,1)} 件/人時`}</strong></div>`;
  const actuals = getContiguousActuals(); const latest = actuals.at(-1)?.source;
  document.querySelector("#pick-cards").innerHTML = PICK_KEYS.map(k => `<div class="card process-card"><h3>${PICK_NAMES[k]}</h3><div class="process-data"><div><span>当日対象</span><strong>${formatNumber(totals.rows[k].total)}件</strong></div><div><span>最新実績</span><strong>${latest?.breakdown?.[k] != null ? `${formatNumber(valueOrNull(latest.breakdown[k]))}件` : latest ? "内訳なし" : "実績未入力"}</strong></div><div><span>生産性</span><strong>${formatNumber(state.settings.picking[k],1)}</strong></div><div><span>作業量</span><strong>${formatNumber(totals.rows[k].hours,2)}人時</strong></div></div></div>`).join("");
}
function packingStatus(line) { const now = timeToMinutes(state.dailyInput.currentTime), deadline = timeToMinutes(line.deadline); if (line.count === null || now === null) return "未判定"; if (line.effectiveCapacity === null || line.latestStartMinutes === null || deadline === null) return "算出不可"; if (now < Math.floor(line.latestStartMinutes)) return "開始前"; if (now <= deadline) return "開始期限到来"; return "締切超過"; }
function renderPackingTable(selector, detail) {
  const buffer = valueOrNull(state.dailyInput.bufferMinutes); const rows = calculatePackingAllocation();
  document.querySelector(selector).innerHTML = rows.map(x => { const status = packingStatus(x), share = `<td class="number">${formatNumber(x.normalizedShare * 100,2)}%</td>`, count = `<td class="number approx">${x.count === null ? "－" : `${formatNumber(x.count)} 件`}</td>`; return `<tr><td><strong>${x.name}</strong>${x.id === "manual" ? ' <span class="tag provisional">配送区分注意</span>' : ""}</td>${detail ? share + count : count + share}<td class="number">${x.effectiveCapacity === null ? "算出不可" : `${formatNumber(x.effectiveCapacity)} 件/時`}</td><td>${x.people === null ? "未入力" : x.id === "manual" ? `${x.people}人` : `${x.people}人（固定）`}</td><td>${x.deadline}${x.id === "manual" ? "※" : ""}</td>${detail ? `<td>${buffer === null ? "未入力" : `${buffer}分`}</td><td>${x.hours === null ? "算出不可" : `${formatNumber(x.hours*60)}分`}</td>` : ""}<td class="approx">${x.latestStartMinutes === null ? "算出不可" : minutesToDeadlineTime(x.latestStartMinutes)}</td><td><span class="status ${statusClass(status)}">${status}</span></td></tr>`; }).join("");
}
function renderPackingDetail() { renderPackingTable("#packing-detail-body", true); const outsourced = valueOrNull(state.dailyInput.outsourced); document.querySelector("#packing-notice").textContent = outsourced === null ? "外部委託件数が未入力のため、社内梱包対象件数と概算値は確定できません。" : "表示件数・開始リミット時刻は入力条件から算出した概算値です。確定実績ではありません。"; }
function renderSettings() {
  const daily = [["現在時刻","currentTime","理想進捗・期限判定の基準（10分単位・秒入力不可）", "time"],["外部委託件数","outsourced","件"],["出荷前バッファ","bufferMinutes","分（当日設定）"],["手梱包当日投入人数","manualPeople","人（0～30）"],["09:30～10:00 投入可能総人数","staffing.before10","人"],["10:00～13:00 投入可能総人数","staffing.before13","人"],["13:00以降 投入可能総人数","staffing.after13","人"]];
  document.querySelector("#daily-fields").innerHTML = daily.map(([label,key,note,type]) => { const path = `dailyInput.${key}`, val = key.includes(".") ? key.split(".").reduce((o,k)=>o[k],state.dailyInput) : state.dailyInput[key]; const control = type === "time" ? `<select data-path="${path}" aria-label="${label}">${buildTenMinuteTimeOptions(val)}</select>` : input(path,val,{min:0,max:key==="manualPeople"?30:undefined,step:1,label}); return `<div class="field"><label>${label}</label>${control}<small>${note}・空欄は未入力</small></div>`; }).join("");
  const times = [["ピッキング開始","start"],["10時バッチ","batch10"],["13時バッチ","batch13"],["13時前主要作業目標（参考設定）","primaryGoal"],["ピッキング警戒ライン","alert"],["ゆうパケット締切","packetDeadline"],["ゆうパック等締切","parcelDeadline"]];
  document.querySelector("#time-fields").innerHTML = times.map(([label,key]) => `<div class="field"><label>${label}</label>${input(`settings.times.${key}`,state.settings.times[key],{type:"time",step:60,label})}</div>`).join("") + `<div class="field"><label>許容遅れ（分）</label>${input("settings.toleranceMinutes",state.settings.toleranceMinutes,{min:0,step:1})}</div><div class="field"><label>直近速度参照（分）</label>${input("settings.recentWindowMinutes",state.settings.recentWindowMinutes,{min:10,step:10})}</div>`;
  renderActualTable(); renderMasterTable();
}
function renderActualTable() { document.querySelector("#actual-table-body").innerHTML = state.actuals.length ? state.actuals.map((r,i) => `<tr><td class="input-cell"><select data-actual="${i}.time" aria-label="実績時刻">${buildTenMinuteTimeOptions(r.time)}</select></td><td class="input-cell"><input type="number" min="0" step="1" value="${r.totalCompleted??""}" data-actual="${i}.totalCompleted" aria-label="累計実績件数"></td><td><button class="btn icon" data-remove-actual="${i}">削除</button></td></tr>`).join("") : `<tr><td colspan="3" class="muted">実績は未入力です。「行を追加」から入力してください。</td></tr>`; }
function renderMasterTable() {
  const picks = PICK_KEYS.map(k => `<tr><td>ピッキング</td><td>${PICK_NAMES[k]}${k!=="total"?' <span class="tag provisional">暫定値</span>':""}</td><td class="input-cell">${input(`settings.picking.${k}`,state.settings.picking[k],{min:.1,step:"0.1"})}</td><td>－</td><td>－</td><td>${k!=="total"?"共通暫定値":"標準値"}</td></tr>`).join("");
  const packing = state.settings.packing.map((x,i) => `<tr><td>梱包</td><td>${x.name}</td><td class="input-cell">${input(`settings.packing.${i}.capacity`,x.capacity,{min:.1,step:"0.1"})}</td><td>${x.id==="manual"?"当日入力（最大30）":`${x.people}人（固定）`}</td><td class="input-cell">${input(`settings.packing.${i}.share`,x.share,{min:0,step:"0.1"})}</td><td>${x.id==="manual"?"件/人時":"件/時"}</td></tr>`).join(""); document.querySelector("#master-table-body").innerHTML = picks + packing;
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
function drawMarkerLabel(ctx, marker, markerX, labelY, left, right) {
  ctx.font = marker.type === "finish" ? "bold 11px sans-serif" : "11px sans-serif";
  const textWidth = ctx.measureText(marker.label).width, boxWidth = textWidth + 8;
  let labelX = markerX + 5;
  if (labelX + boxWidth > right) labelX = markerX - boxWidth - 5;
  labelX = Math.max(left, Math.min(labelX, right - boxWidth));
  ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillRect(labelX, labelY - 11, boxWidth, 15);
  ctx.fillStyle = marker.type === "current" ? "#667789" : marker.type === "finish" ? "#18354d" : marker.isPast ? "#7a6950" : "#765900";
  ctx.fillText(marker.label, labelX + 4, labelY);
}
function drawVerticalMarker(ctx, marker, markerX, top, bottom, labelY, left, right) {
  ctx.save(); ctx.beginPath(); ctx.moveTo(markerX, top); ctx.lineTo(markerX, bottom);
  if (marker.type === "packing") { ctx.strokeStyle = marker.isPast ? "#a9a39a" : "#b39600"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); }
  else if (marker.type === "finish") { ctx.strokeStyle = "#18354d"; ctx.lineWidth = 2.5; ctx.setLineDash([]); }
  else { ctx.strokeStyle = "#8b98a3"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); }
  ctx.stroke(); ctx.restore(); drawMarkerLabel(ctx, marker, markerX, labelY, left, right);
}
function appendActualRow() {
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
  const {start,end}=getChartTimeRange({startMinute:configuredStart,alertMinute:timeToMinutes(state.settings.times.alert),currentMinute:chartData.currentMinute,latestActualMinute:latestActual,finishMinute:chartData.finishMinute,packing:chartData.packing}); const valid=[...ideal.map(x=>x.count),...actual.map(x=>x.count)].filter(isFiniteNumber); const max=Math.max(100,...valid)*1.1; const pad={l:62,r:18,t:82,b:42},x=m=>pad.l+(m-start)/(end-start)*(width-pad.l-pad.r),y=v=>height-pad.b-v/max*(height-pad.t-pad.b);
  ctx.font="11px sans-serif"; ctx.fillStyle="#71808d"; ctx.strokeStyle="#e2e7eb"; for(let i=0;i<=4;i++){const val=max*i/4,yy=y(val);ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(width-pad.r,yy);ctx.stroke();ctx.fillText(formatNumber(val),8,yy+4)}
  [start,timeToMinutes(state.settings.times.batch10),timeToMinutes(state.settings.times.batch13),timeToMinutes(state.settings.times.alert),end].filter(isFiniteNumber).forEach(m=>{ctx.fillText(minutesToTime(m),x(m)-16,height-15)});
  const markers=getChartMarkers(chartData).filter(marker=>marker.minute>=start&&marker.minute<=end).sort((a,b)=>a.minute-b.minute), laneLastX=[-Infinity,-Infinity,-Infinity];
  markers.forEach(marker=>{let lane=0;if(marker.type==="packing"){lane=laneLastX.findIndex(last=>x(marker.minute)-last>=145);if(lane<0)lane=laneLastX.indexOf(Math.min(...laneLastX));laneLastX[lane]=x(marker.minute)}else lane=marker.type==="finish"?2:1;drawVerticalMarker(ctx,marker,x(marker.minute),pad.t-8,height-pad.b,18+lane*20,pad.l,width-pad.r)});
  function line(points,color,stopAtMissing=false){const selected=points.filter(p=>p.minute>=start&&p.minute<=end), usable=stopAtMissing?truncateAtFirstMissing(selected):selected.filter(p=>p.count!==null);if(!usable.length)return;ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=3;usable.forEach((p,i)=>i?ctx.lineTo(x(p.minute),y(p.count)):ctx.moveTo(x(p.minute),y(p.count)));ctx.stroke()}
  line(ideal,"#2878bd"); line(actual,"#f47b20",true); if(!ideal.length){ctx.fillStyle="#667789";ctx.font="bold 15px sans-serif";ctx.textAlign="center";ctx.fillText("件数と時間帯別投入人数を入力すると理想進捗を表示します",width/2,height/2);ctx.textAlign="start"}
}
function renderAll(){renderSummary();renderPickTable();renderPackingDetail();renderSettings();renderValidationMessages();bindDynamicInputs();}
function bindDynamicInputs(){document.querySelectorAll("[data-path]").forEach(el=>el.addEventListener("change",()=>{setPath(el.dataset.path,el.value);saveState();renderAll()}));document.querySelectorAll("[data-actual]").forEach(el=>el.addEventListener("change",()=>{const [i,k]=el.dataset.actual.split(".");state.actuals[Number(i)][k]=el.value;saveState();renderAll()}));document.querySelectorAll("[data-remove-actual]").forEach(el=>el.addEventListener("click",()=>{state.actuals.splice(Number(el.dataset.removeActual),1);saveState();renderAll()}));}
document.querySelectorAll(".tab").forEach(tab=>tab.addEventListener("click",()=>{document.querySelectorAll(".tab,.panel").forEach(x=>x.classList.remove("active"));tab.classList.add("active");document.querySelector(`#${tab.dataset.tab}`).classList.add("active");if(tab.dataset.tab==="summary")renderSummary()}));
document.querySelector("#add-actual").addEventListener("click",()=>{if(appendActualRow())saveState();renderAll()});
document.querySelector("#clear-daily").addEventListener("click",resetDailyData); document.querySelector("#reset-all").addEventListener("click",resetAll); window.addEventListener("resize",()=>renderSummary());
if(state.updatedAt) document.querySelector("#saved-at").textContent=new Date(state.updatedAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
renderAll();
