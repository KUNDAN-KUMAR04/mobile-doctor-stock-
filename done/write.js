// FILE PATH: api/write.js  (inside a folder called "api" at the repo ROOT — NOT inside admin/)
const admin = require("firebase-admin");

// ---- Config from environment variables (set these in Vercel project settings) ----
// FIREBASE_SERVICE_ACCOUNT_KEY  -> full JSON key, as a single-line string
// GITHUB_TOKEN                  -> a GitHub personal access token with "repo" write scope
// GITHUB_OWNER                  -> your GitHub username
// GITHUB_REPO                   -> your repo name
// GITHUB_BRANCH                 -> usually "main"

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
  });
}

const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const ghHeaders = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

function ghUrl(path) {
  return `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
}

async function readFile(path) {
  const res = await fetch(`${ghUrl(path)}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
  if (res.status === 404) return { exists: false, sha: null, data: null };
  if (!res.ok) throw new Error(`GitHub read failed for ${path}: ${res.status}`);
  const json = await res.json();
  const content = Buffer.from(json.content, "base64").toString("utf-8");
  return { exists: true, sha: json.sha, data: JSON.parse(content) };
}

async function writeFile(path, data, sha, message) {
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
    branch: GITHUB_BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(ghUrl(path), { method: "PUT", headers: ghHeaders, body: JSON.stringify(body) });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub write failed for ${path}: ${res.status} ${errText}`);
  }
  return res.json();
}

async function deleteFile(path, sha, message) {
  const res = await fetch(ghUrl(path), {
    method: "DELETE",
    headers: ghHeaders,
    body: JSON.stringify({ message, sha, branch: GITHUB_BRANCH }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub delete failed for ${path}: ${res.status} ${errText}`);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const { idToken, action, payload } = req.body || {};

  // 1. Verify the Firebase login before touching anything.
  let user;
  try {
    user = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    res.status(401).json({ error: "Not logged in or session expired." });
    return;
  }

  try {
    const commitAuthor = user.email || user.uid;

    if (action === "upsertModel") {
      const { deviceType, brand, originalModel, model } = payload;
      const path = `data/${deviceType}/${brand}.json`;
      const file = await readFile(path);
      const fileData = file.exists ? file.data : { brand, deviceType, models: [] };

      const idx = fileData.models.findIndex((m) => m.model === (originalModel || model.model));
      if (idx >= 0) {
        fileData.models[idx] = model;
      } else {
        fileData.models.push(model);
      }

      await writeFile(path, fileData, file.sha, `Update ${brand} ${model.model} (by ${commitAuthor})`);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "deleteModel") {
      const { deviceType, brand, modelName } = payload;
      const path = `data/${deviceType}/${brand}.json`;
      const file = await readFile(path);
      if (!file.exists) throw new Error("Brand file not found.");
      file.data.models = file.data.models.filter((m) => m.model !== modelName);
      await writeFile(path, file.data, file.sha, `Delete ${brand} ${modelName} (by ${commitAuthor})`);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "deleteBrand") {
      const { deviceType, brand } = payload;
      const path = `data/${deviceType}/${brand}.json`;
      const file = await readFile(path);
      if (!file.exists) throw new Error("Brand file not found.");
      await deleteFile(path, file.sha, `Delete brand ${brand} (by ${commitAuthor})`);
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "updatePlaces") {
      const { places } = payload;
      const path = `data/places.json`;
      const file = await readFile(path);
      await writeFile(path, { places }, file.sha, `Update places list (by ${commitAuthor})`);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
