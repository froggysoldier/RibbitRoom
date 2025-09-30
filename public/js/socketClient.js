import * as UI from "./uiHelpers.js";
import * as DOM from "./domElements.js";
import { loadMessages } from "./chatHandlers.js";

export function initSocket(state) {
  if (!state) return;
  if (state.socket && state.socket.connected) return;

  // Socket.IO initialisieren
  state.socket = io({ auth: { token: state.token } });

  state.socket.on("connect", () => {
    state.socketConnected = true;
    if (state.token) state.socket.emit("identify", { token: state.token });
    if (state.sendBtn && state.messageInput) UI.setSendEnabled(!!state.token);
  });

  state.socket.on("connect_error", (err) =>
    console.warn("[SOCKET] connect_error", err?.message || err)
  );

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

  state.socket.on("identified", (data) => {
    if (data.username) state.username = data.username;
    state.myRole = data.role || state.myRole;
    state.filterActive = data.filterActive || false;
    if (state.filterBtn) state.filterBtn.checked = state.filterActive;
    localStorage.setItem("username", state.username || "");
  });

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

  state.socket.on("deletedMessages", (ids) => {
    if (!state.chatWindow) return;
    ids.forEach((id) => state.chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  state.socket.on("forceReload", async (resetAll = true) => {
    if (!state.chatWindow || !state.usersListEl) return;
    if (resetAll) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      if (state.socket) {
        try { state.socket.auth = {}; state.socket.disconnect(); } catch {}
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

  state.socket.on("disconnect", () => {
    state.socketConnected = false;
    if (state.sendBtn && state.messageInput) UI.setSendEnabled(false);
  });
   // Neues Admin-Token
  state.socket.on("newToken", (data) => {
    if (data?.token) {
      state.token = data.token;
      localStorage.setItem("token", state.token);
      console.log("[INFO] Neues Admin-Token gespeichert");
    }
  });

  // Disconnect
  state.socket.on("disconnect", () => {
    state.socketConnected = false;
    UI.setSendEnabled(false);
  });

  // Gebannt
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

  // Role Update
  state.socket.on("roleUpdated", ({ username, role }) => {
    DOM.usersListEl.querySelectorAll("li").forEach((li) => {
      if (li.textContent === username) li.classList.toggle("admin-user", role === "admin");
    });

    DOM.chatWindow.querySelectorAll(".message").forEach((msg) => {
      if (msg.querySelector("strong")?.textContent === username) {
        msg.querySelector("strong").classList.toggle("admin-name", role === "admin");
        msg.classList.toggle("admin-msg", role === "admin");
      }
    });

    if (username === state.username) state.myRole = role;
  });

  // Update Users & Messages
  state.socket.on("updateUsersAndMessages", async () => {
    if (!state.token) return;
    state.socket.emit("requestActiveUsers");
    await loadMessages(state);
  });
  // Admin-Token, Banned, roleUpdated etc. unverändert
}
