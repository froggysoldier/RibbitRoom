import * as UI from "./uiHelpers.js";

export async function loadMessages(state) {
  if (!state.token || !state.chatWindow) return;

  const headers = { 
    "Content-Type": "application/json", 
    "Authorization": `Bearer ${state.token}` 
  };

  try {
    const res = await fetch("/api/messages", { headers });
    if (!res.ok) return;

    const messages = await res.json();
    state.chatWindow.innerHTML = "";

    messages
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .forEach((m) => {
        const isSelf = m.sender === state.username;
        UI.appendMessage(
          m.sender,
          m.content,
          m.createdAt,
          m._id,
          isSelf,
          m.type || "user",
          m.senderRole || "user"
        );
      });
  } catch (err) {
    console.error("[chatHandlers] loadMessages Fehler:", err);
  }
}

export function initChatHandlers(state) {
  if (!state || !state.sendBtn || !state.messageInput || !state.filterBtn) return;

  const sendMessage = () => {
    const content = state.messageInput.value.trim();
    if (!content) return;
    if (!state.socket || !state.socket.connected) return UI.showError("Nicht verbunden");

    state.socket.emit("chatMessage", content);
    state.messageInput.value = "";
    state.sendBtn.disabled = true;
    setTimeout(() => state.messageInput.focus(), 50);
  };

  state.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  state.messageInput.addEventListener("input", () => {
    state.sendBtn.disabled = !state.messageInput.value.trim();
  });

  state.sendBtn.addEventListener("click", (e) => { e.preventDefault(); sendMessage(); });

  state.filterBtn.addEventListener("change", () => {
    if (!state.socket || !state.socket.connected) return;
    state.filterActive = state.filterBtn.checked;
    state.socket.emit("toggleFilter", state.filterActive);
  });
}
