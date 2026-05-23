# Deploy budget-app on Render (HTTPS + Plaid OAuth)

This guide deploys **one Render Web Service** (`backend/`) that serves both the **Django API** and the **Vite/React** UI on the same hostname (e.g. `https://financial-app-1-tu0l.onrender.com`). `build.sh` runs `npm run build -w @budget-app/web` and copies `apps/web/dist` into `backend/frontend_dist/` so `/accounts` matches local `localhost:5173`.

An optional separate **Static Site** is still supported if you prefer a split deploy; see section 3.

Use HTTPS URLs everywhere for Plaid (Chase OAuth).

## Project layout

| Piece | Path |
|--------|------|
| Django backend root | `backend/` |
| Django settings | `backend/config/settings.py` (`DJANGO_SETTINGS_MODULE=config.settings`) |
| WSGI | `gunicorn config.wsgi:application` (run from `backend/`) |
| React frontend (Vite) | `apps/web/` |
| Plaid backend app | `backend/plaid_link/` |
| Plaid UI | `apps/web/src/components/PlaidConnectBar.tsx`, `apps/web/src/pages/PlaidOAuthReturn.tsx` |

---

## 1. Create Postgres database

1. In [Render Dashboard](https://dashboard.render.com/) → **New** → **PostgreSQL**.
2. Name it (e.g. `budget-app-db`), choose region/plan.
3. After creation, copy the **Internal Database URL** (for the backend in the same region) or **External** if needed.

---

## 2. Create backend Web Service

1. **New** → **Web Service** → connect your repo.
2. **Root Directory**: `backend`
3. **Runtime**: Python 3
4. **Build Command**: `chmod +x build.sh && ./build.sh` (builds React + `collectstatic` + `migrate`)
5. **Start Command**: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
6. Link the Postgres instance (Render sets `DATABASE_URL` automatically) or paste `DATABASE_URL` manually.

**Required:** add environment variable **`NODE_VERSION`** = `20` (or `22`) on the Web Service. Render only auto-installs Node when this is set; with Root Directory `backend/`, the repo-root `package.json` is not detected automatically.

Set `BUILD_FRONTEND=false` only if you deploy the UI elsewhere.

### Backend environment variables

Set these in the Web Service → **Environment**:

| Variable | Example | Notes |
|----------|---------|--------|
| `DATABASE_URL` | *(from Render Postgres)* | Required in production |
| `DJANGO_SECRET_KEY` | `your-long-random-secret` | Generate a new one; never commit |
| `DEBUG` | `False` | Optional on Render: defaults to **False** when `RENDER=true` (set explicitly if needed) |
| `ALLOWED_HOSTS` | `budget-app-api.onrender.com` | `.onrender.com` is always allowed by settings |
| `CSRF_TRUSTED_ORIGINS` | `https://budget-app-api.onrender.com,https://budget-app-web.onrender.com` | HTTPS, no trailing slash |
| `CORS_ALLOWED_ORIGINS` | *(optional)* | Defaults to `RENDER_EXTERNAL_URL` when React is served from this service |
| `PLAID_CLIENT_ID` | `…` | From Plaid Dashboard |
| `PLAID_SECRET` or `PLAID_PRODUCTION_SECRET` | `…` | Must match `PLAID_ENV` |
| `PLAID_ENV` | `production` | Use `sandbox` only for fake institutions |
| `NODE_VERSION` | `20` | **Required** so `build.sh` can run `npm` (Render Python services) |
| `PLAID_REDIRECT_URI` | `https://<your-app>.onrender.com/plaid/oauth-return` | Same host as the Web Service |
| `PLAID_TOKEN_FERNET_KEY` | *(optional)* | Fernet key for token encryption at rest |

Example block (replace placeholders):

```env
DATABASE_URL=postgres://user:pass@host/dbname
DJANGO_SECRET_KEY=replace-with-50+-char-random-string
DEBUG=False
ALLOWED_HOSTS=budget-app-api.onrender.com
CSRF_TRUSTED_ORIGINS=https://budget-app-api.onrender.com
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_PRODUCTION_SECRET=your_production_secret
PLAID_ENV=production
PLAID_REDIRECT_URI=https://budget-app-api.onrender.com/plaid/oauth-return
```

After the first deploy, open your Web Service URL (e.g. `https://budget-app-api.onrender.com`) — that is the app UI and API.

---

## 3. (Optional) Separate frontend Static Site

1. **New** → **Static Site** → same repo.
2. **Root Directory**: leave empty (repo root `budget-app`) **or** set to repo root containing `package.json`.
3. **Build Command**:

   ```bash
   npm install && npm run build -w @budget-app/web
   ```

4. **Publish Directory**: `apps/web/dist`
5. **Environment** (build-time for Vite):

| Variable | Example |
|----------|---------|
| `VITE_API_URL` | `https://budget-app-api.onrender.com` |
| `VITE_PLAID_REDIRECT_URI` | `https://budget-app-web.onrender.com/plaid/oauth-return` |

Example:

```env
VITE_API_URL=https://budget-app-api.onrender.com
VITE_PLAID_REDIRECT_URI=https://budget-app-web.onrender.com/plaid/oauth-return
```

SPA routing: `apps/web/public/_redirects` sends all paths to `index.html` (required for `/plaid/oauth-return`).

Note the static site URL: `https://budget-app-web.onrender.com`.

---

## 4. Align env vars after deploy

- `PLAID_REDIRECT_URI` — `https://<your-web-service>/plaid/oauth-return`
- If you use a **separate** static site: set `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` to that origin, set `SERVE_REACT_APP=false` on the Web Service, and set `VITE_API_URL` on the static site build.

---

## 5. Plaid Dashboard — allowed redirect URI

1. [Plaid Dashboard](https://dashboard.plaid.com/) → **Developers** → **API**.
2. Under **Allowed redirect URIs**, add **exactly**:

   ```text
   https://budget-app-web.onrender.com/plaid/oauth-return
   ```

   No query string. Path must be `/plaid/oauth-return` (legacy `/transactions` or `/accounts` still work if allowlisted).

3. For **Chase** / live banks: `PLAID_ENV=production`, production secret, OAuth institution registration approved in Plaid.

---

## 6. Test Chase OAuth flow

1. Open your Web Service URL (or static site if split), log in.
2. **Accounts** → **Link a bank** → choose Chase (or your institution).
3. Complete bank OAuth; browser should land on `/plaid/oauth-return?oauth_state_id=…`.
4. Plaid Link should reopen automatically; after success you are sent to **Accounts**.
5. **Import transactions** on the new connection.

Local dev is unchanged: omit `VITE_API_URL`, use `http://localhost:5173`, Plaid sandbox, and allowlist `http://localhost:5173/plaid/oauth-return` if testing OAuth locally.

---

## Troubleshooting

### CSRF failed

- Add your backend and frontend origins to `CSRF_TRUSTED_ORIGINS` with `https://` and **no** trailing slash.
- API routes use JWT; CSRF mainly affects Django admin. If you hit CSRF on admin, ensure you use the backend hostname over HTTPS.

### CORS blocked

- `CORS_ALLOWED_ORIGINS` must be exactly the browser origin (e.g. `https://budget-app-web.onrender.com`), not the API URL.
- Rebuild the static site after changing `VITE_API_URL` so requests go to the correct backend.

### Plaid `redirect_uri` mismatch

- The URL sent at link-token creation must **byte-match** an allowlisted URI (scheme, host, path).
- Set `VITE_PLAID_REDIRECT_URI` and `PLAID_REDIRECT_URI` to the same `https://…/plaid/oauth-return`.
- API error responses may include `redirect_uri_sent` — add that exact string in Plaid Dashboard.

### Static files not loading (admin / 404 on `/static/`)

- Confirm `build.sh` ran `collectstatic` (check build logs).
- `DEBUG=False` enables WhiteNoise; ensure `whitenoise` is installed from `requirements.txt`.

### “React app not built” / empty UI after deploy

- Add **`NODE_VERSION=20`** (or `22`) under Environment → redeploy.
- Build logs must show `Building React frontend` and `Frontend copied to …/frontend_dist`.
- Build Command must be `chmod +x build.sh && ./build.sh` with Root Directory `backend`.
- If the build succeeds but the message persists, check that `apps/web/dist/index.html` exists in build logs (copy step).

### 502 from Gunicorn

- Check **Logs** for import errors or missing env vars.
- Start command must be run from `backend/`: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
- Verify `DATABASE_URL` and migrations completed in build.

### Database migration failure

- Read the build log from `./build.sh`; fix migration conflicts locally with `python manage.py migrate`.
- Ensure Postgres is linked and `DATABASE_URL` is set before build runs.

---

## Local development (unchanged)

```bash
# Backend
cd backend && pip install -r requirements.txt && cp ../.env.example .env
python manage.py migrate && python manage.py runserver

# Frontend (repo root)
npm install && npm run dev -w @budget-app/web
```

Use `backend/.env` for Plaid secrets; optional `apps/web/.env.local` for overrides. Do not commit secrets.

---

## Final deployment checklist

### Postgres
- [ ] Database created and linked to the backend Web Service (`DATABASE_URL` set automatically)

### Backend Web Service (`backend/`)
- [ ] **Root Directory**: `backend`
- [ ] **`NODE_VERSION`** = `20` (or `22`)
- [ ] **Build**: `chmod +x build.sh && ./build.sh`
- [ ] **Start**: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
- [ ] `DJANGO_SECRET_KEY` — unique, not the dev default
- [ ] `DEBUG=False` (or rely on Render’s `RENDER=true` default)
- [ ] `ALLOWED_HOSTS` — your `*.onrender.com` API hostname (`.onrender.com` is always permitted)
- [ ] `CSRF_TRUSTED_ORIGINS` — `https://<api-host>,https://<static-site-host>` (no trailing slashes)
- [ ] Plaid: `PLAID_CLIENT_ID`, `PLAID_ENV`, matching secret, `PLAID_REDIRECT_URI=https://<web-service>/plaid/oauth-return`
- [ ] Build logs show `Frontend copied to backend/frontend_dist`

### Frontend Static Site (optional split deploy)
- [ ] **Build**: `npm install && npm run build -w @budget-app/web`
- [ ] **Publish**: `apps/web/dist`
- [ ] `VITE_API_URL=https://<api-host>` (no trailing slash)
- [ ] `SERVE_REACT_APP=false` on the Web Service

### Plaid Dashboard
- [ ] Allowed redirect URI: `https://<static-site>/plaid/oauth-return` (exact match, no query string)
- [ ] Chase / production OAuth registration approved (for live banks)

### Smoke test
- [ ] Log in on the static site URL (HTTPS)
- [ ] Accounts → Link a bank → complete OAuth → lands on `/plaid/oauth-return` → returns to Accounts
- [ ] Import transactions on the new connection

### Redirect URI behavior (reference)
- The **browser** sends `redirect_uri` on each link-token request (`VITE_PLAID_REDIRECT_URI` or `{origin}/plaid/oauth-return`).
- **`PLAID_REDIRECT_URI`** is used when the client omits `redirect_uri` (CLI, tests). Keep it identical to the frontend value in production.
