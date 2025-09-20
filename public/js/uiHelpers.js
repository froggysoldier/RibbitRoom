// public/js/uiHelpers.js
import * as DOM from "./domElements.js";

export function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatMessage(content = "") {
  return escapeHtml(content).replace(/\n/g, "<br>");
}

export function showInfo(text, duration = 4000) {
  const p = document.createElement("p");
  p.classList.add("info");
  p.textContent = text;
  DOM.chatWindow.appendChild(p);
  setTimeout(() => p.remove(), duration);
  DOM.chatWindow.scrollTop = DOM.chatWindow.scrollHeight;
}

export function showError(text, duration = 5000) {
  const p = document.createElement("p");
  p.classList.add("error");
  p.textContent = text;
  DOM.chatWindow.appendChild(p);
  setTimeout(() => p.remove(), duration);
  DOM.chatWindow.scrollTop = DOM.chatWindow.scrollHeight;
}

export function setSendEnabled(enabled) {
  DOM.sendBtn.disabled = !enabled;
  DOM.messageInput.disabled = !enabled;
}

export function appendMessage(sender, content, createdAt, id, self = false, type = "user", senderRole = "user", duration = 4000) {
  const p = document.createElement("p");
  p.classList.add("message");
  if (self) p.classList.add("self");
  if (type === "system") p.classList.add("system");
  if (senderRole === "admin") p.classList.add("admin-msg");
  if (id) p.dataset.id = id.toString();

  const date = createdAt ? new Date(createdAt) : new Date();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  p.innerHTML = `
    <div class="msg-header">
      <strong class="${senderRole === "admin" ? "admin-name" : ""}">${escapeHtml(sender)}</strong>
      <span class="time">[${hours}:${minutes}]</span>
    </div>
    <div class="msg-content">${formatMessage(content)}</div>
  `;

  DOM.chatWindow.appendChild(p);
  setTimeout(() => p.classList.add("show"), 20);
  DOM.chatWindow.scrollTop = DOM.chatWindow.scrollHeight;

  // System-Nachrichten verschwinden nach duration
  if (type === "system") {
    setTimeout(() => {
      if (p.parentNode) p.parentNode.removeChild(p);
    }, duration);
  }
}
