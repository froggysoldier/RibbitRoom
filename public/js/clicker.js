// ===============================================================
// 🐟 FISH CLICKER – GLOBAL VERSION mit persistentem Fortschritt
// ===============================================================

// === UI ELEMENTE (Slide-Box + Button) ==========================
const btn = document.getElementById('showBtn');
const box = document.getElementById('slideBox');

if (btn && box) {
  btn.addEventListener('click', () => {
    box.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!box.contains(e.target) && e.target !== btn) {
      box.classList.remove('show');
    }
  });
}

// === VARIABLEN =================================================
let fish = 0;
let fpc = 1;  // Fisch pro Klick
let fps = 0;  // Fische pro Sekunde
let BoughtUpgrade0 = 0;
let BoughtUpgrade1 = 0;
let BoughtUpgrade2 = 0;
let BoughtUpgrade3 = 0;

let Upgrade0Preis = 15;
let Upgrade1Preis = 100;
let Upgrade2Preis = 1000;
let Upgrade3Preis = 5000;

// === DOM ELEMENTE ==============================================
const counter = document.getElementById("counter");
const fisher = document.getElementById("fisher");
const buyUpgrade0 = document.getElementById("buyUpgrade0");
const buyUpgrade1 = document.getElementById("buyUpgrade1");
const buyUpgrade2 = document.getElementById("buyUpgrade2");
const buyUpgrade3 = document.getElementById("buyUpgrade3");
const fpsCounter = document.getElementById("fpsCounter");
const DiscountCounter = document.getElementById("DiscountCounter");

// === DATEN SPEICHERN ==========================================
function saveProgress() {
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
  localStorage.setItem("fishGameSave", JSON.stringify(data));
}

// === DATEN LADEN ==============================================
function loadProgress() {
  const saved = localStorage.getItem("fishGameSave");
  if (saved) {
    try {
      const data = JSON.parse(saved);
      fish = data.fish ?? 0;
      fpc = data.fpc ?? 1;
      fps = data.fps ?? 0;
      BoughtUpgrade0 = data.BoughtUpgrade0 ?? 0;
      BoughtUpgrade1 = data.BoughtUpgrade1 ?? 0;
      BoughtUpgrade2 = data.BoughtUpgrade2 ?? 0;
      BoughtUpgrade3 = data.BoughtUpgrade3 ?? 0;
      Upgrade0Preis = data.Upgrade0Preis ?? 15;
      Upgrade1Preis = data.Upgrade1Preis ?? 100;
      Upgrade2Preis = data.Upgrade2Preis ?? 1000;
      Upgrade3Preis = data.Upgrade3Preis ?? 5000;
    } catch (err) {
      console.error("Fehler beim Laden des Spielstands:", err);
    }
  }
}

// === ANZEIGE AKTUALISIEREN ===================================
function UpdateDisplay() {
  if (!counter) return;

  counter.textContent = fish.toFixed(1);
  fpsCounter.textContent = fps;
  DiscountCounter.textContent = (1 - (BoughtUpgrade3 * 0.05)).toFixed(2);

  buyUpgrade0.textContent = `Bessere Angel kaufen (kostet ${Upgrade0Preis}) - Aktuell: ${BoughtUpgrade0}`;
  buyUpgrade1.textContent = `Fischer anstellen (kostet ${Upgrade1Preis}) - Aktuell: ${BoughtUpgrade1}`;
  buyUpgrade2.textContent = `Boot kaufen (kostet ${Upgrade2Preis}) - Aktuell: ${BoughtUpgrade2}`;

  if (BoughtUpgrade3 >= 10) {
    buyUpgrade3.textContent = "Maximaler Kundenrabatt erreicht.";
  } else {
    buyUpgrade3.textContent = `Kundenrabatt hochstufen (kostet ${Upgrade3Preis}) - Aktuell: ${BoughtUpgrade3}`;
  }

  saveProgress(); // nach jeder Änderung speichern
}

// === PREISBERECHNUNG ==========================================
function UpdateDiscount() {
  Upgrade0Preis = PriceIncrease(Upgrade0Preis, BoughtUpgrade3, 1);
  Upgrade1Preis = PriceIncrease(Upgrade1Preis, BoughtUpgrade3, 1);
  Upgrade2Preis = PriceIncrease(Upgrade2Preis, BoughtUpgrade3, 1);
}

function PriceIncrease(Preis, RabattUpgrade, PreisAenderung) {
  if (PreisAenderung === 0) Preis *= 1.2;
  RabattUpgrade = 1 - (RabattUpgrade * 0.05);
  Preis *= RabattUpgrade;
  return Math.round(Preis);
}

// === EVENTS ===================================================
if (fisher) {
  fisher.addEventListener("click", () => {
    fish += fpc;
    fish = Number(fish.toFixed(1));
    UpdateDisplay();
  });
}

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

// === AUTOMATISCHE FISCHE PRO SEKUNDE ==========================
setInterval(() => {
  fish += fps;
  UpdateDisplay();
}, 1000);

// === SPIELSTAND LADEN ========================================
loadProgress();
UpdateDisplay();

// === OPTIONAL: SPIEL RESET ===================================
window.resetGame = function() {
  if (confirm("Willst du deinen Fortschritt wirklich löschen?")) {
    localStorage.removeItem("fishGameSave");
    location.reload();
  }
};
