// public/js/fishClicker.js
// ===============================================================
// FISH CLICKER – SERVER-PERSISTENT (per MongoDB, usergebunden via JWT)
// ===============================================================

// === DOM / UI Elemente wie in deinem Originalcode =================
const btn = document.getElementById('showBtn');
const box = document.getElementById('slideBox');
const clicker = document.getElementById("clicker");

// === Spiel-Variablen ==============================================
let fish = 0;
let fpc = 1;
let fps = 0;
let BoughtUpgrade0 = 0;
let BoughtUpgrade1 = 0;
let BoughtUpgrade2 = 0;
let BoughtUpgrade3 = 0;

let Upgrade0Preis = 15;
let Upgrade1Preis = 100;
let Upgrade2Preis = 1000;
let Upgrade3Preis = 5000;

// === DOM Elemente (Clicker UI) ===================================
const counter = document.getElementById("counter");
const fisher = document.getElementById("fisher");
const buyUpgrade0 = document.getElementById("buyUpgrade0");
const buyUpgrade1 = document.getElementById("buyUpgrade1");
const buyUpgrade2 = document.getElementById("buyUpgrade2");
const buyUpgrade3 = document.getElementById("buyUpgrade3");
const fpsCounter = document.getElementById("fpsCounter");
const DiscountCounter = document.getElementById("DiscountCounter");

// === Hilfs: Token / Username (aus localStorage wie in deinem Projekt) ==
const token = localStorage.getItem("token");
const username = localStorage.getItem("username");

// === Lokale Fallback-Funktionen (falls kein Token vorhanden) =======
function saveProgressLocal(data) {
  try {
    localStorage.setItem("fishGameSave", JSON.stringify(data));
  } catch (e) { console.warn("local save error", e); }
}
function loadProgressLocal() {
  try {
    const saved = localStorage.getItem("fishGameSave");
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (e) {
    console.warn("local load error", e);
    return null;
  }
}

// ===============================================================
// === Server-API: laden / speichern ==============================
// ===============================================================
async function loadProgressFromServerOrLocal() {
  if (!token) {
    // kein Token → lokale Daten laden
    const local = loadProgressLocal();
    if (local) applyLoadedData(local);
    return;
  }

  try {
    const res = await fetch("/api/fish", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      // Fallback auf lokal, wenn Server-Antwort nicht ok
      const local = loadProgressLocal();
      if (local) applyLoadedData(local);
      return;
    }

    const json = await res.json();
    const data = json.data || null;
    if (data) applyLoadedData(data);
  } catch (err) {
    console.warn("Laden vom Server fehlgeschlagen, fallback auf lokal:", err);
    const local = loadProgressLocal();
    if (local) applyLoadedData(local);
  }
}

async function saveProgressToServerOrLocal() {
  const payload = {
    fish, fpc, fps,
    BoughtUpgrade0, BoughtUpgrade1, BoughtUpgrade2, BoughtUpgrade3,
    Upgrade0Preis, Upgrade1Preis, Upgrade2Preis, Upgrade3Preis,
    // UI-Zustand
    clickerX: clicker?.style.left || null,
    clickerY: clicker?.style.top || null,
    slideBoxVisible: box?.classList?.contains("show") || false,
    slideBoxRight: box?.style?.right || null
  };

  if (!token) {
    // Gästermodus: lokal speichern
    saveProgressLocal(payload);
    return;
  }

  try {
    await fetch("/api/fish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ data: payload })
    });
  } catch (err) {
    console.warn("Speichern auf Server fehlgeschlagen, speichere lokal:", err);
    saveProgressLocal(payload);
  }
}

// ===============================================================
// === Hilfs: Daten in Spiel übernehmen ===========================
// ===============================================================
function applyLoadedData(data) {
  fish = data.fish ?? fish;
  fpc = data.fpc ?? fpc;
  fps = data.fps ?? fps;
  BoughtUpgrade0 = data.BoughtUpgrade0 ?? BoughtUpgrade0;
  BoughtUpgrade1 = data.BoughtUpgrade1 ?? BoughtUpgrade1;
  BoughtUpgrade2 = data.BoughtUpgrade2 ?? BoughtUpgrade2;
  BoughtUpgrade3 = data.BoughtUpgrade3 ?? BoughtUpgrade3;
  Upgrade0Preis = data.Upgrade0Preis ?? Upgrade0Preis;
  Upgrade1Preis = data.Upgrade1Preis ?? Upgrade1Preis;
  Upgrade2Preis = data.Upgrade2Preis ?? Upgrade2Preis;
  Upgrade3Preis = data.Upgrade3Preis ?? Upgrade3Preis;

  // Clicker-Position wiederherstellen
  if (clicker) {
    if (data.clickerX) clicker.style.left = data.clickerX;
    if (data.clickerY) clicker.style.top = data.clickerY;
  }

  // SlideBox-Zustand wiederherstellen (wie in deinem ursprünglichen Verhalten)
  if (box) {
    if (data.slideBoxVisible === true) box.classList.add("show");
    else box.classList.remove("show");
    if (data.slideBoxRight) box.style.right = data.slideBoxRight;
  }

  UpdateDisplay(false); // UpdateDisplay ohne direktes erneutes Speichern
}

// ===============================================================
// === Anzeige aktualisieren (UpdateDisplay) =====================
// === parameter saveDefault true -> speichert am Ende ===========
function UpdateDisplay(saveDefault = true) {
  if (!counter) return;

  counter.textContent = fish.toFixed(1);
  fpsCounter.textContent = fps;
  DiscountCounter.textContent = (1 - (BoughtUpgrade3 * 0.05)).toFixed(2);

  if (buyUpgrade0) buyUpgrade0.textContent = `Bessere Angel kaufen (kostet ${Upgrade0Preis}) - Aktuell: ${BoughtUpgrade0}`;
  if (buyUpgrade1) buyUpgrade1.textContent = `Fischer anstellen (kostet ${Upgrade1Preis}) - Aktuell: ${BoughtUpgrade1}`;
  if (buyUpgrade2) buyUpgrade2.textContent = `Boot kaufen (kostet ${Upgrade2Preis}) - Aktuell: ${BoughtUpgrade2}`;
  if (buyUpgrade3) buyUpgrade3.textContent = BoughtUpgrade3 >= 10
    ? "Maximaler Kundenrabatt erreicht."
    : `Kundenrabatt hochstufen (kostet ${Upgrade3Preis}) - Aktuell: ${BoughtUpgrade3}`;

  if (saveDefault) saveProgressToServerOrLocal();
}

// ===============================================================
// === Preisberechnung ===========================================
function UpdateDiscount() {
  Upgrade0Preis = PriceIncrease(Upgrade0Preis, BoughtUpgrade3, 1);
  Upgrade1Preis = PriceIncrease(Upgrade1Preis, BoughtUpgrade3, 1);
  Upgrade2Preis = PriceIncrease(Upgrade2Preis, BoughtUpgrade3, 1);
}

function PriceIncrease(Preis, RabattUpgrade, PreisAenderung) {
  if (PreisAenderung === 0) Preis *= 1.2;
  const rabatt = 1 - (RabattUpgrade * 0.05);
  Preis *= rabatt;
  return Math.round(Preis);
}

// ===============================================================
// === Events (Clicker + Upgrades) ===============================
if (btn && box) {
  // Button / Modal Verhalten genau wie dein Original (ein/aus)
  btn.addEventListener('click', async () => {
    box.classList.toggle('show');
    // Speichere den Zustand (Server oder lokal)
    await saveProgressToServerOrLocal();
  });

  document.addEventListener('click', async (e) => {
    if (!box.contains(e.target) && e.target !== btn) {
      box.classList.remove('show');
      await saveProgressToServerOrLocal();
    }
  });
}

// Clicker Klick
if (fisher) {
  fisher.addEventListener("click", () => {
    fish += fpc;
    fish = Number(fish.toFixed(1));
    UpdateDisplay();
  });
}

// Upgrades
if (buyUpgrade0) {
  buyUpgrade0.addEventListener("click", () => {
    if (fish >= Upgrade0Preis) {
      fish -= Upgrade0Preis;
      fpc += 0.2;
      Upgrade0Preis = PriceIncrease(Upgrade0Preis, BoughtUpgrade3, 0);
      BoughtUpgrade0++;
      UpdateDisplay();
    }
  });
}

if (buyUpgrade1) {
  buyUpgrade1.addEventListener("click", () => {
    if (fish >= Upgrade1Preis) {
      fish -= Upgrade1Preis;
      fps++;
      Upgrade1Preis = PriceIncrease(Upgrade1Preis, BoughtUpgrade3, 0);
      BoughtUpgrade1++;
      UpdateDisplay();
    }
  });
}

if (buyUpgrade2) {
  buyUpgrade2.addEventListener("click", () => {
    if (fish >= Upgrade2Preis) {
      fish -= Upgrade2Preis;
      fps += 5;
      Upgrade2Preis = PriceIncrease(Upgrade2Preis, BoughtUpgrade3, 0);
      BoughtUpgrade2++;
      UpdateDisplay();
    }
  });
}

if (buyUpgrade3) {
  buyUpgrade3.addEventListener("click", () => {
    if (fish >= Upgrade3Preis && BoughtUpgrade3 < 10) {
      fish -= Upgrade3Preis;
      BoughtUpgrade3++;
      Upgrade3Preis = PriceIncrease(Upgrade3Preis, BoughtUpgrade3, 0);
      UpdateDiscount();
      UpdateDisplay();
    }
  });
}

// Clicker Drag/Position (optional): speichere clicker pos on mouseup
if (clicker) {
  let dragging = false, offsetX=0, offsetY=0;
  clicker.addEventListener("mousedown", (e) => {
    dragging = true;
    offsetX = e.clientX - (clicker.getBoundingClientRect().left || 0);
    offsetY = e.clientY - (clicker.getBoundingClientRect().top || 0);
    clicker.style.position = "absolute";
  });
  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    clicker.style.left = `${e.clientX - offsetX}px`;
    clicker.style.top = `${e.clientY - offsetY}px`;
  });
  document.addEventListener("mouseup", async () => {
    if (dragging) {
      dragging = false;
      await saveProgressToServerOrLocal();
    }
  });
}

// ===============================================================
// === Automatische Fische pro Sekunde ===========================
setInterval(() => {
  fish += fps;
  UpdateDisplay();
}, 1000);

// ===============================================================
// === Start: lade Spielstand (Server oder lokal) ================
loadProgressFromServerOrLocal().then(() => {
  UpdateDisplay(false); // initiales Update ohne sofort speichern (wurde geladen)
});
