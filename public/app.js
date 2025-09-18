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
setSendEnabled(false);
showInfo("Bitte zuerst einloggen oder registrieren.");

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- appendMessage with data-id ---
function appendMessage(sender, content, createdAt, id) {
  const p = document.createElement("p");
  if (id) p.dataset.id = id.toString(); // set data-id so deletions can find it

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

function ensureSocketConnected() {
  if (socketConnected) return;
  socket = io(); // requires <script src="/socket.io/socket.io.js"></script>
  socket.on("connect", () => {
    socketConnected = true;
  });
  socket.on("connect_error", (err) => {
    console.warn("Socket connect error:", err && err.message ? err.message : err);
  });

  // receive new messages
  socket.on("newMessage", (msg) => {
    // msg expected: { _id, sender, content, createdAt }
    appendMessage(msg.sender || "Unbekannt", msg.content || "", msg.createdAt, msg._id);
  });

  // receive delete notifications (array of string IDs)
  socket.on("deletedMessages", (ids) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    ids.forEach(id => {
      const el = chatWindow.querySelector(`[data-id="${id}"]`);
      if (el) el.remove();
    });
  });

  socket.on("disconnect", () => { socketConnected = false; });
}
ensureSocketConnected();

// --- load messages ---
async function loadMessages() {
  try {
    const res = await fetch("/api/messages");
    if (!res.ok) {
      showInfo("Verlauf kann nicht geladen werden.");
      return;
    }
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach(m => {
      // m._id might be an ObjectId; ensure string
      const id = m._id ? m._id.toString() : undefined;
      appendMessage(m.sender, m.content, m.createdAt, id);
    });
    if (token) setSendEnabled(true); else setSendEnabled(false);
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

// --- Login/Register (unchanged) ---
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
  } catch (err) {
    console.error("Login-Fehler:", err);
    alert("Login-Fehler");
  }
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

    // Server saved, trimmed and broadcasted -> DOM update will arrive via socket 'newMessage' and 'deletedMessages'
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
