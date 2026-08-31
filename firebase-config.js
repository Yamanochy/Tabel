// ============================================================
// FIREBASE — тот же проект, что и в Досатуй (dosatuy), специально:
// так Табель может напрямую читать данные Досатуй (ТТН, ремонт),
// без отдельной синхронизации между двумя базами.
// Если когда-нибудь понадобится вынести Табель в отдельный проект —
// правь только этот файл.
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA4BZspRcmA8I_j6mUtIvIHJcTd22k48fg",
  authDomain: "dosatuy.firebaseapp.com",
  projectId: "dosatuy",
  storageBucket: "dosatuy.firebasestorage.app",
  messagingSenderId: "630795971089",
  appId: "1:630795971089:web:3b80b4d2436bbcc9ac5fb0",
};

firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

// офлайн-кэш Firestore — без этого приложение виснет без сети
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
