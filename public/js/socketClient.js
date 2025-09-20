// public/js/socketClient.js
import * as UI from "./uiHelpers.js";
import * as DOM from "./domElements.js";
import { loadMessages } from "./chatHandlers.js"; // ensure loadMessages is exported from chatHandlers

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
    if (typeof data === "string") {
      UI.appendMessage("SYSTEM", data, new Date(), "sys-" + Date.now(), false, "system");
    } else {
      UI.appendMessage("SYSTEM", data.text || "", new Date(), "sys-" + Date.now(), false, "system", "user");
    }
  });

  state.socket.on("removeSystemMessage", (msgId) => {
    const el = DOM.chatWindow.querySelector(`[data-id="${msgId}"]`);
    if (el) el.remove();
  });

  state.socket.on("spamWarning", (data) => {
    // Show persistent spam warning
    const allowedAt = data?.allowedAt || Date.now() + 2000;
    const updatePersistent = () => {
      const remaining = Math.max(0, Math.ceil((allowedAt - Date.now()) / 1000));
      UI.showPersistentSystem(`⚠️ Bitte warten ${remaining}s bevor du wieder schreiben kannst.`, "spam");
    };
    updatePersistent();
    const interval = setInterval(() => {
      const remainingMs = allowedAt - Date.now();
      if (remainingMs <= 0) {
        clearInterval(interval);
        UI.clearPersistentSystem("spam");
      } else {
        updatePersistent();
      }
    }, 500);
  });

  state.socket.on("spamClear", () => {
    UI.clearPersistentSystem("spam");
  });

  state.socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => DOM.chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  state.socket.on("updateUsersAndMessages", async () => {
    state.socket.emit("requestActiveUsers");
    await loadMessages(state);
  });

  state.socket.on("identified", (data) => {
    if (data.username) state.username = data.username;
    state.myRole = data.role || state.myRole;
    state.filterActive = data.filterActive || false;
    DOM.filterBtn.checked = state.filterActive;
    localStorage.setItem("username", state.username || "");
  });

  state.socket.on("activeUsers", (users) => {
    DOM.usersListEl.innerHTML = "";
    users.forEach((u) => {
      const li = document.createElement("li");
      li.textContent = u.username;
      if (u.role === "admin") li.classList.add("admin-user");
      DOM.usersListEl.appendChild(li);
    });
  });

  state.socket.on("newToken", (data) => {
    if (data?.token) {
      state.token = data.token;
      localStorage.setItem("token", state.token);
      console.log("[INFO] Neues Admin-Token gespeichert");
    }
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

  state.socket.on("toggleFilter", (active) => {
    if (!state.username) return;
    state.filterActive = !!active;
  });
}
