// ============================================================
// АВАНСЫ — произвольные суммы, выданные водителю до расчёта,
// с фото чека/подтверждения перевода.
// ============================================================

let advancesCache = [];
let advancesUnsub = null;
let advanceFormOpen = false;
let advanceSelectedFiles = [];

function subscribeAdvances() {
  if (advancesUnsub) return;
  advancesUnsub = db.collection("tabelAdvances").orderBy("date", "desc")
    .onSnapshot((snap) => {
      advancesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "advances" && !advanceFormOpen) render();
      if (currentTab === "summary") render();
    }, (err) => console.error(err));
}

function renderAdvances() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  if (advanceFormOpen) {
    wrap.appendChild(renderAdvanceForm());
    app.appendChild(wrap);
    return;
  }

  const addBtn = el("button", "w-full py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm flex items-center justify-center", `${ICONS.plus}<span class="ml-1">Выдать аванс</span>`);
  addBtn.onclick = () => { advanceFormOpen = true; advanceSelectedFiles = []; render(); };
  wrap.appendChild(addBtn);

  renderAdvancePendingBanner(wrap);

  const list = advancesCache.filter((a) => inSelectedMonth(a.date, selectedYear, selectedMonth));
  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!list.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "За этот месяц авансов ещё нет."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    list.forEach((a) => {
      const row = el("div", "p-4 flex items-center gap-3");
      const thumbWrap = el("div", "shrink-0 w-12 h-12 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center");
      if (a.receiptUrls && a.receiptUrls[0]) {
        const img = el("img", "w-12 h-12 object-cover cursor-pointer");
        img.src = a.receiptUrls[0];
        img.onclick = () => window.open(a.receiptUrls[0], "_blank");
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.innerHTML = ICONS.coin;
      }
      row.appendChild(thumbWrap);
      const info = el("div", "flex-1 min-w-0");
      info.innerHTML = `
        <div class="font-semibold text-slate-800">${escapeHtml(a.driverName)}</div>
        <div class="text-xs text-slate-400">${fmtRU(new Date(a.date + "T00:00:00"))}${a.note ? " · " + escapeHtml(a.note) : ""}</div>`;
      row.appendChild(info);
      row.appendChild(el("div", "font-bold font-num text-route-600 shrink-0", fmtMoney(a.amount)));
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

function renderAdvanceForm() {
  const card = el("div", "bg-white rounded-xl border border-slate-200 p-4 space-y-3");
  const nskNames = driversCache.filter((d) => d.active !== false).map((d) => d.fullName);
  const dosatuyNames = (typeof computeDosatuyTotals === "function") ? Object.keys(computeDosatuyTotals()) : [];
  const allNames = Array.from(new Set([...nskNames, ...dosatuyNames])).sort((a, b) => a.localeCompare(b));
  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">Выдать аванс</div>
    <label class="block text-xs text-slate-500">Дата
      <input id="av-date" type="date" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value="${todayISO()}" />
    </label>
    <label class="block text-xs text-slate-500">Водитель (Новосибирск или Досатуй)
      <input id="av-driver" list="av-driver-list" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Начни вводить ФИО" />
      <datalist id="av-driver-list">
        ${allNames.map((n) => `<option value="${escapeHtml(n)}">`).join("")}
      </datalist>
    </label>
    <label class="block text-xs text-slate-500">Сумма, ₽
      <input id="av-amount" type="number" min="0" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-num" />
    </label>
    <label class="block text-xs text-slate-500">Комментарий (необязательно)
      <input id="av-note" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
    </label>
    <div class="text-xs text-slate-500">Чек / подтверждение перевода (фото, необязательно)</div>
    <div class="flex gap-2">
      <button id="av-cam" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm flex items-center justify-center">${ICONS.camera}Камера</button>
      <button id="av-gal" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm">Галерея</button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="av-cam-input" class="hidden" />
    <input type="file" accept="image/*" multiple id="av-gal-input" class="hidden" />
    <div id="av-thumbs" class="flex gap-2 flex-wrap"></div>
    <div id="av-error" class="text-xs text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="av-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="av-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>`;

  function renderThumbs() {
    const box = card.querySelector("#av-thumbs");
    box.innerHTML = "";
    advanceSelectedFiles.forEach((f, i) => {
      const wrap = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg");
      img.src = URL.createObjectURL(f);
      const del = el("button", "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brick text-white text-xs flex items-center justify-center", "✕");
      del.onclick = () => { advanceSelectedFiles.splice(i, 1); renderThumbs(); };
      wrap.appendChild(img); wrap.appendChild(del);
      box.appendChild(wrap);
    });
  }
  card.querySelector("#av-cam").onclick = () => card.querySelector("#av-cam-input").click();
  card.querySelector("#av-gal").onclick = () => card.querySelector("#av-gal-input").click();
  card.querySelector("#av-cam-input").onchange = (e) => { if (e.target.files[0]) advanceSelectedFiles.push(e.target.files[0]); renderThumbs(); };
  card.querySelector("#av-gal-input").onchange = (e) => { Array.from(e.target.files).forEach((f) => advanceSelectedFiles.push(f)); renderThumbs(); };

  card.querySelector("#av-cancel").onclick = () => { advanceFormOpen = false; advanceSelectedFiles = []; render(); };

  card.querySelector("#av-save").onclick = async () => {
    const date = card.querySelector("#av-date").value;
    const driverName = card.querySelector("#av-driver").value.trim();
    const amount = Number(card.querySelector("#av-amount").value);
    const errBox = card.querySelector("#av-error");
    const saveBtn = card.querySelector("#av-save");
    if (!date || !driverName || !amount) {
      errBox.textContent = "Заполни дату, водителя и сумму.";
      errBox.classList.remove("hidden");
      return;
    }
    // если это водитель из карточек Новосибирска — сохраним и ссылку на неё,
    // но привязка к самой карточке необязательна (например, для водителей Досатуй)
    const matchedDriver = driversCache.find((d) => d.fullName.toLowerCase() === driverName.toLowerCase());
    errBox.classList.add("hidden");
    saveBtn.disabled = true;

    const payload = {
      date, driverId: matchedDriver ? matchedDriver.id : null, driverName,
      amount,
      note: card.querySelector("#av-note").value.trim(),
      createdByUid: currentUser.uid, createdByName: currentProfileName,
    };

    let resizedBlobs = [];
    try {
      for (let i = 0; i < advanceSelectedFiles.length; i++) {
        saveBtn.textContent = `Готовлю фото ${i + 1}/${advanceSelectedFiles.length}…`;
        resizedBlobs.push(await resizeImageTabel(advanceSelectedFiles[i]));
      }
    } catch (e) {
      errBox.textContent = "Не получилось обработать фото: " + e.message;
      errBox.classList.remove("hidden");
      saveBtn.disabled = false; saveBtn.textContent = "Сохранить";
      return;
    }

    try {
      if (!navigator.onLine) throw new Error("OFFLINE");
      const urls = [];
      for (let i = 0; i < resizedBlobs.length; i++) {
        saveBtn.textContent = `Загружаю фото ${i + 1}/${resizedBlobs.length}…`;
        urls.push(await uploadToCloudinary(resizedBlobs[i]));
      }
      await db.collection("tabelAdvances").add({ ...payload, receiptUrls: urls, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      advanceFormOpen = false; advanceSelectedFiles = [];
      render();
    } catch (e) {
      if (!looksLikeNetworkError(e)) {
        errBox.textContent = "Не получилось сохранить: " + e.message;
        errBox.classList.remove("hidden");
        saveBtn.disabled = false; saveBtn.textContent = "Сохранить";
        return;
      }
      try {
        await queueAdd("advance", payload, resizedBlobs);
        await refreshPendingQueueCache();
        advanceFormOpen = false; advanceSelectedFiles = [];
        render();
      } catch (e2) {
        errBox.textContent = "Не получилось сохранить даже локально: " + e2.message;
        errBox.classList.remove("hidden");
        saveBtn.disabled = false; saveBtn.textContent = "Сохранить";
      }
    }
  };

  return card;
}

function renderAdvancePendingBanner(wrap) {
  const items = (typeof pendingQueueCache !== "undefined" ? pendingQueueCache : []).filter((q) => q.kind === "advance");
  if (!items.length) return;
  const banner = el("div", "bg-route/10 border border-route/40 rounded-xl p-3 flex items-center gap-2");
  banner.innerHTML = `<div class="text-xs text-route-600 font-medium flex-1">${items.length} аванс${items.length === 1 ? " ждёт" : "а ждут"} интернета — отправится само</div>`;
  const retryBtn = el("button", "text-[11px] font-semibold text-route-600 bg-white px-2.5 py-1.5 rounded-lg shrink-0", "Проверить сейчас");
  retryBtn.onclick = () => { retryBtn.textContent = "…"; flushOfflineQueue(); };
  banner.appendChild(retryBtn);
  wrap.appendChild(banner);
}
