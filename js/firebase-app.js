/**
 * SuuvieAI — Firebase Auth (Google) + Firestore chat storage
 *
 * Shape:
 *   users/{uid}/chats/{chatId}
 *     title, preview, createdAtMs, updatedAtMs,
 *     messages: [{ role, content, at }]
 *
 * Always mirrors to localStorage. Cloud never wipes local messages.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDocs,
  getDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { firebaseConfig, FIREBASE_ENABLED } from "./firebase-config.js";

let app = null;
let auth = null;
let db = null;
let provider = null;
let ready = false;
let initError = null;

const LS_PREFIX = "suuvieai_chats_v2_";

export function isFirebaseReady() {
  return ready && FIREBASE_ENABLED;
}

export function getFirebaseInitError() {
  return initError;
}

export function formatAuthError(err) {
  const code = err?.code || "";
  const msg = err?.message || String(err);

  if (code === "auth/unauthorized-domain") {
    return (
      `Origin blocked by Firebase. Add "${window.location.hostname}" under\n` +
      `Authentication → Settings → Authorized domains (keep localhost).`
    );
  }
  if (code === "auth/popup-blocked") {
    return "Popup blocked. Allow popups, or use Sign in (redirect).";
  }
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Sign-in popup closed early. Try again.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Enable Google: Authentication → Sign-in method → Google → Enable";
  }
  if (code === "auth/network-request-failed") {
    return "Network error reaching Google/Firebase.";
  }
  return msg || "Sign-in failed.";
}

export function formatFirestoreError(err) {
  const code = err?.code || "";
  const msg = err?.message || String(err);

  if (code === "permission-denied") {
    return (
      "Firestore blocked the write (permission-denied).\n\n" +
      "Firebase Console → Firestore → Rules → paste firestore.rules → Publish\n\n" +
      "Chat is still saved in this browser."
    );
  }
  if (code === "not-found") {
    return "Create Firestore: Build → Firestore Database → Create database";
  }
  if (code === "unavailable" || code === "deadline-exceeded") {
    return "Firestore temporarily unavailable. Chat kept in this browser.";
  }
  return msg || "Could not save to Firebase.";
}

export function initFirebase() {
  if (!FIREBASE_ENABLED) {
    initError =
      "Firebase config not set. Open js/firebase-config.js and paste your web config.";
    console.warn("[SuuvieAI]", initError);
    return false;
  }

  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    provider = new GoogleAuthProvider();
    provider.addScope("profile");
    provider.addScope("email");
    provider.setCustomParameters({ prompt: "select_account" });
    setPersistence(auth, browserLocalPersistence).catch(() => {});
    ready = true;
    console.info("[SuuvieAI] Firebase ready", window.location.origin, firebaseConfig.projectId);
    return true;
  } catch (err) {
    initError = err?.message || String(err);
    console.error("[SuuvieAI] Firebase init failed:", err);
    ready = false;
    return false;
  }
}

export function watchAuth(callback) {
  if (!ready) {
    callback(null);
    return () => {};
  }

  getRedirectResult(auth)
    .then((result) => {
      if (result?.user) {
        console.info("[SuuvieAI] Signed in via redirect:", result.user.email);
      }
    })
    .catch((err) => {
      console.error("[SuuvieAI] redirect result error:", err);
      if (err?.code) window.__suuvieLastAuthError = formatAuthError(err);
    });

  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(mode = "popup") {
  if (!ready) throw new Error(initError || "Firebase not ready");

  if (mode === "redirect") {
    await signInWithRedirect(auth, provider);
    return null;
  }

  try {
    const cred = await signInWithPopup(auth, provider);
    console.info("[SuuvieAI] popup sign-in OK:", cred?.user?.email || cred?.user?.uid);
    return cred;
  } catch (err) {
    const code = err?.code || "";
    console.error("[SuuvieAI] popup sign-in error:", code, err);
    // User closed popup — don't redirect, just surface the error
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      throw err;
    }
    if (
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment"
    ) {
      console.warn("[SuuvieAI] popup blocked → redirect");
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function signOutUser() {
  if (!ready) return;
  await signOut(auth);
}

export function currentUser() {
  return auth?.currentUser || null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lsKey(uid) {
  return LS_PREFIX + uid;
}

function normalizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({
      role: m.role,
      content: String(m.content),
      at: typeof m.at === "number" ? m.at : 0,
    }));
}

function titleFrom(text) {
  const t = (text || "").trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42)}…` : t || "New chat";
}

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function readLocalChats(uid) {
  try {
    const raw = localStorage.getItem(lsKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => ({
      id: c.id,
      title: c.title || "New chat",
      preview: c.preview || "",
      messages: normalizeMessages(c.messages),
      createdAtMs: c.createdAtMs || 0,
      updatedAtMs: c.updatedAtMs || 0,
    }));
  } catch {
    return [];
  }
}

function writeLocalChats(uid, chats) {
  try {
    localStorage.setItem(lsKey(uid), JSON.stringify(chats));
  } catch (err) {
    console.warn("[SuuvieAI] localStorage write failed:", err);
  }
}

/** Merge two chat objects without losing messages */
function mergeChat(a = {}, b = {}) {
  const aMsgs = normalizeMessages(a.messages);
  const bMsgs = normalizeMessages(b.messages);
  // Prefer whichever has MORE messages; if tie, prefer newer updatedAtMs
  let messages = aMsgs;
  if (bMsgs.length > aMsgs.length) messages = bMsgs;
  else if (bMsgs.length === aMsgs.length && bMsgs.length > 0) {
    const aLast = aMsgs[aMsgs.length - 1]?.at || 0;
    const bLast = bMsgs[bMsgs.length - 1]?.at || 0;
    messages = bLast >= aLast ? bMsgs : aMsgs;
  } else if (!aMsgs.length && bMsgs.length) {
    messages = bMsgs;
  }

  const updatedAtMs = Math.max(a.updatedAtMs || 0, b.updatedAtMs || 0);
  const createdAtMs =
    Math.min(
      a.createdAtMs || updatedAtMs || Date.now(),
      b.createdAtMs || updatedAtMs || Date.now()
    ) || Date.now();

  const titleA = a.title && a.title !== "New chat" ? a.title : "";
  const titleB = b.title && b.title !== "New chat" ? b.title : "";

  return {
    id: b.id || a.id,
    title: titleB || titleA || "New chat",
    preview: b.preview || a.preview || "",
    messages,
    createdAtMs,
    updatedAtMs,
  };
}

function upsertLocalChat(uid, chat) {
  const all = readLocalChats(uid);
  const idx = all.findIndex((c) => c.id === chat.id);
  if (idx >= 0) {
    all[idx] = mergeChat(all[idx], chat);
  } else {
    all.unshift({
      id: chat.id,
      title: chat.title || "New chat",
      preview: chat.preview || "",
      messages: normalizeMessages(chat.messages),
      createdAtMs: chat.createdAtMs || Date.now(),
      updatedAtMs: chat.updatedAtMs || Date.now(),
    });
  }
  all.sort((x, y) => (y.updatedAtMs || 0) - (x.updatedAtMs || 0));
  writeLocalChats(uid, all);
  return all;
}

function deleteLocalChat(uid, chatId) {
  writeLocalChats(
    uid,
    readLocalChats(uid).filter((c) => c.id !== chatId)
  );
}

function chatsCol(uid) {
  return collection(db, "users", uid, "chats");
}

function chatFromDoc(d) {
  const data = d.data() || {};
  return {
    id: d.id,
    title: data.title || "New chat",
    preview: data.preview || "",
    messages: normalizeMessages(data.messages),
    createdAtMs: data.createdAtMs || 0,
    updatedAtMs: data.updatedAtMs || 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create empty chat. Returns id. */
export async function createChat(uid, title = "New chat") {
  const now = Date.now();
  let id = newId();

  if (ready) {
    try {
      const ref = await addDoc(chatsCol(uid), {
        title,
        preview: "",
        messages: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdAtMs: now,
        updatedAtMs: now,
      });
      id = ref.id;
    } catch (err) {
      console.error("[SuuvieAI] createChat cloud failed:", err);
      window.__suuvieLastStoreError = formatFirestoreError(err);
    }
  }

  upsertLocalChat(uid, {
    id,
    title,
    preview: "",
    messages: [],
    createdAtMs: now,
    updatedAtMs: now,
  });
  return id;
}

/** List chats newest first (cloud + local merged safely). */
export async function listChats(uid, max = 50) {
  const local = readLocalChats(uid);
  const map = new Map(local.map((c) => [c.id, c]));

  if (ready) {
    try {
      let snap;
      try {
        snap = await getDocs(
          query(chatsCol(uid), orderBy("updatedAtMs", "desc"), limit(max))
        );
      } catch {
        snap = await getDocs(query(chatsCol(uid), limit(max)));
      }

      snap.docs.forEach((d) => {
        const cloudChat = chatFromDoc(d);
        const prev = map.get(cloudChat.id);
        const merged = prev ? mergeChat(prev, cloudChat) : cloudChat;
        map.set(cloudChat.id, merged);
        // Write merge back so local never loses messages
        upsertLocalChat(uid, merged);
      });
    } catch (err) {
      console.error("[SuuvieAI] listChats cloud failed:", err);
      window.__suuvieLastStoreError = formatFirestoreError(err);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0))
    .slice(0, max);
}

/**
 * Load one chat with messages.
 * Returns { id, title, preview, messages: [{role,content}] }
 */
export async function loadChat(uid, chatId) {
  // 1) Local first (instant + reliable)
  let local = readLocalChats(uid).find((c) => c.id === chatId) || null;

  // 2) Cloud
  let cloud = null;
  if (ready) {
    try {
      const snap = await getDoc(doc(db, "users", uid, "chats", chatId));
      if (snap.exists()) {
        cloud = chatFromDoc(snap);

        // Legacy: messages may live in subcollection from older builds
        if (!cloud.messages.length) {
          try {
            const sub = await getDocs(
              collection(db, "users", uid, "chats", chatId, "messages")
            );
            if (!sub.empty) {
              const legacy = sub.docs
                .map((d) => {
                  const x = d.data() || {};
                  return {
                    role: x.role,
                    content: x.content,
                    at: x.at || 0,
                  };
                })
                .filter((m) => m.role && m.content);
              // sort if possible
              legacy.sort((a, b) => (a.at || 0) - (b.at || 0));
              cloud.messages = normalizeMessages(legacy);

              // migrate into main doc for next time
              if (cloud.messages.length) {
                await setDoc(
                  doc(db, "users", uid, "chats", chatId),
                  {
                    messages: cloud.messages,
                    preview:
                      cloud.preview ||
                      cloud.messages.filter((m) => m.role === "assistant").slice(-1)[0]
                        ?.content?.slice(0, 120) ||
                      "",
                    updatedAtMs: Date.now(),
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                );
              }
            }
          } catch (e) {
            console.warn("[SuuvieAI] legacy messages read failed:", e);
          }
        }
      }
    } catch (err) {
      console.warn("[SuuvieAI] loadChat cloud failed:", err);
    }
  }

  const merged = local && cloud ? mergeChat(local, cloud) : cloud || local;

  if (!merged) {
    return { id: chatId, title: "Chat", preview: "", messages: [] };
  }

  // Persist merged so next click is instant
  upsertLocalChat(uid, merged);

  return {
    id: merged.id,
    title: merged.title || "Chat",
    preview: merged.preview || "",
    messages: normalizeMessages(merged.messages).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };
}

/** Back-compat alias used by older script imports */
export async function loadMessages(uid, chatId) {
  const chat = await loadChat(uid, chatId);
  return chat.messages;
}

/**
 * Save one user + assistant turn.
 * Always updates localStorage; tries Firestore.
 */
export async function saveTurn(uid, chatId, userText, assistantText) {
  const now = Date.now();
  const userMsg = { role: "user", content: userText, at: now };
  const aiMsg = { role: "assistant", content: assistantText, at: now + 1 };

  const all = readLocalChats(uid);
  let chat = all.find((c) => c.id === chatId);
  if (!chat) {
    chat = {
      id: chatId,
      title: titleFrom(userText),
      preview: "",
      messages: [],
      createdAtMs: now,
      updatedAtMs: now,
    };
  }

  const messages = normalizeMessages(chat.messages);
  messages.push(userMsg, aiMsg);

  const next = {
    id: chatId,
    title:
      !chat.title || chat.title === "New chat" ? titleFrom(userText) : chat.title,
    preview: String(assistantText).slice(0, 120),
    messages,
    createdAtMs: chat.createdAtMs || now,
    updatedAtMs: now,
  };
  upsertLocalChat(uid, next);
  console.info("[SuuvieAI] saved locally", chatId, "msgs", messages.length);

  if (!ready) {
    return { cloud: false, error: "Firebase not ready", chat: next };
  }

  try {
    const chatRef = doc(db, "users", uid, "chats", chatId);
    await setDoc(
      chatRef,
      {
        title: next.title,
        preview: next.preview,
        messages: next.messages,
        createdAtMs: next.createdAtMs,
        updatedAtMs: next.updatedAtMs,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    console.info("[SuuvieAI] saved to Firestore", chatId, "msgs", messages.length);
    return { cloud: true, chat: next };
  } catch (err) {
    console.error("[SuuvieAI] saveTurn cloud failed:", err);
    return { cloud: false, error: formatFirestoreError(err), chat: next };
  }
}

export async function deleteChat(uid, chatId) {
  deleteLocalChat(uid, chatId);
  if (!ready) return;
  try {
    await deleteDoc(doc(db, "users", uid, "chats", chatId));
  } catch (err) {
    console.warn("[SuuvieAI] deleteChat cloud failed:", err);
    throw new Error(formatFirestoreError(err));
  }
}
