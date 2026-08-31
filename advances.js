// ============================================================
// АВАНСЫ — произвольные суммы, выданные водителю до расчёта.
// ============================================================

let advancesCache = [];
let advancesUnsub = null;

function subscribeAdvances() {
  if (advancesUnsub) return;
  advancesUnsub = db.collection("tabelAdvances").orderBy("date", "desc")
    .onSnapshot((snap) => {
      advancesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "advances") render();
      if (currentTab === "summary") render();
    }, (err) => console.error(err));
}

function renderAdvances() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  const addBtn = el("button", "w-full py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm flex items-center justify-center", `${ICONS.plus}<span class="ml-1">Выдать аванс</span>`);
  addBtn.onclick = () => openAdvanceForm();
  wrap.appendChild(addBtn);

  const list = advancesCache.filter((a) => inSelectedMonth(a.date, selectedYear, selectedMonth));
  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!list.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "За этот месяц авансов ещё нет."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    list.forEach((a) => {
      const row = el("div", "p-4 flex items-center gap-3");
      row.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-800">${escapeHtml(a.driverName)}</div>
          <div class="text-xs text-slate-400">${fmtRU(new Date(a.date + "T00:00:00"))}${a.note ? " · " + escapeHtml(a.note) : ""}</div>
        </div>
        <div class="font-bold font-num text-route-600">${fmtMoney(a.amount)}</div>`;
      const del = el("button", "text-slate-300 hover:text-brick shrink-0 px-1", "✕");
      del.onclick = async () => {
        if (confirm(`Удалить запись об авансе ${fmtMoney(a.amount)} для ${a.driverName}?`)) {
          await db.collection("tabelAdvances").doc(a.id).delete();
        }
      };
      row.appendChild(del);
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}

function openAdvanceForm() {
  const overlay = el("div", "fixed inset-0 bg-black/40 z-30 flex items-end justify-center");
  const card = el("div", "bg-white rounded-t-2xl w-full max-w-md p-5 space-y-3");
  const activeDrivers = driversCache.filter((d) => d.active !== false);
  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">Выдать аванс</div>
    <label class="block text-xs text-slate-500">Дата
      <input id="av-date" type="date" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value="${todayISO()}" />
    </label>
    <label class="block text-xs text-slate-500">Водитель
      <select id="av-driver" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="">Выбери водителя</option>
        ${activeDrivers.map((d) => `<option value="${d.id}">${escapeHtml(d.fullName)}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">Сумма, ₽
      <input id="av-amount" type="number" min="0" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-num" />
    </label>
    <label class="block text-xs text-slate-500">Комментарий (необязательно)
      <input id="av-note" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
    </label>
    <div id="av-error" class="text-xs text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="av-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="av-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>`;
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  card.querySelector("#av-cancel").onclick = () => overlay.remove();

  card.querySelector("#av-save").onclick = async () => {
    const date = card.querySelector("#av-date").value;
    const driverId = card.querySelector("#av-driver").value;
    const amount = Number(card.querySelector("#av-amount").value);
    const errBox = card.querySelector("#av-error");
    if (!date || !driverId || !amount) {
      errBox.textContent = "Заполни дату, водителя и сумму.";
      errBox.classList.remove("hidden");
      return;
    }
    const driver = driversCache.find((d) => d.id === driverId);
    const btn = card.querySelector("#av-save");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      await db.collection("tabelAdvances").add({
        date, driverId, driverName: driver.fullName, amount,
        note: card.querySelector("#av-note").value.trim(),
        createdByUid: currentUser.uid, createdByName: currentProfileName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      overlay.remove();
    } catch (e) {
      errBox.textContent = "Не получилось: " + e.message;
      errBox.classList.remove("hidden");
      btn.disabled = false; btn.textContent = "Сохранить";
    }
  };
}
