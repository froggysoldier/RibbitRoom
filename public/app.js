const loginBtnHeader = document.getElementById("loginBtn");
const modal = document.getElementById("loginModal");
const closeModal = document.querySelector(".close");
const loginSubmit = document.getElementById("loginSubmit");
const registerSubmit = document.getElementById("registerSubmit");
const usersListEl = document.getElementById("users");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const filterBtn = document.getElementById("filterBtn");

function escapeHtml(str="") {
  return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function appendMessage(sender, content, createdAt, id, self=false) {
  const p = document.createElement("p");
  p.classList.add("message");
  if (self) p.classList.add("self");
  if (id) p.dataset.id = id.toString();

  const date = createdAt ? new Date(createdAt) : new Date();
  const hours = date.getHours().toString().padStart(2,"0");
  const minutes = date.getMinutes().toString().padStart(2,"0");

  p.innerHTML = `
  <div class="msg-header">
    <strong>${escapeHtml(sender)}</strong>
    <span class="time">[${hours}:${minutes}]</span>
  </div>
  <div class="msg-content">${escapeHtml(content)}</div>
  `;

  chatWindow.appendChild(p);
  setTimeout(()=>p.classList.add("show"),50);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function renderActiveUsers(users){
  usersListEl.innerHTML = "";
  users.forEach(u=>{
    const li = document.createElement("li");
    li.textContent = u.username;
    usersListEl.appendChild(li);
  });
}

let token = localStorage.getItem("token") || null;
let socket = null;
let username = localStorage.getItem("username") || null;
let filterActive = false;

function initSocket() {
  if(socket && socket.connected) return;
  socket = io({ auth: { token } });

  socket.on("connect",()=>{ 
    if(token) socket.emit("identify",{token});
  });

  socket.on("newMessage", msg => {
    const isSelf = msg.sender === username;
    appendMessage(msg.sender,msg.content,msg.createdAt,msg._id,isSelf);
  });

  socket.on("activeUsers", users => renderActiveUsers(Array.isArray(users)?users:[]));

  socket.on("identified", data => {
    filterActive = data.filterActive || false;
    filterBtn.checked = filterActive;
  });
}

initSocket();

async function loadMessages(){
  const headers = {"Content-Type":"application/json"};
  if(token) headers["Authorization"]=`Bearer ${token}`;
  const res = await fetch("/api/messages",{headers});
  if(!res.ok) return;
  const messages = await res.json();
  chatWindow.innerHTML="";
  messages.reverse().forEach(m=>{
    const isSelf = m.sender===username;
    appendMessage(m.sender,m.content,m.createdAt,m._id,isSelf);
  });
}

loadMessages();

loginBtnHeader.onclick=()=>modal.style.display="block";
closeModal.onclick=()=>modal.style.display="none";
window.onclick=e=>{if(e.target===modal) modal.style.display="none";};

loginSubmit.addEventListener("click",async ()=>{
  const u=document.getElementById("username").value.trim();
  const p=document.getElementById("password").value.trim();
  if(!u||!p)return;
  const res=await fetch("/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
  const data=await res.json();
  if(!res.ok)return;
  token=data.token;
  username=u;
  localStorage.setItem("token",token);
  localStorage.setItem("username",username);
  modal.style.display="none";
  await loadMessages();
  if(socket){socket.auth={token};socket.disconnect();socket.connect();} else initSocket();
});

registerSubmit.addEventListener("click",async ()=>{
  const newU=document.getElementById("newUser").value.trim();
  const newP=document.getElementById("newPass").value.trim();
  const email=document.getElementById("email").value.trim();
  if(!newU||!newP||!email)return;
  await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:newU,password:newP,email})});
});

function sendMessage(){
  const content=messageInput.value.trim();
  if(!content) return;
  if(!socket.connected) return;
  socket.emit("chatMessage",content);
  messageInput.value="";
  sendBtn.disabled=true;
}

messageInput.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}
});
messageInput.addEventListener("input",()=>sendBtn.disabled=!messageInput.value.trim());
sendBtn.addEventListener("click",e=>{e.preventDefault();sendMessage();});

filterBtn.addEventListener("change",()=>{filterActive=filterBtn.checked; socket.emit("toggleFilter",filterActive);});
