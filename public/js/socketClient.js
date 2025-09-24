// public/js/socketClient.js
import * as UI from "./uiHelpers.js";
import * as DOM from "./domElements.js";
import { loadMessages } from "./chatHandlers.js";

// robustere updateOrShowTimeoutMessage
export function updateOrShowTimeoutMessage(id, text, remaining) {
  if (!DOM.chatWindow) return;

  // Suche vorhandene Nachricht per data-id
  let el = DOM.chatWindow.querySelector(`[data-id="${id}"]`);

  // falls nicht vorhanden -> neu anlegen via UI.appendMessage mit sehr großer duration
  if (!el) {
    const longDuration = 24 * 60 * 60 * 1000; // 24h
    UI.appendMessage("SYSTEM", text, new Date(), id, false, "system", "user", longDuration);
    el = DOM.chatWindow.querySelector(`[data-id="${id}"]`);
    if (!el) {
      console.warn("[timeout] konnte element nach appendMessage nicht finden, id=", id);
      return;
    }
  }

  // Aktualisiere Header-Zeit (optional: Anzeige [mm:ss] oder [HH:MM])
  try {
    const headerTime = el.querySelector(".msg-header .time");
    if (headerTime) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      headerTime.textContent = `[${hh}:${mm}]`;
    }
  } catch (e) {
    // nicht kritisch
  }

  // Aktualisiere den Inhalt
  const contentEl = el.querySelector(".msg-content");
  if (contentEl) {
    contentEl.innerHTML = UI.formatMessage(text);
  } else {
    // fallback: ersetze innerHTML komplett
    el.innerHTML = `
      <div class="msg-header"><strong>SYSTEM</strong> <span class="time">[--:--]</span></div>
      <div class="msg-content">${UI.formatMessage(text)}</div>
    `;
  }

  // Scroll zur Nachricht
  el.scrollIntoView({ behavior: "smooth", block: "end" });

  // Wenn Timeout vorbei: markiere und entferne nach kurzer Zeit (nur dieses Element)
  if (typeof remaining === "number" && remaining <= 0) {
    el.classList.add("timeout-ended");
    // optional: ändere style sofort
    const contentEl2 = el.querySelector(".msg-content");
    if (contentEl2) contentEl2.innerHTML = UI.formatMessage(text);

    // entferne nur diese Nachricht nach 3s
    setTimeout(() => {
      const e = DOM.chatWindow.querySelector(`[data-id="${id}"]`);
      if (e) e.remove();
    }, 3000);
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

  state.socketTarget.emit("timeoutUpdate", {
    id: timeoutMsgId,
    text: `⚠️ Du bist noch für ${formatDuration(remaining)} gemutet.`,
    remaining
  });

}
