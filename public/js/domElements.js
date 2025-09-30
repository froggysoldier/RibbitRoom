// public/js/domElements.js
// Wir exportieren Live-Variablen (let) und eine Init-Funktion.
// Andere Module können die Variablen wie bisher als DOM.loginBtn lesen
// — sie werden später gesetzt und sind dann aktuell (ESM live bindings).

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

// Init-Funktion: muss aufgerufen werden, sobald DOMContentLoaded ist.
export function initDomElements() {
  // Only assign if current value is null (idempotent)
  if (!loginBtn) loginBtn = document.getElementById("loginBtn");
  if (!modal) modal = document.getElementById("loginModal");
  if (!closeModal) closeModal = document.querySelector(".close");
  if (!loginSubmit) loginSubmit = document.getElementById("loginSubmit");
  if (!registerSubmit) registerSubmit = document.getElementById("registerSubmit");
  if (!usersListEl) usersListEl = document.getElementById("users");
  if (!chatWindow) chatWindow = document.getElementById("chatWindow");
  if (!sendBtn) sendBtn = document.getElementById("sendBtn");
  if (!messageInput) messageInput = document.getElementById("messageInput");
  if (!filterBtn) filterBtn = document.getElementById("filterBtn");

  if (!codeModal) codeModal = document.getElementById("codeModal");
  if (!codeInput) codeInput = document.getElementById("code");
  if (!codeSubmit) codeSubmit = document.getElementById("codeSubmit");

  // Debug: gibt Warnung in Konsole, falls ein Element fehlt
  const missing = [];
  if (!loginBtn) missing.push("loginBtn");
  if (!modal) missing.push("loginModal");
  if (!loginSubmit) missing.push("loginSubmit");
  if (!registerSubmit) missing.push("registerSubmit");
  if (!codeInput) missing.push("code input (#code)");
  if (!codeSubmit) missing.push("codeSubmit");
  if (!chatWindow) missing.push("chatWindow");
  if (!sendBtn) missing.push("sendBtn");

  if (missing.length) console.warn("[initDomElements] fehlende Elemente:", missing.join(", "));
}
