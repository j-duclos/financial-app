# Deploy budget-app on Render (HTTPS + Plaid OAuth)

This guide deploys the **Django API** as a Render **Web Service**, the **Vite/React** app as a **Static Site**, and Postgres as a **managed database**. Use HTTPS URLs everywhere for Plaid (Chase OAuth).

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
4. **Build Command**: `chmod +x build.sh && ./build.sh`
5. **Start Command**: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
6. Link the Postgres instance (Render sets `DATABASE_URL` automatically) or paste `DATABASE_URL` manually.

### Backend environment variables

Set these in the Web Service → **Environment**:

| Variable | Example | Notes |
|----------|---------|--------|
| `DATABASE_URL` | *(from Render Postgres)* | Required in production |
| `DJANGO_SECRET_KEY` | `your-long-random-secret` | Generate a new one; never commit |
| `DEBUG` | `False` | Optional on Render: defaults to **False** when `RENDER=true` (set explicitly if needed) |
| `ALLOWED_HOSTS` | `budget-app-api.onrender.com` | `.onrender.com` is always allowed by settings |
| `CSRF_TRUSTED_ORIGINS` | `https://budget-app-api.onrender.com,https://budget-app-web.onrender.com` | HTTPS, no trailing slash |
| `CORS_ALLOWED_ORIGINS` | `https://budget-app-web.onrender.com` | Frontend static site URL only |
| `PLAID_CLIENT_ID` | `…` | From Plaid Dashboard |
| `PLAID_SECRET` or `PLAID_PRODUCTION_SECRET` | `…` | Must match `PLAID_ENV` |
| `PLAID_ENV` | `production` | Use `sandbox` only for fake institutions |
| `PLAID_REDIRECT_URI` | `https://budget-app-web.onrender.com/plaid/oauth-return` | Server default; should match allowlist |
| `PLAID_TOKEN_FERNET_KEY` | *(optional)* | Fernet key for token encryption at rest |

Example block (replace placeholders):

```env
DATABASE_URL=postgres://user:pass@host/dbname
DJANGO_SECRET_KEY=replace-with-50+-char-random-string
DEBUG=False
ALLOWED_HOSTS=budget-app-api.onrender.com
CSRF_TRUSTED_ORIGINS=https://budget-app-api.onrender.com,https://budget-app-web.onrender.com
CORS_ALLOWED_ORIGINS=https://budget-app-web.onrender.com
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_PRODUCTION_SECRET=your_production_secret
PLAID_ENV=production
PLAID_REDIRECT_URI=https://budget-app-web.onrender.com/plaid/oauth-return
```

After the first deploy, note the backend URL: `https://budget-app-api.onrender.com` (your name will differ).

---

## 3. Create frontend Static Site

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

## 4. Align env vars after both URLs exist

Update backend if you used placeholders:

- `CSRF_TRUSTED_ORIGINS` — include both backend and frontend `https://…` URLs
- `CORS_ALLOWED_ORIGINS` — frontend URL only
- `PLAID_REDIRECT_URI` — `https://<frontend>/plaid/oauth-return`

Redeploy backend and **rebuild** the static site when changing `VITE_*` vars.

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

1. Open `https://budget-app-web.onrender.com`, log in.
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
- [ ] **Build**: `chmod +x build.sh && ./build.sh`
- [ ] **Start**: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
- [ ] `DJANGO_SECRET_KEY` — unique, not the dev default
- [ ] `DEBUG=False` (or rely on Render’s `RENDER=true` default)
- [ ] `ALLOWED_HOSTS` — your `*.onrender.com` API hostname (`.onrender.com` is always permitted)
- [ ] `CSRF_TRUSTED_ORIGINS` — `https://<api-host>,https://<static-site-host>` (no trailing slashes)
- [ ] `CORS_ALLOWED_ORIGINS` — `https://<static-site-host>` only (required on Render; build fails if missing)
- [ ] Plaid: `PLAID_CLIENT_ID`, `PLAID_ENV`, matching secret, `PLAID_REDIRECT_URI=https://<static-site>/plaid/oauth-return`

### Frontend Static Site (repo root)
- [ ] **Build**: `npm install && npm run build -w @budget-app/web`
- [ ] **Publish**: `apps/web/dist`
- [ ] `VITE_API_URL=https://<api-host>` (no trailing slash)
- [ ] `VITE_PLAID_REDIRECT_URI=https://<static-site>/plaid/oauth-return` (must match Plaid allowlist and backend env)

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
