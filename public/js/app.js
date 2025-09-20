// public/js/app.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";
import { initAuthHandlers } from "./authHandlers.js";
import { initChatHandlers } from "./chatHandlers.js";

const state = {
  token: localStorage.getItem("token") || null,
  username: localStorage.getItem("username") || null,
  myRole: "user",
  filterActive: false,
  socket: null,
  socketConnected: false,
  sendBtn: DOM.sendBtn,
  messageInput: DOM.messageInput,
  filterBtn: DOM.filterBtn
};

// Initialisierung
initSocket(state);
initAuthHandlers(state);
initChatHandlers(state);
