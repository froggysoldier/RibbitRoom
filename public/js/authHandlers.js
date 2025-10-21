// public/js/authHandlers.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { loadMessages } from "./chatHandlers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {
  if (!state) return;

  function refreshLoginButton() {
    DOM.loginBtn.textContent = (state.token && state.username)
      ? "Abmelden"
      : "Login / Registrieren";
  }

  refreshLoginButton();

  DOM.loginBtn.onclick = () => {
    if (state.token) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      if (state.socket) {
        try { state.socket.auth = {}; state.socket.disconnect(); } catch {}
        state.socket = null;
      }
      DOM.usersListEl.innerHTML = "";
      refreshLoginButton();
      UI.showInfo("Abgemeldet");
      window.location.reload();
    } else DOM.modal.style.display = "block";
  };

  DOM.closeModal.onclick = () => { DOM.modal.style.display = "none"; };
  window.onclick = (e) => { if (e.target === DOM.modal) DOM.modal.style.display = "none"; };

  // --- LOGIN HANDLER ---
  DOM.loginSubmit.addEventListener("click", async () => {
    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value.trim();
    if (!u || !p) {
      UI.showError("Bitte Benutzername und Passwort eingeben.");
      DOM.modal.style.display = "none";
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();

      if (!res.ok) {
        UI.showError(data.error || "Login fehlgeschlagen");
        DOM.modal.style.display = "none";
        return;
      }

      state.token = data.token;
      state.username = u;
      state.myRole = data.role || "user";
      localStorage.setItem("token", state.token);
      localStorage.setItem("username", state.username);
      DOM.modal.style.display = "none";
      UI.showInfo(`Eingeloggt als ${state.username}`);
      refreshLoginButton();

      if (state.socket) {
        state.socket.auth = { token: state.token };
        state.socket.disconnect();
        setTimeout(() => initSocket(state), 50);
      } else initSocket(state);

      await loadMessages(state);
    } catch {
      UI.showError("Login-Fehler");
      DOM.modal.style.display = "none";
    }
  });

  // --- REGISTER HANDLER ---
  DOM.registerSubmit.addEventListener("click", async () => {
    const newU = document.getElementById("newUser").value.trim();
    const newP = document.getElementById("newPass").value.trim();
    const email = document.getElementById("email").value.trim();
    if (!newU || !newP || !email) {
      UI.showError("Bitte alle Felder ausfüllen.");
      DOM.modal.style.display = "none";
      return;
    }

    try {
      const body = { username: newU, password: newP, email };
      const adminPassField = document.getElementById("adminPass")?.value?.trim();
      if (adminPassField) body.adminPass = adminPassField;

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (!res.ok) {
        UI.showError(data.error || "Registrierung fehlgeschlagen");
        DOM.modal.style.display = "none";
        return;
      }

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
      refreshLoginButton();
    } catch {
      UI.showError("Registrieren-Fehler");
      DOM.modal.style.display = "none";
    }
  });
}
