import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAzb6U4KqnY9l-JGzv1VwnMDCe47_yEt-g",
  authDomain: "sencetw-f586f.firebaseapp.com",
  projectId: "sencetw-f586f",
  storageBucket: "sencetw-f586f.firebasestorage.app",
  messagingSenderId: "445286360158",
  appId: "1:445286360158:web:33e9387a2b4494394c00cf"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);