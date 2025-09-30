// public/js/authHandlers.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { loadMessages } from "./chatHandlers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {
  if (!state) return;

  function refreshLoginButton() {
    if (DOM.loginBtn)
      DOM.loginBtn.textContent =
        state.token && state.username ? "Abmelden" : "Login / Registrieren";
  }

  refreshLoginButton();

  // --- Login / Logout Button ---
  if (DOM.loginBtn) {
    DOM.loginBtn.onclick = () => {
      if (state.token) {
        // Logout
        state.token = null;
        state.username = null;
        state.myRole = "user";
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        if (state.socket) {
          try { state.socket.disconnect(); } catch {}
          state.socket = null;
        }
        if (DOM.usersListEl) DOM.usersListEl.innerHTML = "";
        refreshLoginButton();
        UI.showInfo("Abgemeldet");
      } else {
        if (DOM.modal) DOM.modal.style.display = "block";
      }
    };
  }

  // --- Modal schließen ---
  if (DOM.closeModal) {
    DOM.closeModal.onclick = () => {
      if (DOM.modal) DOM.modal.style.display = "none";
    };
  }

  window.onclick = (e) => {
    if (e.target === DOM.modal) DOM.modal.style.display = "none";
  };

  // --- Login ---
  if (DOM.loginSubmit) {
    DOM.loginSubmit.addEventListener("click", async () => {
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value.trim();
      if (!username || !password) return UI.showError("Bitte Benutzername und Passwort eingeben.");

      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();

        if (res.status === 403 && data.error.includes("nicht verifiziert")) {
          UI.showInfo("📧 Code wurde an deine E-Mail geschickt. Bitte eingeben.");
          state.pendingUsername = username;
          if (DOM.codeModal) DOM.codeModal.style.display = "block";
          return;
        }

        if (!res.ok) return UI.showError(data.error || "Login fehlgeschlagen");

        state.token = data.token;
        state.username = username;
        state.myRole = data.role || "user";
        localStorage.setItem("token", state.token);
        localStorage.setItem("username", state.username);

        if (DOM.modal) DOM.modal.style.display = "none";
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
      }
    });
  }

  // --- Registrierung ---
  if (DOM.registerSubmit) {
    DOM.registerSubmit.addEventListener("click", async () => {
      const newU = document.getElementById("newUser").value.trim();
      const newP = document.getElementById("newPass").value.trim();
      const email = document.getElementById("email").value.trim();
      if (!newU || !newP || !email) return UI.showError("Bitte alle Felder ausfüllen.");

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
        if (!res.ok) return UI.showError(data.error || "Registrierung fehlgeschlagen");

        UI.showInfo("Registrierung erfolgreich — bitte Code in E-Mail eingeben.");
        if (DOM.modal) DOM.modal.style.display = "none";
      } catch {
        UI.showError("Registrieren-Fehler");
      }
    });
  }
}
