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

function showInfo(text) {
  const p = document.createElement("p");
  p.classList.add("info");
  p.textContent = text;
  chatWindow.appendChild(p);
  setTimeout(() => p.remove(), 4000);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showError(text) {
  const p = document.createElement("p");
  p.classList.add("error");
  p.textContent = text;
  chatWindow.appendChild(p);
  setTimeout(() => p.remove(), 5000);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function setSendEnabled(enabled) {
  sendBtn.disabled = !enabled;
  messageInput.disabled = !enabled;
}

// --- appendMessage (with type and senderRole support) ---
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

// --- renderActiveUsers ---
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

// --- init socket & listeners ---
function initSocket() {
  if (socket && socket.connected) return;
  socket = io({ auth: { token } });

  socket.on("connect", () => {
    socketConnected = true;
    if (token) socket.emit("identify", { token });
    setSendEnabled(!!token);
  });

  socket.on("connect_error", (err) => console.warn("[SOCKET] connect_error", err?.message || err));

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
//forceload
socket.on("forceReload", (resetAll = true) => {
  if (resetAll) {
    // komplettes Reset wie vorher
    token = null;
    username = null;
    myRole = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");

    if (socket) { try { socket.auth = {}; socket.disconnect(); } catch {} socket = null; }

    renderActiveUsers([]);
    chatWindow.innerHTML = "";
    showInfo("⚠️ Server wurde zurückgesetzt. Du wurdest abgemeldet.");

  } else {
    // nur Nachrichten gelöscht, Nutzer bleiben eingeloggt
    chatWindow.innerHTML = "";
     setTimeout(() => {
      window.location.reload();
    }, 200); // 2000ms = 2 Sekunden
    showInfo("⚠️ Alle Nachrichten wurden gelöscht.");
  }
});

  // --- NEU: Neues Token speichern ---
  socket.on("newToken", (data) => {
    if (data?.token) {
      token = data.token;
      localStorage.setItem("token", token);
      console.log("[INFO] Neues Admin-Token gespeichert");
    }
  });

  socket.on("disconnect", () => {
    socketConnected = false;
    setSendEnabled(false);
  });
}

initSocket();

// --- load messages via REST ---
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
    setSendEnabled(!!token);
  } catch (err) { console.error(err); }
}
loadMessages();

// --- Login/Register/Logout ---
loginBtnHeader.onclick = () => {
  if (token) {
    token = null;
    username = null;
    myRole = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");

    if (socket) {
      try { socket.auth = {}; socket.disconnect(); } catch {}
      socket = null;
    }

    renderActiveUsers([]);
    refreshLoginButton();
    showInfo("Abgemeldet");
    window.location.reload();
  } else modal.style.display = "block";
};

closeModal.onclick = () => (modal.style.display = "none");
window.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

loginSubmit.addEventListener("click", async () => {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();
  if (!u || !p) return showError("Bitte Benutzername und Passwort eingeben.");

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || "Login fehlgeschlagen");
    token = data.token;
    username = u;
    myRole = data.role || "user";
    localStorage.setItem("token", token);
    localStorage.setItem("username", username);
    modal.style.display = "none";
    showInfo(`Eingeloggt als ${username}`);
    refreshLoginButton();
    if (socket) { socket.auth = { token }; socket.disconnect(); setTimeout(initSocket, 50); }
    else initSocket();
    await loadMessages();
  } catch { showError("Login-Fehler"); }
});

registerSubmit.addEventListener("click", async () => {
  const newU = document.getElementById("newUser").value.trim();
  const newP = document.getElementById("newPass").value.trim();
  const email = document.getElementById("email").value.trim();
  const adminPassField = document.getElementById("adminPass") ? document.getElementById("adminPass").value.trim() : null;

  if (!newU || !newP || !email) return showError("Bitte alle Felder ausfüllen.");
  try {
    const body = { username: newU, password: newP, email };
    if (adminPassField) body.adminPass = adminPassField;
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || "Registrierung fehlgeschlagen");
    if (data.token) {
      token = data.token;
      username = newU;
      myRole = data.role || "user";
      localStorage.setItem("token", token);
      localStorage.setItem("username", username);
      showInfo("Registrierung erfolgreich — eingeloggt.");
      if (socket) { socket.auth = { token }; socket.disconnect(); setTimeout(initSocket, 50); }
      else initSocket();
      await loadMessages();
    } else showInfo("Registrierung erfolgreich — bitte einloggen.");
    modal.style.display = "none";
    refreshLoginButton();
  } catch { showError("Registrieren-Fehler"); }
});

// --- send message ---
function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  if (!socket || !socket.connected) return showError("Nicht verbunden");

  socket.emit("chatMessage", content);
  messageInput.value = "";
  sendBtn.disabled = true;
  setTimeout(() => messageInput.focus(), 50);
}

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
messageInput.addEventListener("input", () => { sendBtn.disabled = !messageInput.value.trim(); });
sendBtn.addEventListener("click", (e) => { e.preventDefault(); sendMessage(); });

filterBtn.addEventListener("change", () => {
  if (!socket || !socket.connected) return;
  filterActive = filterBtn.checked;
  socket.emit("toggleFilter", filterActive);
});
