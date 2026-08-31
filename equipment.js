// ============================================================
// ТЕХНИКА — список техники в Новосибирске, у каждой единицы свой
// тип оплаты (почасовая/посменная) и ставка.
// ============================================================

let equipmentCache = [];
let equipmentUnsub = null;

function subscribeEquipment() {
  if (equipmentUnsub) return;
  equipmentUnsub = db.collection("tabelEquipment").orderBy("name")
    .onSnapshot((snap) => {
      equipmentCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentTab === "equipment") render();
      if (currentTab === "shifts" && !shiftFormOpen) render();
    }, (err) => console.error(err));
}

function renderEquipment() {
  app.innerHTML = "";
  const wrap = el("div", "space-y-3");

  const addBtn = el("button", "w-full py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm flex items-center justify-center", `${ICONS.plus}<span class="ml-1">Добавить технику</span>`);
  addBtn.onclick = () => openEquipmentForm();
  wrap.appendChild(addBtn);

  const card = el("div", "bg-white rounded-xl border border-slate-200 overflow-hidden");
  const active = equipmentCache.filter((e) => e.active !== false);
  if (!active.length) {
    card.appendChild(el("div", "p-5 text-sm text-slate-400 text-center", "Техника пока не добавлена."));
  } else {
    const body = el("div", "divide-y divide-slate-100");
    active.forEach((e) => {
      const row = el("div", "p-4 flex items-center gap-3");
      row.innerHTML = `
        <div class="w-9 h-9 rounded-lg bg-diesel/5 flex items-center justify-center text-diesel shrink-0">${ICONS.equipment}</div>
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-800 truncate">${escapeHtml(e.name)}</div>
          <div class="text-xs text-slate-400">${e.payType === "hourly" ? "Почасовая" : "Посменная"} · <span class="font-num">${fmtMoney(e.rate)}</span>${e.payType === "hourly" ? "/час" : "/смена"}</div>
        </div>`;
      const editBtn = el("button", "text-xs text-slate-500 bg-slate-100 px-2.5 py-1.5 rounded-lg font-medium shrink-0", "Изменить");
      editBtn.onclick = () => openEquipmentForm(e);
      row.appendChild(editBtn);
      body.appendChild(row);
    });
    card.appendChild(body);
  }
  wrap.appendChild(card);
  app.appendChild(wrap);
}

function openEquipmentForm(existing) {
  const overlay = el("div", "fixed inset-0 bg-black/40 z-30 flex items-end justify-center");
  const card = el("div", "bg-white rounded-t-2xl w-full max-w-md p-5 space-y-3 max-h-[85vh] overflow-y-auto");
  card.innerHTML = `
    <div class="font-bold font-display text-lg text-diesel">${existing ? "Изменить технику" : "Добавить технику"}</div>
    <label class="block text-xs text-slate-500">Название
      <input id="ef-name" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="напр. Экскаватор JCB 3CX" value="${existing ? escapeHtml(existing.name) : ""}" />
    </label>
    <label class="block text-xs text-slate-500">Тип оплаты
      <select id="ef-paytype" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
        <option value="hourly" ${existing && existing.payType === "hourly" ? "selected" : ""}>Почасовая</option>
        <option value="shift" ${existing && existing.payType === "shift" ? "selected" : ""}>Посменная</option>
      </select>
    </label>
    <label class="block text-xs text-slate-500">Ставка, ₽
      <input id="ef-rate" type="number" min="0" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-num" value="${existing ? existing.rate : ""}" />
    </label>
    <div id="ef-error" class="text-xs text-brick hidden"></div>
    <div class="flex gap-2 pt-1">
      <button id="ef-save" class="flex-1 py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Сохранить</button>
      <button id="ef-cancel" class="px-4 py-2.5 rounded-lg bg-slate-100 text-slate-600 font-semibold text-sm">Отмена</button>
    </div>
    ${existing ? `<button id="ef-delete" class="w-full text-xs text-brick font-semibold pt-1">Убрать из списка</button>` : ""}
  `;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  card.querySelector("#ef-cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  card.querySelector("#ef-save").onclick = async () => {
    const name = card.querySelector("#ef-name").value.trim();
    const payType = card.querySelector("#ef-paytype").value;
    const rate = Number(card.querySelector("#ef-rate").value);
    const errBox = card.querySelector("#ef-error");
    if (!name || !rate) {
      errBox.textContent = "Заполни название и ставку.";
      errBox.classList.remove("hidden");
      return;
    }
    const btn = card.querySelector("#ef-save");
    btn.disabled = true; btn.textContent = "Сохраняю…";
    try {
      const payload = { name, payType, rate, active: true };
      if (existing) {
        await db.collection("tabelEquipment").doc(existing.id).update(payload);
      } else {
        await db.collection("tabelEquipment").add({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      overlay.remove();
    } catch (e) {
      errBox.textContent = "Не получилось: " + e.message;
      errBox.classList.remove("hidden");
      btn.disabled = false; btn.textContent = "Сохранить";
    }
  };

  if (existing) {
    card.querySelector("#ef-delete").onclick = async () => {
      if (!confirm(`Убрать «${existing.name}» из списка? Прошлые смены на ней останутся в истории.`)) return;
      await db.collection("tabelEquipment").doc(existing.id).update({ active: false });
      overlay.remove();
    };
  }
}
