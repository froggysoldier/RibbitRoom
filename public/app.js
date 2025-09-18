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
  chatWindow.innerHTML = `<p class="info">${text}</p>`;
}

function setSendEnabled(enabled) {
  sendBtn.disabled = !enabled;
  messageInput.disabled = !enabled;
}

// initial UI state
setSendEnabled(false);
showInfo("Bitte zuerst einloggen oder registrieren.");

// --- Nachricht mit Uhrzeit anzeigen ---
function appendMessage(sender, content, createdAt) {
  const p = document.createElement("p");

  // Falls createdAt fehlt, benutze jetzt
  const date = createdAt ? new Date(createdAt) : new Date();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');

  p.innerHTML = `<strong>${escapeHtml(sender)}</strong> <span class="time">[${hours}:${minutes}]</span>: ${escapeHtml(content)}`;
  chatWindow.appendChild(p);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Kurze HTML-Escaperoutine für Sicherheit (XSS)
function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// --- Token & Socket ---
let token = localStorage.getItem("token") || null;
let socket = null;
let socketConnected = false;

// --- Socket.IO Verbindung (optional: verbinden sofort, Server broadcastet newMessage) ---
function ensureSocketConnected() {
  if (socketConnected) return;

  // socket.io client must be loaded on the page via <script src="/socket.io/socket.io.js"></script>
  socket = io(); // no auth sent here (server currently broadcasts without socket-auth)
  socket.on("connect", () => {
    socketConnected = true;
    console.log("Socket connected:", socket.id);
  });
  socket.on("connect_error", (err) => {
    console.warn("Socket connect error:", err && err.message ? err.message : err);
  });

  socket.on("newMessage", (msg) => {
    // msg expected { sender, content, createdAt }
    appendMessage(msg.sender || "Unbekannt", msg.content || "", msg.createdAt);
  });

  socket.on("disconnect", () => {
    socketConnected = false;
    console.log("Socket disconnected");
  });
}

// Verbindet Socket ohne Token (sicher, denn server broadcastet)
// Falls dein Server verlangt, Token beim Socket-Handshake, diese Zeile anpassen.
ensureSocketConnected();

// --- Nachrichten laden (via REST, benötigt Token if backend protected) ---
async function loadMessages() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch("/api/messages", { headers });
    if (!res.ok) {
      // wenn 401/403 -> nicht eingeloggt; zeige Hinweistexte
      if (res.status === 401 || res.status === 403) {
        showInfo("Bitte einloggen, um den Chatverlauf zu sehen.");
        setSendEnabled(false);
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }

    const messages = await res.json();
    chatWindow.innerHTML = "";
    // messages coming newest-first (server sorts by createdAt -1)
    // wir möchten älteste zuerst anzeigen -> reverse()
    messages.reverse().forEach(m => appendMessage(m.sender, m.content, m.createdAt));

    // Falls eingeloggt, enable send
    if (token) setSendEnabled(true);
    else setSendEnabled(false);
  } catch (err) {
    console.error("Fehler beim Laden der Nachrichten:", err);
    showInfo("Fehler beim Laden der Nachrichten.");
  }
}

// Wenn bereits eingeloggt beim Laden der Seite -> lade Nachrichten
if (token) {
  loadMessages();
}

// --- Modal öffnen/schließen ---
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
    await loadMessages(); // lädt Verlauf und stellt sicher, dass Authorization header funktioniert

    // socket existiert bereits; falls dein server braucht, dass client beim socket auth token mitschickt,
    // müsste man socket.disconnect(); socket = io({ auth: { token } }); ... das ist nur nötig, wenn server socket-auth verlangt.
  } catch (err) {
    console.error("Login-Fehler:", err);
    alert("Login-Fehler");
  }
});

// --- Registrierung ---
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

// --- Nachricht senden (via REST POST). Server speichert, trimmt und broadcastet newMessage -->
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

    // Server speichert und broadcastet -> wir müssen NICHT selbst per socket.emit senden
    messageInput.value = "";
    // (Option) optional: direkt die Antwort anzeigen, aber Broadcast vom Server wird das übernehmen
    // const saved = await res.json();
    // appendMessage(saved.sender, saved.content, saved.createdAt);
  } catch (err) {
    console.error("Fehler beim Senden:", err);
    alert("Fehler beim Senden");
  }
}

// --- Button & Enter ---
sendBtn.onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});
