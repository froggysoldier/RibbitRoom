// public/js/domElements.js

// Alle DOM-Elemente als `let`, werden später initialisiert
export let loginBtn = null;
export let modal = null;
export let closeModal = null;
export let loginSubmit = null;
export let registerSubmit = null;
export let usersListEl = null;
export let chatWindow = null;
export let sendBtn = null;
export let messageInput = null;
export let filterBtn = null;

export let codeModal = null;
export let codeInput = null;
export let codeSubmit = null;

// Init-Funktion: muss aufgerufen werden, sobald DOM geladen ist
export function initDomElements() {
  loginBtn = document.getElementById("loginBtn");
  modal = document.getElementById("loginModal");
  closeModal = document.querySelector(".close");
  loginSubmit = document.getElementById("loginSubmit");
  registerSubmit = document.getElementById("registerSubmit");
  usersListEl = document.getElementById("users");
  chatWindow = document.getElementById("chatWindow");
  sendBtn = document.getElementById("sendBtn");
  messageInput = document.getElementById("messageInput");
  filterBtn = document.getElementById("filterBtn");

  codeModal = document.getElementById("codeModal");
  codeInput = document.getElementById("code");
  codeSubmit = document.getElementById("codeSubmit");

  // Debug: Warnung, falls ein Element fehlt
  const missing = [];
  if (!loginBtn) missing.push("loginBtn");
  if (!modal) missing.push("loginModal");
  if (!loginSubmit) missing.push("loginSubmit");
  if (!registerSubmit) missing.push("registerSubmit");
  if (!codeInput) missing.push("codeInput");
  if (!codeSubmit) missing.push("codeSubmit");
  if (!chatWindow) missing.push("chatWindow");
  if (!sendBtn) missing.push("sendBtn");

  if (missing.length) console.warn("[initDomElements] fehlende Elemente:", missing.join(", "));
}
