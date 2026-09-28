# Install FlowSight on a physical iPhone (Xcode)

Expo-managed app. Native `ios/` is generated on your Mac and is gitignored — do not commit it. This repo uses **npm** workspaces.

**Bundle identifier:** `com.jduclos.flowsight`  
**Home-screen name:** FlowSight  
**API env var:** `EXPO_PUBLIC_API_URL`

## 1. Two different URLs (do not mix these up)

- **API** (`EXPO_PUBLIC_API_URL`) — Django. For production data this is `https://flowsight360.com`. Copy `apps/mobile/.env.render.example` to `.env`.
- **Metro** (`host:8081`) — Debug JavaScript packager on your Mac. A Debug Xcode install **must** reach this host. It is not the API and it is not flowsight360.com.

**Cellular / away from the Mac:** Debug will crash with “Could not connect to the server” on `:8081`. Install **Release** so JS is inside the app. Then the phone only needs the internet for `https://flowsight360.com`.

```bash
cd apps/mobile
# .env already has EXPO_PUBLIC_API_URL=https://flowsight360.com
# Delete FlowSight from the iPhone first (old Debug still looks for Metro).
npm run ios:device:release
```

`--no-bundler` is required. Without it, Expo still starts Metro and the phone keeps trying `:8081`.

Or in Xcode: scheme **FlowSight**, destination your iPhone, configuration **Release**, Run. After install, open the app from the Home Screen — ignore “Waiting on localhost:8081”.

**Home Wi‑Fi Debug** (live reload): same `.env` API, plus Metro (`npx expo start --dev-client --host lan`). Keep that terminal open.

| Client | API (`EXPO_PUBLIC_API_URL`) | Needs Metro? |
|--------|------------------------------|--------------|
| Simulator Debug | localhost Django or Render | Yes (Mac) |
| iPhone Debug on home Wi‑Fi | `https://flowsight360.com` or LAN Django | Yes (Mac `:8081`) |
| iPhone Release / TestFlight | `https://flowsight360.com` | No |

Staging and production **app env** (`EXPO_PUBLIC_APP_ENV`) reject localhost, LAN IPs, and plain HTTP (`constants/env.ts`). Debug + HTTPS Render is allowed.

## 2. Django on the LAN

In a separate terminal:

```bash
cd backend
ALLOWED_HOSTS='*' python3 manage.py runserver 0.0.0.0:8000
```

`ALLOWED_HOSTS='*'` is **local device testing only**. Production hosts come from Render env (`ALLOWED_HOSTS`, CORS, CSRF). Do not copy `*` into production.

Native iOS uses JWT (`Authorization`) against `/api/`. CSRF is skipped for `/api/` (`DisableCSRFForAPIMiddleware`). CORS is a browser concern (web app). If Django returns `DisallowedHost`, the `Host` header is the Mac LAN IP — `ALLOWED_HOSTS='*'` (DEBUG) or that IP in a local-only env file.

## 3. Generate the iOS project (Mac)

From the monorepo root, install JS deps once, then prebuild:

```bash
npm install
cd apps/mobile
cp .env.local.example .env
# Edit EXPO_PUBLIC_API_URL to http://<MAC_LAN_IP>:8000
npx expo prebuild -p ios
cd ios
pod install
open *.xcworkspace
```

Equivalent npm scripts: `npm run prebuild:ios` then open the workspace.

`npx expo prebuild` creates `apps/mobile/ios/` (Xcode project + workspace). Open the **`.xcworkspace`**, not the `.xcodeproj`.

## 4. Alternative: Expo CLI deploy

Same native project as Xcode. `expo run:ios` and `expo run:ios --device` only pick the **destination** (simulator vs plugged-in iPhone). Both must compile.

```bash
cd apps/mobile
npx expo run:ios
npx expo run:ios --device
npm run ios:device:release   # cellular / no Metro
```

Or: `npm run ios` / `npm run ios:device`.

Keep Metro running only for **Debug**. Release embeds the JS bundle.

## 5. Xcode signing (automatic)

No Apple Team ID is stored in this repo. On your Mac:

1. Open `apps/mobile/ios/*.xcworkspace`.
2. Select the **FlowSight** project in the navigator.
3. Select the **FlowSight** target.
4. **Signing & Capabilities**.
5. Enable **Automatically manage signing**.
6. Choose your **Apple Developer Team**.
7. Confirm the bundle identifier is `com.jduclos.flowsight`.

You must be signed into Xcode with an Apple ID (**Xcode → Settings → Accounts**).

A **free / personal** team cannot sign **Associated Domains** or **Push Notifications**. Local `expo run:ios` omits those unless `APPLE_PAID_IOS_CAPABILITIES=1`. After changing that, regenerate native iOS:

```bash
cd apps/mobile
npx expo prebuild -p ios --clean
npx expo run:ios --device
```

Paid Apple Developer Program is required for TestFlight / App Store, push alerts, and Plaid iOS Universal Links. EAS preview/production sets `APPLE_PAID_IOS_CAPABILITIES=1`.

## 6. Run on the iPhone

1. Connect the iPhone with a cable, or use trusted wireless debugging.
2. Trust the Mac on the iPhone if prompted.
3. On the iPhone: **Settings → Privacy & Security → Developer Mode** (enable and restart if iOS asks).
4. In Xcode, pick **any** run destination: your physical iPhone **or** a Simulator. Same scheme (`FlowSight`). Switch destinations in the toolbar; do not use a second project.
5. Resolve signing warnings if the banner appears.
6. Press **Run**.
7. If iOS says the developer is not trusted: **Settings → General → VPN & Device Management** → trust the developer app.
8. Unlock the phone and keep it awake until the install finishes.

First launch of a **Debug** build expects Metro on the Mac. That does not work on cellular. Use **Release** (`npm run ios:device:release`) to use the app away from home against `https://flowsight360.com`.

## 7. Local network checklist

- Mac and iPhone on the **same Wi-Fi**
- Django bound to **`0.0.0.0:8000`**, not `127.0.0.1`
- `EXPO_PUBLIC_API_URL` uses the **Mac LAN IP**, not `localhost`
- macOS Firewall allows Python/Django (or temporarily disable to test)
- iPhone can reach the API (Safari: `http://<MAC_LAN_IP>:8000/api/` or similar)
- Login succeeds
- Dashboard loads server data
- Create/edit a transaction works
- Pull-to-refresh / foreground refresh works

Development iOS Info.plist includes **only** `NSAllowsLocalNetworking` (not `NSAllowsArbitraryLoads`) plus a local-network usage string. Production / staging prebuilds (`EXPO_PUBLIC_APP_ENV=production` or `staging`) omit that ATS exception.

## 8. Production safety

- EAS `preview` and `production` set `EXPO_PUBLIC_API_URL` to the HTTPS Render host in `eas.json`.
- Do not point store builds at a LAN IP.
- Do not commit `.env`, `ios/`, provisioning profiles, or Team IDs.
- Regenerate native iOS from Expo config for store/EAS builds — do not ship a development-prebuild `Info.plist` as production.

## 9. Auth, links, permissions

- JWT access/refresh tokens: **Expo SecureStore** (Keychain on iOS), not AsyncStorage.
- Email verification and password reset use **web** links (`FRONTEND_ORIGIN`), not iOS associated domains. No universal links were added.
- No camera, contacts, location, or microphone permissions. Profile export uses the iOS share sheet only.
- Push (projected low-balance alerts) uses **expo-notifications**. The OS permission prompt is shown only after an in-app explanation, once the household has financial data. Production iOS builds need APNs credentials via EAS (`docs/PROJECTED_FUNDS_ALERTS.md`).

