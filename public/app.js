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

// --- Token & Socket ---
let token = localStorage.getItem("token") || null;
let socket = null;
let socketConnected = false;
let filterActive = false;
let username = localStorage.getItem("username") || null;

function initSocket() {
  if (socket && socket.connected) return;
  socket = io({ auth: { token } });

  socket.on("connect", () => {
    socketConnected = true;
    if (token) socket.emit("identify", { token });
  });

  socket.on("connect_error", (err) =>
    console.warn("Socket connect error:", err?.message || err)
  );

  socket.on("newMessage", (msg) => {
    const isSelf = msg.sender === username;
    appendMessage(
      msg.sender || "Unbekannt",
      msg.content || "",
      msg.createdAt,
      msg._id,
      isSelf
    );
  });

  socket.on("deletedMessages", (ids) =>
    ids.forEach((id) =>
      chatWindow.querySelector(`[data-id="${id}"]`)?.remove()
    )
  );
  socket.on("activeUsers", (users) =>
    renderActiveUsers(Array.isArray(users) ? users : [])
  );

  socket.on("identified", (data) => {
    filterActive = data.filterActive || false;
    filterBtn.checked = filterActive;
  });

  socket.on("disconnect", () => (socketConnected = false));
}

initSocket();

// --- load messages ---
async function loadMessages() {
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch("/api/messages", { headers });
    if (!res.ok) return showError("Verlauf kann nicht geladen werden.");
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach((m) => {
      const isSelf = m.sender === username;
      appendMessage(m.sender, m.content, m.createdAt, m._id, isSelf);
    });
    setSendEnabled(!!token);
  } catch {
    showError("Fehler beim Laden der Nachrichten.");
  }
}
loadMessages();

// --- Modal open/close ---
loginBtnHeader.onclick = () => (modal.style.display = "block");
closeModal.onclick = () => (modal.style.display = "none");
window.onclick = (e) => {
  if (e.target === modal) modal.style.display = "none";
};

// --- Login ---
loginSubmit.addEventListener("click", async () => {
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();
  if (!u || !p) return showError("Bitte Benutzername und Passwort eingeben.");

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || "Login fehlgeschlagen");

    token = data.token;
    username = u;
    localStorage.setItem("token", token);
    localStorage.setItem("username", username);

    modal.style.display = "none";
    setSendEnabled(true);
    await loadMessages();

    if (socket) {
      socket.auth = { token };
      socket.disconnect();
      socket.connect();
    } else initSocket();
  } catch (err) {
    showError("Login-Fehler");
  }
});

// --- Register ---
registerSubmit.addEventListener("click", async () => {
  const newU = document.getElementById("newUser").value.trim();
  const newP = document.getElementById("newPass").value.trim();
  const email = document.getElementById("email").value.trim();
  if (!newU || !newP || !email) return showError("Bitte alle Felder ausfüllen.");

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: newU, password: newP, email }),
    });
    const data = await res.json();
    if (!res.ok) return showError(data.error || "Registrierung fehlgeschlagen");
    showInfo("Registrierung erfolgreich — bitte einloggen.");
  } catch (err) {
    showError("Registrieren-Fehler");
  }
});

// --- send message ---
async function sendMessage() {
  let content = messageInput.value.trim();
  if (!content) return;
  if (!token) return showError("Bitte einloggen!");

  const maxLength = 150;
  if (content.length > maxLength) {
    return showError(`Nachricht zu lang! Maximal ${maxLength} Zeichen.`);
  }

  try {
    const res = await fetch("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        return showError("Nicht autorisiert. Bitte einloggen.");
      const data = await res.json().catch(() => ({}));
      return showError(data.error || "Fehler beim Senden");
    }
    messageInput.value = "";
    sendBtn.disabled = true; // nach Senden Button wieder deaktivieren
  } catch (err) {
    showError("Fehler beim Senden");
  }
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
socket.on("identified", data => {
  filterActive = data.filterActive || false;
  filterBtn.checked = filterActive;
});

filterBtn.addEventListener("change", () => {
  if (!socketConnected) return;
  filterActive = filterBtn.checked;
  socket.emit("toggleFilter", filterActive);
});
