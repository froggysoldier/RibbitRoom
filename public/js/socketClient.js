import * as UI from "./uiHelpers.js";
import * as DOM from "./domElements.js";
import { loadMessages } from "./chatHandlers.js";

export function initSocket(state) {
  if (!state) return;
  if (state.socket && state.socket.connected) return;

  // ✅ Socket.IO initialisieren – mit deiner Render-URL
  state.socket = io("https://ribbitroom-vdzo.onrender.com", {
    auth: { token: state.token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000
  });

  // === Verbindung hergestellt ===
  state.socket.on("connect", () => {
    console.log("[SOCKET] Verbunden mit Server");
    state.socketConnected = true;

    if (state.token) {
      state.socket.emit("identify", { token: state.token });
    }

    if (state.sendBtn && state.messageInput) {
      UI.setSendEnabled(!!state.token);
    }

    UI.showInfo("✅ Verbunden mit Chatserver");
  });

  // === Verbindungsfehler ===
  state.socket.on("connect_error", (err) => {
    console.warn("[SOCKET] connect_error", err?.message || err);
    UI.showError("Verbindung zum Server fehlgeschlagen – prüfe Login oder Netzwerk.");
  });

  // === Neue Nachricht ===
  state.socket.on("newMessage", (msg) => {
    const isSelf = msg.sender === state.username;
    UI.appendMessage(
      msg.sender || "SYSTEM",
      msg.content || "",
      msg.createdAt,
      msg._id,
      isSelf,
      msg.type || "user",
      msg.senderRole || "user"
    );
  });

  // === Systemnachricht ===
  state.socket.on("systemMessage", (data) => {
    let text = "";
    let duration = 4000;
    if (typeof data === "string") text = data;
    else {
      text = data.text || "";
      if (data.duration) duration = data.duration;
    }
    const id = "sys-" + Date.now();
    UI.appendMessage("SYSTEM", text, new Date(), id, false, "system", "user", duration);
  });

  // === Erfolgreich identifiziert ===
  state.socket.on("identified", (data) => {
    console.log("[SOCKET] Identifiziert als", data.username);
    if (data.username) state.username = data.username;
    state.myRole = data.role || state.myRole;
    state.filterActive = data.filterActive || false;
    if (state.filterBtn) state.filterBtn.checked = state.filterActive;
    localStorage.setItem("username", state.username || "");
  });

  // === Benutzerliste ===
  state.socket.on("activeUsers", (users) => {
    if (!state.usersListEl) return;
    state.usersListEl.innerHTML = "";
    if (!state.token) return;

    users.forEach((u) => {
      const li = document.createElement("li");
      li.textContent = u.username;
      if (u.role === "admin") li.classList.add("admin-user");
      state.usersListEl.appendChild(li);
    });
  });

  // === Nachrichten gelöscht ===
  state.socket.on("deletedMessages", (ids) => {
    if (!state.chatWindow) return;
    ids.forEach((id) =>
      state.chatWindow.querySelector(`[data-id="${id}"]`)?.remove()
    );
  });

  // === Server-Reset oder Reload ===
  state.socket.on("forceReload", async (resetAll = true) => {
    if (!state.chatWindow || !state.usersListEl) return;
    if (resetAll) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      if (state.socket) {
        try {
          state.socket.auth = {};
          state.socket.disconnect();
        } catch {}
        state.socket = null;
      }
      state.usersListEl.innerHTML = "";
      state.chatWindow.innerHTML = "";
      UI.showInfo("⚠️ Server zurückgesetzt. Du wurdest abgemeldet.");
      setTimeout(() => window.location.reload(), 2000);
    } else {
      state.chatWindow.innerHTML = "";
      setTimeout(async () => {
        state.socket.emit("requestActiveUsers");
        await loadMessages(state);
      }, 500);
    }
  });

  // === Disconnect ===
  state.socket.on("disconnect", () => {
    console.warn("[SOCKET] Verbindung verloren.");
    state.socketConnected = false;
    if (state.sendBtn && state.messageInput) UI.setSendEnabled(false);
    UI.showError("❌ Verbindung getrennt");
  });

  // === Neues Admin-Token ===
  state.socket.on("newToken", (data) => {
    if (data?.token) {
      state.token = data.token;
      localStorage.setItem("token", state.token);
      console.log("[INFO] Neues Admin-Token gespeichert");
    }
  });

  // === Gebannt ===
  state.socket.on("banned", (data) => {
    const text = data?.text || "Du wurdest gebannt.";
    UI.showError(text);
    state.token = null;
    state.username = null;
    state.myRole = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setTimeout(() => {
      try {
        state.socket.auth = {};
        state.socket.disconnect();
      } catch {}
      window.location.reload();
    }, 3000);
  });

  // === Rollenänderung ===
  state.socket.on("roleUpdated", ({ username, role }) => {
    DOM.usersListEl.querySelectorAll("li").forEach((li) => {
      if (li.textContent === username)
        li.classList.toggle("admin-user", role === "admin");
    });

    DOM.chatWindow.querySelectorAll(".message").forEach((msg) => {
      if (msg.querySelector("strong")?.textContent === username) {
        msg.querySelector("strong").classList.toggle("admin-name", role === "admin");
        msg.classList.toggle("admin-msg", role === "admin");
      }
    });

    if (username === state.username) state.myRole = role;
  });

  // === Update Users & Messages ===
  state.socket.on("updateUsersAndMessages", async () => {
    if (!state.token) return;
    state.socket.emit("requestActiveUsers");
    await loadMessages(state);
  });
}
