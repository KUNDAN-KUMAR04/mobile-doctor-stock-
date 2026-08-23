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
  try {
    await setDoc(doc(db, "meta", "places"), { places: cleaned });
    places = cleaned;
    renderStockInputs();
    showToast("Places saved.", "success");
  } catch (err) {
    showToast(err.message, "fail");
  }
});

// ---------- Datalists (device type / brand / box suggestions) ----------
function renderDatalists() {
  const models = flatModels();
  const deviceTypes = [...new Set(models.map((m) => m.deviceType))];
  const brands = [...new Set(models.map((m) => m.brand))];
  const boxes = [...new Set(models.map((m) => m.box))];
  document.getElementById("deviceTypeList").innerHTML = deviceTypes.map((d) => `<option value="${d}">`).join("");
  document.getElementById("brandList").innerHTML = brands.map((b) => `<option value="${b}">`).join("");
  document.getElementById("boxList").innerHTML = boxes.map((b) => `<option value="${b}">`).join("");
}

// ---------- Model form ----------
function renderStockInputs(prefill = {}) {
  const el = document.getElementById("stock-inputs");
  el.innerHTML = places
    .map((p) => {
      const entry = prefill[p] || { qty: 0 };
      return `<div class="stock-input-row">
        <span class="place-name">${p}</span>
        <input type="number" class="search-input stock-qty-input" data-place="${p}" value="${entry.qty}" min="0" />
      </div>`;
    })
    .join("");
}

document.getElementById("model-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const deviceType = document.getElementById("f-deviceType").value.trim();
  const brand = document.getElementById("f-brand").value.trim();
  const box = document.getElementById("f-box").value.trim();
  const series = document.getElementById("f-series").value.trim();
  const modelName = document.getElementById("f-model").value.trim();
  const displayCode = document.getElementById("f-code").value.trim();

  if (!deviceType || !brand || !box || !modelName) return;

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
  document.getElementById("form-title").textContent = "Add / edit model";
  document.getElementById("cancel-edit-btn").style.display = "none";
  renderStockInputs();
}

function startEdit(m) {
  editing = { deviceType: m.deviceType, brand: m.brand, box: m.box, model: m.model };
  document.getElementById("f-deviceType").value = m.deviceType;
  document.getElementById("f-brand").value = m.brand;
  document.getElementById("f-box").value = m.box;
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

// ---------- Existing inventory list ----------
function renderInventoryList() {
  const el = document.getElementById("inventory-list");
  const models = flatModels();
  if (models.length === 0) {
    el.innerHTML = `<div class="status-line">No models yet — add one above.</div>`;
    return;
  }

  const groups = {};
  for (const m of models) {
    const key = `${m.deviceType} / ${m.brand}`;
    groups[key] = groups[key] || [];
    groups[key].push(m);
  }

  el.innerHTML = Object.entries(groups)
    .map(([groupKey, ms]) => {
      const rows = ms
        .map((m) => {
          const total = (m.stock || []).reduce((s, x) => s + (Number(x.qty) || 0), 0);
          return `<div class="model-list-row">
            <span>${m.model} <span style="color: var(--text-muted);">(${m.displayCode || "no code"}) — ${total} in stock · box: ${m.box}</span></span>
            <span class="actions">
              <button type="button" class="btn-secondary edit-model-btn" data-device="${m.deviceType}" data-brand="${m.brand}" data-box="${m.box}" data-model="${m.model}">Edit</button>
              <button type="button" class="btn-danger delete-model-btn" data-device="${m.deviceType}" data-brand="${m.brand}" data-box="${m.box}" data-model="${m.model}">Delete</button>
            </span>
          </div>`;
        })
        .join("");
      return `<div style="margin-bottom: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <strong style="font-size: 13px;">${groupKey}</strong>
          <button type="button" class="btn-danger delete-brand-btn" data-device="${ms[0].deviceType}" data-brand="${ms[0].brand}">Delete whole brand</button>
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
