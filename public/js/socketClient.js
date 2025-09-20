// public/js/socketClient.js
import * as UI from "./uiHelpers.js";
import * as DOM from "./domElements.js";
import { loadMessages } from "./chatHandlers.js";

export function initSocket(state) {
  if (!state) return;
  if (state.socket && state.socket.connected) return;

  state.socket = io({ auth: { token: state.token } });

  state.socket.on("connect", () => {
    state.socketConnected = true;
    if (state.token) state.socket.emit("identify", { token: state.token });
    UI.setSendEnabled(!!state.token);
  });

  state.socket.on("connect_error", (err) => console.warn("[SOCKET] connect_error", err?.message || err));

  // --- Neue Chatnachrichten ---
  state.socket.on("newMessage", (msg) => {
    const isSelf = msg.sender === state.username;
    UI.appendMessage(
      msg.sender || "SYSTEM",
      msg.content || "",
      msg.createdAt,
      msg._id,
      isSelf,
      "user",
      msg.senderRole || "user"
    );
  });

  // --- Systemnachrichten ---
  state.socket.on("systemMessage", (data) => {
    const text = typeof data === "string" ? data : data.text || "";
    const duration = (typeof data === "object" && data.duration) ? data.duration : 4000;
    UI.appendMessage("SYSTEM", text, new Date(), "sys-" + Date.now(), false, "system", "system");
    if (duration && duration > 0) {
      setTimeout(() => UI.clearPersistentSystem("sys-" + Date.now()), duration);
    }
  });

  // --- Admin-Notices ---
  state.socket.on("adminNotice", (data) => {
    const text = typeof data === "string" ? data : data.text || "";
    UI.appendMessage("ADMIN", text, new Date(), "admin-notice-" + Date.now(), false, "system");
  });

  // --- Identifikation ---
  state.socket.on("identified", (data) => {
    if (data.username) state.username = data.username;
    state.myRole = data.role || state.myRole;
    state.filterActive = data.filterActive || false;
    DOM.filterBtn.checked = state.filterActive;
    localStorage.setItem("username", state.username || "");
  });

  // --- Aktive Nutzerliste ---
  state.socket.on("activeUsers", (users) => {
    DOM.usersListEl.innerHTML = "";
    users.forEach((u) => {
      const li = document.createElement("li");
      li.textContent = u.username;
      if (u.role === "admin") li.classList.add("admin-user");
      DOM.usersListEl.appendChild(li);
    });
  });

  // --- Gelöschte Nachrichten ---
  state.socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => DOM.chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  // --- Force Reload ---
  state.socket.on("forceReload", (resetAll = true) => {
    if (resetAll) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      if (state.socket) { try { state.socket.auth = {}; state.socket.disconnect(); } catch {} state.socket = null; }
      DOM.usersListEl.innerHTML = "";
      DOM.chatWindow.innerHTML = "";
      UI.showInfo("⚠️ Server wurde zurückgesetzt. Du wurdest abgemeldet.");
      setTimeout(() => window.location.reload(), 2000);
    } else {
      DOM.chatWindow.innerHTML = "";
      window.location.reload();
    }
  });

  // --- Neues Token vom Server ---
  state.socket.on("newToken", (data) => {
    if (data?.token) {
      state.token = data.token;
      localStorage.setItem("token", state.token);
      console.log("[INFO] Neues Admin-Token gespeichert");
    }
  });

  // --- Disconnect ---
  state.socket.on("disconnect", () => {
    state.socketConnected = false;
    UI.setSendEnabled(false);
  });

  // --- User gebannt ---
  state.socket.on("banned", (data) => {
    const text = (data && data.text) ? data.text : "Du wurdest gebannt.";
    UI.showError(text);
    state.token = null;
    state.username = null;
    state.myRole = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setTimeout(() => {
      try { state.socket.auth = {}; state.socket.disconnect(); } catch {}
      window.location.reload();
    }, 3000);
  });

  // --- Update Users und Messages ---
  state.socket.on("updateUsersAndMessages", async () => {
    state.socket.emit("requestActiveUsers");
    if (state.token) await loadMessages(state);
  });
}
