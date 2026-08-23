// FILE PATH: admin/firebase-config.js  (INSIDE the admin folder)
// From Firebase Console → Project settings → General → Your apps → SDK setup and config
// These values are safe to expose publicly (they identify the project, not secrets).
export const firebaseConfig = {
  apiKey: "AIzaSyCoyc_JiL9HtNi_7a0eFynNLLqQE8AT2WU",
  authDomain: "mobiledoctor-store.firebaseapp.com",
  projectId: "mobiledoctor-store",
  storageBucket: "mobiledoctor-store.firebasestorage.app",
  messagingSenderId: "822706480808",
  appId: "1:822706480808:web:3623676578f71ee82c849d",
  measurementId: "G-C73BSFDNJ2",
};

// Same values as in the main app.js — used here so the admin page can also read current stock.
export const GITHUB_OWNER = "KUNDAN-KUMAR04";
export const GITHUB_REPO = "mobile-doctor-stock-";
export const GITHUB_BRANCH = "main";
