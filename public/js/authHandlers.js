// public/js/authHandlers.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";
import { loadMessages } from "./chatHandlers.js";

export function initAuthHandlers(state) {
  if (!state) return;

  // --- Login / Logout Button ---
  DOM.loginBtnHeader.onclick = () => {
    if (state.token) {
      // Logout
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");

      if (state.socket) {
        try { state.socket.auth = {}; state.socket.disconnect(); } catch {}
        state.socket = null;
      }

      DOM.renderActiveUsers([]);
      UI.showInfo("Abgemeldet");
      window.location.reload();
    } else {
      // Login Modal öffnen
      DOM.modal.style.display = "block";
    }
  };

  // Modal schließen
  DOM.closeModal.onclick = () => (DOM.modal.style.display = "none");
  window.onclick = (e) => { if (e.target === DOM.modal) DOM.modal.style.display = "none"; };

  // --- Login ---
  DOM.loginSubmit.addEventListener("click", async () => {
    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value.trim();
    if (!u || !p) return UI.showError("Bitte Benutzername und Passwort eingeben.");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if (!res.ok) return UI.showError(data.error || "Login fehlgeschlagen");

      // --- State updaten ---
      state.token = data.token;
      state.username = u;
      state.myRole = data.role || "user";
      localStorage.setItem("token", state.token);
      localStorage.setItem("username", state.username);

      DOM.modal.style.display = "none";
      UI.showInfo(`Eingeloggt als ${state.username}`);

      // Socket neu initialisieren oder reconnecten
      if (state.socket) {
        state.socket.auth = { token: state.token };
        state.socket.disconnect();
        setTimeout(() => initSocket(state), 50);
      } else initSocket(state);

      await loadMessages(state);
    } catch {
      UI.showError("Login-Fehler");
    }
  });

  // --- Registrierung ---
  DOM.registerSubmit.addEventListener("click", async () => {
    const newU = document.getElementById("newUser").value.trim();
    const newP = document.getElementById("newPass").value.trim();
    const email = document.getElementById("email").value.trim();
    const adminPassField = document.getElementById("adminPass") ? document.getElementById("adminPass").value.trim() : null;

    if (!newU || !newP || !email) return UI.showError("Bitte alle Felder ausfüllen.");

    try {
      const body = { username: newU, password: newP, email };
      if (adminPassField) body.adminPass = adminPassField;

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) return UI.showError(data.error || "Registrierung fehlgeschlagen");

      if (data.token) {
        state.token = data.token;
        state.username = newU;
        state.myRole = data.role || "user";
        localStorage.setItem("token", state.token);
        localStorage.setItem("username", state.username);

        UI.showInfo("Registrierung erfolgreich — eingeloggt.");

        if (state.socket) {
          state.socket.auth = { token: state.token };
          state.socket.disconnect();
          setTimeout(() => initSocket(state), 50);
        } else initSocket(state);

        await loadMessages(state);
      } else {
        UI.showInfo("Registrierung erfolgreich — bitte einloggen.");
      }

      DOM.modal.style.display = "none";
    } catch {
      UI.showError("Registrieren-Fehler");
    }
  });
}
