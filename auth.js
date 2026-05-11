// auth.js
import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

window.doLogin = async function() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  if (!email || !password) {
    errEl.textContent = '請輸入帳號和密碼';
    errEl.classList.remove('hidden');
    return;
  }
  btn.textContent = '登入中...'; btn.disabled = true;
  errEl.classList.add('hidden');

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    const msgs = {
      'auth/invalid-credential': '帳號或密碼錯誤',
      'auth/user-not-found': '帳號不存在',
      'auth/wrong-password': '密碼錯誤',
      'auth/too-many-requests': '嘗試次數過多，請稍後再試',
    };
    errEl.textContent = msgs[e.code] || '登入失敗：' + e.message;
    errEl.classList.remove('hidden');
    btn.textContent = '登入'; btn.disabled = false;
  }
};

window.doLogout = async function() {
  await signOut(auth);
};

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    const initial = (user.email || 'U')[0].toUpperCase();
    document.getElementById('user-avatar').textContent = initial;
    document.getElementById('user-email-display').textContent = user.email;
    if (window.onAppReady) window.onAppReady();
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
  }
});