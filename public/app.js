// public/app.js

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

// --- Helper / UI ---
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

// initial UI state
setSendEnabled(false);
showInfo("Bitte zuerst einloggen oder registrieren.");

// --- append message with data-id for deletions ---
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

// --- active users rendering ---
function renderActiveUsers(users) {
  usersListEl.innerHTML = "";
  users.forEach(username => {
    const li = document.createElement("li");
    li.textContent = username;
    usersListEl.appendChild(li);
  });
}

// --- Token & Socket ---
let token = localStorage.getItem("token") || null;
let socket = null;
let socketConnected = false;

function initSocket() {
  if (socket && socket.connected) return;

  // pass token in handshake auth if available
  socket = io({ auth: { token } });

  socket.on("connect", () => {
    socketConnected = true;
    // if server didn't know identity, we can emit identify explicitly
    if (token) socket.emit("identify", { token });
  });

  socket.on("connect_error", (err) => {
    console.warn("Socket connect error:", err && err.message ? err.message : err);
  });

  socket.on("newMessage", (msg) => {
    appendMessage(msg.sender || "Unbekannt", msg.content || "", msg.createdAt, msg._id);
  });

  socket.on("deletedMessages", (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    ids.forEach(id => {
      const el = chatWindow.querySelector(`[data-id="${id}"]`);
      if (el) el.remove();
    });
  });

  socket.on("activeUsers", (users) => {
    renderActiveUsers(Array.isArray(users) ? users : []);
  });

  socket.on("identified", (data) => {
    // optional: display small toast or set UI state
    // console.log("identified:", data.username);
  });

  socket.on("disconnect", () => {
    socketConnected = false;
  });
}

// ensure socket present to receive broadcasts even if not logged in
initSocket();

// --- load messages (public get) ---
async function loadMessages() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch("/api/messages", { headers });
    if (!res.ok) {
      showInfo("Verlauf kann nicht geladen werden.");
      return;
    }
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach(m => {
      const id = m._id ? m._id.toString() : undefined;
      appendMessage(m.sender, m.content, m.createdAt, id);
    });
    // Enable send if logged in
    setSendEnabled(!!token);
  } catch (err) {
    console.error("Fehler beim Laden der Nachrichten:", err);
    showInfo("Fehler beim Laden der Nachrichten.");
  }
}
loadMessages();

// --- Modal open/close ---
loginBtnHeader.onclick = () => modal.style.display = "block";
closeModal.onclick = () => modal.style.display = "none";
window.onclick = e => { if (e.target === modal) modal.style.display = "none"; };

// --- Login ---
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
    if (!res.ok) {
      alert(data.error || "Login fehlgeschlagen");
      return;
    }

    token = data.token;
    localStorage.setItem("token", token);
    modal.style.display = "none";
    setSendEnabled(true);
    await loadMessages();

    // reconnect socket with new auth so server will mark user active
    if (socket) {
      socket.auth = { token };
      socket.disconnect();
      socket.connect();
    } else {
      initSocket();
    }
  } catch (err) {
    console.error("Login-Fehler:", err);
    alert("Login-Fehler");
  }
});

// --- Register ---
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
    if (!res.ok) {
      alert(data.error || "Registrierung fehlgeschlagen");
      return;
    }
    alert("Registrierung erfolgreich — bitte einloggen.");
  } catch (err) {
    console.error("Registrieren-Fehler:", err);
    alert("Registrieren-Fehler");
  }
});

// --- send message (POST) ---
async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;
  if (!token) return alert("Bitte einloggen!");

  try {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ content })
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return alert("Nicht autorisiert. Bitte einloggen.");
      const data = await res.json().catch(() => ({}));
      return alert(data.error || "Fehler beim Senden");
    }

    messageInput.value = "";
    // Server will broadcast newMessage and deletedMessages
  } catch (err) {
    console.error("Fehler beim Senden:", err);
    alert("Fehler beim Senden");
  }
}

// --- UI bindings ---
sendBtn.onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});
