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

export function initDomElements() {
  loginBtn = loginBtn || document.getElementById("loginBtn");
  modal = modal || document.getElementById("loginModal");
  closeModal = closeModal || document.querySelector(".close");
  loginSubmit = loginSubmit || document.getElementById("loginSubmit");
  registerSubmit = registerSubmit || document.getElementById("registerSubmit");
  usersListEl = usersListEl || document.getElementById("users");
  chatWindow = chatWindow || document.getElementById("chatWindow");
  sendBtn = sendBtn || document.getElementById("sendBtn");
  messageInput = messageInput || document.getElementById("messageInput");
  filterBtn = filterBtn || document.getElementById("filterBtn");

  codeModal = codeModal || document.getElementById("codeModal");
  codeInput = codeInput || document.getElementById("code");
  codeSubmit = codeSubmit || document.getElementById("codeSubmit");

  const missing = [];
  if (!loginBtn) missing.push("loginBtn");
  if (!modal) missing.push("modal");
  if (!loginSubmit) missing.push("loginSubmit");
  if (!registerSubmit) missing.push("registerSubmit");
  if (!chatWindow) missing.push("chatWindow");
  if (!sendBtn) missing.push("sendBtn");
  if (!messageInput) missing.push("messageInput");
  if (!filterBtn) missing.push("filterBtn");
  if (!codeInput) missing.push("codeInput");
  if (!codeSubmit) missing.push("codeSubmit");

  if (missing.length) console.warn("[initDomElements] fehlende Elemente:", missing.join(", "));
}
