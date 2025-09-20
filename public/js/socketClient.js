// public/js/socketClient.js
import { appendMessage, renderActiveUsers, showError, showInfo, setSendEnabled } from "./uiHelpers.js";
import { usersListEl, chatWindow, sendBtn, messageInput } from "./domElements.js";

export function initSocket(state) {
  if (state.socket && state.socket.connected) return;

  state.socket = io({ auth: { token: state.token } });

  state.socket.on("connect", () => {
    state.socketConnected = true;
    if (state.token) state.socket.emit("identify", { token: state.token });
    setSendEnabled(!!state.token, sendBtn, messageInput);
  });

  state.socket.on("connect_error", (err) => console.warn("[SOCKET] connect_error", err?.message || err));

  state.socket.on("newMessage", (msg) => {
    const isSelf = msg.sender === state.username;
    appendMessage(msg.sender || "SYSTEM", msg.content || "", msg.createdAt, msg._id, isSelf, msg.type || "user", msg.senderRole || "user");
  });

  state.socket.on("systemMessage", (data) => {
    if (typeof data === "string") appendMessage("SYSTEM", data, new Date(), "sys-" + Date.now(), false, "system");
    else appendMessage("SYSTEM", data.text || "", new Date(), "sys-" + Date.now(), false, "system");
  });

  state.socket.on("adminNotice", (data) => {
    appendMessage("ADMIN", data.text || "", new Date(), "admin-notice-" + Date.now(), false, "system");
  });

  state.socket.on("identified", (data) => {
    if (data.username) state.username = data.username;
    state.myRole = data.role || state.myRole;
    state.filterActive = data.filterActive || false;
    if (state.filterBtn) state.filterBtn.checked = state.filterActive;
    localStorage.setItem("username", state.username || "");
  });

  state.socket.on("activeUsers", (users) => renderActiveUsers(Array.isArray(users) ? users : []));
  state.socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  state.socket.on("forceReload", (resetAll = true) => {
    if (resetAll) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");

      if (state.socket) { try { state.socket.auth = {}; state.socket.disconnect(); } catch {} state.socket = null; }

      renderActiveUsers([]);
      chatWindow.innerHTML = "";
      showInfo("⚠️ Server wurde zurückgesetzt. Du wurdest abgemeldet.");
      setTimeout(() => window.location.reload(), 2000);
    } else {
      chatWindow.innerHTML = "";
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
    setSendEnabled(false, sendBtn, messageInput);
  });

  state.socket.on("banned", (data) => {
    const text = (data && data.text) ? data.text : "Du wurdest gebannt.";
    showError(text);

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

  state.socket.on("roleUpdated", ({ username: updatedUser, role }) => {
    const users = Array.from(usersListEl.children);
    users.forEach(li => { if (li.textContent === updatedUser) li.classList.toggle("admin-user", role === "admin"); });

    const messages = chatWindow.querySelectorAll(".message");
    messages.forEach(msg => {
      if (msg.querySelector("strong")?.textContent === updatedUser) {
        msg.querySelector("strong").classList.toggle("admin-name", role === "admin");
        msg.classList.toggle("admin-msg", role === "admin");
      }
    });

    if (updatedUser === state.username) state.myRole = role;
  });
}
