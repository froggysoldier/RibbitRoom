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

  state.socket.on("newMessage", (msg) => {
    if (!state.token) return; // nur eingeloggte Clients bekommen Nachrichten
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

    if (typeof data === "string") {
      text = data;
    } else if (typeof data === "object") {
      text = data.text || "";
      duration = data.duration || 4000;
    }

    const key = "sys-" + Date.now();
    UI.showPersistentSystem(text, key);

    if (duration > 0) {
      setTimeout(() => UI.clearPersistentSystem(key), duration);
    }
  });

  state.socket.on("adminNotice", (data) => {
    UI.appendMessage("ADMIN", data.text || "", new Date(), "admin-notice-" + Date.now(), false, "system");
  });

  state.socket.on("identified", (data) => {
    if (data.username) state.username = data.username;
    state.myRole = data.role || state.myRole;
    state.filterActive = data.filterActive || false;
    DOM.filterBtn.checked = state.filterActive;
    localStorage.setItem("username", state.username || "");
  });

  state.socket.on("activeUsers", (users) => {
    if (!state.token) {
      DOM.usersListEl.innerHTML = "";
      return; // nicht eingeloggte sehen keine User
    }
    DOM.usersListEl.innerHTML = "";
    users.forEach((u) => {
      const li = document.createElement("li");
      li.textContent = u.username;
      if (u.role === "admin") li.classList.add("admin-user");
      DOM.usersListEl.appendChild(li);
    });
  });

  state.socket.on("deletedMessages", (ids) => {
    if (!state.token) return;
    ids.forEach((id) => DOM.chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  state.socket.on("forceReload", (resetAll = true) => {
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
  });

  state.socket.on("newToken", (data) => {
    if (data?.token) {
      state.token = data.token;
      localStorage.setItem("token", state.token);
      console.log("[INFO] Neues Admin-Token gespeichert");
    }
  });

  state.socket.on("disconnect", () => {
    state.socketConnected = false;
    UI.setSendEnabled(false);
  });

  state.socket.on("banned", (data) => {
    const text = (data && data.text) ? data.text : "Du wurdest gebannt.";
    UI.showError(text);
    state.token = null;
    state.username = null;
    state.myRole = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    DOM.usersListEl.innerHTML = "";
    DOM.chatWindow.innerHTML = "";
    setTimeout(() => {
      try { state.socket.auth = {}; state.socket.disconnect(); } catch {}
      window.location.reload();
    }, 3000);
  });

  state.socket.on("updateUsersAndMessages", async () => {
    if (!state.token) return;
    state.socket.emit("requestActiveUsers");
    await loadMessages(state);
  });
}
