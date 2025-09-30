import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { loadMessages } from "./chatHandlers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {
  if (!state) return;

  function refreshLoginButton() {
    const btn = DOM.getLoginBtn();
    if (btn) {
      btn.textContent =
        state.token && state.username ? "Abmelden" : "Login / Registrieren";
    }
  }

  refreshLoginButton();

  // --- Logout / Login Modal ---
  if (DOM.loginBtn){
    DOM.getLoginBtn().onclick = () => {
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
        DOM.getUsersListEl().innerHTML = "";
        refreshLoginButton();
        UI.showInfo("Abgemeldet");
        window.location.reload();
      } else {
        const modal = DOM.getModal();
        if (modal) modal.style.display = "block";
      }
    };
  }
  DOM.getCloseModal().onclick = () => {
    const modal = DOM.getModal();
    if (modal) modal.style.display = "none";
  };

  window.onclick = (e) => {
    if (e.target === DOM.getModal()) DOM.getModal().style.display = "none";
  };

  // --- Login Schritt 1 ---
  if(Dom.loginSubmit){
    DOM.getLoginSubmit().addEventListener("click", async () => {
      const username = document.getElementById("username").value.trim();
      const password = document.getElementById("password").value.trim();
      if (!username || !password) return UI.showError("Bitte Benutzername und Passwort eingeben.");
    
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
    
        if (res.status === 403 && data.error.includes("nicht verifiziert")) {
          UI.showInfo("📧 Code wurde an deine E-Mail geschickt. Bitte eingeben.");
          state.pendingUsername = username;
    
          const codeModal = DOM.getCodeModal();
          const codeInput = DOM.getCodeInput();
          const codeSubmit = DOM.getCodeSubmit();
          if (codeModal && codeInput && codeSubmit) {
            codeModal.style.display = "block";
            codeInput.style.display = "inline-block";
            codeSubmit.style.display = "inline-block";
          }
          return;
        }
    
        if (!res.ok) return UI.showError(data.error || "Login fehlgeschlagen");
    
        state.token = data.token;
        state.username = username;
        state.myRole = data.role || "user";
        localStorage.setItem("token", state.token);
        localStorage.setItem("username", state.username);
    
        if (DOM.getModal()) DOM.getModal().style.display = "none";
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
  }else console.warn("loginSubmit not found");

  // --- Login Schritt 2: Code bestätigen ---
  if(DOM.codeSubmit){
    DOM.getCodeSubmit().addEventListener("click", async () => {
      const code = DOM.getCodeInput().value.trim();
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
  
        if (DOM.getModal()) DOM.getModal().style.display = "none";
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
  } else console.warn("codeSubmit not found");

  // --- Registrierung ---
  if(DOM.registerSubmit){
    DOM.getRegisterSubmit().addEventListener("click", async () => {
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
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return UI.showError(data.error || "Registrierung fehlgeschlagen");
  
        UI.showInfo("Registrierung erfolgreich — bitte Code in E-Mail eingeben.");
        if (DOM.getModal()) DOM.getModal().style.display = "none";
      } catch {
        UI.showError("Registrieren-Fehler");
      }
    });
  }else console.warn("registerSubmit not found");
}
