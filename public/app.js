// public/app.js
const loginBtnHeader = document.getElementById("loginBtn");
const modal = document.getElementById("loginModal");
const closeModal = document.querySelector(".close");
const loginSubmit = document.getElementById("loginSubmit");
const registerSubmit = document.getElementById("registerSubmit");

const usersListEl = document.getElementById("users");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");

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

function appendMessage(sender, content, createdAt, id) {
  const p = document.createElement("p");
  if (id) p.dataset.id = id.toString();

  const date = createdAt ? new Date(createdAt) : new Date();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  p.innerHTML = `<strong>${escapeHtml(sender)}</strong> <span class="time">[${hours}:${minutes}]</span>: ${escapeHtml(content)}`;
  chatWindow.appendChild(p);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderActiveUsers(users) {
  usersListEl.innerHTML = "";
  users.forEach(username => {
    const li = document.createElement("li");
    li.textContent = username;
    usersListEl.appendChild(li);
  });
}

// Token & Socket
let token = localStorage.getItem("token") || null;
let socket = null;

function initSocket() {
  if (socket && socket.connected) return;

  socket = io({ auth: { token } });

  socket.on("connect", () => {
    if (token) socket.emit("identify", { token });
  });

  socket.on("newMessage", msg => appendMessage(msg.sender || "Unbekannt", msg.content || "", msg.createdAt, msg._id));
  socket.on("deletedMessages", ids => {
    ids?.forEach(id => chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });
  socket.on("activeUsers", users => renderActiveUsers(users));
  socket.on("identified", data => {});
  socket.on("disconnect", () => {});
}

initSocket();

async function loadMessages() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch("/api/messages", { headers });
    if (!res.ok) return showInfo("Verlauf kann nicht geladen werden.");

    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach(m => appendMessage(m.sender, m.content, m.createdAt, m._id));
    setSendEnabled(!!token);
  } catch {
    showInfo("Fehler beim Laden der Nachrichten.");
  }
}
loadMessages();

loginBtnHeader.onclick = () => modal.style.display = "block";
closeModal.onclick = () => modal.style.display = "none";
window.onclick = e => { if (e.target === modal) modal.style.display = "none"; };

loginSubmit.addEventListener("click", async () => {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  if (!username || !password) return alert("Bitte Benutzername und Passwort eingeben.");

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || "Login fehlgeschlagen");

    token = data.token;
    localStorage.setItem("token", token);
    modal.style.display = "none";
    setSendEnabled(true);
    await loadMessages();

    if (socket) { socket.auth = { token }; socket.disconnect(); socket.connect(); }
    else initSocket();
  } catch { alert("Login-Fehler"); }
});

registerSubmit.addEventListener("click", async () => {
  const username = document.getElementById("newUser").value.trim();
  const password = document.getElementById("newPass").value.trim();
  const email = document.getElementById("email").value.trim();
  if (!username || !password || !email) return alert("Bitte alle Felder ausfüllen.");

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, email })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || "Registrierung fehlgeschlagen");

    alert("Registrierung erfolgreich — bitte einloggen.");
  } catch { alert("Registrieren-Fehler"); }
});

async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  if (!token) return alert("Bitte einloggen!");

  try {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ content })
    });

    if (!res.ok) {
      if ([401, 403].includes(res.status)) return alert("Nicht autorisiert.");
      const data = await res.json().catch(() => ({}));
      return alert(data.error || "Fehler beim Senden");
    }

    messageInput.value = "";
  } catch { alert("Fehler beim Senden"); }
}

sendBtn.onclick = sendMessage;
messageInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } });
