// public/js/authHandlers.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { loadMessages } from "./chatHandlers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {
  if (!state) {
    console.warn("[initAuthHandlers] state fehlt");
    return;
  }

  // Safety: ensure DOM was initialized
  if (!DOM.loginBtn || !DOM.modal) {
    console.warn("[initAuthHandlers] DOM noch nicht initialisiert oder Elemente fehlen.");
    return;
  }

  function refreshLoginButton() {
    if (!DOM.loginBtn) return;
    DOM.loginBtn.textContent = state.token && state.username ? "Abmelden" : "Login / Registrieren";
  }

  refreshLoginButton();

  // --- Login / Logout button handler ---
  DOM.loginBtn.addEventListener("click", () => {
    if (state.token) {
      // logout
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

  // --- Close modal (x) ---
  if (DOM.closeModal) {
    DOM.closeModal.addEventListener("click", () => {
      if (DOM.modal) DOM.modal.style.display = "none";
    });
  }

  // --- Clicking outside modal closes it ---
  window.addEventListener("click", (e) => {
    if (e.target === DOM.modal) {
      DOM.modal.style.display = "none";
    }
  });

  // --- Login step 1 (password check) ---
  if (DOM.loginSubmit) {
    DOM.loginSubmit.addEventListener("click", async () => {
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

        if (res.status === 403 && data.error && data.error.toLowerCase().includes("nicht verifiziert")) {
          UI.showInfo("📧 Code wurde an deine E-Mail geschickt. Bitte Code eingeben.");
          state.pendingUsername = username;
          if (DOM.codeModal) DOM.codeModal.style.display = "block";
          return;
        }

        if (!res.ok) return UI.showError(data.error || "Login fehlgeschlagen");

        // success login without code
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
        } else {
          initSocket(state);
        }

        await loadMessages(state);
      } catch (err) {
        console.error("Login error:", err);
        UI.showError("Login-Fehler");
      }
    });
  } else {
    console.warn("[initAuthHandlers] loginSubmit fehlt");
  }

  // --- Login step 2 (verify code) ---
  if (DOM.codeSubmit) {
    DOM.codeSubmit.addEventListener("click", async () => {
      const code = (DOM.codeInput && DOM.codeInput.value) ? DOM.codeInput.value.trim() : document.getElementById("code")?.value?.trim();
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
        UI.showError("Fehler bei der Code-Bestätigung");
      }
    });
  } else {
    console.warn("[initAuthHandlers] codeSubmit fehlt");
  }

  // --- Register ---
  if (DOM.registerSubmit) {
    DOM.registerSubmit.addEventListener("click", async () => {
      const newU = document.getElementById("newUser")?.value?.trim();
      const newP = document.getElementById("newPass")?.value?.trim();
      const email = document.getElementById("email")?.value?.trim();
      const adminPass = document.getElementById("adminPass")?.value?.trim();
      if (!newU || !newP || !email) return UI.showError("Bitte alle Felder ausfüllen.");

      try {
        const body = { username: newU, password: newP, email };
        if (adminPass) body.adminPass = adminPass;

        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) return UI.showError(data.error || "Registrierung fehlgeschlagen");

        UI.showInfo("Registrierung erfolgreich — bitte prüfe deine E-Mail für den Code.");
        if (DOM.modal) DOM.modal.style.display = "none";
      } catch (err) {
        console.error("Register error:", err);
        UI.showError("Registrieren-Fehler");
      }
    });
  } else {
    console.warn("[initAuthHandlers] registerSubmit fehlt");
  }
}
