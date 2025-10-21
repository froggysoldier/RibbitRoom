// ===============================================================
// FISH CLICKER – USER VERSION mit MongoDB-Speicherung
// ===============================================================

// === VARIABLEN ================================================
let token = localStorage.getItem("token"); // JWT vom Login
let fish = 0, fpc = 1, fps = 0;
let BoughtUpgrade0 = 0, BoughtUpgrade1 = 0, BoughtUpgrade2 = 0, BoughtUpgrade3 = 0;
let Upgrade0Preis = 15, Upgrade1Preis = 100, Upgrade2Preis = 1000, Upgrade3Preis = 5000;

// === DOM ELEMENTE =============================================
const counter = document.getElementById("counter");
const fisher = document.getElementById("fisher");
const buyUpgrade0 = document.getElementById("buyUpgrade0");
const buyUpgrade1 = document.getElementById("buyUpgrade1");
const buyUpgrade2 = document.getElementById("buyUpgrade2");
const buyUpgrade3 = document.getElementById("buyUpgrade3");
const fpsCounter = document.getElementById("fpsCounter");
const DiscountCounter = document.getElementById("DiscountCounter");

// === SPIELSTAND LADEN =========================================
async function loadProgress() {
  if (!token) return console.warn("Kein Token – Gastmodus aktiv");
  try {
    const res = await fetch("/api/fish", {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    const data = json.data;
    if (!data) return;

    fish = data.fish ?? fish;
    fpc = data.fpc ?? fpc;
    fps = data.fps ?? fps;
    BoughtUpgrade0 = data.BoughtUpgrade0 ?? 0;
    BoughtUpgrade1 = data.BoughtUpgrade1 ?? 0;
    BoughtUpgrade2 = data.BoughtUpgrade2 ?? 0;
    BoughtUpgrade3 = data.BoughtUpgrade3 ?? 0;
    Upgrade0Preis = data.Upgrade0Preis ?? Upgrade0Preis;
    Upgrade1Preis = data.Upgrade1Preis ?? Upgrade1Preis;
    Upgrade2Preis = data.Upgrade2Preis ?? Upgrade2Preis;
    Upgrade3Preis = data.Upgrade3Preis ?? Upgrade3Preis;

    UpdateDisplay();
  } catch (err) {
    console.error("Fehler beim Laden des Spielstands:", err);
  }
}

// === SPIELSTAND SPEICHERN =====================================
async function saveProgress() {
  if (!token) return; // Nur speichern, wenn eingeloggt
  try {
    const data = {
      fish,
      fpc,
      fps,
      BoughtUpgrade0,
      BoughtUpgrade1,
      BoughtUpgrade2,
      BoughtUpgrade3,
      Upgrade0Preis,
      Upgrade1Preis,
      Upgrade2Preis,
      Upgrade3Preis
    };
    await fetch("/api/fish", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ data })
    });
  } catch (err) {
    console.error("Fehler beim Speichern:", err);
  }
}

// === ANZEIGE AKTUALISIEREN ====================================
function UpdateDisplay() {
  counter.textContent = fish.toFixed(1);
  fpsCounter.textContent = fps;
  DiscountCounter.textContent = (1 - (BoughtUpgrade3 * 0.05)).toFixed(2);

  buyUpgrade0.textContent = `Bessere Angel (${Upgrade0Preis}) – ${BoughtUpgrade0}`;
  buyUpgrade1.textContent = `Fischer (${Upgrade1Preis}) – ${BoughtUpgrade1}`;
  buyUpgrade2.textContent = `Boot (${Upgrade2Preis}) – ${BoughtUpgrade2}`;
  buyUpgrade3.textContent =
    BoughtUpgrade3 >= 10
      ? "Maximaler Kundenrabatt erreicht."
      : `Kundenrabatt (${Upgrade3Preis}) – ${BoughtUpgrade3}`;

  saveProgress();
}

// === PREISBERECHNUNG ==========================================
function PriceIncrease(Preis, RabattUpgrade, PreisAenderung) {
  if (PreisAenderung === 0) Preis *= 1.2;
  const rabatt = 1 - (RabattUpgrade * 0.05);
  return Math.round(Preis * rabatt);
}

function UpdateDiscount() {
  Upgrade0Preis = PriceIncrease(Upgrade0Preis, BoughtUpgrade3, 1);
  Upgrade1Preis = PriceIncrease(Upgrade1Preis, BoughtUpgrade3, 1);
  Upgrade2Preis = PriceIncrease(Upgrade2Preis, BoughtUpgrade3, 1);
}

// === EVENTS ===================================================
fisher?.addEventListener("click", () => {
  fish += fpc;
  UpdateDisplay();
});

buyUpgrade0?.addEventListener("click", () => {
  if (fish >= Upgrade0Preis) {
    fish -= Upgrade0Preis;
    fpc += 0.2;
    Upgrade0Preis = PriceIncrease(Upgrade0Preis, BoughtUpgrade3, 0);
    BoughtUpgrade0++;
    UpdateDisplay();
  }
});

buyUpgrade1?.addEventListener("click", () => {
  if (fish >= Upgrade1Preis) {
    fish -= Upgrade1Preis;
    fps++;
    Upgrade1Preis = PriceIncrease(Upgrade1Preis, BoughtUpgrade3, 0);
    BoughtUpgrade1++;
    UpdateDisplay();
  }
});

buyUpgrade2?.addEventListener("click", () => {
  if (fish >= Upgrade2Preis) {
    fish -= Upgrade2Preis;
    fps += 5;
    Upgrade2Preis = PriceIncrease(Upgrade2Preis, BoughtUpgrade3, 0);
    BoughtUpgrade2++;
    UpdateDisplay();
  }
});

buyUpgrade3?.addEventListener("click", () => {
  if (fish >= Upgrade3Preis && BoughtUpgrade3 < 10) {
    fish -= Upgrade3Preis;
    BoughtUpgrade3++;
    Upgrade3Preis = PriceIncrease(Upgrade3Preis, BoughtUpgrade3, 0);
    UpdateDiscount();
    UpdateDisplay();
  }
});

// === AUTOMATISCHE FISCHE PRO SEKUNDE ==========================
setInterval(() => {
  fish += fps;
  UpdateDisplay();
}, 1000);

// === START ====================================================
loadProgress();
