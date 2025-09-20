// public/js/authHandlers.js
import { modal, loginBtnHeader, loginSubmit, registerSubmit } from "./domElements.js";
import { showError, showInfo, setSendEnabled } from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";

export function initAuthHandlers(state) {

  function refreshLoginButton() {
    if (state.token && state.username) loginBtnHeader.textContent = "Abmelden";
    else loginBtnHeader.textContent = "Login / Registrieren";
  }
  refreshLoginButton();

  loginBtnHeader.onclick = () => {
    if (state.token) {
      state.token = null;
      state.username = null;
      state.myRole = "user";
      localStorage.removeItem("token");
      localStorage.removeItem("username");

      if (state.socket) { try { state.socket.auth = {}; state.socket.disconnect(); } catch {} state.socket = null; }

      setSendEnabled(false, state.sendBtn, state.messageInput);
      refreshLoginButton();
      showInfo("Abgemeldet");
      window.location.reload();
    } else modal.style.display = "block";
  };

  modal.querySelector(".close").onclick = () => modal.style.display = "none";
  window.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

  loginSubmit.addEventListener("click", async () => {
    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value.trim();
    if (!u || !p) return showError("Bitte Benutzername und Passwort eingeben.");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await res.json();
      if (!res.ok) return showError(data.error || "Login fehlgeschlagen");
      state.token = data.token;
      state.username = u;
      state.myRole = data.role || "user";
      localStorage.setItem("token", state.token);
      localStorage.setItem("username", state.username);
      modal.style.display = "none";
      showInfo(`Eingeloggt als ${state.username}`);
      refreshLoginButton();
      if (state.socket) { state.socket.auth = { token: state.token }; state.socket.disconnect(); setTimeout(() => initSocket(state), 50); }
      else initSocket(state);
    } catch { showError("Login-Fehler"); }
  });

  registerSubmit.addEventListener("click", async () => {
    const newU = document.getElementById("newUser").value.trim();
    const newP = document.getElementById("newPass").value.trim();
    const email = document.getElementById("email").value.trim();
    const adminPassField = document.getElementById("adminPass") ? document.getElementById("adminPass").value.trim() : null;

    if (!newU || !newP || !email) return showError("Bitte alle Felder ausfüllen.");
    try {
      const body = { username: newU, password: newP, email };
      if (adminPassField) body.adminPass = adminPassField;
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) return showError(data.error || "Registrierung fehlgeschlagen");
      if (data.token) {
        state.token = data.token;
        state.username = newU;
        state.myRole = data.role || "user";
        localStorage.setItem("token", state.token);
        localStorage.setItem("username", state.username);
        showInfo("Registrierung erfolgreich — eingeloggt.");
        if (state.socket) { state.socket.auth = { token: state.token }; state.socket.disconnect(); setTimeout(() => initSocket(state), 50); }
        else initSocket(state);
      } else showInfo("Registrierung erfolgreich — bitte einloggen.");
      modal.style.display = "none";
      refreshLoginButton();
    } catch { showError("Registrieren-Fehler"); }
  });
}
