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

  state.socket.on("connect_error", (err) => {
    console.warn("[SOCKET] connect_error", err?.message || err);
  });

  // --- Neue Nachrichten empfangen ---
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

  // --- Systemnachrichten ---
  state.socket.on("systemMessage", (data) => {
    if (typeof data === "string") UI.appendMessage("SYSTEM", data, new Date(), "sys-" + Date.now(), false, "system");
    else UI.appendMessage("SYSTEM", data.text || "", new Date(), "sys-" + Date.now(), false, "system");
  });

  state.socket.on("adminNotice", (data) => {
    UI.appendMessage("ADMIN", data.text || "", new Date(), "admin-notice-" + Date.now(), false, "system");
  });

  // --- Identifiziert / login ---
  state.socket.on("identified", (data) => {
    if (data.username) state.username = data.username;
    state.myRole = data.role || state.myRole;
    state.filterActive = data.filterActive || false;
    DOM.filterBtn.checked = state.filterActive;
    localStorage.setItem("username", state.username || "");
  });

  // --- aktive Nutzerliste ---
  state.socket.on("activeUsers", (users) => {
    DOM.renderActiveUsers(users);
  });

  // --- Nachrichten gelöscht ---
  state.socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => state.chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  // --- forceReload für Reset ---
  state.socket.on("forceReload", (resetAll = true) => {
    if (resetAll) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");

      if (state.socket) { try { state.socket.auth = {}; state.socket.disconnect(); } catch {} state.socket = null; }

      DOM.renderActiveUsers([]);
      state.chatWindow.innerHTML = "";
      UI.showInfo("⚠️ Server wurde zurückgesetzt. Du wurdest abgemeldet.");
      setTimeout(() => window.location.reload(), 2000);
    } else {
      state.chatWindow.innerHTML = "";
      window.location.reload();
    }
  });

  // --- neues Token speichern (Admin) ---
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

  // --- gebannt ---
  state.socket.on("banned", (data) => {
    const text = (data && data.text) ? data.text : "Du wurdest gebannt.";
    UI.showError(text);

    state.token = null;
    state.username = null;
    state.myRole = "user";
    localStorage.removeItem("token");
    localStorage.removeItem("username");

    setTimeout(() => {
      try { state.socket.auth = {}; state.socket.disconnect(); } catch (e) {}
      window.location.reload();
    }, 3000);
  });

  // --- Admin-Status Update ---
  state.socket.on("roleUpdated", ({ username: updatedUser, role }) => {
    // Nutzerliste
    const users = Array.from(document.querySelectorAll("#users li"));
    users.forEach(li => {
      if (li.textContent === updatedUser) li.classList.toggle("admin-user", role === "admin");
    });

    // Chatnachrichten
    const messages = state.chatWindow.querySelectorAll(".message");
    messages.forEach(msg => {
      if (msg.querySelector("strong")?.textContent === updatedUser) {
        msg.querySelector("strong").classList.toggle("admin-name", role === "admin");
        msg.classList.toggle("admin-msg", role === "admin");
      }
    });

    if (updatedUser === state.username) state.myRole = role;
  });

  // --- Alte Nachrichten direkt laden ---
  if (state.token) loadMessages(state);
}
