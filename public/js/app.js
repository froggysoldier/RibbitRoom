// public/js/app.js
import * as DOM from "./domElements.js";
import { initAuthHandlers } from "./authHandlers.js";
import { initSocket } from "./socketClient.js";
import { initChatHandlers, loadMessages } from "./chatHandlers.js";

document.addEventListener("DOMContentLoaded", () => {
  // DOM-Elemente setzen
  DOM.initDomElements();

  // State initialisieren
  const state = {
    token: localStorage.getItem("token") || null,
    username: localStorage.getItem("username") || null,
    myRole: "user",
    socket: null,
    socketConnected: false,
    filterActive: false
  };

  // Socket, Auth & Chat initialisieren
  initSocket(state);
  initAuthHandlers(state);
  initChatHandlers(state);

  // Alte Nachrichten laden, falls Token vorhanden
  if (state.token) loadMessages(state);
});
