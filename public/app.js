// --- DOM Elemente ---
const loginBtnHeader = document.getElementById("loginBtn");
const modal = document.getElementById("loginModal");
const closeModal = document.querySelector(".close");
const loginSubmit = document.getElementById("loginSubmit");
const registerSubmit = document.getElementById("registerSubmit");

const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");

// --- Modal öffnen/schließen ---
loginBtnHeader.onclick = () => modal.style.display = "block";
closeModal.onclick = () => modal.style.display = "none";
window.onclick = e => { if (e.target === modal) modal.style.display = "none"; };

// --- Helper: Nachricht mit Uhrzeit anzeigen ---
function appendMessage(sender, content, createdAt) {
  const p = document.createElement("p");
  const date = new Date(createdAt);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const time = `${hours}:${minutes}`;
  p.innerHTML = `<strong>${sender}</strong> <span class="time">[${time}]</span>: ${content}`;
  chatWindow.appendChild(p);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- Token & Socket ---
let token = localStorage.getItem("token");
let socket;

// --- Socket.IO Verbindung ---
function connectSocket() {
  if (!token) return;

  socket = io({ auth: { token } });

  socket.on("connect_error", (err) => {
    console.error("Socket.IO Fehler:", err.message);
  });

  socket.on("newMessage", msg => {
    appendMessage(msg.sender, msg.content, msg.createdAt);
  });
}

// --- Nachrichten laden ---
async function loadMessages() {
  if (!token) return;
  try {
    const res = await fetch("/api/messages", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach(msg => appendMessage(msg.sender, msg.content, msg.createdAt));

    connectSocket(); // Socket.IO erst nach Laden der Nachrichten
  } catch (err) {
    console.error("Fehler beim Laden der Nachrichten:", err);
  }
}

// --- Initialer Hinweis ---
if (!token) {
  chatWindow.innerHTML = "<p>Bitte zuerst einloggen oder registrieren.</p>";
} else {
  loadMessages();
}

// --- Login ---
loginSubmit.addEventListener("click", async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (res.ok) {
      token = data.token;
      localStorage.setItem("token", token);
      modal.style.display = "none";
      alert("Login erfolgreich!");
      loadMessages();
    } else {
      alert(data.error);
    }
  } catch (err) {
    console.error(err);
  }
});

// --- Registrierung ---
registerSubmit.addEventListener("click", async () => {
  const username = document.getElementById("newUser").value;
  const password = document.getElementById("newPass").value;
  const email = document.getElementById("email").value;

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, email })
    });

    const data = await res.json();
    if (res.ok) {
      alert("Registrierung erfolgreich!");
    } else {
      alert(data.error);
    }
  } catch (err) {
    console.error(err);
  }
});

// --- Nachricht senden ---
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

    if (res.ok) {
      const data = await res.json();
      messageInput.value = "";
      socket.emit("chatMessage", data); // Anzeige erfolgt via Socket.IO
    } else {
      const data = await res.json();
      alert(data.error);
    }
  } catch (err) {
    console.error(err);
  }
}

// --- Button & Enter ---
sendBtn.onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
