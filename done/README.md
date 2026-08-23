# Stock Finder

A site to search mobile display stock across your locations (Home, Shop A, Shop B, ...).

- **User page** (`index.html`) — search/filter by device type, brand, series/model/code. Shows stock at every place instantly. No login needed.
- **Admin page** (`admin/`) — staff log in with Firebase (email/password), then add/edit/delete brands, models, and places. Changes are committed straight to your GitHub repo as JSON.
- **Data** lives in plain JSON files under `data/<deviceType>/<brand>.json`.

Because Firebase Auth can't write to GitHub by itself, there's one more moving part: a small serverless function (`api/write.js`) that checks the Firebase login is valid, then makes the actual commit using a GitHub token that's kept secret on the server. This only works on a host that runs backend code, so **this version is set up for Vercel** (GitHub Pages can't run the function; Netlify would need the function rewritten in Netlify's format).

## 1. Push this to GitHub

Create a new **public** GitHub repo and push all these files to it (branch `main`).

## 2. Create a GitHub token for the write function

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Create a token scoped to just this one repo, with **Contents: Read and write** permission.
3. Copy the token — you'll paste it into Vercel in step 5.

## 3. Set up Firebase

1. Go to console.firebase.google.com → Create a project (Google Analytics not needed).
2. Build → Authentication → Get started → enable **Email/Password** sign-in.
3. Authentication → Users → **Add user** for yourself and each staff member (set their email + a password directly — there's no public sign-up page, so only people you add here can log in).
4. Project settings (gear icon) → General → scroll to "Your apps" → click the web icon `</>` → register an app (no hosting needed) → copy the `firebaseConfig` object shown.
5. Project settings → Service accounts → **Generate new private key** → this downloads a JSON file. Keep it safe, you'll need its contents in step 5.

## 4. Fill in the config files

**`app.js`** (user page) — set:
```js
const GITHUB_OWNER = "your-github-username";
const GITHUB_REPO = "your-repo-name";
```

**`admin/firebase-config.js`** — paste in the `firebaseConfig` values from Firebase step 3.4, and the same `GITHUB_OWNER` / `GITHUB_REPO` as above.

## 5. Deploy to Vercel and set secrets

1. Import the repo into Vercel (vercel.com → Add New → Project).
2. Vercel auto-detects `api/write.js` as a serverless function — no extra config needed.
3. In the Vercel project → Settings → Environment Variables, add:
   - `GITHUB_TOKEN` — the token from step 2
   - `GITHUB_OWNER` — your GitHub username
   - `GITHUB_REPO` — your repo name
   - `GITHUB_BRANCH` — `main`
   - `FIREBASE_SERVICE_ACCOUNT_KEY` — the **entire contents** of the JSON file from Firebase step 3.5, pasted as one value
4. Redeploy so the new environment variables take effect.
5. Visit `your-project.vercel.app/admin/`, log in with an account you created in Firebase step 3.3, and you should see the dashboard.

## 6. Using the admin dashboard

- **Places** — add, rename, or remove locations. Currently seeded with Home, Shop A, Shop B; add your other locations here.
- **Add / edit model** — pick a device type and brand (existing ones are suggested as you type, or type a new one to create it), fill in series/model/code, and set a quantity for each place. Saving creates the brand's JSON file if it doesn't exist yet, or updates it.
- **Existing inventory** — browse everything grouped by device type/brand, with Edit and Delete per model, and a "Delete whole brand" option per group.

Every save shows up on the public search page (`index.html`) as soon as GitHub's API reflects it — usually within a few seconds.

## Local preview

Any static file server works for browsing the layout, e.g.:
```
python3 -m http.server 8000
```
The user page and admin dashboard both fetch live from GitHub and (for admin) call the deployed `/api/write` function, so full functionality only works once it's actually deployed on Vercel with the repo pushed.

## Adding a new device type later

1. Create a `data/<newtype>/` folder in the repo (add the first brand file to it, which creates the folder).
2. That's it — both the search page and the admin dashboard discover device types automatically from the folder names in `/data`, no code changes needed.
