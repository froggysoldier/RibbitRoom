// public/app.js

// --- DOM Elemente ---
const loginBtnHeader = document.getElementById("loginBtn");
const modal = document.getElementById("loginModal");
const closeModal = document.querySelector(".close");
const loginSubmit = document.getElementById("loginSubmit");
const registerSubmit = document.getElementById("registerSubmit");

const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");

// --- Helper / UI ---
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

// --- Escape helper to avoid XSS in messages ---
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- append message with time ---
function appendMessage(sender, content, createdAt) {
  const p = document.createElement("p");
  const date = createdAt ? new Date(createdAt) : new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  p.innerHTML = `<strong>${escapeHtml(sender)}</strong> <span class="time">[${hours}:${minutes}]</span>: ${escapeHtml(content)}`;
  chatWindow.appendChild(p);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- Token & Socket ---
let token = localStorage.getItem("token") || null;
let socket = null;
let socketConnected = false;

// Ensure socket connected (no auth on socket handshake required for this setup)
function ensureSocketConnected() {
  if (socketConnected) return;
  socket = io(); // make sure <script src="/socket.io/socket.io.js"></script> is in index.html
  socket.on("connect", () => {
    socketConnected = true;
    console.log("Socket connected:", socket.id);
  });
  socket.on("connect_error", (err) => {
    console.warn("Socket connect error:", err && err.message ? err.message : err);
  });
  socket.on("newMessage", (msg) => {
    // msg expected to be saved object { sender, content, createdAt }
    appendMessage(msg.sender || "Unbekannt", msg.content || "", msg.createdAt);
  });
  socket.on("disconnect", () => {
    socketConnected = false;
  });
}
ensureSocketConnected();

// --- load messages (public) ---
async function loadMessages() {
  try {
    const res = await fetch("/api/messages");
    if (!res.ok) {
      showInfo("Verlauf kann nicht geladen werden.");
      return;
    }
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach(m => appendMessage(m.sender, m.content, m.createdAt));
    if (token) setSendEnabled(true);
    else setSendEnabled(false);
  } catch (err) {
    console.error("Fehler beim Laden der Nachrichten:", err);
    showInfo("Fehler beim Laden der Nachrichten.");
  }
}
loadMessages(); // load on page open

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
    await loadMessages(); // refresh history (optional)
    // No need to re-create socket in current setup (server emits broadcasts to all sockets)
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

    // Server saves and broadcasts -> do not append locally (broadcast will deliver)
    messageInput.value = "";
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
