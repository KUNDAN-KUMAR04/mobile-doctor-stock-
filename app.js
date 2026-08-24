// FILE PATH: app.js  (repo ROOT — NOT inside admin/)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } from "./firebase-config.js";

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

let mode = "database";   // "database" | "file" — which source currently feeds the page
let dbModels = [];        // last known Firestore data, tagged "database"
let fileModels = [];      // last known GitHub JSON data, tagged "file"
let fileModelsLoaded = false; // only fetch from GitHub once per page load; cached after that
let allModels = [];       // whichever of dbModels/fileModels is active, per `mode`

function showError(message) {
  els.results.innerHTML = `<div class="error-state">${message}</div>`;
  els.status.textContent = "";
}

// ---------- Database (Firestore) ----------
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

// ---------- File (GitHub JSON, data/<deviceType>/<brand>.json) ----------
// Two JSON shapes are supported on the FILE side only (this does not touch the
// admin panel or the Database/Firestore path at all):
//
// OLD shape (what write.js / the admin panel still saves):
//   { deviceType, brand, models: [ { box, series, model, displayCode, stock: [{place, qty}] } ] }
//
// NEW shape (e.g. oppo_realme.json — one location, boxes of grouped models):
//   { deviceType, brand, location, boxes: [ { boxTag, items: [ { modelGroup, qty } ] } ] }
//   modelGroup can be several model names separated by "/", all sharing the same qty.
//
// normalizeBrandData() turns either shape into the same flat row shape the
// rest of the app (filters, search, rendering) already expects, so File mode
// works no matter which format a given brand file is in.
function normalizeBrandData(raw, dirName, fileNameNoExt) {
  const deviceType = raw.deviceType || dirName;
  const brand = raw.brand || fileNameNoExt;

  // NEW format: boxes[] of items[] with a single shared "location"
  if (Array.isArray(raw.boxes)) {
    const location = (raw.location || "").trim();
    const models = [];
    for (const box of raw.boxes) {
      const boxTag = box.boxTag || "";
      for (const item of box.items || []) {
        const qty = Number(item.qty) || 0;
        const names = String(item.modelGroup || "")
          .split("/")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const name of names) {
          models.push({
            deviceType,
            brand,
            box: boxTag,
            series: "",
            model: name,
            displayCode: "",
            stock: location ? [{ place: location, qty }] : [],
          });
        }
      }
    }
    return models;
  }

  // OLD format: flat models[] array, each with its own stock-by-place list
  if (Array.isArray(raw.models)) {
    return raw.models.map((m) => ({
      deviceType,
      brand,
      box: m.box || "",
      series: m.series || "",
      model: m.model || "",
      displayCode: m.displayCode || "",
      stock: m.stock || [],
    }));
  }

  // Unrecognized shape — skip this one file instead of breaking File mode entirely.
  console.warn(`app.js: unrecognized JSON format in data/${dirName}/${fileNameNoExt}.json — skipped.`);
  return [];
}

// Reads live from the GitHub Contents API — same folder layout your config.yml
// (Decap CMS) writes to, but now format-tolerant per file (see normalizeBrandData).
async function loadFileModels() {
  if (fileModelsLoaded) return fileModels; // cached after first successful load this page-view

  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

  const dataDirRes = await fetch(`${apiBase}/data?ref=${GITHUB_BRANCH}`);
  if (!dataDirRes.ok) {
    throw new Error(`Could not read the /data folder (status ${dataDirRes.status}). Check GITHUB_OWNER/GITHUB_REPO in firebase-config.js and that the repo is public.`);
  }
  const dataDirItems = await dataDirRes.json();
  const deviceTypeDirs = dataDirItems.filter((i) => i.type === "dir");

  const models = [];
  for (const dt of deviceTypeDirs) {
    const brandRes = await fetch(`${apiBase}/data/${dt.name}?ref=${GITHUB_BRANCH}`);
    if (!brandRes.ok) continue;
    const brandFiles = await brandRes.json();

    for (const bf of brandFiles.filter((f) => f.type === "file" && f.name.endsWith(".json"))) {
      try {
        const brandDataRes = await fetch(bf.download_url);
        if (!brandDataRes.ok) continue;
        const brandData = await brandDataRes.json();

        const fileNameNoExt = bf.name.replace(/\.json$/i, "");
        models.push(...normalizeBrandData(brandData, dt.name, fileNameNoExt));
      } catch (err) {
        // A single malformed/unexpected file should never take down the whole
        // File-mode load — log it and keep going with everything else.
        console.warn(`app.js: failed to load data/${dt.name}/${bf.name}:`, err);
      }
    }
  }

  fileModels = models;
  fileModelsLoaded = true;
  return models;
}

// ---------- Filters / rendering (shared by both modes) ----------
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

// ---------- Mode switching ----------
async function applyMode() {
  if (mode === "database") {
    allModels = dbModels;
    populateFilterOptions();
    populateBrandOptions();
    render();
    return;
  }

  // mode === "file"
  els.status.textContent = "Loading stock data from GitHub\u2026";
  try {
    const models = await loadFileModels();
    allModels = models.map((m) => ({ ...m, source: "file" }));
    populateFilterOptions();
    populateBrandOptions();
    render();
  } catch (err) {
    showError(err.message);
  }
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
      // Firestore couldn't be reached — auto-switch to File mode so the page
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

  applyMode(); // paint immediately with whatever's available while Firestore loads
}

init();
