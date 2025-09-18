// LOGIN
const loginBtn = document.getElementById("loginSubmit");
loginBtn.addEventListener("click", async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (res.ok) {
    // Token speichern (z.B. localStorage)
    localStorage.setItem("token", data.token);
    alert("Login erfolgreich!");
    // Modal schließen
    document.getElementById("loginModal").style.display = "none";
  } else {
    alert(data.error);
  }
});

// LOGIN
const loginBtn = document.getElementById("loginSubmit");
loginBtn.addEventListener("click", async () => {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (res.ok) {
    // Token speichern (z.B. localStorage)
    localStorage.setItem("token", data.token);
    alert("Login erfolgreich!");
    // Modal schließen
    document.getElementById("loginModal").style.display = "none";
  } else {
    alert(data.error);
  }
});
