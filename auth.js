// ============================================================
// ВХОД — без регистрации: сюда заходят тем же логином, что и в Досатуй.
// После входа email проверяется по списку TABEL_ALLOWED_EMAILS —
// если его там нет, доступ закрыт, даже если пароль верный.
// ============================================================

let currentUser = null;
let currentProfileName = "";

const authScreen = document.getElementById("auth-screen");
const shell = document.getElementById("app-shell");

function renderAuthScreen(message = "", isError = false) {
  authScreen.classList.remove("hidden");
  shell.classList.add("hidden");
  authScreen.innerHTML = `
    <div class="min-h-screen flex items-center justify-center px-5 bg-diesel">
      <div class="w-full max-w-sm">
        <div class="text-center mb-6">
          <img src="icon-192.png" class="w-14 h-14 rounded-xl mx-auto mb-3 shadow" />
          <div class="text-white text-2xl font-bold font-display">Табель</div>
          <div class="text-white/50 text-xs font-num tracking-wide mt-1">ТЕХНИКА · НОВОСИБИРСК</div>
        </div>
        <div class="bg-white rounded-xl p-5 space-y-3">
          <label class="block text-xs text-slate-500">Email
            <input id="af-email" type="email" autocomplete="username" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="как в Досатуй" />
          </label>
          <label class="block text-xs text-slate-500">Пароль
            <input id="af-pass" type="password" autocomplete="current-password" class="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="тот же, что в Досатуй" />
          </label>
          <div id="af-error" class="text-xs text-brick hidden"></div>
          <button id="af-submit" class="w-full py-2.5 rounded-lg bg-diesel text-white font-semibold text-sm">Войти</button>
          <button id="af-forgot" class="w-full text-xs text-slate-400 underline">Забыл пароль</button>
        </div>
        <div class="text-center text-white/30 text-[11px] mt-4">Доступ только для двух аккаунтов, у остальных вход закрыт</div>
      </div>
    </div>`;

  const errBox = document.getElementById("af-error");
  if (message) {
    errBox.textContent = message;
    errBox.classList.toggle("text-brick", isError);
    errBox.classList.toggle("text-shift", !isError);
    errBox.classList.remove("hidden");
  }

  document.getElementById("af-submit").onclick = async () => {
    const email = document.getElementById("af-email").value.trim();
    const pass = document.getElementById("af-pass").value;
    const btn = document.getElementById("af-submit");
    if (!email || !pass) {
      errBox.textContent = "Заполни email и пароль.";
      errBox.className = "text-xs text-brick";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Входим…";
    try {
      await auth.signInWithEmailAndPassword(email, pass);
      // дальше подхватит onAuthStateChanged ниже
    } catch (e) {
      errBox.textContent = friendlyAuthError(e);
      errBox.className = "text-xs text-brick";
      btn.disabled = false;
      btn.textContent = "Войти";
    }
  };

  document.getElementById("af-forgot").onclick = async () => {
    const email = document.getElementById("af-email").value.trim();
    if (!email) {
      errBox.textContent = "Сначала впиши email.";
      errBox.className = "text-xs text-brick";
      errBox.classList.remove("hidden");
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      errBox.textContent = "Письмо для смены пароля отправлено на " + email;
      errBox.className = "text-xs text-shift";
      errBox.classList.remove("hidden");
    } catch (e) {
      errBox.textContent = friendlyAuthError(e);
      errBox.className = "text-xs text-brick";
      errBox.classList.remove("hidden");
    }
  };
}

function friendlyAuthError(e) {
  const map = {
    "auth/invalid-email": "Некорректный email.",
    "auth/user-not-found": "Пользователь не найден.",
    "auth/wrong-password": "Неверный пароль.",
    "auth/invalid-credential": "Неверный email или пароль.",
    "auth/too-many-requests": "Слишком много попыток — подожди немного.",
  };
  return map[e.code] || ("Ошибка: " + e.message);
}

auth.onAuthStateChanged((user) => {
  if (!user) {
    currentUser = null;
    renderAuthScreen();
    return;
  }

  const email = (user.email || "").toLowerCase();
  const allowed = TABEL_ALLOWED_EMAILS.map((e) => e.toLowerCase()).includes(email);
  if (!allowed) {
    auth.signOut();
    renderAuthScreen("У этого аккаунта нет доступа к Табелю.", true);
    return;
  }

  currentUser = user;
  // подхватываем имя из уже существующего профиля в Досатуй, чтобы не
  // заводить его заново — это тот же Firestore-проект
  db.collection("users").doc(user.uid).get().then((doc) => {
    currentProfileName = (doc.exists && doc.data().name) || user.email;
    authScreen.classList.add("hidden");
    shell.classList.remove("hidden");
    startApp();
  }).catch(() => {
    currentProfileName = user.email;
    authScreen.classList.add("hidden");
    shell.classList.remove("hidden");
    startApp();
  });
});
