// public/js/app.js
import * as DOM from "./domElements.js";
import { initAuthHandlers } from "./authHandlers.js";
import { initChatHandlers, loadMessages } from "./chatHandlers.js";
import { initSocket } from "./socketClient.js";

// State initialisieren
const state = {
  token: localStorage.getItem("token") || null,
  username: localStorage.getItem("username") || null,
  myRole: "user",
  filterActive: false,
  socket: null,
  socketConnected: false,
  chatWindow: null,
  sendBtn: null,
  messageInput: null,
  filterBtn: null
};

// --- Alles erst nach DOMContentLoaded ---
document.addEventListener("DOMContentLoaded", () => {
  // DOM-Elemente initialisieren
  DOM.initDomElements();

  // State mit DOM-Elementen verbinden
  state.chatWindow = DOM.chatWindow;
  state.sendBtn = DOM.sendBtn;
  state.messageInput = DOM.messageInput;
  state.filterBtn = DOM.filterBtn;

  // Socket, Auth & Chat initialisieren
  initSocket(state);
  initAuthHandlers(state);
  initChatHandlers(state);

  // Alte Nachrichten laden
  if (state.token) loadMessages(state);
});
