// public/js/socketClient.js
import { appendMessage, renderActiveUsers, showInfo, showError, setSendEnabled } from "./uiHelpers.js";

export function initSocket(state) {
  if (state.socket && state.socket.connected) return;

  state.socket = io({ auth: { token: state.token } });

  state.socket.on("connect", () => {
    state.socketConnected = true;
    if (state.token) state.socket.emit("identify", { token: state.token });
    setSendEnabled(true, state.sendBtn, state.messageInput);
  });

  state.socket.on("connect_error", (err) => console.warn("[SOCKET] connect_error", err?.message || err));

  state.socket.on("newMessage", (msg) => {
    const isSelf = msg.sender === state.username;
    appendMessage(msg.sender || "SYSTEM", msg.content || "", msg.createdAt, msg._id, isSelf, msg.type || "user", msg.senderRole || "user", document.getElementById("chatWindow"));
  });

  state.socket.on("systemMessage", (data) => {
    if (typeof data === "string") appendMessage("SYSTEM", data, new Date(), "sys-" + Date.now(), false, "system", "user", document.getElementById("chatWindow"));
    else appendMessage("SYSTEM", data.text || "", new Date(), "sys-" + Date.now(), false, "system", "user", document.getElementById("chatWindow"));
  });

  state.socket.on("adminNotice", (data) => {
    appendMessage("ADMIN", data.text || "", new Date(), "admin-notice-" + Date.now(), false, "system", "user", document.getElementById("chatWindow"));
  });

  state.socket.on("activeUsers", (users) => renderActiveUsers(Array.isArray(users) ? users : [], document.getElementById("users")));

  state.socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => document.getElementById("chatWindow").querySelector(`[data-id="${id}"]`)?.remove());
  });

  state.socket.on("forceReload", (resetAll = true) => {
    if (resetAll) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      if (state.socket) { try { state.socket.auth = {}; state.socket.disconnect(); } catch {} state.socket = null; }
      renderActiveUsers([], document.getElementById("users"));
      document.getElementById("chatWindow").innerHTML = "";
      showInfo("⚠️ Server wurde zurückgesetzt. Du wurdest abgemeldet.", document.getElementById("chatWindow"));
      setTimeout(() => window.location.reload(), 2000);
    } else {
      document.getElementById("chatWindow").innerHTML = "";
      window.location.reload();
    }
  });

  state.socket.on("newToken", (data) => {
    if (data?.token) {
      state.token = data.token;
      localStorage.setItem("token", state.token);
    }
  });

  state.socket.on("disconnect", () => {
    state.socketConnected = false;
    setSendEnabled(false, state.sendBtn, state.messageInput);
  });

  state.socket.on("banned", (data) => {
    const text = data?.text || "Du wurdest gebannt.";
    showError(text, document.getElementById("chatWindow"));
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

  return state.socket;
}
