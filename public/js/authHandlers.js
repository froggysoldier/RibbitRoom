// public/js/authHandlers.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { loadMessages } from "./chatHandlers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {
  if (!state) return;

  function refreshLoginButton() {
    if (!DOM.loginBtn) return;
    DOM.loginBtn.textContent = state.token && state.username ? "Abmelden" : "Login / Registrieren";
  }

  refreshLoginButton();

  // --- Login / Logout ---
  DOM.loginBtn?.addEventListener("click", () => {
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
      if (DOM.usersListEl) DOM.usersListEl.innerHTML = "";
      refreshLoginButton();
      UI.showInfo("Abgemeldet");
      window.location.reload();
      return;
    }
    // open modal
    if (DOM.modal) DOM.modal.style.display = "block";
  });

  // --- Close modal ---
  DOM.closeModal?.addEventListener("click", () => {
    if (DOM.modal) DOM.modal.style.display = "none";
  });
  window.addEventListener("click", (e) => {
    if (e.target === DOM.modal) DOM.modal.style.display = "none";
  });

  // --- Login ---
  DOM.loginSubmit?.addEventListener("click", async () => {
    const username = document.getElementById("username")?.value?.trim();
    const password = document.getElementById("password")?.value?.trim();
    if (!username || !password) return UI.showError("Bitte Benutzername und Passwort eingeben.");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      // ❗ Account nicht verifiziert
      if (res.status === 403 && data.error?.toLowerCase().includes("nicht verifiziert")) {
        UI.showInfo("📧 Code wurde an deine E-Mail geschickt. Bitte Code eingeben.");
        state.pendingUsername = username;

        // 1️⃣ Login-Modal sichtbar machen
        if (DOM.modal) DOM.modal.style.display = "block";

        // 2️⃣ Code-Feld sichtbar machen
        if (DOM.codeModal) DOM.codeModal.style.display = "block";
        return;
      }

      if (!res.ok) return UI.showError(data.error || "Login fehlgeschlagen");

      // logged in
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
    } catch (err) {
      console.error("Login error:", err);
      UI.showError("Login-Fehler");
    }
  });

  // --- Verify code ---
  DOM.codeSubmit?.addEventListener("click", async () => {
    const code = DOM.codeInput?.value?.trim();
    if (!state.pendingUsername || !code) return UI.showError("Bitte Code eingeben.");

    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: state.pendingUsername, code })
      });
      const data = await res.json();
      if (!res.ok) return UI.showError(data.error || "Code ungültig");

      state.token = data.token;
      state.username = state.pendingUsername;
      state.myRole = data.role || "user";
      state.pendingUsername = null;

      localStorage.setItem("token", state.token);
      localStorage.setItem("username", state.username);

      // ✅ Modal + Code-Feld schließen
      if (DOM.modal) DOM.modal.style.display = "none";
      if (DOM.codeModal) DOM.codeModal.style.display = "none";

      UI.showInfo(`Eingeloggt als ${state.username}`);
      refreshLoginButton();

      if (state.socket) {
        state.socket.auth = { token: state.token };
        state.socket.disconnect();
        setTimeout(() => initSocket(state), 50);
      } else initSocket(state);

      await loadMessages(state);
    } catch (err) {
      console.error("Verify error:", err);
      UI.showError("Fehler bei Code-Bestätigung");
    }
  });

  // --- Registration ---
  DOM.registerSubmit?.addEventListener("click", async () => {
    const newU = document.getElementById("newUser")?.value?.trim();
    const newP = document.getElementById("newPass")?.value?.trim();
    const email = document.getElementById("email")?.value?.trim();
    const adminPass = document.getElementById("adminPass")?.value?.trim();
    if (!newU || !newP || !email) return UI.showError("Bitte alle Felder ausfüllen.");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newU, password: newP, email, adminPass })
      });
      const data = await res.json();
      if (!res.ok) return UI.showError(data.error || "Registrierung fehlgeschlagen");

      // ✅ Login-Modal offen lassen, Code-Feld sichtbar machen
      if (DOM.modal) DOM.modal.style.display = "block";
      if (DOM.codeModal) DOM.codeModal.style.display = "block";

      UI.showInfo("Registrierung erfolgreich — bitte prüfe deine E-Mail für den Code.");
    } catch (err) {
      console.error("Register error:", err);
      UI.showError("Registrieren-Fehler");
    }
  });
}
