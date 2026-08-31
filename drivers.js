// ============================================================
// ВОДИТЕЛИ — личные и банковские данные + ставки оплаты (у каждого
// водителя своя почасовая и посменная ставка — техника тут ни при чём).
// Отдельная, изолированная коллекция.
// ============================================================

let driversCache = [];
let driversUnsub = null;
let driverLicenseFile = null;

function subscribeDrivers() {
  if (driversUnsub) return;
  driversUnsub = db.collection("tabelDrivers").orderBy("fullName")
    .onSnapshot((snap) => {
      driversCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "drivers") render();
      if (currentTab === "shifts" && !shiftFormOpen) render();
      if (currentTab === "summary") render();
    }, (err) => console.error(err));
}

function renderDrivers() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  const addBtn = el("button", "w-full py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm flex items-center justify-center", `${ICONS.plus}<span class="ml-1">Добавить водителя</span>`);
  addBtn.onclick = () => openDriverForm();
  wrap.appendChild(addBtn);

  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  const active = driversCache.filter((d) => d.active !== false);
  if (!active.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "Водители пока не добавлены."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    active.forEach((d) => {
      const row = el("div", "p-4");
      const avatar = d.licensePhotoUrl
        ? `<img src="${d.licensePhotoUrl}" class="w-9 h-9 rounded-full object-cover shrink-0" />`
        : `<div class="w-9 h-9 rounded-full bg-diesel/5 flex items-center justify-center text-diesel shrink-0">${ICONS.drivers}</div>`;
      row.innerHTML = `
        <div class="flex items-center gap-3 mb-2">
          ${avatar}
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-slate-800 truncate">${escapeHtml(d.fullName)}</div>
            <div class="text-xs text-slate-400 truncate">${d.phone ? escapeHtml(d.phone) : "телефон не указан"}</div>
          </div>
        </div>
        <div class="text-xs text-slate-500 space-y-0.5 pl-12">
          ${d.licenseNumber ? `<div>Удостоверение: ${escapeHtml(d.licenseNumber)}</div>` : ""}
          ${d.bankName ? `<div>${escapeHtml(d.bankName)}${d.bankAccount ? " · " + escapeHtml(d.bankAccount) : ""}</div>` : ""}
          <div class="font-num">${d.hourlyRate ? "Почасовая: " + fmtMoney(d.hourlyRate) + "/ч" : ""}${d.hourlyRate && d.shiftRate ? " · " : ""}${d.shiftRate ? "Посменная: " + fmtMoney(d.shiftRate) : ""}${!d.hourlyRate && !d.shiftRate ? "Ставки не указаны" : ""}</div>
        </div>`;
      const editBtn = el("button", "text-xs text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-lg font-medium mt-2 ml-12", "Изменить данные");
      editBtn.onclick = () => openDriverForm(d);
      row.appendChild(editBtn);
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}

function openDriverForm(existing) {
  driverLicenseFile = null;
  const overlay = el("div", "fixed inset-0 bg-black/40 z-30 flex items-end justify-center");
  const card = el("div", "bg-white rounded-t-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto");
  const f = (k) => (existing && existing[k]) ? escapeHtml(existing[k]) : "";
  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">${existing ? "Изменить водителя" : "Добавить водителя"}</div>
    <label class="block text-xs text-slate-500">ФИО
      <input id="df-name" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Иванов Иван Иванович" value="${f("fullName")}" />
    </label>
    <label class="block text-xs text-slate-500">Номер телефона
      <input id="df-phone" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="+7 900 000 00 00" value="${f("phone")}" />
    </label>
    <label class="block text-xs text-slate-500">Удостоверение (номер)
      <input id="df-license" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value="${f("licenseNumber")}" />
    </label>
    <div class="text-xs text-slate-500">Фото водительского удостоверения</div>
    <div class="flex gap-2">
      <button id="df-cam" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm flex items-center justify-center">${ICONS.camera}Камера</button>
      <button id="df-gal" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm">Галерея</button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="df-cam-input" class="hidden" />
    <input type="file" accept="image/*" id="df-gal-input" class="hidden" />
    <div id="df-thumb"></div>
    <div class="text-xs text-slate-400 font-semibold pt-1">Ставки оплаты</div>
    <label class="block text-xs text-slate-500">Почасовая ставка, ₽/час
      <input id="df-hourly" type="number" min="0" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-num" value="${existing && existing.hourlyRate ? existing.hourlyRate : ""}" />
    </label>
    <label class="block text-xs text-slate-500">Посменная ставка, ₽/смена
      <input id="df-shift" type="number" min="0" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-num" value="${existing && existing.shiftRate ? existing.shiftRate : ""}" />
    </label>
    <div class="text-xs text-slate-400 font-semibold pt-1">Реквизиты для перевода зарплаты</div>
    <label class="block text-xs text-slate-500">Банк
      <input id="df-bank" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="напр. Сбербанк" value="${f("bankName")}" />
    </label>
    <label class="block text-xs text-slate-500">Номер счёта / карты
      <input id="df-account" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-num" value="${f("bankAccount")}" />
    </label>
    <div id="df-error" class="text-xs text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="df-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="df-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>
    ${existing ? `<button id="df-delete" class="w-full text-xs text-brick font-semibold pt-1">Убрать из списка</button>` : ""}
  `;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function renderThumb() {
    const box = card.querySelector("#df-thumb");
    const src = driverLicenseFile ? URL.createObjectURL(driverLicenseFile) : (existing && existing.licensePhotoUrl);
    box.innerHTML = src ? `<img src="${src}" class="w-20 h-20 object-cover rounded-lg" />` : `<div class="text-xs text-slate-400">Фото не выбрано</div>`;
  }
  renderThumb();
  card.querySelector("#df-cam").onclick = () => card.querySelector("#df-cam-input").click();
  card.querySelector("#df-gal").onclick = () => card.querySelector("#df-gal-input").click();
  card.querySelector("#df-cam-input").onchange = (e) => { if (e.target.files[0]) { driverLicenseFile = e.target.files[0]; renderThumb(); } };
  card.querySelector("#df-gal-input").onchange = (e) => { if (e.target.files[0]) { driverLicenseFile = e.target.files[0]; renderThumb(); } };

  card.querySelector("#df-cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  card.querySelector("#df-save").onclick = async () => {
    const fullName = card.querySelector("#df-name").value.trim();
    const errBox = card.querySelector("#df-error");
    if (!fullName) {
      errBox.textContent = "Заполни хотя бы ФИО.";
      errBox.classList.remove("hidden");
      return;
    }
    const payload = {
      fullName,
      phone: card.querySelector("#df-phone").value.trim(),
      licenseNumber: card.querySelector("#df-license").value.trim(),
      hourlyRate: Number(card.querySelector("#df-hourly").value) || null,
      shiftRate: Number(card.querySelector("#df-shift").value) || null,
      bankName: card.querySelector("#df-bank").value.trim(),
      bankAccount: card.querySelector("#df-account").value.trim(),
      active: true,
    };
    const btn = card.querySelector("#df-save");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      if (driverLicenseFile) {
        btn.textContent = "Загружаю фото…";
        const resized = await resizeImageTabel(driverLicenseFile);
        payload.licensePhotoUrl = await uploadToCloudinary(resized);
      }
      btn.textContent = "Сохраняю…";
      if (existing) {
        await db.collection("tabelDrivers").doc(existing.id).update(payload);
      } else {
        await db.collection("tabelDrivers").add({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      overlay.remove();
    } catch (e) {
      errBox.textContent = "Не получилось: " + e.message;
      errBox.classList.remove("hidden");
      btn.disabled = false; btn.textContent = "Сохранить";
    }
  };

  if (existing) {
    card.querySelector("#df-delete").onclick = async () => {
      if (!confirm(`Убрать «${existing.fullName}» из списка? Прошлые смены и авансы останутся в истории.`)) return;
      await db.collection("tabelDrivers").doc(existing.id).update({ active: false });
      overlay.remove();
    };
  }
}
