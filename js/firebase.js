import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function sanitizeId(name) {
  return String(name).trim().replace(/[\/\.#\$\[\]]/g, "_").slice(0, 80) || "_anon";
}

export async function fetchUserData(name) {
  const id = sanitizeId(name);
  const snap = await getDoc(doc(db, "users", id));
  if (snap.exists()) {
    const d = snap.data();
    return {
      history: d.history || {},
      wrong: d.wrong || [],
      attempts: d.attempts || {},
      hints: d.hints || {},
      lastAt: d.lastAt || {},
      wrongAnswers: d.wrongAnswers || {},
      firstSeenAt: d.firstSeenAt || null,
      lastLoginAt: d.lastLoginAt || null,
      updatedAt: d.updatedAt || null,
    };
  }
  return { history: {}, wrong: [], attempts: {}, hints: {}, lastAt: {}, wrongAnswers: {} };
}

export async function pushUserData(name, data) {
  const id = sanitizeId(name);
  await setDoc(doc(db, "users", id), {
    history: data.history || {},
    wrong: data.wrong || [],
    attempts: data.attempts || {},
    hints: data.hints || {},
    lastAt: data.lastAt || {},
    wrongAnswers: data.wrongAnswers || {},
    updatedAt: Date.now(),
  }, { merge: true });
}

export async function touchUserLogin(name) {
  const id = sanitizeId(name);
  const ref = doc(db, "users", id);
  const snap = await getDoc(ref);
  const update = { lastLoginAt: Date.now() };
  if (!snap.exists() || !snap.data().firstSeenAt) {
    update.firstSeenAt = Date.now();
  }
  await setDoc(ref, update, { merge: true });
}

export async function fetchAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
