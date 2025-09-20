// public/js/authHandlers.js
import { showError, showInfo, setSendEnabled } from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {
  const DOM = {
    loginBtnHeader: document.getElementById("loginBtn"),
    modal: document.getElementById("loginModal"),
    closeModal: document.querySelector(".close"),
    loginSubmit: document.getElementById("loginSubmit"),
    registerSubmit: document.getElementById("registerSubmit")
  };

  function refreshLoginButton() {
    if (state.token && state.username) DOM.loginBtnHeader.textContent = "Abmelden";
    else DOM.loginBtnHeader.textContent = "Login / Registrieren";
  }
  refreshLoginButton();

  // --- Login / Logout ---
  DOM.loginBtnHeader.onclick = () => {
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

      document.getElementById("users").innerHTML = "";
      document.getElementById("chatWindow").innerHTML = "";
      refreshLoginButton();
      showInfo("Abgemeldet", document.getElementById("chatWindow"));
      window.location.reload();
    } else {
      DOM.modal.style.display = "block";
    }
  };

  DOM.closeModal.onclick = () => DOM.modal.style.display = "none";
  window.onclick = (e) => { if (e.target === DOM.modal) DOM.modal.style.display = "none"; };

  // --- Login ---
  DOM.loginSubmit.addEventListener("click", async () => {
    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value.trim();
    if (!u || !p) return showError("Bitte Benutzername und Passwort eingeben.", document.getElementById("chatWindow"));

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if (!res.ok) return showError(data.error || "Login fehlgeschlagen", document.getElementById("chatWindow"));

      state.token = data.token;
      state.username = u;
      state.myRole = data.role || "user";
      localStorage.setItem("token", state.token);
      localStorage.setItem("username", state.username);
      DOM.modal.style.display = "none";
      showInfo(`Eingeloggt als ${state.username}`, document.getElementById("chatWindow"));
      refreshLoginButton();

      if (state.socket) { state.socket.auth = { token: state.token }; state.socket.disconnect(); setTimeout(() => initSocket(state), 50); }
      else initSocket(state);

    } catch {
      showError("Login-Fehler", document.getElementById("chatWindow"));
    }
  });

  // --- Registrierung ---
  DOM.registerSubmit.addEventListener("click", async () => {
    const newU = document.getElementById("newUser").value.trim();
    const newP = document.getElementById("newPass").value.trim();
    const email = document.getElementById("email").value.trim();
    const adminPassField = document.getElementById("adminPass") ? document.getElementById("adminPass").value.trim() : null;

    if (!newU || !newP || !email) return showError("Bitte alle Felder ausfüllen.", document.getElementById("chatWindow"));

    try {
      const body = { username: newU, password: newP, email };
      if (adminPassField) body.adminPass = adminPassField;
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) return showError(data.error || "Registrierung fehlgeschlagen", document.getElementById("chatWindow"));

      if (data.token) {
        state.token = data.token;
        state.username = newU;
        state.myRole = data.role || "user";
        localStorage.setItem("token", state.token);
        localStorage.setItem("username", state.username);
        showInfo("Registrierung erfolgreich — eingeloggt.", document.getElementById("chatWindow"));

        if (state.socket) { state.socket.auth = { token: state.token }; state.socket.disconnect(); setTimeout(() => initSocket(state), 50); }
        else initSocket(state);
      } else showInfo("Registrierung erfolgreich — bitte einloggen.", document.getElementById("chatWindow"));

      DOM.modal.style.display = "none";
      refreshLoginButton();

    } catch {
      showError("Registrieren-Fehler", document.getElementById("chatWindow"));
    }
  });
}
