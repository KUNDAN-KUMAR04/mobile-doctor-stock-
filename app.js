// FILE PATH: app.js  (repo ROOT — NOT inside admin/)
// ---- SET THESE THREE VALUES to match your GitHub repo ----
const GITHUB_OWNER = "KUNDAN-KUMAR04";
const GITHUB_REPO = "mobile-doctor-stock-";
const GITHUB_BRANCH = "main";
// ------------------------------------------------------------

const els = {
  status: document.getElementById("status-line"),
  results: document.getElementById("results"),
  search: document.getElementById("search-input"),
  deviceType: document.getElementById("device-type-select"),
  brand: document.getElementById("brand-select"),
};

let allModels = []; // flattened list of every model across every brand file

function isConfigured() {
  return GITHUB_OWNER !== "YOUR_GITHUB_USERNAME" && GITHUB_REPO !== "YOUR_REPO_NAME";
}

function showError(message) {
  els.results.innerHTML = `<div class="error-state">${message}</div>`;
  els.status.textContent = "";
}

async function loadAllData() {
  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

  const dataDirRes = await fetch(`${apiBase}/data?ref=${GITHUB_BRANCH}`);
  if (!dataDirRes.ok) {
    throw new Error(`Could not read the /data folder (status ${dataDirRes.status}). Check the repo name and that it's public.`);
  }
  const dataDirItems = await dataDirRes.json();
  const deviceTypeDirs = dataDirItems.filter((i) => i.type === "dir");

  const models = [];
  for (const dt of deviceTypeDirs) {
    const brandRes = await fetch(`${apiBase}/data/${dt.name}?ref=${GITHUB_BRANCH}`);
    if (!brandRes.ok) continue;
    const brandFiles = await brandRes.json();

    for (const bf of brandFiles.filter((f) => f.type === "file" && f.name.endsWith(".json"))) {
      const brandDataRes = await fetch(bf.download_url);
      if (!brandDataRes.ok) continue;
      const brandData = await brandDataRes.json();

      for (const m of brandData.models || []) {
        models.push({
          deviceType: brandData.deviceType || dt.name,
          brand: brandData.brand || bf.name.replace(".json", ""),
          series: m.series || "",
          model: m.model || "",
          displayCode: m.displayCode || "",
          stock: m.stock || [],
        });
      }
    }
  }
  return models;
}

function populateFilterOptions() {
  const deviceTypes = [...new Set(allModels.map((m) => m.deviceType))].sort();
  els.deviceType.innerHTML =
    `<option value="">All device types</option>` +
    deviceTypes.map((d) => `<option value="${d}">${d}</option>`).join("");
}

function populateBrandOptions() {
  const selectedType = els.deviceType.value;
  const pool = selectedType ? allModels.filter((m) => m.deviceType === selectedType) : allModels;
  const brands = [...new Set(pool.map((m) => m.brand))].sort();
  els.brand.innerHTML =
    `<option value="">All brands</option>` +
    brands.map((b) => `<option value="${b}">${b}</option>`).join("");
}

function currentFilters() {
  return {
    text: els.search.value.trim().toLowerCase(),
    deviceType: els.deviceType.value,
    brand: els.brand.value,
  };
}

function matchesFilters(m, f) {
  if (f.deviceType && m.deviceType !== f.deviceType) return false;
  if (f.brand && m.brand !== f.brand) return false;
  if (f.text) {
    const haystack = `${m.series} ${m.model} ${m.displayCode} ${m.brand}`.toLowerCase();
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

  els.results.innerHTML = matches.map(renderTicket).join("");
}

function renderTicket(m) {
  const total = m.stock.reduce((sum, s) => sum + (Number(s.qty) || 0), 0);
  const stockRows = m.stock
    .map((s) => {
      const qty = Number(s.qty) || 0;
      const cls = qty > 0 ? "in-stock" : "out-stock";
      return `<div class="stock-row">
        <span class="place">${s.place}</span>
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
    <div class="ticket-total">Total in stock: <span class="num">${total}</span></div>
    <div class="stock-list">${stockRows}</div>
  </div>`;
}

async function init() {
  if (!isConfigured()) {
    showError(
      `Setup needed &mdash; open <code>app.js</code> and set <code>GITHUB_OWNER</code> and <code>GITHUB_REPO</code> to your repo, then reload.`
    );
    return;
  }

  els.status.textContent = "Loading stock data\u2026";
  try {
    allModels = await loadAllData();
    populateFilterOptions();
    populateBrandOptions();
    render();
  } catch (err) {
    showError(err.message);
  }

  els.search.addEventListener("input", render);
  els.deviceType.addEventListener("change", () => {
    populateBrandOptions();
    render();
  });
  els.brand.addEventListener("change", render);
}

init();
