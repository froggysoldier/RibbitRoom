// public/js/authHandlers.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { loadMessages } from "./chatHandlers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {
  if (!state) return;

  const refreshLoginButton = () => {
    DOM.loginBtn.textContent =
      state.token && state.username ? "Abmelden" : "Login / Registrieren";
  };

  refreshLoginButton();

  // --- Logout ---
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
    } else {
      DOM.modal.style.display = "block";
    }
  };

  DOM.closeModal.onclick = () => { DOM.modal.style.display = "none"; };
  window.onclick = (e) => { if (e.target === DOM.modal) DOM.modal.style.display = "none"; };

  // --- Login Schritt 1 ---
  DOM.loginSubmit.addEventListener("click", async () => {
    const username = DOM.username.value.trim();
    const password = DOM.password.value.trim();
    if (!username || !password) return UI.showError("Bitte Benutzername und Passwort eingeben.");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (res.status === 403 && data.error?.includes("nicht verifiziert")) {
        UI.showInfo("📧 Code wurde an deine E-Mail geschickt. Bitte eingeben.");
        state.pendingUsername = username;

        // Code-Modal sichtbar machen
        DOM.codeBlock.style.display = "block";
        DOM.codeInput.style.display = "inline-block";
        DOM.codeSubmit.style.display = "inline-block";
        return;
      }

      if (!res.ok) return UI.showError(data.error || "Login fehlgeschlagen");

      // Login ohne Code (bereits verifiziert)
      state.token = data.token;
      state.username = username;
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
    }
  });

  // --- Login Schritt 2: Code bestätigen ---
  DOM.codeSubmit.addEventListener("click", async () => {
    const code = DOM.codeInput.value.trim();
    if (!state.pendingUsername || !code) return UI.showError("Bitte Code eingeben.");

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: state.pendingUsername, code }),
      });
      const data = await res.json();
      if (!res.ok) return UI.showError(data.error || "Code ungültig");

      state.token = data.token;
      state.username = state.pendingUsername;
      state.myRole = data.role || "user";
      state.pendingUsername = null;

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
      UI.showError("Fehler bei der Code-Bestätigung");
    }
  });

  // --- Registrierung ---
  DOM.registerSubmit.addEventListener("click", async () => {
    const newU = DOM.newUser.value.trim();
    const newP = DOM.newPass.value.trim();
    const email = DOM.email.value.trim();
    if (!newU || !newP || !email) return UI.showError("Bitte alle Felder ausfüllen.");

    try {
      const body = { username: newU, password: newP, email };
      const adminPassField = DOM.adminPass?.value?.trim();
      if (adminPassField) body.adminPass = adminPassField;

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return UI.showError(data.error || "Registrierung fehlgeschlagen");

      UI.showInfo("Registrierung erfolgreich — bitte Code in E-Mail eingeben.");
      DOM.modal.style.display = "none";
    } catch {
      UI.showError("Registrieren-Fehler");
    }
  });
}
