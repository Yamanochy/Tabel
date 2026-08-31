// ============================================================
// ДОСАТУЙ (СПРАВОЧНО) — читает те же данные напрямую из базы Досатуй
// (тот же проект), только для просмотра. Ничего здесь не редактируется —
// править записи можно только в самом приложении Досатуй.
// ============================================================

let dosatuyTtnCache = [];
let dosatuyMaintCache = [];
let dosatuyUnsub1 = null, dosatuyUnsub2 = null;

function subscribeDosatuyRef() {
  if (!dosatuyUnsub1) {
    dosatuyUnsub1 = db.collection("ttnDocs").onSnapshot((snap) => {
      dosatuyTtnCache = snap.docs.map((d) => d.data());
      if (currentTab === "dosatuy") render();
    }, () => {});
  }
  if (!dosatuyUnsub2) {
    dosatuyUnsub2 = db.collection("maintenanceDocs").onSnapshot((snap) => {
      dosatuyMaintCache = snap.docs.map((d) => d.data());
      if (currentTab === "dosatuy") render();
    }, () => {});
  }
}

function maintBasePayRef(doc) {
  if (doc.type === "Ремонт" && doc.repairPrice) return Number(doc.repairPrice);
  return 6000;
}

function renderDosatuyRef() {
  subscribeDosatuyRef(); // подписываемся лениво, только когда реально открыли вкладку
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  wrap.appendChild((() => {
    const c = el("div", "bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-2");
    c.innerHTML = `<div class="text-xs text-slate-500">Данные читаются напрямую из приложения Досатуй — только для просмотра. Чтобы что-то поправить, открой само приложение Досатуй.</div>`;
    return c;
  })());

  const perDriver = {}; // name -> { shifts, maint, total }
  dosatuyTtnCache.forEach((d) => {
    if (!inSelectedMonth(d.ttnDate, selectedYear, selectedMonth)) return;
    if (!perDriver[d.driverName]) perDriver[d.driverName] = { shifts: 0, maint: 0, total: 0 };
    perDriver[d.driverName].shifts += 1;
    perDriver[d.driverName].total += 6000;
  });
  dosatuyMaintCache.forEach((m) => {
    if (!inSelectedMonth(m.date, selectedYear, selectedMonth)) return;
    const workers = [m.primaryWorker, m.secondaryWorker].filter(Boolean);
    const share = workers.length === 2 ? Math.round(maintBasePayRef(m) / 2) : maintBasePayRef(m);
    workers.forEach((w) => {
      if (!perDriver[w]) perDriver[w] = { shifts: 0, maint: 0, total: 0 };
      perDriver[w].maint += share;
      perDriver[w].total += share;
    });
  });

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
