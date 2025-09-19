// --- DOM Elemente ---
const loginBtnHeader = document.getElementById("loginBtn");
const modal = document.getElementById("loginModal");
const closeModal = document.querySelector(".close");
const loginSubmit = document.getElementById("loginSubmit");
const registerSubmit = document.getElementById("registerSubmit");
const usersListEl = document.getElementById("users");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const filterBtn = document.getElementById("filterBtn");

// --- Helper / UI ---
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMessage(content = "") {
  return escapeHtml(content).replace(/\n/g, "<br>");
}

function appendMessage(sender, content, createdAt, id, self = false, type = "user", senderRole = "user") {
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
      <strong>${escapeHtml(sender)}</strong>
      <span class="time">[${hours}:${minutes}]</span>
    </div>
    <div class="msg-content">${formatMessage(content)}</div>
  `;

  chatWindow.appendChild(p);
  setTimeout(() => p.classList.add("show"), 50);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderActiveUsers(users) {
  usersListEl.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    li.textContent = u.username;
    if (u.role === "admin") li.classList.add("admin-user");
    usersListEl.appendChild(li);
  });
}

// --- state ---
let token = localStorage.getItem("token") || null;
let socket = null;
let socketConnected = false;
let filterActive = false;
let username = localStorage.getItem("username") || null;
let myRole = "user";

function refreshLoginButton() {
  if (token && username) loginBtnHeader.textContent = "Abmelden";
  else loginBtnHeader.textContent = "Login / Registrieren";
}
refreshLoginButton();

function initSocket() {
  if (socket && socket.connected) return;
  socket = io({ auth: { token } });

  socket.on("connect", () => {
    socketConnected = true;
    if (token) socket.emit("identify", { token });
    sendBtn.disabled = !token;
  });

  socket.on("newMessage", (msg) => {
    const isSelf = msg.sender === username;
    appendMessage(msg.sender || "SYSTEM", msg.content || "", msg.createdAt, msg._id, isSelf, msg.type || "user", msg.senderRole || "user");
  });

  socket.on("systemMessage", (data) => {
    if (typeof data === "string") appendMessage("SYSTEM", data, new Date(), "sys-" + Date.now(), false, "system");
    else appendMessage("SYSTEM", data.text || "", new Date(), "sys-" + Date.now(), false, "system");
  });

  socket.on("adminNotice", (data) => {
    appendMessage("ADMIN", data.text || "", new Date(), "admin-notice-" + Date.now(), false, "system");
  });

  socket.on("identified", (data) => {
    if (data.username) username = data.username;
    myRole = data.role || myRole;
    filterActive = data.filterActive || false;
    filterBtn.checked = filterActive;
    localStorage.setItem("username", username || "");
    refreshLoginButton();
  });

  socket.on("activeUsers", (users) => renderActiveUsers(Array.isArray(users) ? users : []));

  socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  socket.on("forceReload", () => {
    alert("Server wurde zurückgesetzt! Die Seite wird neu geladen.");
    localStorage.clear();
    window.location.reload();
  });

  socket.on("disconnect", () => { socketConnected = false; sendBtn.disabled = true; });
}

initSocket();

async function loadMessages() {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch("/api/messages", { headers });
    if (!res.ok) return;
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach((m) => {
      const isSelf = m.sender === username;
      appendMessage(m.sender, m.content, m.createdAt, m._id, isSelf, m.type || "user", m.senderRole || "user");
    });
    sendBtn.disabled = !token;
  } catch {}
}
loadMessages();

loginBtnHeader.onclick = () => {
  if (token) {
    token = null;
    username = null;
    myRole = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    if (socket) { socket.auth = {}; socket.disconnect(); socket = null; }
    renderActiveUsers([]);
    refreshLoginButton();
  } else modal.style.display = "block";
};

closeModal.onclick = () => (modal.style.display = "none");
window.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || !socket || !socket.connected) return;
  socket.emit("chatMessage", content);
  messageInput.value = "";
  sendBtn.disabled = true;
  setTimeout(() => messageInput.focus(), 50);
}

messageInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
messageInput.addEventListener("input", () => { sendBtn.disabled = !messageInput.value.trim(); });
sendBtn.addEventListener("click", (e) => { e.preventDefault(); sendMessage(); });
