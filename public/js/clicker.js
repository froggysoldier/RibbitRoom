const btn = document.getElementById('showBtn');
const box = document.getElementById('slideBox');

btn.addEventListener('click', () => {
  box.classList.toggle('show');
});

// Variablen definieren
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

// HTML-Elemente
const counter = document.getElementById("counter");
const fisher = document.getElementById("fisher");
const buyUpgrade0 = document.getElementById("buyUpgrade0");
const buyUpgrade1 = document.getElementById("buyUpgrade1");
const buyUpgrade2 = document.getElementById("buyUpgrade2");
const buyUpgrade3 = document.getElementById("buyUpgrade3");
const fpcCounter = document.getElementById("fpcCounter");
const fpsCounter = document.getElementById("fpsCounter");
const DiscountCounter = document.getElementById("DiscountCounter");


function UpdateDisplay() {
  counter.textContent = fish;
  fpcCounter.textContent = fpc;
  fpsCounter.textContent = fps;
  DiscountCounter.textContent = 1 - (BoughtUpgrade3 * 0.05);

  buyUpgrade0.textContent = `Bessere Angel kaufen (kostet ${Upgrade0Preis}) - Aktuell: ${BoughtUpgrade0} Upgrades`;
  buyUpgrade1.textContent = `Fischer anstellen (kostet ${Upgrade1Preis}) - Aktuell: ${BoughtUpgrade1} Upgrades`;
  buyUpgrade2.textContent = `Boot kaufen (kostet ${Upgrade2Preis}) - Aktuell: ${BoughtUpgrade2} Upgrades`;

  if (BoughtUpgrade3 === 10) {
    buyUpgrade3.textContent = "Maximaler Kundenrabatt erreicht.";
  } else {
    buyUpgrade3.textContent = `Kundenrabatt hochstufen (kostet ${Upgrade3Preis}) - Aktuell: ${BoughtUpgrade3} Upgrades`;
  }
}

function UpdateDiscount() {
  Upgrade0Preis = PriceIncrease(Upgrade0Preis, BoughtUpgrade3, 1);
  Upgrade1Preis = PriceIncrease(Upgrade1Preis, BoughtUpgrade3, 1);
  Upgrade2Preis = PriceIncrease(Upgrade2Preis, BoughtUpgrade3, 1);
}

function PriceIncrease(Preis, PreisUpgrade, PreisAenderung) {
  if (PreisAenderung === 0) Preis *= 1.2;
  PreisUpgrade = 1 - (PreisUpgrade * 0.05);
  Preis *= PreisUpgrade;
  return Math.round(Preis);
}

// Klick auf Bild
fisher.addEventListener("click", () => {
  fish += fpc;
  fish = Number(fish.toFixed(1));
  counter.textContent = fish;
});

buyUpgrade0.addEventListener("click", () => {
  if (fish >= Upgrade0Preis) {
    fish -= Upgrade0Preis;
    fpc += 0.2;
    fpc = Number(fpc.toFixed(1));
    Upgrade0Preis = PriceIncrease(Upgrade0Preis, BoughtUpgrade3, 0);
    BoughtUpgrade0++;
    UpdateDisplay();
  }
});

buyUpgrade1.addEventListener("click", () => {
  if (fish >= Upgrade1Preis) {
    fish -= Upgrade1Preis;
    fps++;
    Upgrade1Preis = PriceIncrease(Upgrade1Preis, BoughtUpgrade3, 0);
    BoughtUpgrade1++;
    UpdateDisplay();
  }
});

buyUpgrade2.addEventListener("click", () => {
  if (fish >= Upgrade2Preis) {
    fish -= Upgrade2Preis;
    fps += 5;
    Upgrade2Preis = PriceIncrease(Upgrade2Preis, BoughtUpgrade3, 0);
    BoughtUpgrade2++;
    UpdateDisplay();
  }
});

buyUpgrade3.addEventListener("click", () => {
  if (fish >= Upgrade3Preis && BoughtUpgrade3 !== 10) {
    fish -= Upgrade3Preis;
    BoughtUpgrade3++;
    Upgrade3Preis = PriceIncrease(Upgrade3Preis, BoughtUpgrade3, 0);
    UpdateDiscount();
    UpdateDisplay();
  }
});

setInterval(() => {
  fish += fps;
  UpdateDisplay();
}, 1000);


