// public/js/uiHelpers.js
import { chatWindow, usersListEl } from "./domElements.js";

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

export function showInfo(text) {
  const p = document.createElement("p");
  p.classList.add("info");
  p.textContent = text;
  chatWindow.appendChild(p);
  setTimeout(() => p.remove(), 4000);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

export function showError(text) {
  const p = document.createElement("p");
  p.classList.add("error");
  p.textContent = text;
  chatWindow.appendChild(p);
  setTimeout(() => p.remove(), 5000);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

export function appendMessage(sender, content, createdAt, id, self = false, type = "user", senderRole = "user") {
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
      <strong class="${senderRole === "admin" ? "admin-name" : ""}">
        ${escapeHtml(sender)}
      </strong>
      <span class="time">[${hours}:${minutes}]</span>
    </div>
    <div class="msg-content">${formatMessage(content)}</div>
  `;

  chatWindow.appendChild(p);
  setTimeout(() => p.classList.add("show"), 50);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  if (type === "system") setTimeout(() => { if (p.parentNode) p.remove(); }, 4000);
}

export function renderActiveUsers(users) {
  usersListEl.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    li.textContent = u.username;
    if (u.role === "admin") li.classList.add("admin-user");
    usersListEl.appendChild(li);
  });
}

export function setSendEnabled(enabled, sendBtn, messageInput) {
  sendBtn.disabled = !enabled;
  messageInput.disabled = !enabled;
}
