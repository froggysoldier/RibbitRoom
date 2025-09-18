// DOM Elemente
const loginBtnHeader = document.getElementById("loginBtn");
const modal = document.getElementById("loginModal");
const closeModal = document.querySelector(".close");
const loginSubmit = document.getElementById("loginSubmit");
const registerSubmit = document.getElementById("registerSubmit");

const usersListEl = document.getElementById("users");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");

// Helper
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function showInfo(text) {
  chatWindow.innerHTML = `<p class="info">${escapeHtml(text)}</p>`;
}
function setSendEnabled(enabled) {
  sendBtn.disabled = !enabled;
  messageInput.disabled = !enabled;
}

// append message mit Admin-Farbcode
function appendMessage(sender, content, createdAt, id, role) {
  const p = document.createElement("p");
  if (id) p.dataset.id = id.toString();

  const date = createdAt ? new Date(createdAt) : new Date();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  let displayName = sender;
  if (role === "admin") displayName = `<span style="color:red">${escapeHtml(sender)} (Admin)</span>`;

  p.innerHTML = `<strong>${displayName}</strong> <span class="time">[${hours}:${minutes}]</span>: ${escapeHtml(content)}`;
  chatWindow.appendChild(p);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Active Users
function renderActiveUsers(users) {
  usersListEl.innerHTML = "";
  users.forEach(u => {
    const li = document.createElement("li");
    if(u.role === "admin") li.innerHTML = `<span style="color:red">${escapeHtml(u.username)} (Admin)</span>`;
    else li.textContent = u.username;
    usersListEl.appendChild(li);
  });
}

// Token & Socket
let token = localStorage.getItem("token") || null;
let socket = null;

function initSocket() {
  if (socket && socket.connected) return;
  socket = io({ auth: { token } });

  socket.on("connect", () => { if(token) socket.emit("identify", { token }); });
  socket.on("newMessage", (msg) => appendMessage(msg.sender || "Unbekannt", msg.content || "", msg.createdAt, msg._id, msg.role));
  socket.on("deletedMessages", (ids) => ids.forEach(id => chatWindow.querySelector(`[data-id="${id}"]`)?.remove()));
  socket.on("activeUsers", (users) => renderActiveUsers(Array.isArray(users) ? users : []));
  socket.on("identified", (data) => {});
  socket.on("disconnect", () => {});
}
initSocket();

// Messages laden
async function loadMessages() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/messages", { headers });
    if (!res.ok) { showInfo("Verlauf kann nicht geladen werden."); return; }
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach(m => appendMessage(m.sender, m.content, m.createdAt, m._id, m.role));
    setSendEnabled(!!token);
  } catch (err) { showInfo("Fehler beim Laden der Nachrichten."); console.error(err); }
}
loadMessages();

// Modal open/close
loginBtnHeader.onclick = () => modal.style.display = "block";
closeModal.onclick = () => modal.style.display = "none";
window.onclick = e => { if (e.target === modal) modal.style.display = "none"; };

// Login
loginSubmit.onclick = async () => {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  if (!username || !password) return alert("Bitte Benutzername und Passwort eingeben.");

  try {
    const res = await fetch("/api/auth/login", {
      method: "P
