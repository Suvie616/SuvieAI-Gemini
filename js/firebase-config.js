/**
 * SuuvieAI — Firebase web config (live)
 *
 * Firebase Console checklist:
 *   1) Authentication → Google → Enable
 *   2) Authorized domains → add localhost AND suvieai-gemini.onrender.com
 *   3) Firestore → Create database
 *   4) Rules → paste firestore.rules → Publish
 */

export const firebaseConfig = {
  apiKey: "AIzaSyBeg8Z2eeIInpvzEIg5YMXF7NRJUDzNk80",
  authDomain: "suvieai-gemini.firebaseapp.com",
  projectId: "suvieai-gemini",
  storageBucket: "suvieai-gemini.firebasestorage.app",
  messagingSenderId: "742884904029",
  appId: "1:742884904029:web:18942ddd53a3a61bad51b4",
};

/** Must stay exported — firebase-app.js imports this */
export const FIREBASE_ENABLED =
  Boolean(firebaseConfig.apiKey) &&
  firebaseConfig.apiKey !== "PASTE_API_KEY" &&
  Boolean(firebaseConfig.projectId) &&
  firebaseConfig.projectId !== "PASTE_PROJECT_ID";
