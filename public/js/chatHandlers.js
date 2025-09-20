// public/js/chatHandlers.js
import { appendMessage, setSendEnabled } from "./uiHelpers.js";
import { initSocket } from "./socketClient.js";

export function initChatHandlers(state) {
  const messageInput = state.messageInput;
  const sendBtn = state.sendBtn;
  const filterBtn = state.filterBtn;

  function sendMessage() {
    const content = messageInput.value.trim();
    if (!content) return;
    if (!state.socket || !state.socket.connected) return appendMessage("SYSTEM", "Nicht verbunden", new Date(), null, false, "system", "user", document.getElementById("chatWindow"));

    state.socket.emit("chatMessage", content);
    messageInput.value = "";
    sendBtn.disabled = true;
    setTimeout(() => messageInput.focus(), 50);
  }

  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  messageInput.addEventListener("input", () => { sendBtn.disabled = !messageInput.value.trim(); });
  sendBtn.addEventListener("click", (e) => { e.preventDefault(); sendMessage(); });

  filterBtn.addEventListener("change", () => {
    if (!state.socket || !state.socket.connected) return;
    state.filterActive = filterBtn.checked;
    state.socket.emit("toggleFilter", state.filterActive);
  });
}
