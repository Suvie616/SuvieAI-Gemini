/**
 * Copy this file to firebase-config.js and paste your Firebase web config.
 *
 * Firebase Console → Project settings → Your apps → Web app
 */

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

export const FIREBASE_ENABLED =
  Boolean(firebaseConfig.apiKey) &&
  firebaseConfig.apiKey !== "PASTE_API_KEY" &&
  Boolean(firebaseConfig.projectId) &&
  firebaseConfig.projectId !== "PASTE_PROJECT_ID";
