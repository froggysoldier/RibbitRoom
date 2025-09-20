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
    if (!state.token) return;
    const isSelf = msg.sender === state.username;
    UI.appendMessage(msg.sender || "SYSTEM", msg.content || "", msg.createdAt, msg._id, isSelf, msg.type || "user", msg.senderRole || "user");
  });

  state.socket.on("systemMessage", (data) => {
    if (!state.token) return;
    if (typeof data === "string") UI.appendMessage("SYSTEM", data, new Date(), "sys-" + Date.now(), false, "system");
    else UI.appendMessage("SYSTEM", data.text || "", new Date(), "sys-" + Date.now(), false, "system", "system", data.duration || 4000);
  });

  state.socket.on("adminNotice", (data) => {
    if (!state.token) return;
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
    if (!state.token) return;
    DOM.usersListEl.innerHTML = "";
    users.forEach((u) => {
      const li = document.createElement("li");
      li.textContent = u.username;
      if (u.role === "admin") li.classList.add("admin-user");
      DOM.usersListEl.appendChild(li);
    });
  });

  state.socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => DOM.chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

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
