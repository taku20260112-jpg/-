const KEY = "bw_calorie_log_v2";

const form = document.getElementById("entryForm");
const dateEl = document.getElementById("date");
const weightEl = document.getElementById("weight");
const caloriesEl = document.getElementById("calories");
const tbody = document.getElementById("tbody");
const stats = document.getElementById("stats");
const statsText = document.getElementById("statsText");
const resetTodayBtn = document.getElementById("resetToday");

const TARGET_DELTA = 250;

let weightLineChartInstance = null;
let weeklyAvgChartInstance = null;

function today() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function load() {
  return JSON.parse(localStorage.getItem(KEY) || "[]");
}

function save(d) {
  localStorage.setItem(KEY, JSON.stringify(d));
}

function sortAsc(data) {
  return [...data].sort((a, b) => new Date(a.date) - new Date(b.date));
}

function sortDesc(data) {
  return [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function addDays(isoDate, delta) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function toNumOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ✅ 増量/減量目安の表示更新 */
function updateTargetsUI(maintenanceKcal) {
  const cutEl = document.getElementById("cutKcal");
  const bulkEl = document.getElementById("bulkKcal");
  const noteEl = document.getElementById("targetsNote");

  if (!cutEl || !bulkEl) return;

  if (!Number.isFinite(maintenanceKcal)) {
    cutEl.textContent = "--";
    bulkEl.textContent = "--";
    if (noteEl) noteEl.style.display = "";
    return;
  }

  const cut = Math.round(maintenanceKcal - TARGET_DELTA);
  const bulk = Math.round(maintenanceKcal + TARGET_DELTA);

  cutEl.textContent = `${cut.toLocaleString()} kcal`;
  bulkEl.textContent = `${bulk.toLocaleString()} kcal`;
  if (noteEl) noteEl.style.display = "none";
}

function calcMaintenance(data) {
  const cleaned = data
    .map((x) => ({
      date: String(x.date ?? ""),
      weight: toNumOrNull(x.weight),
      calories: toNumOrNull(x.calories),
    }))
    .filter((x) => x.date);

  if (cleaned.length < 1) return null;

  const byDate = new Map();
  for (const r of cleaned) byDate.set(r.date, r);

  const dates = Array.from(byDate.keys()).sort(
    (a, b) => new Date(a) - new Date(b)
  );
  const latestDate = dates[dates.length - 1];

  const window14 = [];
  for (let i = 13; i >= 0; i--) {
    window14.push(addDays(latestDate, -i));
  }

  const prev7Dates = window14.slice(0, 7);
  const last7Dates = window14.slice(7);

  const calVals = window14
    .map((d) => byDate.get(d)?.calories)
    .filter((v) => Number.isFinite(v));

  const prev7W = prev7Dates
    .map((d) => byDate.get(d)?.weight)
    .filter((v) => Number.isFinite(v));

  const last7W = last7Dates
    .map((d) => byDate.get(d)?.weight)
    .filter((v) => Number.isFinite(v));

  if (calVals.length < 7) return null;
  if (prev7W.length < 3) return null;
  if (last7W.length < 3) return null;

  const avgCal14 = avg(calVals);
  const avgWPrev7 = avg(prev7W);
  const avgWLast7 = avg(last7W);

  const delta14daysKg = avgWLast7 - avgWPrev7;
  const estDailyBalance = (delta14daysKg * 7200) / 14;
  const maintenance = Math.round(avgCal14 - estDailyBalance);

  return {
    maintenance,
    avgCal14: Math.round(avgCal14),
    avgWLast7: Math.round(avgWLast7 * 10) / 10,
    avgWPrev7: Math.round(avgWPrev7 * 10) / 10,
    delta14daysKg: Math.round(delta14daysKg * 100) / 100,
    estDailyBalance: Math.round(estDailyBalance),
    counts: {
      calDays: calVals.length,
      last7WeightDays: last7W.length,
      prev7WeightDays: prev7W.length,
    },
    window: { start: window14[0], end: window14[13] },
  };
}

/* ===== charts ===== */

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function calcWeeklyAverages(rowsAsc) {
  const map = new Map();

  for (const r of rowsAsc) {
    const weekStart = getMonday(r.date);
    const key = toISODate(weekStart);

    const cur = map.get(key) ?? { sum: 0, count: 0 };
    cur.sum += r.weight;
    cur.count += 1;
    map.set(key, cur);
  }

  return Array.from(map.entries())
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([weekStartISO, v]) => ({
      label: `${weekStartISO}週`,
      avgWeight: Math.round((v.sum / v.count) * 10) / 10,
    }));
}

function renderCharts(data) {
  const rows = sortAsc(data)
    .map((x) => ({ date: x.date, weight: toNumOrNull(x.weight) }))
    .filter((x) => x.date && Number.isFinite(x.weight));

  if (weightLineChartInstance) weightLineChartInstance.destroy();
  if (weeklyAvgChartInstance) weeklyAvgChartInstance.destroy();
  if (!rows.length) return;

  const weightCanvas = document.getElementById("weightLineChart");
  const weeklyCanvas = document.getElementById("weeklyAvgChart");
  if (!weightCanvas || !weeklyCanvas) return;

  weightLineChartInstance = new Chart(weightCanvas, {
    type: "line",
    data: {
      labels: rows.map((x) => x.date),
      datasets: [
        {
          label: "体重 (kg)",
          data: rows.map((x) => x.weight),
          tension: 0.2,
          pointRadius: 3,
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  const weekly = calcWeeklyAverages(rows);

  weeklyAvgChartInstance = new Chart(weeklyCanvas, {
    type: "line",
    data: {
      labels: weekly.map((x) => x.label),
      datasets: [
        {
          label: "週平均体重 (kg)",
          data: weekly.map((x) => x.avgWeight),
          tension: 0.2,
          pointRadius: 3,
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });
}

/* ===== UI ===== */

function render() {
  const data = load();
  const desc = sortDesc(data);

  tbody.innerHTML = "";
  desc.forEach((r) => {
    const wNum = toNumOrNull(r.weight);
    const cNum = toNumOrNull(r.calories);

    const wText = Number.isFinite(wNum) ? wNum.toFixed(1) : "—";
    const cText = Number.isFinite(cNum) ? String(Math.round(cNum)) : "—";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${wText}</td>
      <td>${cText}</td>
      <td></td>
    `;
    tbody.appendChild(tr);
  });

  const m = calcMaintenance(data);

  if (!statsText) return;

  if (!m) {
    statsText.textContent = `推定に必要な入力が不足しています。
目安：直近14日で「カロリー7日以上」＋「体重（直近7日で3回以上 & 前7日で3回以上）」`;
    updateTargetsUI(null);
  } else {
    const sign = m.delta14daysKg >= 0 ? "+" : "";
    statsText.textContent = `推定メンテナンス: ${m.maintenance} kcal

対象期間: ${m.window.start} 〜 ${m.window.end}
14日平均摂取: ${m.avgCal14} kcal
直近7日平均体重: ${m.avgWLast7} kg
その前7日平均体重: ${m.avgWPrev7} kg
14日間変化量: ${sign}${m.delta14daysKg} kg
推定日次収支: ${m.estDailyBalance} kcal/day

入力状況: カロリー${m.counts.calDays}日 / 体重(直近7日${m.counts.last7WeightDays}回, 前7日${m.counts.prev7WeightDays}回)`;
    updateTargetsUI(m.maintenance);
  }

  renderCharts(data);
}

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const d = dateEl.value;

  const w = toNumOrNull(weightEl.value);
  const c = toNumOrNull(caloriesEl.value);

  const hasW = Number.isFinite(w);
  const hasC = Number.isFinite(c);

  if (!d || (!hasW && !hasC)) return;

  const data = load();

  const idx = data.findIndex((x) => x.date === d);
  if (idx >= 0) {
    const prev = data[idx] ?? { date: d };
    const prevW = toNumOrNull(prev.weight);
    const prevC = toNumOrNull(prev.calories);

    data[idx] = {
      date: d,
      weight: hasW ? w : prevW,
      calories: hasC ? c : prevC,
    };
  } else {
    data.push({
      date: d,
      weight: hasW ? w : null,
      calories: hasC ? c : null,
    });
  }

  save(data);

  weightEl.value = "";
  caloriesEl.value = "";

  render();
});

resetTodayBtn.addEventListener("click", () => {
  dateEl.value = today();
});

dateEl.value = today();
render();
