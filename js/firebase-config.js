/**
 * SuvieAI — Firebase web config
 *
 * Enable in Firebase Console:
 *   1) Authentication → Sign-in method → Google → Enable
 *   2) Authentication → Settings → Authorized domains → add localhost
 *   3) Firestore Database → Create database
 *   4) Firestore → Rules → paste firestore.rules → Publish
 */

export const firebaseConfig = {
  apiKey: "AIzaSyBeg8Z2eeIInpvzEIg5YMXF7NRJUDzNk80",
  authDomain: "suvieai-gemini.firebaseapp.com",
  projectId: "suvieai-gemini",
  storageBucket: "suvieai-gemini.firebasestorage.app",
  messagingSenderId: "742884904029",
  appId: "1:742884904029:web:18942ddd53a3a61bad51b4"
};


/** True when real config values are present */
export const FIREBASE_ENABLED =
  Boolean(firebaseConfig.apiKey) &&
  firebaseConfig.apiKey !== "PASTE_API_KEY" &&
  Boolean(firebaseConfig.projectId) &&
  firebaseConfig.projectId !== "PASTE_PROJECT_ID";
