// public/js/socketClient.js
import * as UI from "./uiHelpers.js";
import * as DOM from "./domElements.js";
import { loadMessages } from "./chatHandlers.js";

// --- Timeout-Nachrichten verwalten (client-side) ---
// Map id -> element (nur im DOM des Tabs)
const activeTimeoutMessages = new Map();

/**
 * updateOrShowTimeoutMessage(id, text, remaining)
 * - id: eindeutige data-id der Chat-Nachricht (z.B. "timeout-username")
 * - text: anzuzeigender Text (bereits formatiert)
 * - remaining: verbleibende Sekunden (number). Wenn 0 => Timeout vorbei.
 */
export function updateOrShowTimeoutMessage(id, text, remaining) {
  if (!DOM.chatWindow) return;

  let el = DOM.chatWindow.querySelector(`[data-id="${id}"]`);

  if (!el) {
    // appendMessage: appendMessage(sender, content, createdAt, id, self=false, type="user", senderRole="user", duration)
    // wir verwenden type="system" damit CSS passt, senderRole irrelevant
    const longDuration = 24 * 60 * 60 * 1000; // 24h
    UI.appendMessage("SYSTEM", text, new Date(), id, false, "system", "user", longDuration);
    el = DOM.chatWindow.querySelector(`[data-id="${id}"]`);
    if (el) activeTimeoutMessages.set(id, el);
  } else {
    // update existing .msg-content
    const contentEl = el.querySelector(".msg-content");
    if (contentEl) {
      contentEl.innerHTML = UI.formatMessage(text);
    } else {
      // fallback: replace innerHTML
      el.innerHTML = `
        <div class="msg-header"><strong>SYSTEM</strong><span class="time">[--:--]</span></div>
        <div class="msg-content">${UI.formatMessage(text)}</div>
      `;
    }
  }

  // scroll into view
  if (el) el.scrollIntoView({ behavior: "smooth", block: "end" });

  // if finished, mark and remove after a short delay
  if (remaining === 0) {
    setTimeout(() => {
      const el2 = DOM.chatWindow.querySelector(`[data-id="${id}"]`);
      if (!el2) return;
      const contentEl = el2.querySelector(".msg-content");
      if (contentEl) contentEl.innerHTML = UI.formatMessage(text);
      el2.classList.add("timeout-ended");
      // remove after 3s
      setTimeout(() => {
        el2.remove();
        activeTimeoutMessages.delete(id);
      }, 3000);
    }, 500);
  }
}

// ---------------- initSocket ----------------
export function initSocket(state) {
  if (!state) return;
  if (state.socket && state.socket.connected) return;

  state.socket = io({ auth: { token: state.token } });

  // --- Verbindung ---
  state.socket.on("connect", () => {
    state.socketConnected = true;
    if (state.token) state.socket.emit("identify", { token: state.token });
    UI.setSendEnabled(!!state.token);
  });

  state.socket.on("connect_error", (err) =>
    console.warn("[SOCKET] connect_error", err?.message || err)
  );

  // --- Nachrichten empfangen ---
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
    let duration = 4000; // Standarddauer

    if (typeof data === "string") {
      text = data;
    } else {
      text = data.text || "";
      if (data.duration) duration = data.duration;
    }

    const id = "sys-" + Date.now();
    UI.appendMessage("SYSTEM", text, new Date(), id, false, "system", "user", duration);
  });

  state.socket.on("adminNotice", (data) => {
    UI.appendMessage("ADMIN", data.text || "", new Date(), "admin-notice-" + Date.now(), false, "system");
  });

  // --- Auth / Identifizierung ---
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
    if (!state.token) return; // nicht angemeldete Nutzer sehen nichts
    users.forEach((u) => {
      const li = document.createElement("li");
      li.textContent = u.username;
      if (u.role === "admin") li.classList.add("admin-user");
      DOM.usersListEl.appendChild(li);
    });
  });

  // --- Nachrichten löschen ---
  state.socket.on("deletedMessages", (ids) => {
    ids.forEach((id) => DOM.chatWindow.querySelector(`[data-id="${id}"]`)?.remove());
  });

  // --- Force Reload ---
  state.socket.on("forceReload", async (resetAll = true) => {
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
      DOM.usersListEl.innerHTML = "";
      DOM.chatWindow.innerHTML = "";
      UI.showInfo("⚠️ Server wurde zurückgesetzt. Du wurdest abgemeldet.");
      setTimeout(() => window.location.reload(), 2000);
    } else {
      DOM.chatWindow.innerHTML = "";
      setTimeout(async () => {
        state.socket.emit("requestActiveUsers");
        await loadMessages(state);
      }, 500);
    }
  });

  // --- Neues Admin Token ---
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

  // --- Banned ---
  state.socket.on("banned", (data) => {
    const text = (data && data.text) ? data.text : "Du wurdest gebannt.";
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

  // --- Role Update für Admin-Namen ---
  state.socket.on("roleUpdated", ({ username, role }) => {
    const lis = DOM.usersListEl.querySelectorAll("li");
    lis.forEach((li) => {
      if (li.textContent === username) {
        li.classList.toggle("admin-user", role === "admin");
      }
    });

    const messages = DOM.chatWindow.querySelectorAll(".message");
    messages.forEach((msg) => {
      if (msg.querySelector("strong")?.textContent === username) {
        msg.querySelector("strong").classList.toggle("admin-name", role === "admin");
        msg.classList.toggle("admin-msg", role === "admin");
      }
    });

    if (username === state.username) state.myRole = role;
  });

  // --- Aktualisierung auf Anfrage ---
  state.socket.on("updateUsersAndMessages", async () => {
    if (!state.token) return;
    state.socket.emit("requestActiveUsers");
    await loadMessages(state);
  });

  // --- timeoutUpdate (server sends id,text,remaining) ---
  state.socket.on("timeoutUpdate", ({ id, text, remaining }) => {
    // ensure fallback id
    const msgId = id || `timeout-${state.username ? state.username.trim().toLowerCase() : "unknown"}`;
    updateOrShowTimeoutMessage(msgId, text, remaining);
  });

}
