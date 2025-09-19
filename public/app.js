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
  console.info("[UI] INFO:", text);
}

function showError(text) {
  const p = document.createElement("p");
  p.classList.add("error");
  p.textContent = text;
  chatWindow.appendChild(p);
  setTimeout(() => p.remove(), 5000);
  chatWindow.scrollTop = chatWindow.scrollHeight;
  console.warn("[UI] ERROR:", text);
}

function setSendEnabled(enabled) {
  sendBtn.disabled = !enabled;
  messageInput.disabled = !enabled;
}

// --- appendMessage ---
function appendMessage(sender, content, createdAt, id, self = false) {
  const p = document.createElement("p");
  p.classList.add("message");
  if (self) p.classList.add("self");
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

  setTimeout(() => {
    p.classList.add("show");
  }, 50);

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- User-Liste ---
function renderActiveUsers(users) {
  usersListEl.innerHTML = "";
  users.forEach((u) => {
    const li = document.createElement("li");
    li.textContent = u.username;
    usersListEl.appendChild(li);
  });
}

// --- Token & Socket state ---
let token = localStorage.getItem("token") || null;
let socket = null;
let socketConnected = false;
let filterActive = false;
let username = localStorage.getItem("username") || null;

// --- Update login button text depending on auth state ---
function refreshLoginButton() {
  if (token && username) {
    loginBtnHeader.textContent = "Abmelden";
  } else {
    loginBtnHeader.textContent = "Login / Registrieren";
  }
}
refreshLoginButton();

// --- Socket init & Event-Listener (re-attach safe) ---
function initSocket() {
  // if socket exists and is connected, nothing to do
  if (socket && socket.connected) return;

  // create socket (auth may be null)
  socket = io({ auth: { token } });

  socket.on("connect", () => {
    console.log("[SOCKET] verbunden:", socket.id);
    socketConnected = true;
    if (token) socket.emit("identify", { token });
    setSendEnabled(!!token);
  });

  socket.on("connect_error", (err) => {
    console.warn("[SOCKET] connect_error:", err?.message || err);
  });

  socket.on("newMessage", (msg) => {
    console.log("[SOCKET] newMessage:", msg);
    const isSelf = msg.sender === username;
    appendMessage(msg.sender || "SYSTEM", msg.content || "", msg.createdAt, msg._id, isSelf);
  });

  socket.on("deletedMessages", (ids) => {
    console.log("[SOCKET] deletedMessages:", ids);
    ids.forEach((id) => chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  socket.on("activeUsers", (users) => {
    console.log("[SOCKET] activeUsers:", users);
    renderActiveUsers(Array.isArray(users) ? users : []);
  });

  socket.on("identified", (data) => {
    console.log("[SOCKET] identified:", data);
    filterActive = data.filterActive || false;
    filterBtn.checked = filterActive;
    // if server returned username update local username (in case token had username)
    if (data.username) {
      username = data.username;
      localStorage.setItem("username", username);
      refreshLoginButton();
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("[SOCKET] disconnected:", reason);
    socketConnected = false;
    setSendEnabled(false);
  });
}

// start socket on load
initSocket();

// --- load messages via REST for history ---
async function loadMessages() {
  console.log("[MESSAGES] Lade Nachrichten...");
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/messages", { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showError(err.error || "Verlauf kann nicht geladen werden.");
      return;
    }
    const messages = await res.json();
    console.log("[MESSAGES] Anzahl:", messages.length);
    chatWindow.innerHTML = "";
    messages.reverse().forEach((m) => {
      const isSelf = m.sender === username;
      appendMessage(m.sender, m.content, m.createdAt, m._id, isSelf);
    });
    setSendEnabled(!!token);
  } catch (err) {
    console.error(err);
    showError("Fehler beim Laden der Nachrichten.");
  }
}
loadMessages();

// --- Modal open/close & login button behavior ---
loginBtnHeader.onclick = () => {
  if (token) {
    // logout flow
    logout();
  } else {
    modal.style.display = "block";
  }
};
closeModal.onclick = () => (modal.style.display = "none");
window.onclick = (e) => {
  if (e.target === modal) modal.style.display = "none";
};

// --- Logout ---
function logout() {
  // Clear auth
  token = null;
  username = null;
  localStorage.removeItem("token");
  localStorage.removeItem("username");
  setSendEnabled(false);
  refreshLoginButton();
  showInfo("Abgemeldet");
  // disconnect socket
  if (socket) {
    try {
      socket.auth = {};
      socket.disconnect();
    } catch (e) { /* ignore */ }
    socket = null;
  }
  renderActiveUsers([]);
}

// --- Login ---
loginSubmit.addEventListener("click", async () => {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();
  if (!u || !p) return showError("Bitte Benutzername und Passwort eingeben.");
  console.log("[LOGIN] Versuch:", u);

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return showError(data.error || "Login fehlgeschlagen");
    }

    if (!data.token) {
      return showError("Kein Token erhalten");
    }

    token = data.token;
    username = u;
    localStorage.setItem("token", token);
    localStorage.setItem("username", username);

    console.log("[LOGIN] Erfolg:", username);

    modal.style.display = "none";
    showInfo(`Eingeloggt als ${username}`);
    refreshLoginButton();
    await loadMessages();

    // reconnect socket with token and re-attach listeners
    if (socket) {
      socket.auth = { token };
      socket.disconnect();
      // re-init after a short delay to ensure clean reconnect
      setTimeout(() => {
        initSocket();
      }, 50);
    } else {
      initSocket();
    }

    // focus the input
    setTimeout(() => messageInput.focus(), 150);
  } catch (err) {
    console.error(err);
    showError("Login-Fehler");
  }
});

// --- Register ---
registerSubmit.addEventListener("click", async () => {
  const newU = document.getElementById("newUser").value.trim();
  const newP = document.getElementById("newPass").value.trim();
  const email = document.getElementById("email").value.trim();
  if (!newU || !newP || !email) return showError("Bitte alle Felder ausfüllen.");
  console.log("[REGISTER] Versuch:", newU);

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newU, password: newP, email }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return showError(data.error || "Registrierung fehlgeschlagen");
    }

    console.log("[REGISTER] Erfolg:", data);
    showInfo("Registrierung erfolgreich — bitte einloggen.");
    // optionally auto-fill login fields
    document.getElementById("username").value = newU;
    document.getElementById("password").value = newP;
  } catch (err) {
    console.error(err);
    showError("Registrieren-Fehler");
  }
});

// --- send message (via Socket) ---
function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  if (!socket || !socket.connected) return showError("Nicht verbunden zum Server");

  // send via socket (Variante A)
  socket.emit("chatMessage", content);
  messageInput.value = "";
  sendBtn.disabled = true;
  // focus back after send
  setTimeout(() => messageInput.focus(), 50);
}

// --- Eingabe-Steuerung ---
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Button aktivieren/deaktivieren je nach Input
messageInput.addEventListener("input", () => {
  sendBtn.disabled = !messageInput.value.trim();
});

// --- Sende-Button ---
sendBtn.addEventListener("click", (e) => {
  e.preventDefault();
  sendMessage();
});

// --- Filter Button ---
filterBtn.addEventListener("change", () => {
  if (!socket || !socket.connected) return;
  filterActive = filterBtn.checked;
  socket.emit("toggleFilter", filterActive);
});
