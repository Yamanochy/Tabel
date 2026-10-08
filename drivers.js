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
//
// Водитель ушёл и вернулся. «Убрать из списка» карточку не стирает, а
// прячет (active: false) и выключает доступ. Вернуть человека можно двумя
// путями, оба ведут к одной и той же карточке, без дублей:
//   • кнопка «Вернуть» в разделе «Убранные из списка» внизу вкладки —
//     карточка возвращается, доступ прежнего аккаунта включается;
//   • он зарегистрировался заново (новая заявка) — в окне «Подтвердить»
//     можно выбрать его убранную карточку или карточку, которая уже
//     привязана к его старому аккаунту (доступ перейдёт на новый).
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
let nskAccessLoaded = false; // список доступов уже пришёл из базы
let removedDriversOpen = false; // раскрыт ли раздел «Убранные из списка»

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
    nskAccessLoaded = true;
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
  // пока список доступов не пришёл из базы, «ждущими» выглядели бы все подряд
  if (!nskAccessLoaded) return [];
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

// доступ этого аккаунта включён прямо сейчас
function nskAccessIsOn(uid) {
  const acc = nskAccessCache.find((a) => a.id === uid);
  return !!acc && acc.active === true;
}

// Прежний аккаунт карточки можно лишать доступа, только если этот доступ
// действительно её: документ доступа указывает на эту карточку и аккаунт
// не записан в другой действующей. Иначе, перепривязывая одну карточку,
// можно было бы молча отключить работающего водителя.
function nskOldAccountIsOurs(card, oldUid) {
  const acc = nskAccessCache.find((a) => a.id === oldUid);
  if (acc && acc.driverId && acc.driverId !== card.id) return false;
  return !driversCache.some((x) => x.id !== card.id && x.active !== false && x.linkedUid === oldUid);
}

// действующий водитель с теми же фамилией и именем (для Табеля это один человек:
// смены, авансы и реквизиты сопоставляются именно по фамилии и имени)
function nskActiveTwin(d) {
  const key = nameKey(d.fullName);
  return driversCache.find((x) => x.id !== d.id && x.active !== false && nameKey(x.fullName) === key) || null;
}

// последние 10 цифр номера: «+7 923 …» и «8923…» — один и тот же телефон
function nskPhoneDigits(s) { return String(s || "").replace(/\D/g, "").slice(-10); }
function nskPhonesDiffer(a, b) {
  const x = nskPhoneDigits(a), y = nskPhoneDigits(b);
  return x.length === 10 && y.length === 10 && x !== y;
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
  // «Пётр» и «Петр» — одно имя: в заявке водитель мог написать и так, и так
  return String(name || "").trim().toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(Boolean);
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
// Карточка может быть любой:
//   • обычной, без доступа;
//   • убранной из списка — тогда она заодно возвращается в список;
//   • уже привязанной к другому аккаунту (водитель завёл новый) — тогда
//     прежний аккаунт теряет доступ сразу, а его заявка убирается.
// Возвращает false, если доступ выдан, а пометить прошлые записи не вышло.
async function nskLinkExistingCard(driver, request) {
  const linkedEmail = request.email || "";
  const oldUid = driver.linkedUid || null;
  const batch = db.batch();
  batch.update(db.collection("tabelDrivers").doc(driver.id), { active: true, linkedUid: request.id, linkedEmail });
  if (oldUid && oldUid !== request.id && nskOldAccountIsOurs(driver, oldUid)) {
    batch.delete(db.collection("nskAccess").doc(oldUid));
    batch.delete(db.collection("nskUsers").doc(oldUid));
  }
  batch.set(db.collection("nskAccess").doc(request.id), nskAccessDoc(driver.id, {
    fullName: driver.fullName,
    hourlyRate: driver.hourlyRate || null,
    shiftRate: driver.shiftRate || null,
    linkedEmail,
  }));
  await batch.commit();
  // доступ уже выдан; пометки на прошлых сменах и авансах — отдельным шагом
  try {
    await nskRetagDriverRecords(driver.id, driver.fullName, request.id);
    return true;
  } catch (e) {
    return false;
  }
}

const NSK_RETAG_FAILED = "но пометить прошлые смены и авансы не получилось — похоже, пропала связь. Открой карточку водителя и нажми «Сохранить»: пометки проставятся.";

function openNskApproveDialog(request) {
  // Кого можно выбрать:
  //   free    — в списке, аккаунта ещё нет (обычный случай);
  //   removed — убран из списка: вернётся в список и получит доступ;
  //   taken   — уже работает с другого аккаунта: доступ перейдёт на этот.
  // (карточка, где записан этот же аккаунт, но доступа почему-то нет, — тоже «без доступа»)
  const free = driversCache.filter((d) => d.active !== false && (!d.linkedUid || d.linkedUid === request.id));
  // Убранную карточку не предлагаем, если на того же человека уже есть
  // действующая: привязка к старой переписала бы на неё пометки его смен
  // и подменила бы реквизиты в реестре на выплату.
  const removed = driversCache.filter((d) => d.active === false && !nskActiveTwin(d));
  const taken = driversCache.filter((d) => d.active !== false && d.linkedUid && d.linkedUid !== request.id);
  const everyone = free.concat(removed, taken);
  const kindOf = (d) => (d.active === false ? "removed" : (d.linkedUid && d.linkedUid !== request.id) ? "taken" : "free");
  const safeMatches = free.concat(removed).filter((d) => nskCardMatchesRequest(d, request));
  const takenMatches = taken.filter((d) => nskCardMatchesRequest(d, request));
  // Подставляем карточку сами, только если совпадение ровно одно и нет
  // действующего водителя с тем же именем и своим аккаунтом. Карточку, у
  // которой доступ уже есть, не подставляем никогда: заявку с чужим именем
  // может подать кто угодно, и перенос доступа должен быть осознанным выбором.
  const preselected = safeMatches.length === 1 && !takenMatches.length ? safeMatches[0].id : "";

  const option = (d, label) => `<option value="${d.id}" ${d.id === preselected ? "selected" : ""}>${escapeHtml(label)}</option>`;
  const grouped = removed.length > 0 || taken.length > 0;
  const group = (title, list, labelOf) => (list.length
    ? `<optgroup label="${title}">${list.map((d) => option(d, labelOf(d))).join("")}</optgroup>` : "");
  const options = grouped
    ? group("В списке, без доступа", free, (d) => d.fullName)
      + group("Убранные из списка — вернуть", removed, (d) => d.fullName)
      + group("Уже с доступом — перенести на этот аккаунт", taken, (d) => `${d.fullName} · ${d.linkedEmail || "аккаунт привязан"}`)
    : free.map((d) => option(d, d.fullName)).join("");

  const overlay = el("div", "fixed inset-0 bg-black/40 z-30 flex items-end justify-center");
  const card = el("div", "bg-white rounded-t-2xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto");
  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">Подтвердить доступ в «Смену»</div>
    <div class="bg-slate-50 rounded-lg px-3 py-2">
      <div class="text-sm font-semibold text-slate-800 break-words">${escapeHtml(request.name || "без имени")}</div>
      <div class="text-xs text-slate-500 break-all">${escapeHtml(request.email || "")}${request.phone ? " · " + escapeHtml(request.phone) : ""}</div>
    </div>
    <label class="block text-xs text-slate-500">Чья это карточка
      <select id="na-driver" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="">Выбери водителя</option>
        ${options}
        <option value="__new__">Новый водитель — создать карточку</option>
      </select>
    </label>
    <div id="na-hint" class="text-xs text-slate-500 break-words"></div>
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
  const chosen = () => everyone.find((d) => d.id === select.value) || null;
  const oldAccount = (d) => d.linkedEmail || "без почты";
  // прежний аккаунт потеряет доступ (а не просто останется записью в карточке)
  const losesOld = (d) => !!d.linkedUid && d.linkedUid !== request.id && nskOldAccountIsOurs(d, d.linkedUid);
  // телефон в заявке не тот, что в карточке, — повод позвонить, прежде чем отдавать доступ
  const phoneNote = (d) => (nskPhonesDiffer(d.phone, request.phone)
    ? ` Телефон в заявке (${request.phone}) не совпадает с карточкой (${d.phone}) — позвони водителю по номеру из карточки.` : "");
  const SEES_HISTORY = " Этот аккаунт увидит все его прошлые смены и авансы.";

  function update() {
    errBox.classList.add("hidden");
    const d = chosen();
    const kind = d ? kindOf(d) : null;
    let text, button = "Подтвердить", warn = false;
    if (select.value === "__new__") {
      const twin = safeMatches[0] || takenMatches[0];
      if (twin) {
        text = `Карточка с таким именем уже есть: «${twin.fullName}». Выбери её в списке — иначе на одного человека получится две карточки, и его смены с реквизитами перепутаются.`;
        warn = true;
      } else {
        text = "Откроется новая карточка: проверь ФИО, задай ставки и нажми «Сохранить».";
      }
      button = "Создать карточку";
    } else if (!d) {
      if (takenMatches.length) {
        const t0 = takenMatches[0];
        text = `Водитель с таким именем уже работает: «${t0.fullName}», аккаунт ${oldAccount(t0)}. Если это он завёл новый аккаунт, выбери его в разделе «Уже с доступом». Если нет — сначала выясни, кто подал заявку.`;
        warn = true;
      } else if (everyone.length) {
        text = "Выбери, кому из водителей принадлежит этот аккаунт. Если его ещё нет в списке, выбери «Новый водитель».";
      } else {
        text = "Карточек водителей пока нет — выбери «Новый водитель».";
      }
    } else {
      if (!d.hourlyRate && !d.shiftRate) {
        text = "У этого водителя не заданы ставки, а без них смену не внести. Откроется его карточка: задай ставку и нажми «Сохранить»."
          + (kind === "removed" ? " После сохранения он вернётся в список." : "");
        button = "Открыть карточку";
      } else if (kind === "removed") {
        text = `Убран из списка. После подтверждения вернётся в список и получит доступ. Ставки: ${nskRatesText(d)}.` + SEES_HISTORY
          + (losesOld(d) ? ` Прежний аккаунт (${oldAccount(d)}) останется без доступа.` : "");
        button = "Вернуть и подтвердить";
      } else if (kind === "taken") {
        text = `Сейчас у него доступ с аккаунта ${oldAccount(d)}. После подтверждения доступ перейдёт на новый аккаунт, со старого войти будет нельзя. Убедись, что заявку подал он сам.`;
        button = "Перенести доступ";
        warn = true;
      } else {
        text = `Ставки: ${nskRatesText(d)}. Смены в приложении он будет вносить под именем «${d.fullName}».`;
      }
      const note = phoneNote(d);
      if (note) { text += note; warn = true; }
    }
    hint.textContent = text;
    hint.className = "text-xs break-words " + (warn ? "text-brick" : "text-slate-500");
    okBtn.textContent = button;
  }
  select.onchange = update;
  update();

  card.querySelector("#na-cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  okBtn.onclick = async () => {
    const fail = (msg) => { errBox.textContent = msg; errBox.classList.remove("hidden"); };
    if (select.value === "__new__") {
      overlay.remove();
      openDriverForm(null, { fullName: request.name || "", phone: request.phone || "", linkUid: request.id });
      return;
    }
    const d = chosen();
    if (!d) return fail("Выбери карточку водителя или «Новый водитель».");

    // пока окно было открыто, заявку или карточку мог обработать второй руководитель
    const fresh = driversCache.find((x) => x.id === d.id);
    const changed = !fresh || (fresh.linkedUid || null) !== (d.linkedUid || null) || (fresh.active === false) !== (d.active === false);
    if (changed || !nskWaitingRequests().some((r) => r.id === request.id)) {
      return fail("Пока окно было открыто, эту заявку или карточку уже изменили. Закрой окно и открой заявку заново.");
    }

    // доступ к чужой истории начислений отдаём только после явного «да»
    const kind = kindOf(d);
    if (kind === "taken" && !confirm(`Перенести доступ «${d.fullName}» с аккаунта ${oldAccount(d)} на ${request.email || "новый аккаунт"}? Со старого аккаунта войти будет нельзя, а новый увидит все его смены и авансы.${phoneNote(d)}`)) return;
    if (kind === "removed" && !confirm(`Вернуть «${d.fullName}» в список и дать доступ аккаунту ${request.email || "из заявки"}?${SEES_HISTORY}${phoneNote(d)}`)) return;

    if (!d.hourlyRate && !d.shiftRate) {
      overlay.remove();
      openDriverForm(d, { linkUid: request.id });
      return;
    }
    okBtn.disabled = true; okBtn.textContent = "Подтверждаю…";
    try {
      const tagged = await nskLinkExistingCard(d, request);
      overlay.remove();
      if (!tagged) alert("Доступ выдан, " + NSK_RETAG_FAILED);
    } catch (e) {
      okBtn.disabled = false;
      update();
      fail("Не получилось: " + e.message);
    }
  };
}

// ---------- убранные из списка: вернуть водителя ----------

// Возвращает карточку в список. Если к ней был привязан аккаунт «Смены»,
// доступ включается снова — водителю не нужно ни регистрироваться заново,
// ни входить: приложение откроется у него само.
async function nskRestoreDriver(d, btn) {
  // На того же человека уже есть действующая карточка — вторую не возвращаем:
  // пометки на его сменах переписались бы на старый аккаунт (рабочий увидел бы
  // пустой список), а реестр на выплату начал бы брать реквизиты не из той.
  const twin = nskActiveTwin(d);
  if (twin) {
    alert(`В списке уже есть «${twin.fullName}». Вторая карточка на того же человека не нужна: его смены в «Смене» и реквизиты в реестре начали бы браться не из той карточки. Если нужно что-то поправить — поправь в действующей.`);
    return;
  }
  // пока водителя не было, его аккаунт могли привязать к другой карточке
  const ours = !d.linkedUid || nskOldAccountIsOurs(d, d.linkedUid);
  const holder = d.linkedUid ? driversCache.find((x) => x.id !== d.id && x.active !== false && x.linkedUid === d.linkedUid) : null;
  const hasRate = !!(d.hourlyRate || d.shiftRate);
  const linked = !!d.linkedUid && ours;
  const giveAccess = linked && hasRate && !nskRulesMissing;

  let text = `Вернуть «${d.fullName}» в список?`;
  if (giveAccess) text += ` Доступ в приложение «Смена» для аккаунта ${d.linkedEmail || "водителя"} включится снова.`;
  else if (linked && !hasRate) text += " У него привязан аккаунт «Смены», но не задана ставка: откроется карточка — задай ставку и нажми «Сохранить», иначе доступ не включится.";
  else if (d.linkedUid && !ours) text += ` Его аккаунт в «Смене» сейчас привязан к другой карточке${holder ? " — «" + holder.fullName + "»" : ""}, поэтому эта карточка вернётся без доступа.`;
  if (!confirm(text)) return;

  if (btn) { btn.disabled = true; btn.textContent = "Возвращаю…"; }
  try {
    const batch = db.batch();
    const cardRef = db.collection("tabelDrivers").doc(d.id);
    if (d.linkedUid && !ours) batch.update(cardRef, { active: true, linkedUid: null, linkedEmail: "" });
    else batch.update(cardRef, { active: true });
    if (giveAccess) {
      batch.set(db.collection("nskAccess").doc(d.linkedUid), nskAccessDoc(d.id, {
        fullName: d.fullName,
        hourlyRate: d.hourlyRate || null,
        shiftRate: d.shiftRate || null,
        linkedEmail: d.linkedEmail || "",
      }));
    }
    await batch.commit();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Вернуть"; }
    alert("Не получилось: " + e.message);
    return;
  }
  // Пометки на сменах и авансах сверяем, только когда доступ действительно
  // выдан. Тёзок среди действующих нет (проверено выше), так что чужие
  // записи это не заденет.
  if (giveAccess) {
    try { await nskRetagDriverRecords(d.id, d.fullName, d.linkedUid); }
    catch (e) { alert("Водитель возвращён и доступ включён, " + NSK_RETAG_FAILED); }
  }
  // аккаунт привязан, а ставки нет — без неё доступ не включить: сразу открываем карточку
  if (linked && !hasRate && !nskRulesMissing) openDriverForm({ ...d, active: true });
}

function renderRemovedDrivers(removed) {
  const box = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  const head = el("button", "w-full px-4 py-3 flex items-center justify-between gap-3 text-left");
  head.id = "removed-toggle";
  head.innerHTML = `
    <span class="text-sm font-semibold text-slate-600">Убранные из списка: ${removed.length}</span>
    <span class="text-xs text-slate-400 shrink-0">${removedDriversOpen ? "Скрыть" : "Показать"}</span>`;
  head.onclick = () => { removedDriversOpen = !removedDriversOpen; render(); };
  box.appendChild(head);
  if (!removedDriversOpen) return box;

  const body = el("div", "divide-y divide-slate-100 border-t border-slate-100");
  removed.forEach((d) => {
    const row = el("div", "px-4 py-3 flex items-center gap-3");
    row.dataset.removed = d.id;
    const info = el("div", "flex-1 min-w-0");
    info.innerHTML = `
      <div class="font-semibold text-slate-700 truncate">${escapeHtml(d.fullName)}</div>
      <div class="text-xs text-slate-400 break-words">${d.phone ? escapeHtml(d.phone) : "телефон не указан"}${d.linkedUid ? " · был доступ в «Смену»: " + escapeHtml(d.linkedEmail || "аккаунт привязан") : ""}</div>`;
    row.appendChild(info);
    const back = el("button", "shrink-0 text-sm font-semibold text-diesel bg-slate-100 px-3 py-2 rounded-lg", "Вернуть");
    back.onclick = () => nskRestoreDriver(d, back);
    row.appendChild(back);
    body.appendChild(row);
  });
  box.appendChild(body);
  box.appendChild(el("div", "px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100",
    "«Вернуть» возвращает карточку в список. Если у водителя был доступ в «Смену», он включится снова — регистрироваться заново ему не нужно."));
  return box;
}

// строка про доступ в карточке списка: есть ли он на самом деле
function nskLinkLine(d) {
  const email = escapeHtml(d.linkedEmail || "аккаунт привязан");
  // пока список доступов не загружен (или правила не опубликованы), зря не пугаем
  if (!nskAccessLoaded || nskRulesMissing || nskAccessIsOn(d.linkedUid)) {
    return `<div class="text-shift break-words">Вносит смены сам: ${email}</div>`;
  }
  return `<div class="text-brick break-words">Аккаунт ${email} привязан, но доступ выключен. Чтобы включить, нажми «Изменить данные» и «Сохранить».</div>`;
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
          ${d.linkedUid ? nskLinkLine(d) : ""}
        </div>`;
      const editBtn = el("button", "text-xs text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-lg font-medium mt-2 ml-12", "Изменить данные");
      editBtn.onclick = () => openDriverForm(d);
      row.appendChild(editBtn);
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);

  const removed = driversCache.filter((d) => d.active === false);
  if (removed.length) wrap.appendChild(renderRemovedDrivers(removed));

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
  // карточка убрана из списка (сюда попадают из окна «Подтвердить»): сохранение вернёт её в список
  const wasRemoved = !!existing && existing.active === false;
  if (oldUid) linkOptions.push({ uid: oldUid, label: `${existing.linkedEmail || "привязанный аккаунт"} — ${wasRemoved ? "был привязан, доступ отключён" : "привязан сейчас"}` });
  nskWaitingRequests().forEach((r) => {
    if (r.id !== oldUid) linkOptions.push({ uid: r.id, label: `${r.name || "без имени"} · ${r.email || ""}` });
  });
  // аккаунт из заявки выбираем сразу, если заявка ещё ждёт
  const presetRequest = preset.linkUid ? linkOptions.find((o) => o.uid === preset.linkUid) : null;
  const selectedUid = presetRequest ? preset.linkUid : oldUid;

  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">${existing ? "Изменить водителя" : "Добавить водителя"}</div>
    ${presetRequest ? `<div class="text-xs text-slate-600 bg-route/10 border border-route/40 rounded-lg px-3 py-2">Подтверждаешь доступ в «Смену» для аккаунта <b>${escapeHtml(presetRequest.label)}</b>. Проверь ФИО, задай ставки и нажми «Сохранить».</div>` : ""}
    ${wasRemoved ? `<div class="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Карточка сейчас убрана из списка. После сохранения она вернётся в список.</div>` : ""}
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
    ${existing && !wasRemoved ? `<button id="df-delete" class="w-full text-xs text-brick font-semibold pt-1">Убрать из списка</button>` : ""}
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
      if (oldUid && oldUid !== newUid && nskOldAccountIsOurs(existing, oldUid)) {
        // доступ сняли или передали другому аккаунту: прежний теряет его сразу,
        // заявку убираем — если понадобится, человек подаст её заново
        // (если этот аккаунт уже записан в другой действующей карточке, его не трогаем)
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

  if (existing && !wasRemoved) {
    card.querySelector("#df-delete").onclick = async () => {
      if (!confirm(`Убрать «${existing.fullName}» из списка? Прошлые смены и авансы останутся в истории.${oldUid ? " Доступ в приложение «Смена» у него отключится." : ""} Вернуть его можно будет внизу вкладки, в разделе «Убранные из списка».`)) return;
      try {
        const batch = db.batch();
        batch.update(db.collection("tabelDrivers").doc(existing.id), { active: false });
        // выключаем доступ, только если он есть и принадлежит этой карточке
        // (обновление несуществующего документа сорвало бы всю операцию)
        if (oldUid && !nskRulesMissing && nskAccessCache.some((a) => a.id === oldUid) && nskOldAccountIsOurs(existing, oldUid)) {
          batch.update(db.collection("nskAccess").doc(oldUid), { active: false });
        }
        await batch.commit();
        overlay.remove();
      } catch (e) {
        alert("Не получилось: " + e.message);
      }
    };
  }
}
