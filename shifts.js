// ============================================================
// СМЕНЫ — кто, на какой технике, сколько часов или посменно.
// Ставка берётся из карточки водителя НА МОМЕНТ сохранения записи и
// "замораживается" в самой смене — если ставку водителю потом
// поднимут/снизят, уже сохранённые смены не пересчитаются задним числом.
// ============================================================

let shiftsCache = [];
let shiftsUnsub = null;
let shiftFormOpen = false;
let shiftEditingId = null;
let shiftSelectedFiles = [];

function subscribeShifts() {
  if (shiftsUnsub) return;
  shiftsUnsub = db.collection("tabelShifts").orderBy("date", "desc")
    .onSnapshot((snap) => {
      shiftsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "shifts" && !shiftFormOpen) render();
      if (currentTab === "summary") render();
    }, (err) => console.error(err));
}

// ---------- сжатие и загрузка фото (тот же приём, что и в Досатуй) ----------
function resizeImageTabel(file, maxDim = 1600, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => { URL.revokeObjectURL(url); blob ? resolve(blob) : reject(new Error("Не удалось обработать фото")); }, "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Не удалось открыть фото")); };
    img.src = url;
  });
}
function uploadToCloudinary(blob) {
  const form = new FormData();
  form.append("file", blob);
  form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  return fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: form })
    .then((r) => { if (!r.ok) throw new Error("Не удалось загрузить фото"); return r.json(); })
    .then((data) => data.secure_url);
}

function computeShiftPay(payType, rate, hours) {
  if (payType === "hourly") return Number(rate || 0) * Number(hours || 0);
  return Number(rate || 0);
}

function renderShifts() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");
  wrap.appendChild(monthSwitcher());

  if (shiftFormOpen) {
    wrap.appendChild(renderShiftForm(shiftEditingId ? shiftsCache.find((s) => s.id === shiftEditingId) : null));
    app.appendChild(wrap);
    return;
  }

  const addBtn = el("button", "w-full py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm flex items-center justify-center", `${ICONS.plus}<span class="ml-1">Добавить смену</span>`);
  addBtn.onclick = () => { shiftFormOpen = true; shiftEditingId = null; shiftSelectedFiles = []; render(); };
  wrap.appendChild(addBtn);

  renderPendingBanner(wrap);

  const list = shiftsCache.filter((s) => inSelectedMonth(s.date, selectedYear, selectedMonth));
  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  if (!list.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "За этот месяц смен ещё нет."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    list.forEach((s) => {
      const row = el("div", "p-4 flex gap-3");
      const thumbWrap = el("div", "shrink-0 w-16 h-16 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center");
      if (s.photoUrls && s.photoUrls[0]) {
        const img = el("img", "w-16 h-16 object-cover cursor-pointer");
        img.src = s.photoUrls[0];
        img.onclick = () => window.open(s.photoUrls[0], "_blank");
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.innerHTML = ICONS.camera;
      }
      row.appendChild(thumbWrap);
      const info = el("div", "flex-1 min-w-0 text-sm cursor-pointer");
      info.innerHTML = `
        <div class="font-bold text-slate-800">${escapeHtml(s.driverName)}</div>
        <div class="text-xs text-slate-500">${escapeHtml(s.equipmentName || "—")} · ${fmtRU(new Date(s.date + "T00:00:00"))}</div>
        <div class="text-xs text-slate-400">${s.payType === "hourly" ? (s.hours + " ч × " + fmtMoney(s.rate)) : ("посменно · " + fmtMoney(s.rate))}</div>`;
      info.onclick = () => { shiftFormOpen = true; shiftEditingId = s.id; shiftSelectedFiles = []; render(); };
      row.appendChild(info);
      const right = el("div", "text-right shrink-0 flex flex-col items-end gap-1");
      right.innerHTML = `<div class="font-bold font-num text-diesel">${fmtMoney(s.computedPay)}</div>`;
      const del = el("button", "text-slate-300 hover:text-brick text-xs", "✕");
      del.onclick = async (ev) => {
        ev.stopPropagation();
        if (confirm(`Удалить смену ${escapeHtml(s.driverName)} за ${fmtRU(new Date(s.date + "T00:00:00"))}?`)) {
          await db.collection("tabelShifts").doc(s.id).delete();
        }
      };
      right.appendChild(del);
      row.appendChild(right);
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}

function renderShiftForm(existing) {
  const card = el("div", "bg-white rounded-xl border border-slate-200 p-4 space-y-3");
  // в «Сменах» показываем только тех, у кого вообще задана хоть одна ставка —
  // иначе в списке мешаются и водители Досатуй, которых сюда завели просто
  // как общую картотеку (см. вкладку «Водители»), но которые на технике
  // в Новосибирске не работают
  const activeDrivers = driversCache.filter((d) =>
    (d.active !== false && (d.hourlyRate || d.shiftRate)) || (existing && d.id === existing.driverId)
  );
  const activeEquipment = equipmentCache.filter((e) => e.active !== false || (existing && e.id === existing.equipmentId));

  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">${existing ? "Изменить смену" : "Новая смена"}</div>
    <label class="block text-xs text-slate-500">Дата
      <input id="sf-date" type="date" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value="${existing ? existing.date : todayISO()}" />
    </label>
    <label class="block text-xs text-slate-500">Водитель
      <select id="sf-driver" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="">Выбери водителя</option>
        ${activeDrivers.map((d) => `<option value="${d.id}" ${existing && existing.driverId === d.id ? "selected" : ""}>${escapeHtml(d.fullName)}</option>`).join("")}
      </select>
    </label>
    <label class="block text-xs text-slate-500">Техника
      <select id="sf-equipment" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="">Выбери технику</option>
        ${activeEquipment.map((e) => `<option value="${e.id}" ${existing && existing.equipmentId === e.id ? "selected" : ""}>${escapeHtml(e.name)}${e.plateNumber ? " — " + escapeHtml(e.plateNumber) : ""}</option>`).join("")}
      </select>
    </label>
    <div id="sf-paytype-wrap">
      <div class="text-xs text-slate-500 mb-1">Оплата за эту смену</div>
      <div class="flex gap-2" id="sf-paytype-btns">
        <button type="button" data-val="hourly" class="sf-pt-btn flex-1 py-2 rounded-lg text-sm font-semibold border">Почасовая</button>
        <button type="button" data-val="shift" class="sf-pt-btn flex-1 py-2 rounded-lg text-sm font-semibold border">Посменная</button>
      </div>
    </div>
    <label id="sf-hours-wrap" class="block text-xs text-slate-500 hidden">Часы за смену
      <input id="sf-hours" type="number" min="0" step="0.5" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-num" placeholder="напр. 10" value="${existing && existing.hours ? existing.hours : ""}" />
    </label>
    <div id="sf-pay-hint" class="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2"></div>
    <label class="block text-xs text-slate-500">Заметка (необязательно)
      <input id="sf-note" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value="${existing && existing.note ? escapeHtml(existing.note) : ""}" />
    </label>
    <div class="text-xs text-slate-500">Путевой лист (фото, можно несколько)</div>
    <div id="sf-existing-thumbs" class="flex gap-2 flex-wrap"></div>
    <div class="flex gap-2">
      <button id="sf-cam" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm flex items-center justify-center">${ICONS.camera}Камера</button>
      <button id="sf-gal" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm">Галерея</button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="sf-cam-input" class="hidden" />
    <input type="file" accept="image/*" multiple id="sf-gal-input" class="hidden" />
    <div id="sf-thumbs" class="flex gap-2 flex-wrap"></div>
    <div id="sf-error" class="text-xs text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="sf-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="sf-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>`;

  let shiftExistingPhotos = existing && existing.photoUrls ? existing.photoUrls.slice() : [];
  function renderExistingThumbs() {
    const box = card.querySelector("#sf-existing-thumbs");
    if (!shiftExistingPhotos.length) { box.innerHTML = ""; return; }
    box.innerHTML = "";
    shiftExistingPhotos.forEach((url, i) => {
      const wrap = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg cursor-pointer");
      img.src = url;
      img.onclick = () => window.open(url, "_blank");
      const del = el("button", "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brick text-white text-xs flex items-center justify-center", "✕");
      del.onclick = () => { shiftExistingPhotos.splice(i, 1); renderExistingThumbs(); };
      wrap.appendChild(img); wrap.appendChild(del);
      box.appendChild(wrap);
    });
  }
  renderExistingThumbs();

  const driverSelect = card.querySelector("#sf-driver");
  const hoursWrap = card.querySelector("#sf-hours-wrap");
  const hoursInput = card.querySelector("#sf-hours");
  const payHint = card.querySelector("#sf-pay-hint");
  let chosenPayType = existing ? existing.payType : null;

  function currentDriver() {
    return driversCache.find((d) => d.id === driverSelect.value);
  }
  function rateFor(payType) {
    // при редактировании — если водитель и способ оплаты не менялись,
    // берём ставку, уже сохранённую в самой записи, а не текущую ставку
    // водителя (иначе просто исправление заметки задним числом пересчитало
    // бы сумму по новой ставке)
    if (existing && payType === existing.payType && driverSelect.value === existing.driverId) {
      return Number(existing.rate || 0);
    }
    const d = currentDriver();
    if (!d) return 0;
    return payType === "hourly" ? Number(d.hourlyRate || 0) : Number(d.shiftRate || 0);
  }
  function updatePtButtons() {
    card.querySelectorAll(".sf-pt-btn").forEach((b) => {
      const active = b.dataset.val === chosenPayType;
      b.className = "sf-pt-btn flex-1 py-2 rounded-lg text-sm font-semibold border " +
        (active ? "bg-diesel text-white border-diesel" : "bg-white text-slate-600 border-slate-200");
    });
  }
  function updatePayHint() {
    const d = currentDriver();
    if (!d) { payHint.textContent = "Сначала выбери водителя."; hoursWrap.classList.add("hidden"); return; }
    if (!chosenPayType) { payHint.textContent = "Выбери, как оплачивается эта смена."; hoursWrap.classList.add("hidden"); return; }
    const rate = rateFor(chosenPayType);
    if (!rate) { payHint.textContent = `У водителя не указана ${chosenPayType === "hourly" ? "почасовая" : "посменная"} ставка — задай её в карточке водителя.`; hoursWrap.classList.toggle("hidden", chosenPayType !== "hourly"); return; }
    hoursWrap.classList.toggle("hidden", chosenPayType !== "hourly");
    if (chosenPayType === "hourly") {
      const hours = Number(hoursInput.value) || 0;
      payHint.textContent = `${hours} ч × ${fmtMoney(rate)} = ${fmtMoney(rate * hours)}`;
    } else {
      payHint.textContent = `Посменно: ${fmtMoney(rate)} за смену`;
    }
  }
  card.querySelectorAll(".sf-pt-btn").forEach((b) => {
    b.onclick = () => { chosenPayType = b.dataset.val; updatePtButtons(); updatePayHint(); };
  });
  driverSelect.onchange = () => {
    // если у водителя только одна из ставок задана — выбираем её сами
    const d = currentDriver();
    if (d && !existing) {
      if (d.hourlyRate && !d.shiftRate) chosenPayType = "hourly";
      else if (d.shiftRate && !d.hourlyRate) chosenPayType = "shift";
    }
    updatePtButtons(); updatePayHint();
  };
  hoursInput.oninput = updatePayHint;
  updatePtButtons(); updatePayHint();

  function renderThumbs() {
    const box = card.querySelector("#sf-thumbs");
    box.innerHTML = "";
    shiftSelectedFiles.forEach((f, i) => {
      const wrap = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg");
      img.src = URL.createObjectURL(f);
      const del = el("button", "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brick text-white text-xs flex items-center justify-center", "✕");
      del.onclick = () => { shiftSelectedFiles.splice(i, 1); renderThumbs(); };
      wrap.appendChild(img); wrap.appendChild(del);
      box.appendChild(wrap);
    });
  }

  card.querySelector("#sf-cam").onclick = () => card.querySelector("#sf-cam-input").click();
  card.querySelector("#sf-gal").onclick = () => card.querySelector("#sf-gal-input").click();
  card.querySelector("#sf-cam-input").onchange = (e) => { if (e.target.files[0]) shiftSelectedFiles.push(e.target.files[0]); renderThumbs(); };
  card.querySelector("#sf-gal-input").onchange = (e) => { Array.from(e.target.files).forEach((f) => shiftSelectedFiles.push(f)); renderThumbs(); };

  card.querySelector("#sf-cancel").onclick = () => { shiftFormOpen = false; shiftEditingId = null; shiftSelectedFiles = []; render(); };

  card.querySelector("#sf-save").onclick = async () => {
    const date = card.querySelector("#sf-date").value;
    const driverId = driverSelect.value;
    const equipmentId = card.querySelector("#sf-equipment").value;
    const errBox = card.querySelector("#sf-error");
    const saveBtn = card.querySelector("#sf-save");

    if (!date || !driverId || !chosenPayType) {
      errBox.textContent = "Заполни дату, водителя и способ оплаты за смену.";
      errBox.classList.remove("hidden");
      return;
    }
    const driver = driversCache.find((d) => d.id === driverId);
    const equipment = equipmentCache.find((e) => e.id === equipmentId);
    const hours = Number(hoursInput.value) || 0;
    const rate = rateFor(chosenPayType);
    if (!rate) {
      errBox.textContent = `У водителя не задана ${chosenPayType === "hourly" ? "почасовая" : "посменная"} ставка.`;
      errBox.classList.remove("hidden");
      return;
    }
    if (chosenPayType === "hourly" && !hours) {
      errBox.textContent = "Укажи количество часов.";
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");
    saveBtn.disabled = true;

    const payload = {
      date, driverId, driverName: driver.fullName,
      equipmentId: equipmentId || null, equipmentName: equipment ? equipment.name : "",
      payType: chosenPayType, rate,
      hours: chosenPayType === "hourly" ? hours : null,
      computedPay: computeShiftPay(chosenPayType, rate, hours),
      note: card.querySelector("#sf-note").value.trim(),
      createdByUid: currentUser.uid, createdByName: currentProfileName,
    };

    let resizedBlobs = [];
    try {
      for (let i = 0; i < shiftSelectedFiles.length; i++) {
        saveBtn.textContent = `Готовлю фото ${i + 1}/${shiftSelectedFiles.length}…`;
        resizedBlobs.push(await resizeImageTabel(shiftSelectedFiles[i]));
      }
    } catch (e) {
      errBox.textContent = "Не получилось обработать фото: " + e.message;
      errBox.classList.remove("hidden");
      saveBtn.disabled = false; saveBtn.textContent = "Сохранить";
      return;
    }

    try {
      if (!navigator.onLine) throw new Error("OFFLINE");
      const newUrls = [];
      for (let i = 0; i < resizedBlobs.length; i++) {
        saveBtn.textContent = `Загружаю фото ${i + 1}/${resizedBlobs.length}…`;
        newUrls.push(await uploadToCloudinary(resizedBlobs[i]));
      }
      if (existing) {
        const photoUrls = [...shiftExistingPhotos, ...newUrls];
        await db.collection("tabelShifts").doc(existing.id).update({ ...payload, photoUrls });
      } else {
        await db.collection("tabelShifts").add({ ...payload, photoUrls: newUrls, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      shiftFormOpen = false; shiftEditingId = null; shiftSelectedFiles = [];
      render();
    } catch (e) {
      if (existing || !looksLikeNetworkError(e)) {
        errBox.textContent = "Не получилось сохранить: " + e.message;
        errBox.classList.remove("hidden");
        saveBtn.disabled = false; saveBtn.textContent = "Сохранить";
        return;
      }
      try {
        await queueAdd("shift", payload, resizedBlobs);
        await refreshPendingQueueCache();
        shiftFormOpen = false; shiftEditingId = null; shiftSelectedFiles = [];
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

function renderPendingBanner(wrap) {
  const items = (typeof pendingQueueCache !== "undefined" ? pendingQueueCache : []).filter((q) => q.kind === "shift");
  if (!items.length) return;
  const banner = el("div", "bg-route/10 border border-route/40 rounded-xl p-3 flex items-center gap-2");
  banner.innerHTML = `<div class="text-xs text-route-600 font-medium flex-1">${items.length} запис${items.length === 1 ? "ь ждёт" : "и ждут"} интернета — отправится само</div>`;
  const retryBtn = el("button", "text-[11px] font-semibold text-route-600 bg-white px-2.5 py-1.5 rounded-lg shrink-0", "Проверить сейчас");
  retryBtn.onclick = () => { retryBtn.textContent = "…"; flushOfflineQueue(); };
  banner.appendChild(retryBtn);
  wrap.appendChild(banner);
}
