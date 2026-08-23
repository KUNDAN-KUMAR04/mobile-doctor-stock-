// FILE PATH: admin/admin.js  (INSIDE the admin folder)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let currentUser = null;
let allModels = [];
let places = [];
let editing = null; // { deviceType, brand, originalModel } when editing an existing model

// ---------- Auth guard ----------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  currentUser = user;
  document.getElementById("who-email").textContent = user.email;
  loadEverything();
});

document.getElementById("logout-link").addEventListener("click", (e) => {
  e.preventDefault();
  signOut(auth);
});

// ---------- GitHub read (same approach as the public search page) ----------
async function loadEverything() {
  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

  const placesRes = await fetch(`${apiBase}/data/places.json?ref=${GITHUB_BRANCH}`);
  if (placesRes.ok) {
    const placesJson = await placesRes.json();
    const decoded = JSON.parse(atob(placesJson.content));
    places = decoded.places || [];
  }

  const dataDirRes = await fetch(`${apiBase}/data?ref=${GITHUB_BRANCH}`);
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
          deviceTypeFolder: dt.name,
          brand: brandData.brand,
          series: m.series || "",
          model: m.model,
          displayCode: m.displayCode || "",
          stock: m.stock || [],
        });
      }
    }
  }
  allModels = models;
  renderAll();
}

function renderAll() {
  renderPlacesEditor();
  renderDatalists();
  renderStockInputs();
  renderInventoryList();
}

// ---------- Places panel ----------
function renderPlacesEditor() {
  const el = document.getElementById("places-editor");
  el.innerHTML = places
    .map(
      (p, i) => `<div class="place-row">
        <input class="search-input place-input" data-index="${i}" value="${p}" />
        <button type="button" class="btn-danger remove-place-btn" data-index="${i}">Remove</button>
      </div>`
    )
    .join("");
}

document.getElementById("add-place-btn").addEventListener("click", () => {
  places.push("New place");
  renderPlacesEditor();
});

document.getElementById("places-editor").addEventListener("click", (e) => {
  if (e.target.classList.contains("remove-place-btn")) {
    places.splice(Number(e.target.dataset.index), 1);
    renderPlacesEditor();
  }
});

document.getElementById("places-editor").addEventListener("input", (e) => {
  if (e.target.classList.contains("place-input")) {
    places[Number(e.target.dataset.index)] = e.target.value;
  }
});

document.getElementById("save-places-btn").addEventListener("click", async () => {
  const cleaned = places.map((p) => p.trim()).filter(Boolean);
  await callWriteApi("updatePlaces", { places: cleaned });
  places = cleaned;
  renderStockInputs();
});

// ---------- Datalists (device type / brand suggestions) ----------
function renderDatalists() {
  const deviceTypes = [...new Set(allModels.map((m) => m.deviceTypeFolder))];
  const brands = [...new Set(allModels.map((m) => m.brand))];
  document.getElementById("deviceTypeList").innerHTML = deviceTypes.map((d) => `<option value="${d}">`).join("");
  document.getElementById("brandList").innerHTML = brands.map((b) => `<option value="${b}">`).join("");
}

// ---------- Model form ----------
function renderStockInputs(prefill = {}) {
  const el = document.getElementById("stock-inputs");
  el.innerHTML = places
    .map((p) => {
      const entry = prefill[p] || { qty: 0, box: "" };
      return `<div class="stock-input-row">
        <span class="place-name">${p}</span>
        <input type="text" class="search-input stock-box-input" data-place="${p}" value="${entry.box || ""}" placeholder="Box name (e.g. Vivo 1)" />
        <input type="number" class="search-input stock-qty-input" data-place="${p}" value="${entry.qty}" min="0" />
      </div>`;
    })
    .join("");
}

document.getElementById("model-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const deviceType = document.getElementById("f-deviceType").value.trim();
  const brand = document.getElementById("f-brand").value.trim();
  const series = document.getElementById("f-series").value.trim();
  const modelName = document.getElementById("f-model").value.trim();
  const displayCode = document.getElementById("f-code").value.trim();

  if (!deviceType || !brand || !modelName) return;

  const boxByPlace = {};
  document.querySelectorAll(".stock-box-input").forEach((inp) => {
    boxByPlace[inp.dataset.place] = inp.value.trim();
  });

  const stock = [...document.querySelectorAll(".stock-qty-input")].map((inp) => ({
    place: inp.dataset.place,
    qty: Number(inp.value) || 0,
    box: boxByPlace[inp.dataset.place] || "",
  }));

  const model = { series, model: modelName, displayCode, stock };
  const payload = {
    deviceType,
    brand,
    model,
    originalModel: editing ? editing.originalModel : null,
  };

  await callWriteApi("upsertModel", payload);
  resetForm();
  await loadEverything();
});

document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);

function resetForm() {
  editing = null;
  document.getElementById("model-form").reset();
  document.getElementById("form-title").textContent = "Add / edit model";
  document.getElementById("cancel-edit-btn").style.display = "none";
  renderStockInputs();
}

function startEdit(m) {
  editing = { deviceType: m.deviceTypeFolder, brand: m.brand, originalModel: m.model };
  document.getElementById("f-deviceType").value = m.deviceTypeFolder;
  document.getElementById("f-brand").value = m.brand;
  document.getElementById("f-series").value = m.series;
  document.getElementById("f-model").value = m.model;
  document.getElementById("f-code").value = m.displayCode;
  const prefill = {};
  m.stock.forEach((s) => (prefill[s.place] = { qty: s.qty, box: s.box || "" }));
  renderStockInputs(prefill);
  document.getElementById("form-title").textContent = `Editing ${m.brand} ${m.model}`;
  document.getElementById("cancel-edit-btn").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Existing inventory list ----------
function renderInventoryList() {
  const el = document.getElementById("inventory-list");
  if (allModels.length === 0) {
    el.innerHTML = `<div class="status-line">No models yet — add one above.</div>`;
    return;
  }

  const groups = {};
  for (const m of allModels) {
    const key = `${m.deviceTypeFolder} / ${m.brand}`;
    groups[key] = groups[key] || [];
    groups[key].push(m);
  }

  el.innerHTML = Object.entries(groups)
    .map(([groupKey, models]) => {
      const rows = models
        .map((m) => {
          const total = m.stock.reduce((s, x) => s + (Number(x.qty) || 0), 0);
          const boxes = [...new Set(m.stock.map((x) => x.box).filter(Boolean))];
          const boxNote = boxes.length ? ` · box: ${boxes.join(", ")}` : "";
          return `<div class="model-list-row">
            <span>${m.model} <span style="color: var(--text-muted);">(${m.displayCode || "no code"}) — ${total} in stock${boxNote}</span></span>
            <span class="actions">
              <button type="button" class="btn-secondary edit-model-btn" data-device="${m.deviceTypeFolder}" data-brand="${m.brand}" data-model="${m.model}">Edit</button>
              <button type="button" class="btn-danger delete-model-btn" data-device="${m.deviceTypeFolder}" data-brand="${m.brand}" data-model="${m.model}">Delete</button>
            </span>
          </div>`;
        })
        .join("");
      return `<div style="margin-bottom: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size: 13px;">${groupKey}</strong>
          <button type="button" class="btn-danger delete-brand-btn" data-device="${models[0].deviceTypeFolder}" data-brand="${models[0].brand}">Delete whole brand</button>
        </div>
        ${rows}
      </div>`;
    })
    .join("");
}

document.getElementById("inventory-list").addEventListener("click", async (e) => {
  const t = e.target;
  if (t.classList.contains("edit-model-btn")) {
    const m = allModels.find(
      (x) => x.deviceTypeFolder === t.dataset.device && x.brand === t.dataset.brand && x.model === t.dataset.model
    );
    if (m) startEdit(m);
  }
  if (t.classList.contains("delete-model-btn")) {
    if (!confirm(`Delete ${t.dataset.model}?`)) return;
    await callWriteApi("deleteModel", { deviceType: t.dataset.device, brand: t.dataset.brand, modelName: t.dataset.model });
    await loadEverything();
  }
  if (t.classList.contains("delete-brand-btn")) {
    if (!confirm(`Delete the entire "${t.dataset.brand}" brand file? This removes all its models.`)) return;
    await callWriteApi("deleteBrand", { deviceType: t.dataset.device, brand: t.dataset.brand });
    await loadEverything();
  }
});

// ---------- Write API helper ----------
async function callWriteApi(action, payload) {
  try {
    const idToken = await currentUser.getIdToken();
    const res = await fetch("/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, action, payload }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Request failed");
    showToast("Saved.", "success");
    return json;
  } catch (err) {
    showToast(err.message, "fail");
    throw err;
  }
}

function showToast(message, kind) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 3000);
}
