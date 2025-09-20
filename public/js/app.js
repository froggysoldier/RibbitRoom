// public/js/app.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";
import { initAuthHandlers } from "./authHandlers.js";
import { initChatHandlers, loadMessages } from "./chatHandlers.js";

// --- State initialisieren ---
const state = {
  token: localStorage.getItem("token") || null,
  username: localStorage.getItem("username") || null,
  myRole: "user",
  filterActive: false,
  socket: null,
  socketConnected: false,
  chatWindow: DOM.chatWindow,
  sendBtn: DOM.sendBtn,
  messageInput: DOM.messageInput,
  filterBtn: DOM.filterBtn
};

// --- Socket initialisieren ---
initSocket(state);
initAuthHandlers(state);
initChatHandlers(state);

// --- Alte Nachrichten direkt laden, falls Token vorhanden ---
if (state.token) {
  loadMessages(state);
}
