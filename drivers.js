// ============================================================
// ВОДИТЕЛИ — личные и банковские данные + ставки оплаты (у каждого
// водителя своя почасовая и посменная ставка — техника тут ни при чём).
// Отдельная, изолированная коллекция.
//
// Здесь же выдаётся доступ в приложение «Смена» (водители техники
// сами вносят смены со своего телефона). Заявка подтверждается кнопкой
// «Подтвердить» вверху вкладки или выбором аккаунта в карточке водителя:
//   nskUsers  — заявки: кто зарегистрировался в «Смене» и ждёт доступа
//   nskAccess — выданный доступ. Документ лежит под uid аккаунта
//               водителя и хранит КОПИЮ ФИО и ставок из карточки.
// Зачем копия: сама карточка (tabelDrivers) водителю закрыта — в ней
// банковские реквизиты. Из копии «Смена» берёт ставку, а правила базы
// сверяют с ней каждую внесённую смену. Копия обновляется сама при
// каждом сохранении карточки — руками её править не нужно.
// ============================================================

let driversCache = [];
let driversUnsub = null;
let driverLicenseFiles = []; // новые фото, ещё не загруженные
let driverExistingPhotos = []; // уже загруженные фото при редактировании (можно удалять)
const DRIVER_PHOTO_LIMIT = 5;

let nskRequestsCache = [];   // заявки из «Смены»
let nskAccessCache = [];     // выданные доступы
let nskUnsubRequests = null, nskUnsubAccess = null;
let nskRulesMissing = false; // правила Firestore для «Смены» ещё не опубликованы

function subscribeDrivers() {
  if (driversUnsub) return;
  driversUnsub = db.collection("tabelDrivers").orderBy("fullName")
    .onSnapshot((snap) => {
      driversCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "drivers") render();
      if (currentTab === "shifts" && !shiftFormOpen) render();
      if (currentTab === "summary") render();
    }, (err) => console.error(err));

  // если блок правил для «Смены» ещё не добавлен, эти две подписки вернут
  // отказ — Табель при этом продолжает работать как раньше
  nskUnsubRequests = db.collection("nskUsers").onSnapshot((snap) => {
    nskRequestsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (currentTab === "drivers") render();
  }, () => { nskRulesMissing = true; if (currentTab === "drivers") render(); });
  nskUnsubAccess = db.collection("nskAccess").onSnapshot((snap) => {
    nskAccessCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (currentTab === "drivers") render();
  }, () => { nskRulesMissing = true; if (currentTab === "drivers") render(); });
}

// на случай старых записей, где было одно фото в licensePhotoUrl —
// приводим к единому виду (массив)
function driverPhotos(d) {
  if (Array.isArray(d.licensePhotoUrls)) return d.licensePhotoUrls;
  if (d.licensePhotoUrl) return [d.licensePhotoUrl];
  return [];
}

// ---------- доступ в приложение «Смена» ----------

// зарегистрировались, но ещё не привязаны ни к одной карточке
function nskWaitingRequests() {
  const linked = new Set(nskAccessCache.map((a) => a.id));
  return nskRequestsCache.filter((r) => !linked.has(r.id));
}

// то, что увидит приложение «Смена»: только ФИО и ставки, без реквизитов
function nskAccessDoc(driverId, payload) {
  return {
    driverId,
    fullName: payload.fullName,
    hourlyRate: payload.hourlyRate,
    shiftRate: payload.shiftRate,
    email: payload.linkedEmail || "",
    active: true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
}

// Водитель видит в «Смене» только записи с его uid в поле driverUid.
// При привязке помечаем этим uid все его прежние смены и авансы
// (при отвязке — снимаем пометку). Человека находим так же, как во
// вкладке «Итого»: по карточке или по фамилии+имени.
async function nskRetagDriverRecords(driverId, fullName, newUid) {
  const key = nameKey(fullName);
  const ops = [];
  (typeof shiftsCache !== "undefined" ? shiftsCache : []).forEach((s) => {
    const mine = s.driverId === driverId || nameKey(s.driverName) === key;
    if (mine && (s.driverUid || null) !== newUid) ops.push(db.collection("tabelShifts").doc(s.id));
  });
  (typeof advancesCache !== "undefined" ? advancesCache : []).forEach((a) => {
    const mine = a.driverId === driverId || nameKey(a.driverName) === key;
    if (mine && (a.driverUid || null) !== newUid) ops.push(db.collection("tabelAdvances").doc(a.id));
  });
  // одной пачкой база принимает не больше 500 изменений
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((ref) => batch.update(ref, { driverUid: newUid }));
    await batch.commit();
  }
}

function renderNskRequestsBanner(wrap) {
  if (nskRulesMissing) {
    wrap.appendChild(el("div", "bg-white rounded-xl border border-slate-200 p-3 text-xs text-slate-500",
      "Доступ в приложение «Смена» пока не настроен: в Firebase не опубликован блок правил для него (шаг 1 в USTANOVKA.md). На остальную работу Табеля это не влияет."));
    return;
  }
  const waiting = nskWaitingRequests();
  if (!waiting.length) return;
  const box = el("div", "rounded-xl border border-route bg-route/10 p-3");
  box.appendChild(el("div", "text-sm font-semibold text-diesel",
    `Ждут доступа в «Смену»: ${waiting.length}`));
  box.appendChild(el("div", "text-xs text-slate-500 mt-1",
    "Нажми «Подтвердить» и укажи, чья это карточка. Если водителя ещё нет в списке, карточку создашь там же."));
  waiting.forEach((r) => {
    // имя и почта — отдельной строкой над кнопками: на телефоне их нужно
    // видеть целиком, иначе не понять, чья это заявка
    const row = el("div", "mt-2 bg-white rounded-lg px-3 py-2");
    row.dataset.request = r.id;
    row.innerHTML = `
      <div class="text-sm font-semibold text-slate-800 break-words">${escapeHtml(r.name || "без имени")}</div>
      <div class="text-xs text-slate-400 break-all">${escapeHtml(r.email || "")}${r.phone ? " · " + escapeHtml(r.phone) : ""}</div>`;
    const actions = el("div", "flex items-center gap-2 mt-2");
    const approve = el("button", "flex-1 text-sm font-semibold text-white bg-diesel px-3 py-2 rounded-lg", "Подтвердить");
    approve.onclick = () => openNskApproveDialog(r);
    actions.appendChild(approve);
    const reject = el("button", "shrink-0 text-sm text-brick font-semibold px-3 py-2", "Отклонить");
    reject.onclick = async () => {
      if (!confirm(`Отклонить заявку «${r.name || r.email}»? Человек сможет подать её заново.`)) return;
      try { await db.collection("nskUsers").doc(r.id).delete(); }
      catch (e) { alert("Не получилось: " + e.message); }
    };
    actions.appendChild(reject);
    row.appendChild(actions);
    box.appendChild(row);
  });
  wrap.appendChild(box);
}

// ---------- подтверждение заявки на доступ ----------

function nskNameWords(name) {
  return String(name || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// Карточка «подходит» заявке, если её фамилия и имя (первые два слова ФИО)
// есть в имени из заявки в любом порядке: водитель мог написать и
// «Ганжа Роман», и «Роман Ганжа», и с отчеством.
function nskCardMatchesRequest(driver, request) {
  const card = nskNameWords(driver.fullName).slice(0, 2);
  const req = nskNameWords(request.name);
  return card.length === 2 && card.every((w) => req.includes(w));
}

function nskRatesText(d) {
  const parts = [];
  if (d.hourlyRate) parts.push("почасовая " + fmtMoney(d.hourlyRate) + "/ч");
  if (d.shiftRate) parts.push("посменная " + fmtMoney(d.shiftRate));
  return parts.join(", ");
}

// Привязка аккаунта к уже существующей карточке — то же самое, что делает
// сохранение карточки с выбранным аккаунтом, только без открытия формы.
async function nskLinkExistingCard(driver, request) {
  const linkedEmail = request.email || "";
  const batch = db.batch();
  batch.update(db.collection("tabelDrivers").doc(driver.id), { linkedUid: request.id, linkedEmail });
  batch.set(db.collection("nskAccess").doc(request.id), nskAccessDoc(driver.id, {
    fullName: driver.fullName,
    hourlyRate: driver.hourlyRate || null,
    shiftRate: driver.shiftRate || null,
    linkedEmail,
  }));
  await batch.commit();
  await nskRetagDriverRecords(driver.id, driver.fullName, request.id);
}

function openNskApproveDialog(request) {
  // выбирать можно из действующих карточек, у которых ещё нет аккаунта
  const candidates = driversCache.filter((d) => d.active !== false && !d.linkedUid);
  const matches = candidates.filter((d) => nskCardMatchesRequest(d, request));
  // подставляем карточку сами, только если совпадение ровно одно
  const preselected = matches.length === 1 ? matches[0].id : "";

  const overlay = el("div", "fixed inset-0 bg-black/40 z-30 flex items-end justify-center");
  const card = el("div", "bg-white rounded-t-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto");
  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">Подтвердить доступ в «Смену»</div>
    <div class="bg-slate-50 rounded-lg px-3 py-2">
      <div class="text-sm font-semibold text-slate-800">${escapeHtml(request.name || "без имени")}</div>
      <div class="text-xs text-slate-500">${escapeHtml(request.email || "")}${request.phone ? " · " + escapeHtml(request.phone) : ""}</div>
    </div>
    <label class="block text-xs text-slate-500">Чья это карточка
      <select id="na-driver" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="">Выбери водителя</option>
        ${candidates.map((d) => `<option value="${d.id}" ${d.id === preselected ? "selected" : ""}>${escapeHtml(d.fullName)}</option>`).join("")}
        <option value="__new__">Новый водитель — создать карточку</option>
      </select>
    </label>
    <div id="na-hint" class="text-xs text-slate-500"></div>
    <div id="na-error" class="text-xs text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="na-ok" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Подтвердить</button>
      <button id="na-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>`;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const select = card.querySelector("#na-driver");
  const hint = card.querySelector("#na-hint");
  const okBtn = card.querySelector("#na-ok");
  const errBox = card.querySelector("#na-error");
  const chosen = () => candidates.find((d) => d.id === select.value) || null;

  function update() {
    errBox.classList.add("hidden");
    const d = chosen();
    if (select.value === "__new__") {
      hint.textContent = "Откроется новая карточка: проверь ФИО, задай ставки и нажми «Сохранить».";
      okBtn.textContent = "Создать карточку";
    } else if (!d) {
      hint.textContent = candidates.length
        ? "Выбери, кому из водителей принадлежит этот аккаунт. Если его ещё нет в списке, выбери «Новый водитель»."
        : "Карточек без доступа нет — выбери «Новый водитель».";
      okBtn.textContent = "Подтвердить";
    } else if (!d.hourlyRate && !d.shiftRate) {
      hint.textContent = "У этого водителя не заданы ставки, а без них смену не внести. Откроется его карточка: задай ставку и нажми «Сохранить».";
      okBtn.textContent = "Открыть карточку";
    } else {
      hint.textContent = `Ставки: ${nskRatesText(d)}. Смены в приложении он будет вносить под именем «${d.fullName}».`;
      okBtn.textContent = "Подтвердить";
    }
  }
  select.onchange = update;
  update();

  card.querySelector("#na-cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  okBtn.onclick = async () => {
    const d = chosen();
    if (select.value === "__new__") {
      overlay.remove();
      openDriverForm(null, { fullName: request.name || "", phone: request.phone || "", linkUid: request.id });
      return;
    }
    if (!d) {
      errBox.textContent = "Выбери карточку водителя или «Новый водитель».";
      errBox.classList.remove("hidden");
      return;
    }
    if (!d.hourlyRate && !d.shiftRate) {
      overlay.remove();
      openDriverForm(d, { linkUid: request.id });
      return;
    }
    okBtn.disabled = true; okBtn.textContent = "Подтверждаю…";
    try {
      await nskLinkExistingCard(d, request);
      overlay.remove();
    } catch (e) {
      okBtn.disabled = false;
      update();
      errBox.textContent = "Не получилось: " + e.message;
      errBox.classList.remove("hidden");
    }
  };
}

function renderDrivers() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  renderNskRequestsBanner(wrap);

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
      const photos = driverPhotos(d);
      const row = el("div", "p-4");
      const avatar = photos.length
        ? `<div class="relative shrink-0"><img src="${photos[0]}" class="w-9 h-9 rounded-full object-cover" />${photos.length > 1 ? `<span class="absolute -bottom-1 -right-1 bg-diesel text-white text-[9px] font-num rounded-full w-4 h-4 flex items-center justify-center">${photos.length}</span>` : ""}</div>`
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
          ${d.linkedUid ? `<div class="text-shift">Вносит смены сам: ${escapeHtml(d.linkedEmail || "аккаунт привязан")}</div>` : ""}
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

// preset — когда форму открыли из заявки на доступ в «Смену»:
// { fullName, phone, linkUid } — ФИО и телефон из заявки (для новой
// карточки) и аккаунт, который нужно сразу выбрать в поле доступа.
function openDriverForm(existing, preset) {
  preset = preset || {};
  driverLicenseFiles = [];
  driverExistingPhotos = existing ? driverPhotos(existing).slice() : [];
  const overlay = el("div", "fixed inset-0 bg-black/40 z-30 flex items-end justify-center");
  const card = el("div", "bg-white rounded-t-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto");
  const f = (k) => (existing && existing[k]) ? escapeHtml(existing[k]) : (!existing && preset[k]) ? escapeHtml(preset[k]) : "";

  // кого можно привязать: тех, кто ждёт доступа, и уже привязанный к этой карточке аккаунт
  const oldUid = existing ? (existing.linkedUid || null) : null;
  const linkOptions = [];
  if (oldUid) linkOptions.push({ uid: oldUid, label: `${existing.linkedEmail || "привязанный аккаунт"} — привязан сейчас` });
  nskWaitingRequests().forEach((r) => {
    if (r.id !== oldUid) linkOptions.push({ uid: r.id, label: `${r.name || "без имени"} · ${r.email || ""}` });
  });
  // аккаунт из заявки выбираем сразу, если заявка ещё ждёт
  const presetRequest = preset.linkUid ? linkOptions.find((o) => o.uid === preset.linkUid) : null;
  const selectedUid = presetRequest ? preset.linkUid : oldUid;

  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">${existing ? "Изменить водителя" : "Добавить водителя"}</div>
    ${presetRequest ? `<div class="text-xs text-slate-600 bg-route/10 border border-route/40 rounded-lg px-3 py-2">Подтверждаешь доступ в «Смену» для аккаунта <b>${escapeHtml(presetRequest.label)}</b>. Проверь ФИО, задай ставки и нажми «Сохранить».</div>` : ""}
    <label class="block text-xs text-slate-500">ФИО
      <input id="df-name" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Иванов Иван Иванович" value="${f("fullName")}" />
    </label>
    <label class="block text-xs text-slate-500">Номер телефона
      <input id="df-phone" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="+7 900 000 00 00" value="${f("phone")}" />
    </label>
    <label class="block text-xs text-slate-500">Удостоверение (номер)
      <input id="df-license" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value="${f("licenseNumber")}" />
    </label>
    <div class="text-xs text-slate-500">Фото водительского удостоверения (можно до ${DRIVER_PHOTO_LIMIT} штук)</div>
    <div class="flex gap-2">
      <button id="df-cam" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm flex items-center justify-center">${ICONS.camera}Камера</button>
      <button id="df-gal" class="flex-1 py-2.5 rounded-lg bg-slate-100 text-slate-700 font-semibold text-sm">Галерея</button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="df-cam-input" class="hidden" />
    <input type="file" accept="image/*" multiple id="df-gal-input" class="hidden" />
    <div id="df-thumbs" class="flex gap-2 flex-wrap"></div>
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
    <div class="text-xs text-slate-400 font-semibold pt-1">Доступ в приложение «Смена»</div>
    <label class="block text-xs text-slate-500">Аккаунт водителя
      <select id="df-link" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" ${nskRulesMissing ? "disabled" : ""}>
        <option value="">Нет доступа</option>
        ${linkOptions.map((o) => `<option value="${o.uid}" ${o.uid === selectedUid ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
      </select>
    </label>
    <div class="text-[11px] text-slate-400">${nskRulesMissing
      ? "Недоступно: в Firebase ещё не опубликован блок правил для «Смены»."
      : "Водитель сначала сам регистрируется в «Смене» — после этого его заявка появится вверху вкладки с кнопкой «Подтвердить», а аккаунт — в этом списке. Смены он вносит по ставкам из этой карточки; реквизиты ему не видны."}</div>
    <div id="df-error" class="text-xs text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="df-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="df-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>
    ${existing ? `<button id="df-delete" class="w-full text-xs text-brick font-semibold pt-1">Убрать из списка</button>` : ""}
  `;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function totalPhotoCount() { return driverExistingPhotos.length + driverLicenseFiles.length; }

  function renderThumbs() {
    const box = card.querySelector("#df-thumbs");
    box.innerHTML = "";
    driverExistingPhotos.forEach((url, i) => {
      const wrap = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg cursor-pointer");
      img.src = url;
      img.onclick = () => window.open(url, "_blank");
      const del = el("button", "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brick text-white text-xs flex items-center justify-center", "✕");
      del.onclick = () => { driverExistingPhotos.splice(i, 1); renderThumbs(); };
      wrap.appendChild(img); wrap.appendChild(del);
      box.appendChild(wrap);
    });
    driverLicenseFiles.forEach((f2, i) => {
      const wrap = el("div", "relative w-16 h-16");
      const img = el("img", "w-16 h-16 object-cover rounded-lg");
      img.src = URL.createObjectURL(f2);
      const del = el("button", "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-brick text-white text-xs flex items-center justify-center", "✕");
      del.onclick = () => { driverLicenseFiles.splice(i, 1); renderThumbs(); };
      wrap.appendChild(img); wrap.appendChild(del);
      box.appendChild(wrap);
    });
    if (!totalPhotoCount()) box.innerHTML = `<div class="text-xs text-slate-400">Фото не выбрано</div>`;
  }
  renderThumbs();

  function addFiles(files) {
    const room = DRIVER_PHOTO_LIMIT - totalPhotoCount();
    if (room <= 0) { alert(`Можно приложить не больше ${DRIVER_PHOTO_LIMIT} фото.`); return; }
    Array.from(files).slice(0, room).forEach((f2) => driverLicenseFiles.push(f2));
    renderThumbs();
  }
  card.querySelector("#df-cam").onclick = () => card.querySelector("#df-cam-input").click();
  card.querySelector("#df-gal").onclick = () => card.querySelector("#df-gal-input").click();
  card.querySelector("#df-cam-input").onchange = (e) => { if (e.target.files[0]) addFiles([e.target.files[0]]); };
  card.querySelector("#df-gal-input").onchange = (e) => { addFiles(e.target.files); };

  card.querySelector("#df-cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  card.querySelector("#df-save").onclick = async () => {
    const fullName = card.querySelector("#df-name").value.trim();
    const errBox = card.querySelector("#df-error");
    const fail = (text) => { errBox.textContent = text; errBox.classList.remove("hidden"); };
    if (!fullName) return fail("Заполни хотя бы ФИО.");

    const newUid = nskRulesMissing ? oldUid : (card.querySelector("#df-link").value || null);
    const request = newUid ? nskRequestsCache.find((r) => r.id === newUid) : null;
    const payload = {
      fullName,
      phone: card.querySelector("#df-phone").value.trim(),
      licenseNumber: card.querySelector("#df-license").value.trim(),
      hourlyRate: Number(card.querySelector("#df-hourly").value) || null,
      shiftRate: Number(card.querySelector("#df-shift").value) || null,
      bankName: card.querySelector("#df-bank").value.trim(),
      bankAccount: card.querySelector("#df-account").value.trim(),
      active: true,
      // аккаунт водителя в приложении «Смена» (null — доступа нет)
      linkedUid: newUid,
      linkedEmail: newUid ? ((request && request.email) || (newUid === oldUid && existing.linkedEmail) || "") : "",
    };
    if (newUid && !payload.hourlyRate && !payload.shiftRate) {
      return fail("Задай хотя бы одну ставку: без неё водитель не сможет внести смену в приложении.");
    }

    const btn = card.querySelector("#df-save");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      const newUrls = [];
      for (let i = 0; i < driverLicenseFiles.length; i++) {
        btn.textContent = `Загружаю фото ${i + 1}/${driverLicenseFiles.length}…`;
        const resized = await resizeImageTabel(driverLicenseFiles[i]);
        newUrls.push(await uploadToCloudinary(resized));
      }
      payload.licensePhotoUrls = [...driverExistingPhotos, ...newUrls];
      btn.textContent = "Сохраняю…";

      // карточка и доступ пишутся одной пачкой: либо всё, либо ничего —
      // чтобы ставка в карточке и её копия для «Смены» не разошлись
      const ref = existing ? db.collection("tabelDrivers").doc(existing.id) : db.collection("tabelDrivers").doc();
      const batch = db.batch();
      if (existing) batch.update(ref, payload);
      else batch.set(ref, { ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (oldUid && oldUid !== newUid) {
        // доступ сняли или передали другому аккаунту: прежний теряет его сразу,
        // заявку убираем — если понадобится, человек подаст её заново
        batch.delete(db.collection("nskAccess").doc(oldUid));
        batch.delete(db.collection("nskUsers").doc(oldUid));
      }
      if (newUid) batch.set(db.collection("nskAccess").doc(newUid), nskAccessDoc(ref.id, payload));
      await batch.commit();

      // Пометки на сменах и авансах сверяем при каждом сохранении карточки с
      // доступом (а не только при привязке): если какая-то запись осталась
      // без пометки, достаточно открыть карточку и нажать «Сохранить».
      // Лишних записей в базу это не даёт — правятся только расхождения.
      if (oldUid !== newUid || newUid) {
        btn.textContent = "Обновляю смены…";
        await nskRetagDriverRecords(ref.id, fullName, newUid);
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
      if (!confirm(`Убрать «${existing.fullName}» из списка? Прошлые смены и авансы останутся в истории.${oldUid ? " Доступ в приложение «Смена» у него отключится." : ""}`)) return;
      try {
        const batch = db.batch();
        batch.update(db.collection("tabelDrivers").doc(existing.id), { active: false });
        if (oldUid && !nskRulesMissing) batch.update(db.collection("nskAccess").doc(oldUid), { active: false });
        await batch.commit();
        overlay.remove();
      } catch (e) {
        alert("Не получилось: " + e.message);
      }
    };
  }
}
