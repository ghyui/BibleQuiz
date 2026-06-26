import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBkPuHEluAU-7nWki7Nc0RrH3T1kqa-C20",
  authDomain: "biblequiz-c2ff6.firebaseapp.com",
  projectId: "biblequiz-c2ff6",
  storageBucket: "biblequiz-c2ff6.firebasestorage.app",
  messagingSenderId: "393495899482",
  appId: "1:393495899482:web:fdbb779cbfa9953dc41763",
};

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
      firstSeenAt: d.firstSeenAt || null,
      lastLoginAt: d.lastLoginAt || null,
      updatedAt: d.updatedAt || null,
    };
  }
  return { history: {}, wrong: [], attempts: {} };
}

export async function pushUserData(name, data) {
  const id = sanitizeId(name);
  await setDoc(doc(db, "users", id), {
    history: data.history || {},
    wrong: data.wrong || [],
    attempts: data.attempts || {},
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
