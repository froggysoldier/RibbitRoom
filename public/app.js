// --- Socket.IO ---
const socket = io();

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

// --- Helper: Nachrichten anzeigen ---
function appendMessage(sender, content) {
  const p = document.createElement("p");
  p.innerHTML = `<strong>${sender}:</strong> ${content}`;
  chatWindow.appendChild(p);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// --- Nachrichten laden ---
async function loadMessages() {
  try {
    const res = await fetch("/api/messages");
    const messages = await res.json();
    chatWindow.innerHTML = "";
    messages.reverse().forEach(msg => appendMessage(msg.sender, msg.content));
  } catch (err) {
    console.error("Fehler beim Laden der Nachrichten:", err);
  }
}
loadMessages();

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
      localStorage.setItem("token", data.token);
      alert("Login erfolgreich!");
      modal.style.display = "none";
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

// --- Nachricht senden Funktion ---
async function sendMessage() {
  const content = messageInput.value.trim();
  if (!content) return;

  const token = localStorage.getItem("token");
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
      messageInput.value = "";
      const data = await res.json();
      socket.emit("chatMessage", data); // Echtzeit an andere Nutzer
    } else {
      const data = await res.json();
      alert(data.error);
    }
  } catch (err) {
    console.error(err);
  }
}

// --- Button Click & Enter-Taste ---
sendBtn.onclick = sendMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// --- Echtzeit Nachrichten empfangen ---
socket.on("newMessage", msg => {
  appendMessage(msg.sender, msg.content);
});
