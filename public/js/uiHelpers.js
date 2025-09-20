// public/js/uiHelpers.js
import * as DOM from "./domElements.js";

/* utility helpers */
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

/* info/error helpers (transient) */
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

/* check whether chat is scrolled to bottom */
export function isAtBottom(threshold = 10) {
  const el = DOM.chatWindow;
  return (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
}

/* appendMessage (smart autoscroll; system messages auto-remove if duration provided) */
export function appendMessage(sender, content, createdAt, id, self = false, type = "user", senderRole = "user") {
  const wasAtBottom = isAtBottom();

  const p = document.createElement("p");
  p.classList.add("message");
  if (self) p.classList.add("self");
  if (type === "system") p.classList.add("system");
  if (senderRole === "admin") p.classList.add("admin-msg");
  if (id) p.dataset.id = id.toString();

  // If content is an object we accept { text, duration }
  let text = typeof content === "object" && content?.text ? content.text : String(content || "");
  const duration = typeof content === "object" && content?.duration ? Number(content.duration) : null;

  const date = createdAt ? new Date(createdAt) : new Date();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  p.innerHTML = `
    <div class="msg-header">
      <strong class="${senderRole === "admin" ? "admin-name" : ""}">
        ${escapeHtml(sender)}
      </strong>
      <span class="time">[${hours}:${minutes}]</span>
    </div>
    <div class="msg-content">${formatMessage(text)}</div>
  `;

  DOM.chatWindow.appendChild(p);
  setTimeout(() => p.classList.add("show"), 50);

  // only auto-scroll if user was at bottom
  if (wasAtBottom) {
    DOM.chatWindow.scrollTop = DOM.chatWindow.scrollHeight;
  }

  // transient system messages auto-remove if duration present (else default 4000)
  if (type === "system") {
    const sysDuration = duration || 4000;
    setTimeout(() => {
      if (p.parentNode) p.parentNode.removeChild(p);
    }, sysDuration);
  }
}

/* persistent system message (used for spam warnings) */
export function showPersistentSystem(text, key = "persistent") {
  let existing = DOM.chatWindow.querySelector(`p[data-persist="${key}"]`);
  if (existing) {
    const contentEl = existing.querySelector(".msg-content");
    if (contentEl) contentEl.innerHTML = formatMessage(text);
    return;
  }

  const p = document.createElement("p");
  p.classList.add("message", "system");
  p.dataset.persist = key;

  const date = new Date();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  p.innerHTML = `
    <div class="msg-header">
      <strong> SYSTEM </strong>
      <span class="time">[${hours}:${minutes}]</span>
    </div>
    <div class="msg-content">${formatMessage(text)}</div>
  `;
  const wasAtBottom = isAtBottom();
  DOM.chatWindow.appendChild(p);
  setTimeout(() => p.classList.add("show"), 50);
  if (wasAtBottom) DOM.chatWindow.scrollTop = DOM.chatWindow.scrollHeight;
}

export function clearPersistentSystem(key = "persistent") {
  const existing = DOM.chatWindow.querySelector(`p[data-persist="${key}"]`);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
}
