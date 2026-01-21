const KEY = "bw_calorie_log_v2";

const form = document.getElementById("entryForm");
const dateEl = document.getElementById("date");
const weightEl = document.getElementById("weight");
const caloriesEl = document.getElementById("calories");
const tbody = document.getElementById("tbody");
const stats = document.getElementById("stats");
const resetTodayBtn = document.getElementById("resetToday");

let weightLineChartInstance = null;
let weeklyAvgChartInstance = null;

function today(){
  const d = new Date();
  return d.toISOString().slice(0,10);
}

function load(){
  return JSON.parse(localStorage.getItem(KEY) || "[]");
}

function save(d){
  localStorage.setItem(KEY, JSON.stringify(d));
}

function sortAsc(data){
  return [...data].sort((a,b) => new Date(a.date) - new Date(b.date));
}

function sortDesc(data){
  return [...data].sort((a,b) => new Date(b.date) - new Date(a.date));
}

function avg(arr){
  if(!arr.length) return null;
  return arr.reduce((s,x)=>s+x,0) / arr.length;
}

/**
 * メンテナンスカロリー推定（修正版）
 * - 14日平均摂取カロリー
 * - （直近7日平均体重 − その前7日平均体重）＝ 14日間の体重変化
 * - 脂肪1kg = 7200kcal
 */
function calcMaintenance(data){
  const cleaned = data
    .map(x => ({
      date: String(x.date ?? ""),
      weight: Number(x.weight),
      calories: Number(x.calories),
    }))
    .filter(x => x.date && Number.isFinite(x.weight) && Number.isFinite(x.calories));

  if (cleaned.length < 14) return null;

  const latest14 = sortDesc(cleaned).slice(0, 14);

  const avgCal14 = avg(latest14.map(x => x.calories));

  const last7 = latest14.slice(0, 7);
  const prev7 = latest14.slice(7, 14);

  const avgWLast7 = avg(last7.map(x => x.weight));
  const avgWPrev7 = avg(prev7.map(x => x.weight));
  const delta14daysKg = avgWLast7 - avgWPrev7; // 14日間の変化量

  // 日次収支（kcal/day）
  const estDailyBalance = (delta14daysKg * 7200) / 14;

  const maintenance = Math.round(avgCal14 - estDailyBalance);

  return {
    maintenance,
    avgCal14: Math.round(avgCal14),
    avgWLast7: Math.round(avgWLast7 * 10) / 10,
    avgWPrev7: Math.round(avgWPrev7 * 10) / 10,
    delta14daysKg: Math.round(delta14daysKg * 100) / 100,
    estDailyBalance: Math.round(estDailyBalance),
  };
}

/* ===== charts ===== */

function getMonday(date){
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function toISODate(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function calcWeeklyAverages(rowsAsc){
  const map = new Map();

  for (const r of rowsAsc){
    const weekStart = getMonday(r.date);
    const key = toISODate(weekStart);

    const cur = map.get(key) ?? { sum: 0, count: 0 };
    cur.sum += r.weight;
    cur.count += 1;
    map.set(key, cur);
  }

  return Array.from(map.entries())
    .sort((a,b) => new Date(a[0]) - new Date(b[0]))
    .map(([weekStartISO, v]) => ({
      label: `${weekStartISO}週`,
      avgWeight: Math.round((v.sum / v.count) * 10) / 10
    }));
}

function renderCharts(data){
  const rows = sortAsc(data)
    .map(x => ({ date: x.date, weight: Number(x.weight) }))
    .filter(x => x.date && Number.isFinite(x.weight));

  if(weightLineChartInstance) weightLineChartInstance.destroy();
  if(weeklyAvgChartInstance) weeklyAvgChartInstance.destroy();
  if(!rows.length) return;

  const weightCanvas = document.getElementById("weightLineChart");
  const weeklyCanvas = document.getElementById("weeklyAvgChart");
  if(!weightCanvas || !weeklyCanvas) return;

  weightLineChartInstance = new Chart(
    weightCanvas,
    {
      type: "line",
      data: {
        labels: rows.map(x => x.date),
        datasets: [{
          label: "体重 (kg)",
          data: rows.map(x => x.weight),
          tension: 0.2,
          pointRadius: 3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    }
  );

  const weekly = calcWeeklyAverages(rows);

  weeklyAvgChartInstance = new Chart(
    weeklyCanvas,
    {
      type: "line",
      data: {
        labels: weekly.map(x => x.label),
        datasets: [{
          label: "週平均体重 (kg)",
          data: weekly.map(x => x.avgWeight),
          tension: 0.2,
          pointRadius: 3
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    }
  );
}

/* ===== UI ===== */

function render(){
  const data = load();
  const desc = sortDesc(data);

  tbody.innerHTML = "";
  desc.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${Number(r.weight).toFixed(1)}</td>
      <td>${Math.round(r.calories)}</td>
      <td></td>
    `;
    tbody.appendChild(tr);
  });

  const m = calcMaintenance(data);
  if(!m){
    stats.textContent = "14日分入力してください";
  }else{
    const sign = m.delta14daysKg >= 0 ? "+" : "";
    stats.textContent =
`推定メンテナンス: ${m.maintenance} kcal

14日平均摂取: ${m.avgCal14} kcal
直近7日平均体重: ${m.avgWLast7} kg
その前7日平均体重: ${m.avgWPrev7} kg
14日間変化量: ${sign}${m.delta14daysKg} kg
推定日次収支: ${m.estDailyBalance} kcal/day`;
  }

  renderCharts(data);
}

form.addEventListener("submit", e => {
  e.preventDefault();

  const d = dateEl.value;
  const w = Number(weightEl.value);
  const c = Number(caloriesEl.value);

  if(!d || !Number.isFinite(w) || !Number.isFinite(c)) return;

  const data = load().filter(x => x.date !== d);
  data.push({ date: d, weight: w, calories: c });
  save(data);
  render();
});

resetTodayBtn.addEventListener("click", () => {
  dateEl.value = today();
});

dateEl.value = today();
render();
