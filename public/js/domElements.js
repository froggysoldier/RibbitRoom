// Funktionen statt direkten DOM-Abfragen, damit die Elemente sicher existieren
export const getLoginBtn = () => document.getElementById("loginBtn");
export const getModal = () => document.getElementById("loginModal");
export const getCloseModal = () => document.querySelector(".close");
export const getLoginSubmit = () => document.getElementById("loginSubmit");
export const getRegisterSubmit = () => document.getElementById("registerSubmit");
export const getUsersListEl = () => document.getElementById("users");
export const getChatWindow = () => document.getElementById("chatWindow");
export const getSendBtn = () => document.getElementById("sendBtn");
export const getMessageInput = () => document.getElementById("messageInput");
export const getFilterBtn = () => document.getElementById("filterBtn");

export const getCodeModal = () => document.getElementById("codeModal");
export const getCodeInput = () => document.getElementById("code");
export const getCodeSubmit = () => document.getElementById("codeSubmit");
