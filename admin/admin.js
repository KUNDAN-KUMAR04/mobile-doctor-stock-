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

// localStorage keys for "remember the last device type / brand / box" so bulk
// entry of the same brand doesn't force reselecting every single time. Just a
// convenience default — the person can always change it manually.
const LS_DT = "md_admin_last_deviceType";
const LS_BRAND = "md_admin_last_brand";
const LS_BOX = "md_admin_last_box";

let currentUser = null;
let boxDocs = [];   // raw box documents, each with its firestore doc id attached as _id
let places = [];
// editing holds the ORIGINAL location + id of a model being edited, so we know
// which box doc to remove it from if it's being moved to a different box.
let editing = null; // { deviceType, brand, box, id }

function genId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
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
function rememberSelection(deviceType, brand, box) {
  try {
    localStorage.setItem(LS_DT, deviceType || "");
    localStorage.setItem(LS_BRAND, brand || "");
    localStorage.setItem(LS_BOX, box || "");
  } catch (e) {
    /* private browsing / storage disabled — just skip remembering */
  }
}
function getRemembered() {
  try {
    return {
      deviceType: localStorage.getItem(LS_DT) || "",
      brand: localStorage.getItem(LS_BRAND) || "",
      box: localStorage.getItem(LS_BOX) || "",
    };
  } catch (e) {
    return { deviceType: "", brand: "", box: "" };
  }
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
    migrateMissingIds();
    renderAll();
  });

  getDoc(doc(db, "meta", "places")).then((snap) => {
    places = snap.exists() ? snap.data().places || [] : [];
    renderAll();
  });
}

// Older entries were saved without a unique `id`, which is what caused the
// "second model with the same name overwrites the first" bug — matching used
// to happen on the model NAME. This backfills an id onto any model missing
// one (in-memory immediately so the UI is correct this tick, and persisted
// to Firestore in the background so it only has to happen once per box).
function migrateMissingIds() {
  for (const b of boxDocs) {
    let changed = false;
    const models = (b.models || []).map((m) => {
      if (!m.id) {
        changed = true;
        return { ...m, id: genId() };
      }
      return m;
    });
    if (changed) {
      b.models = models;
      setDoc(doc(db, "boxes", b._id), { deviceType: b.deviceType, brand: b.brand, box: b.box, models }).catch((e) =>
        console.error("ID migration failed for box", b._id, e)
      );
    }
  }
}

// Flattens box docs into one row PER NAME, not per stored item — a single
// item can represent a group of interchangeable models sharing one universal
// display (e.g. "Y18 / Y19 / 1902" all use the exact same part and one shared
// qty). Every name in the group gets searchable/editable as its own row, but
// all rows from the same item share the same `id`, so editing or deleting any
// one of them acts on the whole shared entry — exactly how the File-mode JSON
// (modelGroup + qty) already behaves, so Database and File feel identical.
// `m.names` is the modern shape; older docs saved before this only have a
// single `model` string (optionally with a separate `aliases` array) — both
// are folded into the same names list here for backward compatibility.
function flatModels() {
  const out = [];
  for (const b of boxDocs) {
    for (const m of b.models || []) {
      const names = m.names && m.names.length ? m.names : [m.model, ...(m.aliases || [])].filter(Boolean);
      for (const name of names) {
        out.push({
          deviceType: b.deviceType,
          brand: b.brand,
          box: b.box,
          boxDocId: b._id,
          id: m.id,
          series: m.series || "",
          model: name,
          names,
          displayCode: m.displayCode || "",
          aliases: names.filter((n) => n !== name),
          stock: m.stock || [],
        });
      }
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

// Device type / Brand / Box "remember" the last used selection (see LS_* keys
// above) instead of resetting to blank after every save — falls back to
// whatever's already picked, then to the last remembered choice, so a batch
// of the same brand doesn't need reselecting each time.
function refreshFormSmartFields() {
  const remembered = getRemembered();
  const curDT = smartValue("f-deviceType", "f-deviceType-other") || remembered.deviceType;
  const curBrand = smartValue("f-brand", "f-brand-other") || remembered.brand;
  const curBox = smartValue("f-box", "f-box-other") || remembered.box;
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
  if (places.length === 0) {
    el.innerHTML = `<div class="status-line">No places yet — add one in the "Places" panel above and save it, then it'll show up here for entering stock.</div>`;
    return;
  }
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
  const displayCode = document.getElementById("f-code").value.trim();

  // One item can cover several interchangeable model names sharing a single
  // universal part/display and a single shared qty — e.g. "Y18 / Y19 / 1902".
  // Same "/" convention as the File-mode JSON, so it feels identical either way.
  const names = document
    .getElementById("f-model")
    .value.split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!deviceType || !brand || !box || names.length === 0) {
    showToast("Device type, brand, box and at least one model name are required.", "fail");
    return;
  }

  const stock = [...document.querySelectorAll(".stock-qty-input")].map((inp) => ({
    place: inp.dataset.place,
    qty: Number(inp.value) || 0,
  }));

  // Keyed by id, not name — this is what allows any number of items (even
  // ones sharing a name) to live in the same box without overwriting each
  // other, and lets one item carry several names sharing one qty.
  const modelObj = { id: editing ? editing.id : genId(), series, names, displayCode, stock };

  try {
    // Only need to pull the model out of its old box doc if it's actually
    // moving to a different box — renaming/regrouping in place is handled by
    // the id-matched upsert below, no removal needed.
    if (editing) {
      const oldId = boxDocId(editing.deviceType, editing.brand, editing.box);
      const newId = boxDocId(deviceType, brand, box);
      if (oldId !== newId) {
        await removeModelFromBox(oldId, editing.id);
      }
    }
    await upsertModelIntoBox(deviceType, brand, box, modelObj);
    rememberSelection(deviceType, brand, box);
    showToast("Saved.", "success");
    resetForm();
  } catch (err) {
    showToast(err.message, "fail");
  }
});

// Writes/merges one model into its box document (creating the box doc if needed).
// Matches by id only, so adding a NEW entry (fresh id) always adds a new item
// -- it never overwrites an existing one just because a name matches.
async function upsertModelIntoBox(deviceType, brand, box, modelObj) {
  const id = boxDocId(deviceType, brand, box);
  const ref = doc(db, "boxes", id);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data().models || [] : [];
  const idx = existing.findIndex((m) => m.id === modelObj.id);
  if (idx >= 0) existing[idx] = modelObj;
  else existing.push(modelObj);

  await setDoc(ref, { deviceType, brand, box, models: existing });
}

// Removes a model by id from a box doc; deletes the box doc entirely if it becomes empty.
async function removeModelFromBox(boxId, id) {
  const ref = doc(db, "boxes", boxId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const remaining = (snap.data().models || []).filter((m) => m.id !== id);
  if (remaining.length === 0) {
    await deleteDoc(ref);
  } else {
    await updateDoc(ref, { models: remaining });
  }
}

document.getElementById("cancel-edit-btn").addEventListener("click", () => resetForm());

// Clears the per-item fields (series/names/code/stock) but keeps whatever
// Device type / Brand / Box are currently selected — that's the "remember
// the last selection" behavior for fast batch entry. Pick a different
// device type/brand/box manually any time to override it.
function resetForm() {
  editing = null;
  const dt = smartValue("f-deviceType", "f-deviceType-other");
  const brand = smartValue("f-brand", "f-brand-other");
  const box = smartValue("f-box", "f-box-other");

  document.getElementById("f-series").value = "";
  document.getElementById("f-model").value = "";
  document.getElementById("f-code").value = "";

  populateSmartSelect("f-deviceType", "f-deviceType-other", getDeviceTypes(), dt);
  populateSmartSelect("f-brand", "f-brand-other", getBrands(dt), brand);
  populateSmartSelect("f-box", "f-box-other", getBoxes(dt, brand), box);
  refreshSeriesSuggestions();
  document.getElementById("form-title").textContent = "Add / edit model";
  document.getElementById("cancel-edit-btn").style.display = "none";
  renderStockInputs();
}

function startEdit(m) {
  editing = { deviceType: m.deviceType, brand: m.brand, box: m.box, id: m.id };
  populateSmartSelect("f-deviceType", "f-deviceType-other", getDeviceTypes(), m.deviceType);
  populateSmartSelect("f-brand", "f-brand-other", getBrands(m.deviceType), m.brand);
  populateSmartSelect("f-box", "f-box-other", getBoxes(m.deviceType, m.brand), m.box);
  refreshSeriesSuggestions();
  const groupNames = m.names && m.names.length ? m.names : [m.model];
  document.getElementById("f-series").value = m.series;
  document.getElementById("f-model").value = groupNames.join(" / ");
  document.getElementById("f-code").value = m.displayCode;
  const prefill = {};
  (m.stock || []).forEach((s) => (prefill[s.place] = { qty: s.qty }));
  renderStockInputs(prefill);
  document.getElementById("form-title").textContent = `Editing ${m.brand} ${groupNames.join(" / ")}`;
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
  document.getElementById("inv-search").value = "";
  refreshInventoryFilters();
  renderInventoryList();
});
document.getElementById("inv-search").addEventListener("input", renderInventoryList);

document.getElementById("inv-delete-brand-btn").addEventListener("click", async () => {
  const dt = document.getElementById("inv-deviceType").value;
  const br = document.getElementById("inv-brand").value;
  if (!br) {
    showToast("Pick a brand in the filters first.", "fail");
    return;
  }
  if (!confirm(`Delete every box for "${br}"? This removes all its models.`)) return;
  try {
    const q = dt
      ? query(collection(db, "boxes"), where("deviceType", "==", dt), where("brand", "==", br))
      : query(collection(db, "boxes"), where("brand", "==", br));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    showToast("Brand deleted.", "success");
  } catch (err) {
    showToast(err.message, "fail");
  }
});

// ---------- Existing inventory list ----------
// Same ticket-card look as the public site (reuses .ticket / .results-grid from
// style.css) instead of the old plain grouped list, plus a text search across
// model / code / series / aliases so you don't have to hunt through filters.
function renderInventoryList() {
  const el = document.getElementById("inventory-list");
  const countEl = document.getElementById("inv-count");
  const dt = document.getElementById("inv-deviceType").value;
  const br = document.getElementById("inv-brand").value;
  const bx = document.getElementById("inv-box").value;
  const q = document.getElementById("inv-search").value.trim().toLowerCase();

  let models = flatModels();
  if (dt) models = models.filter((m) => m.deviceType === dt);
  if (br) models = models.filter((m) => m.brand === br);
  if (bx) models = models.filter((m) => m.box === bx);
  if (q) {
    models = models.filter((m) => {
      const haystack = [m.model, m.series, m.displayCode, m.brand, m.box, m.deviceType, ...(m.aliases || [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  countEl.textContent = `${models.length} model${models.length === 1 ? "" : "s"}`;

  if (models.length === 0) {
    el.innerHTML = `<div class="empty-state">No models match this filter.</div>`;
    return;
  }

  el.innerHTML =
    `<div class="results-grid">` +
    models
      .map((m) => {
        const total = (m.stock || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
        const stockRows = (m.stock || [])
          .map((s) => {
            const qty = Number(s.qty) || 0;
            const cls = qty > 0 ? "in-stock" : "out-stock";
            return `<div class="stock-row">
              <span class="place">${escapeHtml(s.place)}</span>
              <span class="qty ${cls}">${qty}</span>
            </div>`;
          })
          .join("");
        const aliasLine =
          m.aliases && m.aliases.length
            ? `<div class="ticket-aliases">shares stock with: ${m.aliases.map(escapeHtml).join(", ")}</div>`
            : "";
        const groupNames = (m.names && m.names.length ? m.names : [m.model]).join(", ");

        return `<div class="ticket">
          <div class="ticket-header">
            <div>
              <div class="ticket-brand">${escapeHtml(m.brand)} &middot; ${escapeHtml(m.deviceType)} &middot; ${escapeHtml(m.box)}</div>
              <div class="ticket-model">${escapeHtml(m.model)}</div>
              <div class="ticket-series">${escapeHtml(m.series || "")}</div>
              ${aliasLine}
            </div>
            ${m.displayCode ? `<span class="ticket-code">${escapeHtml(m.displayCode)}</span>` : ""}
          </div>
          <div class="ticket-total">Total in stock: <span class="num">${total}</span></div>
          <div class="stock-list">${stockRows || `<div class="status-line" style="margin:0;">No stock recorded yet.</div>`}</div>
          <div class="ticket-admin-actions">
            <button type="button" class="btn-secondary edit-model-btn" data-boxid="${escapeHtml(m.boxDocId)}" data-id="${escapeHtml(m.id)}">Edit</button>
            <button type="button" class="btn-danger delete-model-btn" data-boxid="${escapeHtml(m.boxDocId)}" data-id="${escapeHtml(m.id)}" data-names="${escapeHtml(groupNames)}">Delete</button>
          </div>
        </div>`;
      })
      .join("") +
    `</div>`;
}

document.getElementById("inventory-list").addEventListener("click", async (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  try {
    if (t.classList.contains("edit-model-btn")) {
      const m = flatModels().find((x) => x.boxDocId === t.dataset.boxid && x.id === t.dataset.id);
      if (m) startEdit(m);
    }
    if (t.classList.contains("delete-model-btn")) {
      if (!confirm(`Delete "${t.dataset.names}"? This removes the whole shared entry (all its names and its stock count).`)) return;
      await removeModelFromBox(t.dataset.boxid, t.dataset.id);
      showToast("Deleted.", "success");
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
