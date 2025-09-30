import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";
import { initAuthHandlers } from "./authHandlers.js";
import { initChatHandlers, loadMessages } from "./chatHandlers.js";

// --- State ---
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

// --- Warten bis DOM geladen ist ---
document.addEventListener("DOMContentLoaded", () => {
  state.chatWindow = DOM.getChatWindow();
  state.sendBtn = DOM.getSendBtn();
  state.messageInput = DOM.getMessageInput();
  state.filterBtn = DOM.getFilterBtn();

  initSocket(state);
  initAuthHandlers(state);
  initChatHandlers(state);

  if (state.token) loadMessages(state);
});
