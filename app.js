// ============================================================
// ТАБЕЛЬ — техника и водители в Новосибирске.
// Тот же Firestore-проект, что и Досатуй, но отдельные коллекции:
// tabelEquipment, tabelDrivers, tabelShifts, tabelAdvances.
// ============================================================

const app = document.getElementById("app");
let currentTab = "summary";
let selectedMonth = new Date().getMonth();
let selectedYear = new Date().getFullYear();

const MONTHS_RU = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

const ICONS = {
  summary: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>`,
  shifts: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/></svg>`,
  drivers: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>`,
  equipment: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17h1M21 17h1M3 17V10a1 1 0 0 1 1-1h5l2-3h3v6h6a1 1 0 0 1 1 1v4"/><path d="M16 17H8"/><circle cx="6.5" cy="17" r="2"/><circle cx="17.5" cy="17" r="2"/></svg>`,
  dosatuy: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6"/><path d="M12 9 7 4M12 9l5-5"/><path d="M5.5 11 12 9l6.5 2"/><path d="M12 9 6 15h5.3M12 9l6 6h-5.3"/><path d="M12 15v6" stroke-width="1.9"/></svg>`,
  advances: `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>`,
  plus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  camera: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline -mt-0.5 mr-1.5"><path d="M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  coin: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline -mt-0.5 mr-0.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5a2.5 2.5 0 0 1 2.5-1.5h.5a2 2 0 0 1 0 4h-1a2 2 0 0 0 0 4h.5a2.5 2.5 0 0 0 2.5-1.5"/></svg>`,
};

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtRU(d) {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtMoney(n) {
  return Math.round(n || 0).toLocaleString("ru-RU") + " ₽";
}
function todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function inSelectedMonth(dateStr, year, month) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  return d.getFullYear() === year && d.getMonth() === month;
}

function startApp() {
  renderUserBar();
  buildNav();
  wireNav();
  currentTab = "summary";
  render();
  if (typeof subscribeEquipment === "function") subscribeEquipment();
  if (typeof subscribeDrivers === "function") subscribeDrivers();
  if (typeof subscribeShifts === "function") subscribeShifts();
  if (typeof subscribeAdvances === "function") subscribeAdvances();
  if (typeof subscribeDosatuyRef === "function") subscribeDosatuyRef();
  if (typeof refreshPendingQueueCache === "function") {
    refreshPendingQueueCache().then(() => { if (currentTab === "shifts") render(); });
  }
  if (typeof flushOfflineQueue === "function" && navigator.onLine) flushOfflineQueue();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function renderUserBar() {
  const bar = document.getElementById("user-bar");
  bar.innerHTML = `
    <span class="text-slate-300">${escapeHtml(currentProfileName)}</span>
    <button id="logout-btn" class="ml-auto text-slate-400 text-xs underline">Выйти</button>`;
  document.getElementById("logout-btn").onclick = () => auth.signOut();
}

function buildNav() {
  const nav = document.getElementById("nav");
  const tabs = [
    ["summary", ICONS.summary, "Итого"],
    ["shifts", ICONS.shifts, "Смены"],
    ["advances", ICONS.advances, "Авансы"],
    ["drivers", ICONS.drivers, "Водители"],
    ["equipment", ICONS.equipment, "Техника"],
    ["dosatuy", ICONS.dosatuy, "Досатуй"],
  ];
  nav.innerHTML = tabs.map(([tab, icon, label]) => `
    <button class="tabbtn relative flex flex-col items-center gap-1 px-2 py-1 text-slate-400 text-[10px] font-medium" data-tab="${tab}">
      <span class="tabicon-wrap w-8 h-8 rounded-full flex items-center justify-center transition-colors"><span class="tabicon">${icon}</span></span>
      ${label}
    </button>`).join("");
}

function wireNav() {
  document.querySelectorAll(".tabbtn").forEach((b) => {
    b.onclick = () => { currentTab = b.dataset.tab; render(); };
  });
}

function render() {
  if (currentTab === "summary") renderSummary();
  else if (currentTab === "shifts") renderShifts();
  else if (currentTab === "advances") renderAdvances();
  else if (currentTab === "drivers") renderDrivers();
  else if (currentTab === "equipment") renderEquipment();
  else if (currentTab === "dosatuy") renderDosatuyRef();
  else { currentTab = "summary"; renderSummary(); }
  document.querySelectorAll(".tabbtn").forEach((b) => {
    b.classList.toggle("tab-active", b.dataset.tab === currentTab);
  });
}

// месяц-переключатель, общий для нескольких вкладок
function monthSwitcher() {
  const wrap = el("div", "bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between");
  const prev = el("button", "w-8 h-8 rounded-lg bg-slate-100 text-slate-500 font-bold", "‹");
  const next = el("button", "w-8 h-8 rounded-lg bg-slate-100 text-slate-500 font-bold", "›");
  const label = el("div", "font-bold font-display text-diesel", `${MONTHS_RU[selectedMonth]} ${selectedYear}`);
  prev.onclick = () => {
    selectedMonth--; if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
    render();
  };
  next.onclick = () => {
    selectedMonth++; if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
    render();
  };
  wrap.appendChild(prev); wrap.appendChild(label); wrap.appendChild(next);
  return wrap;
}

// начислено/аванс/остаток по каждому человеку за выбранный месяц —
// считаем по ФИО, объединяя заработок из смен в Новосибирске И из
// Досатуй, чтобы аванс, выданный водителю Досатуй, вычитался из его
// общего заработка, а не висел отдельной "минусовой" строкой
function computeCombinedTotals() {
  const combined = {}; // name -> { nsk, dosatuy, advanced }
  const ensure = (name) => {
    if (!combined[name]) combined[name] = { nsk: 0, dosatuy: 0, advanced: 0 };
    return combined[name];
  };

  (typeof shiftsCache !== "undefined" ? shiftsCache : []).forEach((s) => {
    if (!inSelectedMonth(s.date, selectedYear, selectedMonth)) return;
    ensure(s.driverName).nsk += Number(s.computedPay || 0);
  });

  if (typeof computeDosatuyTotals === "function") {
    const dosatuyTotals = computeDosatuyTotals();
    Object.keys(dosatuyTotals).forEach((name) => {
      ensure(name).dosatuy = dosatuyTotals[name].total;
    });
  }

  (typeof advancesCache !== "undefined" ? advancesCache : []).forEach((a) => {
    if (!inSelectedMonth(a.date, selectedYear, selectedMonth)) return;
    ensure(a.driverName).advanced += Number(a.amount || 0);
  });

  return combined;
}

function renderSummary() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  const combined = computeCombinedTotals();
  const names = Object.keys(combined);
  const grandNsk = names.reduce((s, n) => s + combined[n].nsk, 0);
  const grandDosatuy = names.reduce((s, n) => s + combined[n].dosatuy, 0);

  const grid = el("div", "grid grid-cols-2 gap-3");
  grid.appendChild(statCard("Начислено · Новосибирск", fmtMoney(grandNsk)));
  grid.appendChild(statCard("Начислено · Досатуй", fmtMoney(grandDosatuy)));
  wrap.appendChild(grid);
  wrap.appendChild(statCard("Всего по обеим бригадам", fmtMoney(grandNsk + grandDosatuy)));

  wrap.appendChild(el("div", "text-xs font-bold text-slate-400 uppercase tracking-wide pt-1", "К выплате — по каждому человеку"));
  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!names.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "За этот месяц пока нет ни начислений, ни авансов."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    names.sort((a, b) => a.localeCompare(b)).forEach((name) => {
      const t = combined[name];
      const earned = t.nsk + t.dosatuy;
      const remain = earned - t.advanced;
      const row = el("div", "p-4");
      const breakdown = (t.nsk && t.dosatuy)
        ? `<div class="text-[11px] text-slate-400">Новосибирск ${fmtMoney(t.nsk)} + Досатуй ${fmtMoney(t.dosatuy)}</div>`
        : "";
      row.innerHTML = `
        <div class="font-semibold text-slate-800">${escapeHtml(name)}</div>
        ${breakdown}
        <div class="grid grid-cols-3 gap-2 text-center mt-2">
          <div><div class="text-[10px] text-slate-400">Начислено</div><div class="font-num font-bold text-diesel text-sm">${fmtMoney(earned)}</div></div>
          <div><div class="text-[10px] text-slate-400">Аванс</div><div class="font-num font-bold text-route-600 text-sm">${fmtMoney(t.advanced)}</div></div>
          <div><div class="text-[10px] text-slate-400">Остаток</div><div class="font-num font-bold ${remain < 0 ? "text-brick" : "text-shift"} text-sm">${fmtMoney(remain)}</div></div>
        </div>`;
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}

function statCard(label, value) {
  const c = el("div", "bg-white rounded-xl border border-slate-200 p-3 text-center");
  c.innerHTML = `<div class="text-lg font-bold font-num text-diesel">${value}</div><div class="text-[10px] text-slate-400 mt-0.5">${label}</div>`;
  return c;
}
