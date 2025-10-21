import axios from "./axiosHelper.js"; // Optional: Wrapper für API-Requests
import * as DOM from "./domElements.js"; // falls du DOM-Elemente zentral hast

// === UI ELEMENTE ===============================================
const btn = document.getElementById('showBtn');
const box = document.getElementById('slideBox');
const clicker = document.getElementById("clicker");
const counter = document.getElementById("counter");
const fisher = document.getElementById("fisher");
const buyUpgrade0 = document.getElementById("buyUpgrade0");
const buyUpgrade1 = document.getElementById("buyUpgrade1");
const buyUpgrade2 = document.getElementById("buyUpgrade2");
const buyUpgrade3 = document.getElementById("buyUpgrade3");
const fpsCounter = document.getElementById("fpsCounter");
const DiscountCounter = document.getElementById("DiscountCounter");

// === STATE =====================================================
let state = {
  fish: 0,
  fpc: 1,
  fps: 0,
  BoughtUpgrade0: 0,
  BoughtUpgrade1: 0,
  BoughtUpgrade2: 0,
  BoughtUpgrade3: 0,
  Upgrade0Preis: 15,
  Upgrade1Preis: 100,
  Upgrade2Preis: 1000,
  Upgrade3Preis: 5000,
  clickerX: null,
  clickerY: null,
  slideBoxVisible: false,
  slideBoxRight: null
};

let username = localStorage.getItem("username") || null;
let token = localStorage.getItem("token") || null;

// === Helfer: State vom Server laden ===========================
async function loadProgress() {
  if (!username || !token) return;

  try {
    const res = await fetch(`/api/fish/${username}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.fishProgress) return;

    state = { ...state, ...data.fishProgress };

    // UI wiederherstellen
    if (clicker) {
      if (state.clickerX) clicker.style.left = state.clickerX;
      if (state.clickerY) clicker.style.top = state.clickerY;
    }
    if (box && state.slideBoxRight) box.style.right = state.slideBoxRight;
    if (box && state.slideBoxVisible) box.classList.add("show");

    updateDisplay();
  } catch (err) {
    console.error("Fehler beim Laden des Fish-Progress:", err);
  }
}

// === Helfer: State zum Server speichern =======================
async function saveProgress() {
  if (!username || !token) return;

  try {
    const res = await fetch(`/api/fish/${username}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ fishProgress: state })
    });
    if (!res.ok) console.error("Fehler beim Speichern des Fortschritts");
  } catch (err) {
    console.error("Save Error:", err);
  }
}

// === Anzeige aktualisieren =====================================
function updateDisplay() {
  if (!counter) return;
  counter.textContent = state.fish.toFixed(1);
  fpsCounter.textContent = state.fps;
  DiscountCounter.textContent = (1 - (state.BoughtUpgrade3 * 0.05)).toFixed(2);

  buyUpgrade0.textContent = `Bessere Angel kaufen (kostet ${state.Upgrade0Preis}) - Aktuell: ${state.BoughtUpgrade0}`;
  buyUpgrade1.textContent = `Fischer anstellen (kostet ${state.Upgrade1Preis}) - Aktuell: ${state.BoughtUpgrade1}`;
  buyUpgrade2.textContent = `Boot kaufen (kostet ${state.Upgrade2Preis}) - Aktuell: ${state.BoughtUpgrade2}`;
  buyUpgrade3.textContent = state.BoughtUpgrade3 >= 10 ? 
    "Maximaler Kundenrabatt erreicht." : 
    `Kundenrabatt hochstufen (kostet ${state.Upgrade3Preis}) - Aktuell: ${state.BoughtUpgrade3}`;

  saveProgress();
}

// === Preisberechnung ===========================================
function priceIncrease(preis, rabattUpgrade, preisAenderung) {
  if (preisAenderung === 0) preis *= 1.2;
  rabattUpgrade = 1 - (rabattUpgrade * 0.05);
  preis *= rabattUpgrade;
  return Math.round(preis);
}

// === UI EVENTS ================================================
if (btn && box) {
  btn.addEventListener('click', () => {
    box.classList.toggle('show');
    state.slideBoxVisible = box.classList.contains("show");
    saveProgress();
  });

  document.addEventListener('click', (e) => {
    if (!box.contains(e.target) && e.target !== btn) {
      box.classList.remove('show');
      state.slideBoxVisible = false;
      saveProgress();
    }
  });
}

if (fisher) {
  fisher.addEventListener("click", () => {
    state.fish += state.fpc;
    state.fish = Number(state.fish.toFixed(1));
    updateDisplay();
  });
}

if (buyUpgrade0) {
  buyUpgrade0.addEventListener("click", () => {
    if (state.fish >= state.Upgrade0Preis) {
      state.fish -= state.Upgrade0Preis;
      state.fpc += 0.2;
      state.Upgrade0Preis = priceIncrease(state.Upgrade0Preis, state.BoughtUpgrade3, 0);
      state.BoughtUpgrade0++;
      updateDisplay();
    }
  });
}

if (buyUpgrade1) {
  buyUpgrade1.addEventListener("click", () => {
    if (state.fish >= state.Upgrade1Preis) {
      state.fish -= state.Upgrade1Preis;
      state.fps++;
      state.Upgrade1Preis = priceIncrease(state.Upgrade1Preis, state.BoughtUpgrade3, 0);
      state.BoughtUpgrade1++;
      updateDisplay();
    }
  });
}

if (buyUpgrade2) {
  buyUpgrade2.addEventListener("click", () => {
    if (state.fish >= state.Upgrade2Preis) {
      state.fish -= state.Upgrade2Preis;
      state.fps += 5;
      state.Upgrade2Preis = priceIncrease(state.Upgrade2Preis, state.BoughtUpgrade3, 0);
      state.BoughtUpgrade2++;
      updateDisplay();
    }
  });
}

if (buyUpgrade3) {
  buyUpgrade3.addEventListener("click", () => {
    if (state.fish >= state.Upgrade3Preis && state.BoughtUpgrade3 < 10) {
      state.fish -= state.Upgrade3Preis;
      state.BoughtUpgrade3++;
      state.Upgrade3Preis = priceIncrease(state.Upgrade3Preis, state.BoughtUpgrade3, 0);
      updateDisplay();
    }
  });
}

// === Automatisch Fische pro Sekunde ============================
setInterval(() => {
  state.fish += state.fps;
  updateDisplay();
}, 1000);

// === Initial Load ===============================================
loadProgress();
