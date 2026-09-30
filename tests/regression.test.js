"use strict";

const fs = require("node:fs");
const vm = require("node:vm");

let source = fs.readFileSync("app.js", "utf8");
source = source.slice(0, source.indexOf('document.querySelectorAll(".tab")'));

const context = {
  console,
  confirm: () => true,
  Date,
  window: { devicePixelRatio: 1 },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: { querySelector: () => ({ textContent: "" }), querySelectorAll: () => [] }
};
vm.createContext(context);

vm.runInContext(`${source}
function assertNear(actual, expected, tolerance, label) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) throw new Error(label + ": " + actual);
}
if (timeToMinutes("13:40") !== 820 || timeToMinutes("13:40:21") !== 820) throw new Error("時刻の分変換");
if (normalizeTimeValue("13:40:21") !== "13:40") throw new Error("時刻の正規化");
const migrated = mergeState({version:1,dailyInput:{currentTime:"13:40:21"},settings:{times:{start:"09:30:12"}},actuals:[]});
if (migrated.dailyInput.currentTime !== "13:40" || migrated.settings.times.start !== "09:30") throw new Error("旧保存値の移行");
state.settings.times.start = "09:30";
state.dailyInput.currentTime = "13:40";
if (getTimeValidationMessages().length) throw new Error("有効な現在時刻");
state.dailyInput.currentTime = "13:45";
if (!getTimeValidationMessages().some(message => message.includes("10分刻み"))) throw new Error("現在時刻の刻み検証");
state.dailyInput.currentTime = "13:40";
state.actuals = [{time:"10:30",totalCompleted:1},{time:"10:40",totalCompleted:2},{time:"10:50",totalCompleted:3}];
if (getTimeValidationMessages().length || calculateActualProgress().some(row => !row.valid)) throw new Error("有効な実績時刻列");
state.actuals = [{time:"10:30",totalCompleted:1},{time:"10:35",totalCompleted:2}];
if (calculateActualProgress()[1].valid) throw new Error("実績時刻の刻み検証");
state.actuals = [{time:"10:30",totalCompleted:1},{time:"10:20",totalCompleted:2}];
if (!getTimeValidationMessages().some(message => message.includes("前行より後"))) throw new Error("実績時刻の逆転検証");
state.actuals = [{time:"10:30",totalCompleted:1},{time:"10:30",totalCompleted:2}];
if (!getTimeValidationMessages().includes("同一時刻の実績が重複しています。")) throw new Error("実績時刻の重複検証");
state.settings.times.start = "09:30";
let options = buildTenMinuteTimeOptions();
if (!["09:30","09:40","09:50","10:00"].every(time => options.includes('value="' + time + '"')) || options.includes('value="09:35"')) throw new Error("09:30基準の選択肢");
state.settings.times.start = "09:35";
options = buildTenMinuteTimeOptions();
if (!["09:35","09:45","09:55"].every(time => options.includes('value="' + time + '"')) || options.includes('value="09:40"')) throw new Error("09:35基準の選択肢");
options = buildTenMinuteTimeOptions("13:40");
if (!options.includes('<option value="13:40" selected disabled>13:40（10分刻み不一致）</option>')) throw new Error("不一致時刻の選択表示");
options = buildTenMinuteTimeOptions("13:45");
if (!options.includes('<option value="13:45" selected>13:45</option>') || options.includes("13:45（10分刻み不一致）")) throw new Error("正常時刻の選択表示");
state.settings.times.start = "09:30";
state.actuals = [{time:"10:30",totalCompleted:1000},{time:"",totalCompleted:""}];
if (appendActualRow() || state.actuals.length !== 2) throw new Error("未完成行の追加抑止");
state.actuals = [{time:"10:30",totalCompleted:1000},{time:"10:35",totalCompleted:1200}];
if (appendActualRow() || state.actuals.length !== 2) throw new Error("不正時刻行の追加抑止");
state.actuals = [{time:"10:30",totalCompleted:1000},{time:"10:40",totalCompleted:1200}];
if (!appendActualRow() || state.actuals.at(-1).time !== "10:50" || state.actuals.at(-1).totalCompleted !== "") throw new Error("有効な次行の追加");
const excelFixture = {
  currentTime: "13:40",
  picks: {
    total: { batch6: 3000, batch10: 2200, batch13: 300 },
    gas: { batch6: 1400, batch10: 1100, batch13: 100 },
    sas: { batch6: 1000, batch10: 800, batch13: 100 },
    order: { batch6: 700, batch10: 600, batch13: 100 }
  },
  staffing: { before10: 40, before13: 40, after13: 40 },
  outsourced: 0, bufferMinutes: 30, manualPeople: 8,
  actuals: [{ time: "13:10", totalCompleted: 8900 }, { time: "13:40", totalCompleted: 9800 }]
};
state.dailyInput.currentTime = excelFixture.currentTime;
PICK_KEYS.forEach(key => { state.dailyInput.picks[key] = Object.fromEntries(Object.entries(excelFixture.picks[key]).map(([batch, value]) => [batch, String(value)])); });
state.dailyInput.staffing = Object.fromEntries(Object.entries(excelFixture.staffing).map(([key, value]) => [key, String(value)]));
state.dailyInput.outsourced = String(excelFixture.outsourced);
state.dailyInput.bufferMinutes = String(excelFixture.bufferMinutes);
state.dailyInput.manualPeople = String(excelFixture.manualPeople);
state.actuals = clone(excelFixture.actuals);
const metrics = currentMetrics();
assertNear(metrics.idealPoint.count, 11324.43009648206, 0.1, "理想累計");
assertNear(metrics.current.count, 9800, 0, "実績累計");
assertNear(metrics.diffCount, -1524.43009648206, 0.1, "件数差");
assertNear(metrics.idealSpeed, 1950.605115218674, 0.1, "現在理想速度");
assertNear(metrics.recentSpeed, 1800, 0, "直近実績速度");
assertNear(metrics.recentSpeed / metrics.idealSpeed * 100, 92.279, 0.1, "直近ペース");
assertNear(metrics.delay, 46.89099, 0.1, "遅れ時間");
if (minutesToTime(metrics.finish) !== "14:33") throw new Error("終了見込み: " + minutesToTime(metrics.finish));
if (metrics.status !== "遅延拡大") throw new Error("状態: " + metrics.status);
state.actuals = [{ time: "13:30", totalCompleted: 9500 }];
const staleMetrics = currentMetrics();
if (staleMetrics.current.minute !== timeToMinutes("13:30") || staleMetrics.idealPoint.minute !== timeToMinutes("13:30") || staleMetrics.dataAge !== 10) throw new Error("現在時刻と進捗評価時刻の分離");
state.actuals = clone(excelFixture.actuals);
const broken = truncateAtFirstMissing([{count: 1}, {count: null}, {count: 3}]);
if (broken.length !== 1) throw new Error("欠損を跨いだ実績線");
state.actuals = [{time:"13:10",totalCompleted:8900},{time:"13:20",totalCompleted:""},{time:"13:30",totalCompleted:9600}];
if (currentMetrics().current.minute !== timeToMinutes("13:10")) throw new Error("KPIが欠損を跨いだ");
state.actuals = [{time:"13:10",totalCompleted:8900},{time:"",totalCompleted:""},{time:"13:30",totalCompleted:9600}];
if (currentMetrics().current.minute !== timeToMinutes("13:10")) throw new Error("KPIが時刻空欄を跨いだ");
state.actuals = [{time:"13:10",totalCompleted:8900},{time:"13:35",totalCompleted:9600}];
if (currentMetrics().current.minute !== timeToMinutes("13:10")) throw new Error("KPIが非10分刻み実績を採用した");
state.actuals = clone(excelFixture.actuals);
const packing = calculatePackingAllocation();
const expectedCounts = [4145, 4726, 80, 1606, 843];
packing.forEach((line, index) => { if (line.count !== expectedCounts[index]) throw new Error(line.name + "概算件数: " + line.count); });
const expectedLatestStarts = { gemini: "11:02", leo: "10:16", ravioli: "15:21", radish: "13:05", manual: "14:21" };
packing.forEach(line => { if (minutesToDeadlineTime(line.latestStartMinutes) !== expectedLatestStarts[line.id]) throw new Error(line.name + "最新開始: " + minutesToDeadlineTime(line.latestStartMinutes)); });
const chartRange = getChartTimeRange({ startMinute: timeToMinutes("09:30"), alertMinute: timeToMinutes("14:00"), currentMinute: timeToMinutes("13:40"), latestActualMinute: timeToMinutes("13:40"), finishMinute: timeToMinutes("14:33"), packing });
if (chartRange.end <= timeToMinutes("15:21")) throw new Error("チャート終端が最終イベント以前: " + minutesToTime(chartRange.end));
const zeroCountRange = getChartTimeRange({ startMinute: timeToMinutes("09:30"), alertMinute: timeToMinutes("14:00"), currentMinute: timeToMinutes("13:40"), latestActualMinute: timeToMinutes("13:40"), finishMinute: timeToMinutes("14:33"), packing: [...packing, { name: "0件対象外", count: 0, latestStartMinutes: timeToMinutes("20:00") }] });
if (zeroCountRange.end !== chartRange.end) throw new Error("0件ラインがチャート終端を延長: " + minutesToTime(zeroCountRange.end));
const activeLineRange = getChartTimeRange({ startMinute: timeToMinutes("09:30"), alertMinute: timeToMinutes("14:00"), currentMinute: timeToMinutes("13:40"), latestActualMinute: timeToMinutes("13:40"), finishMinute: timeToMinutes("14:33"), packing: [...packing, { name: "有効ライン", count: 1, latestStartMinutes: timeToMinutes("16:00") }] });
if (activeLineRange.end <= timeToMinutes("16:00")) throw new Error("有効ラインを含むチャート終端: " + minutesToTime(activeLineRange.end));
const markerPacking = [...packing, { name: "時刻なし対象外", count: 1, latestStartMinutes: null }, { name: "0件対象外", count: 0, latestStartMinutes: timeToMinutes("15:30") }];
const chartMarkers = getChartMarkers({ currentMinute: timeToMinutes("13:40"), finishMinute: metrics.finish, packing: markerPacking });
if (chartMarkers.filter(marker => marker.type === "packing").length !== 5 || chartMarkers.some(marker => marker.label.includes("対象外"))) throw new Error("0件またはnull最新開始を描画対象から除外");
if (!chartMarkers.some(marker => marker.label === "ピッキング終了見込み 14:33") || !chartMarkers.some(marker => marker.label === "現在 13:40")) throw new Error("チャートイベント文言");
if (!chartMarkers.find(marker => marker.label.startsWith("レオ ")).isPast || chartMarkers.find(marker => marker.label.startsWith("手梱包 ")).isPast) throw new Error("梱包開始期限の過去未来判定");
const noop = () => {};
const fakeContext = new Proxy({ measureText: text => ({ width: text.length * 6 }) }, { get: (target, key) => key in target ? target[key] : noop, set: (target, key, value) => { target[key] = value; return true; } });
const originalQuerySelector = document.querySelector;
document.querySelector = selector => selector === "#progress-chart" ? { clientWidth: 900, getContext: () => fakeContext } : originalQuerySelector(selector);
renderChart(metrics.ideal, metrics.actual, { currentMinute: metrics.currentMinute, finishMinute: null, packing });
const staffingSummary = calculateCurrentStaffingSummary();
if (staffingSummary.totalPeople !== 40 || staffingSummary.packingPeople !== 18 || staffingSummary.pickingPeople !== 22 || staffingSummary.staffingStatus !== "充足") throw new Error("現在の人員状況");
if (minutesToDeadlineTime(staffingSummary.nextPackingStart) !== "14:21") throw new Error("次の梱包開始");
const allocation22 = calculatePickingStaffAllocation();
if (allocation22.status !== "ready" || allocation22.totalPeople !== 22 || allocation22.rows.reduce((total, row) => total + row.people, 0) !== 22) throw new Error("目安配分22人の合計");
if (JSON.stringify(allocation22.rows.map(row => row.people)) !== JSON.stringify([1, 9, 7, 5])) throw new Error("13:40目安配分: " + allocation22.rows.map(row => row.people));
const allocation14 = calculatePickingStaffAllocation(14);
if (allocation14.rows.reduce((total, row) => total + row.people, 0) !== 14) throw new Error("目安配分14人の合計");
if (calculatePickingStaffAllocation(null).status !== "unavailable") throw new Error("人員条件未確定時の目安配分");
state.dailyInput.picks.total = { batch6: "0", batch10: "0", batch13: "0" };
const zeroCategory = calculatePickingStaffAllocation(22);
if (zeroCategory.rows.find(row => row.key === "total").people !== 0) throw new Error("0件区分の目安人数");
PICK_KEYS.forEach(key => { state.dailyInput.picks[key] = { batch6: "0", batch10: "0", batch13: "0" }; });
const noWork = calculatePickingStaffAllocation(22);
if (noWork.status !== "no-work" || noWork.totalWorkHours !== 0 || noWork.rows.some(row => !Number.isFinite(row.people) || !Number.isFinite(row.share))) throw new Error("対象作業なしの有限値保証");
PICK_KEYS.forEach(key => { state.dailyInput.picks[key] = Object.fromEntries(Object.entries(excelFixture.picks[key]).map(([batch, value]) => [batch, String(value)])); });
state.dailyInput.currentTime = "09:50";
const before10 = calculatePickingStaffAllocation(22);
state.dailyInput.currentTime = "10:10";
const after10 = calculatePickingStaffAllocation(22);
state.dailyInput.currentTime = "12:50";
const before13 = calculatePickingStaffAllocation(22);
state.dailyInput.currentTime = "13:10";
const after13 = calculatePickingStaffAllocation(22);
if (!(after10.rows[0].releasedCount > before10.rows[0].releasedCount && after10.rows[0].workHours > before10.rows[0].workHours)) throw new Error("10時バッチの目安配分反映");
if (!(after13.rows[0].releasedCount > before13.rows[0].releasedCount && after13.rows[0].workHours > before13.rows[0].workHours)) throw new Error("13時バッチの目安配分反映");
state.dailyInput.currentTime = excelFixture.currentTime;
state.dailyInput.currentTime = "13:05";
const radishStartSummary = calculateCurrentStaffingSummary();
if (packingStatus(packing[3]) !== "開始期限到来" || radishStartSummary.packingPeople !== 18) throw new Error("ラディッシュ開始分の人員控除");
state.dailyInput.currentTime = "14:21";
const manualStartSummary = calculateCurrentStaffingSummary();
if (manualStartSummary.packingPeople !== 26 || minutesToDeadlineTime(manualStartSummary.nextPackingStart) === "14:21") throw new Error("手梱包開始分の人員控除");
const manualStartAllocation = calculatePickingStaffAllocation();
if (manualStartAllocation.totalPeople !== 14 || manualStartAllocation.rows.reduce((total, row) => total + row.people, 0) !== 14) throw new Error("梱包開始後の目安配分再計算");
state.dailyInput.currentTime = excelFixture.currentTime;
state.dailyInput.bufferMinutes = "";
const unknownPackingSummary = calculateCurrentStaffingSummary();
if (unknownPackingSummary.packingPeople !== null || unknownPackingSummary.pickingPeople !== null || unknownPackingSummary.staffingStatus !== null) throw new Error("梱包条件未確定時の人員表示");
if (calculateIdealProgress().length !== 0) throw new Error("梱包条件未確定時に理想線を生成した");
state.dailyInput.bufferMinutes = String(excelFixture.bufferMinutes);
for (const total of [0, 1, 2, 17, 999, 11400]) {
  const allocated = allocatePackingCounts(total, state.settings.packing.map(line => Number(line.share)));
  if (allocated.reduce((sum, count) => sum + count, 0) !== total) throw new Error("梱包配分合計: " + total);
}
if (minutesToDeadlineTime(packing[3].latestStartMinutes) !== "13:05") throw new Error("ラディッシュ最新開始表示");
state.dailyInput.currentTime = "13:05";
if (packingStatus(packing[3]) !== "開始期限到来") throw new Error("表示分単位の梱包状態");
state.dailyInput.currentTime = "10:30";
PICK_KEYS.forEach(key => { state.dailyInput.picks[key].batch13 = ""; });
if (getReleasedPickTotal(timeToMinutes("10:30")) !== 10800 || calculateIdealProgress().length === 0) throw new Error("未来バッチ未確定時の理想進捗");
state.dailyInput.picks.gas.batch10 = "";
if (calculateIdealProgress().length !== 0) throw new Error("到来済みバッチ未入力時に理想線を生成した");
PICK_KEYS.forEach(key => { state.dailyInput.picks[key] = Object.fromEntries(Object.entries(excelFixture.picks[key]).map(([batch, value]) => [batch, String(value)])); });
state.dailyInput.currentTime = excelFixture.currentTime;
state.dailyInput.outsourced = "11401";
if (calculatePackingAllocation().some(line => line.count !== null)) throw new Error("外部委託超過を補正した");
console.log(JSON.stringify({ ideal: metrics.idealPoint.count, actual: metrics.current.count, diff: metrics.diffCount, idealSpeed: metrics.idealSpeed, recentSpeed: metrics.recentSpeed, pace: metrics.recentSpeed / metrics.idealSpeed * 100, delay: metrics.delay, finish: minutesToTime(metrics.finish), status: metrics.status }, null, 2));
`, context);
