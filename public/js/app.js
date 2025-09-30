// public/js/app.js
import * as DOM from "./domElements.js";
import * as UI from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";
import { initAuthHandlers } from "./authHandlers.js";
import { initChatHandlers, loadMessages } from "./chatHandlers.js";

// State
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

document.addEventListener("DOMContentLoaded", () => {
  // Init DOM bindings
  DOM.initDomElements();

  // Link DOM elements into state
  state.chatWindow = DOM.chatWindow;
  state.sendBtn = DOM.sendBtn;
  state.messageInput = DOM.messageInput;
  state.filterBtn = DOM.filterBtn;

  // Initialize features
  initSocket(state);
  initAuthHandlers(state);
  initChatHandlers(state);

  // Load previous messages if logged in
  if (state.token) loadMessages(state);
});
