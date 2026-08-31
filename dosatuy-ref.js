// ============================================================
// ДОСАТУЙ (СПРАВОЧНО) — читает те же данные напрямую из базы Досатуй
// (тот же проект), только для просмотра. Ничего здесь не редактируется —
// править записи можно только в самом приложении Досатуй.
// Подписка стартует сразу при входе (не только при заходе на вкладку),
// чтобы цифры были готовы и во вкладке «Итого».
// ============================================================

let dosatuyTtnCache = [];
let dosatuyMaintCache = [];
let dosatuyUnsub1 = null, dosatuyUnsub2 = null;

function subscribeDosatuyRef() {
  if (!dosatuyUnsub1) {
    dosatuyUnsub1 = db.collection("ttnDocs").onSnapshot((snap) => {
      dosatuyTtnCache = snap.docs.map((d) => d.data());
      if (currentTab === "dosatuy" || currentTab === "summary") render();
    }, () => {});
  }
  if (!dosatuyUnsub2) {
    dosatuyUnsub2 = db.collection("maintenanceDocs").onSnapshot((snap) => {
      dosatuyMaintCache = snap.docs.map((d) => d.data());
      if (currentTab === "dosatuy" || currentTab === "summary") render();
    }, () => {});
  }
}

function maintBasePayRef(doc) {
  if (doc.type === "Ремонт" && doc.repairPrice) return Number(doc.repairPrice);
  return 6000;
}

// { name -> { shifts, maint, total } } за выбранный месяц — используется
// и во вкладке «Досатуй», и во вкладке «Итого». Сначала группируем по
// фамилии+имени (см. nameKey в app.js), чтобы старое и новое написание
// ФИО одного человека не расходились на две строки.
function computeDosatuyTotals() {
  const perKey = {}; // key -> { displayName, shifts, maint, total }
  const ensure = (name) => {
    const key = nameKey(name);
    if (!perKey[key]) perKey[key] = { displayName: name, shifts: 0, maint: 0, total: 0 };
    perKey[key].displayName = bestName(perKey[key].displayName, name);
    return perKey[key];
  };

  dosatuyTtnCache.forEach((d) => {
    if (!inSelectedMonth(d.ttnDate, selectedYear, selectedMonth)) return;
    const rec = ensure(d.driverName);
    rec.shifts += 1;
    rec.total += 6000;
  });
  dosatuyMaintCache.forEach((m) => {
    if (!inSelectedMonth(m.date, selectedYear, selectedMonth)) return;
    const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
    const share = workers.length === 2 ? Math.round(maintBasePayRef(m) / 2) : maintBasePayRef(m);
    workers.forEach((w) => {
      const rec = ensure(w);
      rec.maint += share;
      rec.total += share;
    });
  });

  const out = {};
  Object.values(perKey).forEach((v) => { out[v.displayName] = { shifts: v.shifts, maint: v.maint, total: v.total }; });
  return out;
}

function renderDosatuyRef() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  wrap.appendChild((() => {
    const c = el("div", "bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-2");
    c.innerHTML = `<div class="text-xs text-slate-500">Данные читаются напрямую из приложения Досатуй — только для просмотра. Чтобы что-то поправить, открой само приложение Досатуй.</div>`;
    return c;
  })());

  const perDriver = computeDosatuyTotals();
  const names = Object.keys(perDriver);
  const grandTotal = names.reduce((s, n) => s + perDriver[n].total, 0);

  wrap.appendChild(statCard("Всего начислено бригаде Досатуй", fmtMoney(grandTotal)));

  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!names.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "За этот месяц данных ещё нет."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    names.sort((a, b) => a.localeCompare(b)).forEach((name) => {
      const d = perDriver[name];
      const row = el("div", "p-4 flex items-center justify-between");
      row.innerHTML = `
        <div>
          <div class="font-semibold text-slate-800">${escapeHtml(name)}</div>
          <div class="text-xs text-slate-400">${d.shifts} рейс${d.shifts === 1 ? "" : d.shifts < 5 ? "а" : "ов"}${d.maint ? " · ТО/ремонт " + fmtMoney(d.maint) : ""}</div>
        </div>
        <div class="font-bold font-num text-diesel">${fmtMoney(d.total)}</div>`;
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}
