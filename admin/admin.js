// FILE PATH: admin/admin.js  (INSIDE the admin folder — runs on panel.html)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const OTHER_VALUE = "__other__";

let currentUser = null;
let boxDocs = [];   // raw box documents, each with its firestore doc id attached as _id
let places = [];
// editing holds the ORIGINAL location of a model being edited, so we know
// which box doc to remove it from if it's being moved to a different box.
let editing = null; // { deviceType, brand, box, model }

function slug(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function boxDocId(deviceType, brand, box) {
  return `${slug(deviceType)}__${slug(brand)}__${slug(box)}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function naturalSort(arr) {
  return [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

// ---------- Auth guard ----------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "index.html"; // login page, same folder
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

// ---------- Firestore read (real-time) ----------
function loadEverything() {
  onSnapshot(collection(db, "boxes"), (snap) => {
    boxDocs = snap.docs.map((d) => ({ _id: d.id, ...d.data() }));
    renderAll();
  });

  getDoc(doc(db, "meta", "places")).then((snap) => {
    places = snap.exists() ? snap.data().places || [] : [];
    renderAll();
  });
}

function flatModels() {
  const out = [];
  for (const b of boxDocs) {
    for (const m of b.models || []) {
      out.push({ deviceType: b.deviceType, brand: b.brand, box: b.box, boxDocId: b._id, ...m });
    }
  }
  return out;
}

function renderAll() {
  renderPlacesEditor();
  refreshFormSmartFields();
  refreshInventoryFilters();
  renderStockInputs();
  renderInventoryList();
}

// ---------- Places panel ----------
function renderPlacesEditor() {
  const el = document.getElementById("places-editor");
  el.innerHTML = places
    .map(
      (p, i) => `<div class="place-row">
        <input class="search-input place-input" data-index="${i}" value="${escapeHtml(p)}" />
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
  try {
    await setDoc(doc(db, "meta", "places"), { places: cleaned });
    places = cleaned;
    renderStockInputs();
    showToast("Places saved.", "success");
  } catch (err) {
    showToast(err.message, "fail");
  }
});

// ---------- Lookup helpers (drive both the smart form fields and the inventory filters) ----------
function getDeviceTypes() {
  return naturalSort([...new Set(boxDocs.map((b) => b.deviceType).filter(Boolean))]);
}
function getBrands(deviceType) {
  return naturalSort([
    ...new Set(boxDocs.filter((b) => !deviceType || b.deviceType === deviceType).map((b) => b.brand).filter(Boolean)),
  ]);
}
function getBoxes(deviceType, brand) {
  return naturalSort([
    ...new Set(
      boxDocs
        .filter((b) => (!deviceType || b.deviceType === deviceType) && (!brand || b.brand === brand))
        .map((b) => b.box)
        .filter(Boolean)
    ),
  ]);
}
function getSeriesList(brand) {
  return naturalSort([
    ...new Set(flatModels().filter((m) => !brand || m.brand === brand).map((m) => m.series).filter(Boolean)),
  ]);
}

// ---------- Smart "select from existing, or add new" fields ----------
// Each smart field is a <select id="{id}"> paired with a hidden <input id="{id}-other">
// that appears when "+ Add new…" is chosen.
function populateSmartSelect(selectId, otherId, options, currentValue) {
  const sel = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  const isCustom = currentValue && !options.includes(currentValue);

  sel.innerHTML =
    `<option value="">Select…</option>` +
    options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("") +
    `<option value="${OTHER_VALUE}">+ Add new…</option>`;

  if (isCustom) {
    sel.value = OTHER_VALUE;
    other.style.display = "block";
    other.value = currentValue;
  } else {
    sel.value = currentValue || "";
    other.style.display = "none";
    if (sel.value !== OTHER_VALUE) other.value = "";
  }
}
function smartValue(selectId, otherId) {
  const sel = document.getElementById(selectId);
  if (sel.value === OTHER_VALUE) return document.getElementById(otherId).value.trim();
  return sel.value;
}
function wireSmartToggle(selectId, otherId) {
  const sel = document.getElementById(selectId);
  const other = document.getElementById(otherId);
  sel.addEventListener("change", () => {
    other.style.display = sel.value === OTHER_VALUE ? "block" : "none";
    if (sel.value === OTHER_VALUE) other.focus();
  });
}

function refreshFormSmartFields() {
  const curDT = smartValue("f-deviceType", "f-deviceType-other");
  const curBrand = smartValue("f-brand", "f-brand-other");
  const curBox = smartValue("f-box", "f-box-other");
  populateSmartSelect("f-deviceType", "f-deviceType-other", getDeviceTypes(), curDT);
  populateSmartSelect("f-brand", "f-brand-other", getBrands(curDT), curBrand);
  populateSmartSelect("f-box", "f-box-other", getBoxes(curDT, curBrand), curBox);
  refreshSeriesSuggestions();
}
function refreshSeriesSuggestions() {
  const brand = smartValue("f-brand", "f-brand-other");
  document.getElementById("seriesList").innerHTML = getSeriesList(brand)
    .map((s) => `<option value="${escapeHtml(s)}">`)
    .join("");
}

// Cascading: device type change resets brand + box; brand change resets box.
function cascadeFromDeviceType() {
  const dt = smartValue("f-deviceType", "f-deviceType-other");
  populateSmartSelect("f-brand", "f-brand-other", getBrands(dt), "");
  populateSmartSelect("f-box", "f-box-other", getBoxes(dt, ""), "");
  refreshSeriesSuggestions();
}
function cascadeFromBrand() {
  const dt = smartValue("f-deviceType", "f-deviceType-other");
  const br = smartValue("f-brand", "f-brand-other");
  populateSmartSelect("f-box", "f-box-other", getBoxes(dt, br), "");
  refreshSeriesSuggestions();
}

["f-deviceType", "f-deviceType-other"].forEach((id) =>
  document.getElementById(id).addEventListener(id.endsWith("-other") ? "input" : "change", cascadeFromDeviceType)
);
["f-brand", "f-brand-other"].forEach((id) =>
  document.getElementById(id).addEventListener(id.endsWith("-other") ? "input" : "change", cascadeFromBrand)
);
wireSmartToggle("f-deviceType", "f-deviceType-other");
wireSmartToggle("f-brand", "f-brand-other");
wireSmartToggle("f-box", "f-box-other");

// ---------- Model form ----------
function renderStockInputs(prefill = {}) {
  const el = document.getElementById("stock-inputs");
  el.innerHTML = places
    .map((p) => {
      const entry = prefill[p] || { qty: 0 };
      return `<div class="stock-input-row">
        <span class="place-name">${escapeHtml(p)}</span>
        <input type="number" class="search-input stock-qty-input" data-place="${escapeHtml(p)}" value="${entry.qty}" min="0" />
      </div>`;
    })
    .join("");
}

document.getElementById("model-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const deviceType = smartValue("f-deviceType", "f-deviceType-other");
  const brand = smartValue("f-brand", "f-brand-other");
  const box = smartValue("f-box", "f-box-other");
  const series = document.getElementById("f-series").value.trim();
  const modelName = document.getElementById("f-model").value.trim();
  const displayCode = document.getElementById("f-code").value.trim();

  if (!deviceType || !brand || !box || !modelName) {
    showToast("Device type, brand, box and model name are required.", "fail");
    return;
  }

  const stock = [...document.querySelectorAll(".stock-qty-input")].map((inp) => ({
    place: inp.dataset.place,
    qty: Number(inp.value) || 0,
  }));

  const modelObj = { series, model: modelName, displayCode, stock };

  try {
    // If editing and the model moved to a different box, pull it out of the old box first.
    if (editing) {
      const oldId = boxDocId(editing.deviceType, editing.brand, editing.box);
      const newId = boxDocId(deviceType, brand, box);
      if (oldId !== newId || editing.model !== modelName) {
        await removeModelFromBox(oldId, editing.model);
      }
    }
    await upsertModelIntoBox(deviceType, brand, box, modelObj);
    showToast("Saved.", "success");
    resetForm();
  } catch (err) {
    showToast(err.message, "fail");
  }
});

// Writes/merges one model into its box document (creating the box doc if needed).
async function upsertModelIntoBox(deviceType, brand, box, modelObj) {
  const id = boxDocId(deviceType, brand, box);
  const ref = doc(db, "boxes", id);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data().models || [] : [];
  const idx = existing.findIndex((m) => m.model === modelObj.model);
  if (idx >= 0) existing[idx] = modelObj;
  else existing.push(modelObj);

  await setDoc(ref, { deviceType, brand, box, models: existing });
}

// Removes a model by name from a box doc; deletes the box doc entirely if it becomes empty.
async function removeModelFromBox(boxId, modelName) {
  const ref = doc(db, "boxes", boxId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const remaining = (snap.data().models || []).filter((m) => m.model !== modelName);
  if (remaining.length === 0) {
    await deleteDoc(ref);
  } else {
    await updateDoc(ref, { models: remaining });
  }
}

document.getElementById("cancel-edit-btn").addEventListener("click", resetForm);

function resetForm() {
  editing = null;
  document.getElementById("model-form").reset();
  populateSmartSelect("f-deviceType", "f-deviceType-other", getDeviceTypes(), "");
  populateSmartSelect("f-brand", "f-brand-other", getBrands(""), "");
  populateSmartSelect("f-box", "f-box-other", getBoxes("", ""), "");
  refreshSeriesSuggestions();
  document.getElementById("form-title").textContent = "Add / edit model";
  document.getElementById("cancel-edit-btn").style.display = "none";
  renderStockInputs();
}

function startEdit(m) {
  editing = { deviceType: m.deviceType, brand: m.brand, box: m.box, model: m.model };
  populateSmartSelect("f-deviceType", "f-deviceType-other", getDeviceTypes(), m.deviceType);
  populateSmartSelect("f-brand", "f-brand-other", getBrands(m.deviceType), m.brand);
  populateSmartSelect("f-box", "f-box-other", getBoxes(m.deviceType, m.brand), m.box);
  refreshSeriesSuggestions();
  document.getElementById("f-series").value = m.series;
  document.getElementById("f-model").value = m.model;
  document.getElementById("f-code").value = m.displayCode;
  const prefill = {};
  (m.stock || []).forEach((s) => (prefill[s.place] = { qty: s.qty }));
  renderStockInputs(prefill);
  document.getElementById("form-title").textContent = `Editing ${m.brand} ${m.model}`;
  document.getElementById("cancel-edit-btn").style.display = "inline-block";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Inventory: cascading Device type → Brand → Box filters ----------
function populatePlainSelect(selectId, allLabel, options, currentValue) {
  const sel = document.getElementById(selectId);
  sel.innerHTML = `<option value="">${allLabel}</option>` + options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  sel.value = options.includes(currentValue) ? currentValue : "";
}

function refreshInventoryFilters() {
  const dt = document.getElementById("inv-deviceType").value;
  const br = document.getElementById("inv-brand").value;
  const bx = document.getElementById("inv-box").value;
  populatePlainSelect("inv-deviceType", "All device types", getDeviceTypes(), dt);
  const dtNow = document.getElementById("inv-deviceType").value;
  populatePlainSelect("inv-brand", "All brands", getBrands(dtNow), br);
  const brNow = document.getElementById("inv-brand").value;
  populatePlainSelect("inv-box", "All boxes", getBoxes(dtNow, brNow), bx);
}

document.getElementById("inv-deviceType").addEventListener("change", () => {
  document.getElementById("inv-brand").value = "";
  document.getElementById("inv-box").value = "";
  refreshInventoryFilters();
  renderInventoryList();
});
document.getElementById("inv-brand").addEventListener("change", () => {
  document.getElementById("inv-box").value = "";
  refreshInventoryFilters();
  renderInventoryList();
});
document.getElementById("inv-box").addEventListener("change", renderInventoryList);
document.getElementById("inv-clear-btn").addEventListener("click", () => {
  document.getElementById("inv-deviceType").value = "";
  document.getElementById("inv-brand").value = "";
  document.getElementById("inv-box").value = "";
  refreshInventoryFilters();
  renderInventoryList();
});

// ---------- Existing inventory list ----------
function renderInventoryList() {
  const el = document.getElementById("inventory-list");
  const dt = document.getElementById("inv-deviceType").value;
  const br = document.getElementById("inv-brand").value;
  const bx = document.getElementById("inv-box").value;

  let models = flatModels();
  if (dt) models = models.filter((m) => m.deviceType === dt);
  if (br) models = models.filter((m) => m.brand === br);
  if (bx) models = models.filter((m) => m.box === bx);

  if (models.length === 0) {
    el.innerHTML = `<div class="status-line">No models match this filter.</div>`;
    return;
  }

  const groups = {};
  for (const m of models) {
    const key = `${m.deviceType} / ${m.brand} / ${m.box}`;
    groups[key] = groups[key] || [];
    groups[key].push(m);
  }

  el.innerHTML = Object.entries(groups)
    .map(([groupKey, ms]) => {
      const rows = ms
        .map((m) => {
          const total = (m.stock || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
          return `<div class="model-list-row">
            <span>${escapeHtml(m.model)} <span style="color: var(--text-muted);">(${escapeHtml(m.displayCode || "no code")}) — ${total} in stock</span></span>
            <span class="actions">
              <button type="button" class="btn-secondary edit-model-btn" data-device="${escapeHtml(m.deviceType)}" data-brand="${escapeHtml(m.brand)}" data-box="${escapeHtml(m.box)}" data-model="${escapeHtml(m.model)}">Edit</button>
              <button type="button" class="btn-danger delete-model-btn" data-device="${escapeHtml(m.deviceType)}" data-brand="${escapeHtml(m.brand)}" data-box="${escapeHtml(m.box)}" data-model="${escapeHtml(m.model)}">Delete</button>
            </span>
          </div>`;
        })
        .join("");
      return `<div style="margin-bottom: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size: 13px;">${escapeHtml(groupKey)}</strong>
          <button type="button" class="btn-danger delete-brand-btn" data-device="${escapeHtml(ms[0].deviceType)}" data-brand="${escapeHtml(ms[0].brand)}">Delete whole brand</button>
        </div>
        ${rows}
      </div>`;
    })
    .join("");
}

document.getElementById("inventory-list").addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.classList.contains("edit-model-btn")) {
      const m = flatModels().find(
        (x) => x.deviceType === t.dataset.device && x.brand === t.dataset.brand && x.box === t.dataset.box && x.model === t.dataset.model
      );
      if (m) startEdit(m);
    }
    if (t.classList.contains("delete-model-btn")) {
      if (!confirm(`Delete ${t.dataset.model}?`)) return;
      const id = boxDocId(t.dataset.device, t.dataset.brand, t.dataset.box);
      await removeModelFromBox(id, t.dataset.model);
      showToast("Deleted.", "success");
    }
    if (t.classList.contains("delete-brand-btn")) {
      if (!confirm(`Delete every box for "${t.dataset.brand}"? This removes all its models.`)) return;
      const q = query(collection(db, "boxes"), where("deviceType", "==", t.dataset.device), where("brand", "==", t.dataset.brand));
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      showToast("Brand deleted.", "success");
    }
  } catch (err) {
    showToast(err.message, "fail");
  }
});

function showToast(message, kind) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast ${kind}`;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 3000);
}
