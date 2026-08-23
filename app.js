// FILE PATH: app.js  (repo ROOT)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const els = {
  status: document.getElementById("status-line"),
  results: document.getElementById("results"),
  search: document.getElementById("search-input"),       // model / model number text search
  deviceType: document.getElementById("device-type-select"),
  brand: document.getElementById("brand-select"),
  sourceDbBtn: document.getElementById("source-db-btn"),
  sourceFileBtn: document.getElementById("source-file-btn"),
};

let mode = "database"; // "database" | "file" — which source currently feeds the page
let dbModels = [];      // last known Firestore data, tagged "database"
let allModels = [];      // whichever of dbModels/FALLBACK_MODELS is active, per `mode`

// Used only if Firestore can't be reached. Kept here just so the page never shows
// a blank error screen — every card sourced from here is tagged "File" (see renderTicket).
const FALLBACK_MODELS = [
  { deviceType: "Android", brand: "Vivo", box: "Vivo 1", series: "Y-series", model: "Y18", displayCode: "1802",
    stock: [{ place: "Home", qty: 3 }, { place: "Shop A", qty: 5 }, { place: "Shop B", qty: 0 }] },
  { deviceType: "Android", brand: "Vivo", box: "Vivo V Box", series: "V-series", model: "V30", displayCode: "12208",
    stock: [{ place: "Home", qty: 1 }, { place: "Shop A", qty: 2 }, { place: "Shop B", qty: 0 }] },
  { deviceType: "Android", brand: "Vivo", box: "Vivo T Box", series: "T-series", model: "T3x", displayCode: "1815",
    stock: [{ place: "Home", qty: 0 }, { place: "Shop A", qty: 0 }, { place: "Shop B", qty: 4 }] },
  { deviceType: "iOS", brand: "Apple", box: "Apple Box 1", series: "iPhone", model: "iPhone 13", displayCode: "A2633",
    stock: [{ place: "Home", qty: 0 }, { place: "Shop A", qty: 1 }, { place: "Shop B", qty: 0 }] },
  { deviceType: "Android", brand: "Oppo", box: "Oppo A-series Box", series: "A-series", model: "A5", displayCode: "2201",
    stock: [{ place: "Home", qty: 2 }, { place: "Shop A", qty: 0 }, { place: "Shop B", qty: 1 }] },
  { deviceType: "Android", brand: "Oppo", box: "Oppo A-series Box", series: "A-series", model: "A9", displayCode: "2005",
    stock: [{ place: "Home", qty: 0 }, { place: "Shop A", qty: 3 }, { place: "Shop B", qty: 3 }] },
  { deviceType: "Android", brand: "Moto", box: "Moto Box 1", series: "G-series", model: "G54", displayCode: "3105",
    stock: [{ place: "Home", qty: 1 }, { place: "Shop A", qty: 1 }, { place: "Shop B", qty: 0 }] },
];

function showError(message) {
  els.results.innerHTML = `<div class="error-state">${message}</div>`;
  els.status.textContent = "";
}

// Flatten box docs (deviceType/brand/box/models[]) into one row per model,
// keeping the box name attached for display only.
function flattenBoxes(boxDocs) {
  const models = [];
  for (const b of boxDocs) {
    for (const m of b.models || []) {
      models.push({
        deviceType: b.deviceType,
        brand: b.brand,
        box: b.box,
        series: m.series || "",
        model: m.model || "",
        displayCode: m.displayCode || "",
        stock: m.stock || [],
      });
    }
  }
  return models;
}

function populateFilterOptions() {
  const deviceTypes = [...new Set(allModels.map((m) => m.deviceType))].sort();
  const currentDT = els.deviceType.value;
  els.deviceType.innerHTML =
    `<option value="">All device types</option>` +
    deviceTypes.map((d) => `<option value="${d}">${d}</option>`).join("");
  if (deviceTypes.includes(currentDT)) els.deviceType.value = currentDT;
}

function populateBrandOptions() {
  const selectedType = els.deviceType.value;
  const pool = selectedType ? allModels.filter((m) => m.deviceType === selectedType) : allModels;
  const brands = [...new Set(pool.map((m) => m.brand))].sort();
  const currentBrand = els.brand.value;
  els.brand.innerHTML =
    `<option value="">All brands</option>` +
    brands.map((b) => `<option value="${b}">${b}</option>`).join("");
  if (brands.includes(currentBrand)) els.brand.value = currentBrand;
}

function currentFilters() {
  return {
    text: els.search.value.trim().toLowerCase(), // matches model name OR model number (displayCode)
    deviceType: els.deviceType.value,
    brand: els.brand.value,
  };
}

function matchesFilters(m, f) {
  if (f.deviceType && m.deviceType !== f.deviceType) return false;
  if (f.brand && m.brand !== f.brand) return false;
  if (f.text) {
    const haystack = `${m.series} ${m.model} ${m.displayCode}`.toLowerCase();
    if (!haystack.includes(f.text)) return false;
  }
  return true;
}

function render() {
  const f = currentFilters();
  const matches = allModels.filter((m) => matchesFilters(m, f));

  els.status.innerHTML = `<span class="count">${matches.length}</span> model${matches.length === 1 ? "" : "s"} found`;

  if (matches.length === 0) {
    els.results.innerHTML = `<div class="empty-state">No matching models. Try a different search or clear filters.</div>`;
    return;
  }

  els.results.innerHTML = matches.map((m) => renderTicket(m)).join("");
}

// Place, quantity, and box are OUTPUT ONLY — shown here, never used as search/filter inputs.
function renderTicket(m) {
  const total = m.stock.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
  const stockRows = m.stock
    .map((s) => {
      const qty = Number(s.qty) || 0;
      const cls = qty > 0 ? "in-stock" : "out-stock";
      const boxLabel = m.box ? `<span class="box-tag">${m.box}</span>` : "";
      return `<div class="stock-row">
        <span class="place">${s.place} ${boxLabel}</span>
        <span class="qty ${cls}">${qty}</span>
      </div>`;
    })
    .join("");

  return `<div class="ticket">
    <div class="ticket-header">
      <div>
        <div class="ticket-brand">${m.brand} &middot; ${m.deviceType}</div>
        <div class="ticket-model">${m.model}</div>
        <div class="ticket-series">${m.series}</div>
      </div>
      ${m.displayCode ? `<span class="ticket-code">${m.displayCode}</span>` : ""}
    </div>
    <span class="source-tag ${m.source === "database" ? "source-db" : "source-file"}">${m.source === "database" ? "DATABASE" : "FILE"}</span>
    <div class="ticket-total">Total in stock: <span class="num">${total}</span></div>
    <div class="stock-list">${stockRows}</div>
  </div>`;
}

function applyMode() {
  allModels = mode === "database" ? dbModels : FALLBACK_MODELS.map((m) => ({ ...m, source: "file" }));
  populateFilterOptions();
  populateBrandOptions();
  render();
}

function setMode(newMode) {
  mode = newMode;
  els.sourceDbBtn.classList.toggle("active", mode === "database");
  els.sourceFileBtn.classList.toggle("active", mode === "file");
  applyMode();
}

els.sourceDbBtn.addEventListener("click", () => setMode("database"));
els.sourceFileBtn.addEventListener("click", () => setMode("file"));

function init() {
  els.status.textContent = "Loading stock data\u2026";

  // Real-time listener: any admin change reflects here instantly, no reload needed.
  onSnapshot(
    collection(db, "boxes"),
    (snapshot) => {
      const boxDocs = snapshot.docs.map((d) => d.data());
      dbModels = flattenBoxes(boxDocs).map((m) => ({ ...m, source: "database" }));
      if (mode === "database") applyMode();
    },
    (err) => {
      // Firestore couldn't be reached — auto-switch to file mode so the page
      // still shows something, clearly tagged "File".
      console.error("Firestore read failed, switching to file mode:", err);
      setMode("file");
    }
  );

  els.search.addEventListener("input", render);
  els.deviceType.addEventListener("change", () => {
    populateBrandOptions();
    render();
  });
  els.brand.addEventListener("change", render);

  applyMode(); // paint immediately with whatever's available (file data) while Firestore loads
}

init();
