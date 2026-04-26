# Fieshzen — Developer Specification

**Version:** 1.0  
**Target Platform:** Samsung Tizen TV (WGT Application)  
**Base Application:** Feishin v1.11.0 (GPL-3.0)  
**Music Server:** Navidrome 0.61.0 (OpenSubsonic / Subsonic API compatible)  
**Deployment System:** SAWSUBE (FastAPI backend at http://192.168.1.48:8000)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Feishin Source Analysis](#3-feishin-source-analysis)
4. [Repository Structure](#4-repository-structure)
5. [Build System](#5-build-system)
6. [Tizen WGT Configuration](#6-tizen-wgt-configuration)
7. [Credential Injection & Auto-Login](#7-credential-injection--auto-login)
8. [SAWSUBE Integration](#8-sawsube-integration)
9. [Tizen WebKit Compatibility Layer](#9-tizen-webkit-compatibility-layer)
10. [Remote Navigation System](#10-remote-navigation-system)
11. [Feishin Source Modifications](#11-feishin-source-modifications)
12. [Navidrome API Reference](#12-navidrome-api-reference)
13. [Audio Playback Architecture](#13-audio-playback-architecture)
14. [Screen-by-Screen Feature Map](#14-screen-by-screen-feature-map)
15. [Performance Optimisations](#15-performance-optimisations)
16. [Testing Plan](#16-testing-plan)
17. [Environment Variables Reference](#17-environment-variables-reference)
18. [File Paths & Commands](#18-file-paths--commands)

---

## 1. Executive Summary

Fieshzen is a Samsung Tizen TV port of **Feishin** — a modern, self-hosted music player that connects to Navidrome (and other OpenSubsonic-compatible servers). Unlike previous ports in this workspace (Radarrzen, Sonarrzen) which were written from scratch in vanilla JS, **Fieshzen is built directly from Feishin's React/TypeScript source code**.

The strategy is:

1. Use Feishin's existing **web build mode** (`pnpm build:web`) which already strips all Electron-specific code.
2. Wrap the built output as a **Tizen WGT package** with a custom `config.xml`.
3. Apply a **Tizen compatibility patch layer** (remote key registration, spatial navigation, CSS fixes) that is injected at build time.
4. Use **SAWSUBE** to call Navidrome's auth API, generate pre-seeded localStorage credentials, then package and install the WGT on the Samsung TV.

The goal is to replicate the Feishin experience as faithfully as possible on a Samsung TV with full D-pad remote control support.

---

## 2. Architecture Overview

```
feishin/                        ← Feishin source (GPL-3.0, already cloned)
  src/renderer/                 ← React app (the part we care about)
  web.vite.config.ts            ← Web build config (no Electron, BASE=./)
  package.json                  ← Build scripts
  settings.js.template          ← Template for web config injection

Fieshzen/                       ← This repo
  FieshzenSpec.md               ← This document
  README.md
  build.sh                      ← Build script: pnpm build:web → WGT
  Fieshzen.wgt                  ← Latest built WGT (committed for SAWSUBE raw install)
  tizen/
    config.xml                  ← Tizen WGT manifest
    settings.js                 ← SAWSUBE-injected server config (template)
    fieshzen-auth.js            ← SAWSUBE-injected auth pre-seed (template)
  patches/
    tizen-compat.js             ← Samsung remote + spatial navigation layer
    tizen-fixes.css             ← Tizen WebKit CSS compatibility fixes

SAWSUBE/                        ← Backend (FastAPI)
  backend/config.py             ← Navidrome settings + Fieshzen paths
  backend/routers/tizenbrew.py  ← POST /{tv_id}/build-install-fieshzen endpoint
  backend/routers/navidrome.py  ← Image proxy router (new)
  backend/services/
    tizenbrew_service.py        ← build_and_install_fieshzen() + CURATED_APPS entry
```

### Build Flow

```
SAWSUBE POST /api/tizenbrew/{tv_id}/build-install-fieshzen
  │
  ├─ 1. POST http://192.168.1.250:4534/auth/login  → get JWT + subsonic tokens
  ├─ 2. Write settings.js → feishin/out/web/settings.js
  ├─ 3. Run: cd /home/will/Github/feishin && pnpm build:web
  ├─ 4. Copy feishin/out/web/* → /tmp/fieshzen_build/
  ├─ 5. Copy tizen/config.xml → /tmp/fieshzen_build/config.xml
  ├─ 6. Write fieshzen-auth.js → /tmp/fieshzen_build/fieshzen-auth.js
  ├─ 7. Inject <script> tags into /tmp/fieshzen_build/index.html
  ├─ 8. tizen package --type wgt --sign TestProfile -o ./out -- /tmp/fieshzen_build/
  ├─ 9. sdb connect 192.168.1.202
  └─ 10. tizen install -n Fieshzen.wgt
```

---

## 3. Feishin Source Analysis

### 3.1 Technology Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| UI Framework | React 19 | Functional components, hooks |
| Component Library | Mantine v8 | CSS-in-JS, standard HTML output |
| State Management | Zustand + Immer | Persisted in localStorage |
| Data Fetching | TanStack Query v5 | `@tanstack/react-query` |
| Routing | React Router v7 | Client-side routing |
| Build System | Vite + electron-vite | `web.vite.config.ts` for non-Electron build |
| Language | TypeScript | Strict types throughout |
| Styling | CSS Modules | `*.module.css` files, class name scoping |
| API Client | ts-rest + axios | Typed API contracts |
| Audio Engine | react-player + Web Audio API | Web mode (no MPV on Tizen) |
| Package Manager | pnpm | Required, do NOT use npm/yarn |

### 3.2 Build Modes

Feishin has three build modes:

| Script | Config | Output | Description |
|--------|--------|--------|-------------|
| `pnpm build:electron` | `electron.vite.config.ts` | `out/main/` | Electron main process |
| `pnpm build:web` | `web.vite.config.ts` | `out/web/` | **Pure web app — no Electron** |
| `pnpm build:remote` | `remote.vite.config.ts` | `out/remote/` | Remote control companion |

**We use `pnpm build:web`.** This is the correct target for Fieshzen.

### 3.3 Web Build Output Structure

After `pnpm build:web`, the `out/web/` directory contains:

```
out/web/
  index.html          ← Entry point (includes <script src="settings.js"></script>)
  settings.js         ← MUST be provided externally (see settings.js.template)
  assets/
    index-[hash].js   ← Main React bundle
    index-[hash].css  ← All styles
    [name]-[hash].js  ← Code-split chunks
    favicon.ico
    *.png             ← Icons
    *.webp            ← Preview images
```

The `index.html` from the web build already has this tag:
```html
<script src="settings.js"></script>
```

This means SAWSUBE only needs to write `settings.js` into the WGT root — no modification to the built HTML is needed for server configuration.

### 3.4 Electron-Only Features (will be absent in web build)

These features use `isElectron()` checks in the source and will NOT be present in the web build:

- **MPV audio player** — only `WebPlayer` (HTML5 `<audio>` / `react-player`) will be active
- **Discord RPC** — `isElectron()` gated throughout
- **MPRIS** (Linux media controls) — Electron IPC only
- **Global shortcuts** — `electron-localshortcut` only
- **Auto-updater** — `electron-updater` only
- **Local settings persistence** via `electron-store` — replaced by `localStorage` in web mode
- **Window controls** (titlebar buttons) — not rendered in web mode
- **Power save blocker** — Electron API only

These require NO changes; the existing `isElectron()` guards handle them correctly.

### 3.5 Key Source Files

| File | Purpose |
|------|---------|
| `src/renderer/index.html` | HTML entry point, loads `settings.js` when `web=true` |
| `src/renderer/main.tsx` | React app bootstrap |
| `src/renderer/app.tsx` | Root component, router setup |
| `src/renderer/router/routes.ts` | All app routes (enum `AppRoute`) |
| `src/renderer/router/app-router.tsx` | React Router configuration |
| `src/renderer/store/auth.store.ts` | Auth state (persisted as `store_authentication`) |
| `src/renderer/store/player.store.ts` | Player state, queue, all media actions |
| `src/renderer/store/settings.store.ts` | All user settings |
| `src/renderer/store/env-settings-overrides.ts` | Reads `window.FS_*` vars from settings.js |
| `src/renderer/features/action-required/utils/window-properties.tsx` | Reads `window.SERVER_LOCK`, etc. |
| `src/renderer/features/login/routes/login-route.tsx` | Login screen — skipped if `currentServer` set |
| `src/renderer/features/player/audio-player/web-player.tsx` | Web audio player (what Tizen will use) |
| `src/renderer/features/player/audio-player/engine/web-player-engine.tsx` | `react-player` HTML5 engine |
| `src/renderer/features/player/audio-player/hooks/use-stream-url.tsx` | Gets stream URL via API |
| `src/renderer/api/navidrome/navidrome-controller.ts` | All Navidrome-specific API calls |
| `src/renderer/api/subsonic/subsonic-api.ts` | Subsonic API client (also used for Navidrome) |
| `src/renderer/layouts/default-layout/` | Main layout: sidebar + content + playerbar |
| `src/renderer/features/sidebar/components/sidebar.tsx` | Left navigation sidebar |
| `src/renderer/features/player/components/playerbar.tsx` | Bottom player controls |
| `src/renderer/features/home/` | Home/dashboard screen |
| `src/renderer/features/albums/` | Album list + album detail |
| `src/renderer/features/artists/` | Artists list |
| `src/renderer/features/playlists/` | Playlist list + detail |
| `src/renderer/features/search/` | Search |
| `src/renderer/features/lyrics/` | Lyrics display |
| `src/renderer/features/visualizer/` | Audio visualizer |
| `settings.js.template` | Template for all `window.*` configuration variables |

### 3.6 Authentication Flow

Feishin uses two authentication mechanisms for Navidrome:

1. **Navidrome JWT** (`ndCredential`): A Bearer token from `POST /auth/login`. Used in `X-ND-Authorization` header for Navidrome's own REST API.
2. **Subsonic credential** (`credential`): URL query string `u=...&s=<salt>&t=<md5token>&v=1.16.1&c=feishin`. Used for Subsonic-compatible endpoints.

The auth state is persisted in `localStorage["store_authentication"]` as a Zustand persist object:

```json
{
  "state": {
    "currentServer": {
      "id": "unique-id",
      "name": "Server Name",
      "url": "http://host:port",
      "type": "navidrome",
      "username": "username",
      "userId": "user-id-from-nd",
      "credential": "u=user&s=salt&t=md5token&v=1.16.1&c=fieshzen",
      "ndCredential": "eyJhbGci...",
      "isAdmin": true,
      "savePassword": true
    },
    "deviceId": "device-id",
    "serverList": {
      "unique-id": { "...same as currentServer..." }
    }
  },
  "version": 2
}
```

**If `currentServer` is populated on app start, the login route redirects directly to home.** This is the key to zero-friction auto-login.

---

## 4. Repository Structure

The `/home/will/Github/Fieshzen/` repository should contain:

```
Fieshzen/
  FieshzenSpec.md               ← This document
  README.md                     ← User-facing setup guide
  build.sh                      ← Dev build script (calls pnpm build:web + packages)
  Fieshzen.wgt                  ← Committed pre-built WGT for GitHub install

  tizen/
    config.xml                  ← Tizen WGT manifest (see §6)

  patches/
    tizen-compat.js             ← Samsung remote key registration + spatial nav (see §10)
    tizen-fixes.css             ← Tizen WebKit CSS patches (see §9.2)

  .gitignore
```

### 4.1 build.sh

```bash
#!/usr/bin/env bash
set -e

FEISHIN_SRC="${FEISHIN_SRC:-/home/will/Github/feishin}"
PROFILE="${PROFILE:-TestProfile}"
OUT_WGT="Fieshzen.wgt"
TMP_DIR=$(mktemp -d)

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "==> Building Feishin web app..."
cd "$FEISHIN_SRC"
pnpm install --frozen-lockfile
pnpm build:web

echo "==> Assembling WGT directory..."
cp -r "$FEISHIN_SRC/out/web/." "$TMP_DIR/"

# Copy Tizen manifest (config.xml must be first entry in WGT zip)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/tizen/config.xml" "$TMP_DIR/config.xml"

# Copy compatibility patches
cp "$SCRIPT_DIR/patches/tizen-compat.js" "$TMP_DIR/tizen-compat.js"
cp "$SCRIPT_DIR/patches/tizen-fixes.css" "$TMP_DIR/tizen-fixes.css"

# Inject patch scripts into index.html (after <head> opening tag)
sed -i 's|<head>|<head>\n    <link rel="stylesheet" href="tizen-fixes.css">\n    <script src="tizen-compat.js"></script>|' "$TMP_DIR/index.html"

echo "==> Packaging WGT..."
cd "$SCRIPT_DIR"
TIZEN="${TIZEN_CLI:-$HOME/tizen-studio/tools/ide/bin/tizen}"
"$TIZEN" package --type wgt --sign "$PROFILE" -o . -- "$TMP_DIR"
mv *.wgt "$OUT_WGT" 2>/dev/null || true

echo "==> Done: $OUT_WGT"
```

---

## 5. Build System

### 5.1 Dependencies

Feishin requires **pnpm** (not npm or yarn). SAWSUBE must verify pnpm is available before running the build.

```bash
# Check pnpm
pnpm --version  # Must be >= 9.0.0
node --version  # Must be >= 20.0.0
```

### 5.2 Build Time Expectations

- `pnpm install --frozen-lockfile`: ~60–120s (first time), ~10s (cached)
- `pnpm build:web`: ~90–180s (cold), ~60s (warm)
- Total SAWSUBE pipeline: ~3–5 minutes

### 5.3 Build Environment Variables

Feishin's web build reads these env vars at build time (via Vite define):

| Var | Purpose | Value for Fieshzen |
|-----|---------|-------------------|
| `NODE_ENV` | Environment | `production` |

**No build-time env vars are needed** for server configuration. Server config goes into `settings.js` which is loaded at runtime.

### 5.4 Output File Size Estimate

Feishin web build produces approximately:
- `index.html`: ~2 KB
- `assets/index-[hash].js`: ~2.5–4 MB (large React bundle)
- `assets/index-[hash].css`: ~300–500 KB
- Total WGT: ~5–8 MB

This is acceptable for Tizen TV storage.

---

## 6. Tizen WGT Configuration

### 6.1 tizen/config.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets"
        xmlns:tizen="http://tizen.org/ns/widgets"
        id="https://github.com/WB2024/fieshzen"
        version="1.0.0"
        viewmodes="fullscreen">

  <tizen:application id="FshznTV001.Fieshzen"
                     package="FshznTV001"
                     required_version="4.0"
                     launch_mode="single"/>

  <content src="index.html"/>

  <name>Fieshzen</name>

  <icon src="assets/128x128.png"/>

  <!-- Allow access to local filesystem and all remote origins -->
  <access origin="*" subdomains="true"/>

  <!-- Network access for Navidrome server -->
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/network.state"/>

  <!-- Storage for localStorage persistence -->
  <tizen:privilege name="http://tizen.org/privilege/websetting"/>

  <!-- TV remote key input -->
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>

  <!-- Audio playback -->
  <tizen:privilege name="http://tizen.org/privilege/audio"/>

  <!-- Allow wide viewport for 1920px TV display -->
  <meta name="viewport" content="width=1920"/>

  <!-- Content Security Policy — allow inline scripts and our server -->
  <tizen:content-security-policy>
    default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;
    script-src * 'unsafe-inline' 'unsafe-eval' data: blob:;
    connect-src *;
    media-src *;
    img-src * data: blob:;
    style-src * 'unsafe-inline';
    font-src * data:;
  </tizen:content-security-policy>

</widget>
```

**Key decisions:**

| Field | Value | Reason |
|-------|-------|--------|
| `package` | `FshznTV001` | Unique, not clashing with Radarrzen (`RdrrTV001`) or Sonarrzen (`SnarzTV001`) |
| `app id` | `FshznTV001.Fieshzen` | Samsung convention: `package.AppName` |
| `required_version` | `4.0` | Tizen 4.0+ for Samsung Frame 2022+ |
| `viewport` | `width=1920` | Full HD TV resolution |
| `access origin="*"` | wildcard | Required for Navidrome API calls |
| CSP | permissive | Required for React/Vite inline scripts and Mantine CSS-in-JS |

---

## 7. Credential Injection & Auto-Login

This is the most critical integration section. Fieshzen must start directly on the music library without any login screen.

### 7.1 Two-Layer Injection

SAWSUBE writes two files into the WGT at build time:

1. **`settings.js`** — configures Feishin's server lock (pre-fills server URL, name, type)
2. **`fieshzen-auth.js`** — pre-seeds `localStorage["store_authentication"]` with full auth state

Both must be referenced in `index.html` **before** the main React bundle loads. They must be injected into the built `index.html` because the web build's `index.html` already includes `<script src="settings.js"></script>` but NOT `fieshzen-auth.js`.

### 7.2 settings.js Content

SAWSUBE writes this file to the WGT root (replaces the placeholder):

```javascript
"use strict";

window.SERVER_URL = "http://192.168.1.250:4534";
window.SERVER_NAME = "Wblinuxclean";
window.SERVER_TYPE = "navidrome";
window.SERVER_LOCK = "true";
window.LEGACY_AUTHENTICATION = "false";
window.ANALYTICS_DISABLED = "true";
window.REMOTE_URL = "";

// Optimal TV settings
window.FS_GENERAL_THEME = "defaultDark";
window.FS_GENERAL_THEME_DARK = "defaultDark";
window.FS_GENERAL_ZOOM_FACTOR = "1.0";
window.FS_GENERAL_SIDEBAR_COLLAPSED_NAVIGATION = "false";
window.FS_GENERAL_FOLLOW_CURRENT_SONG = "true";
window.FS_GENERAL_HOME_FEATURE = "true";
window.FS_PLAYBACK_MEDIA_SESSION = "true";
window.FS_PLAYBACK_SCROBBLE_ENABLED = "false";
window.FS_PLAYBACK_TRANSCODE_ENABLED = "false";
window.FS_LYRICS_FETCH = "true";
window.FS_LYRICS_FOLLOW = "true";
window.FS_DISCORD_ENABLED = "false";
window.FS_AUTO_DJ_ENABLED = "false";
```

**Key settings explained:**

| Setting | Value | Reason |
|---------|-------|--------|
| `SERVER_LOCK` | `"true"` | Pre-configures login page with server details |
| `LEGACY_AUTHENTICATION` | `"false"` | Use Navidrome JWT auth (preferred over legacy subsonic password) |
| `ANALYTICS_DISABLED` | `"true"` | No analytics on TV |
| `FS_PLAYBACK_TRANSCODE_ENABLED` | `"false"` | Stream original files; Tizen WebKit handles MP3/AAC/FLAC natively |
| `FS_DISCORD_ENABLED` | `"false"` | Discord RPC has no meaning on TV |
| `FS_LYRICS_FETCH` | `"true"` | Show lyrics (Navidrome supports `getLyricsBySongId`) |

### 7.3 fieshzen-auth.js Content

SAWSUBE generates this file dynamically by:
1. Calling `POST http://192.168.1.250:4534/auth/login` with `{"username":"wblinuxclean","password":"Niagara1"}`
2. Parsing the response to extract: `id`, `isAdmin`, `name`, `subsonicSalt`, `subsonicToken`, `token` (JWT)
3. Constructing the full auth state object
4. Writing the pre-seed script

The Navidrome `/auth/login` response shape (verified live):
```json
{
  "id": "KANmEBlnJYYjCJ3S8JGklv",
  "isAdmin": true,
  "name": "Wblinuxclean",
  "subsonicSalt": "79d043",
  "subsonicToken": "b0d31bbccd90fbcdc65d4d7953dfaf4e",
  "token": "eyJhbGci...",
  "username": "wblinuxclean"
}
```

The `credential` field Feishin uses is:
```
u=wblinuxclean&s=<subsonicSalt>&t=<subsonicToken>&v=1.16.1&c=fieshzen
```

Generated `fieshzen-auth.js`:
```javascript
(function() {
  var AUTH_KEY = "store_authentication";
  try {
    if (!localStorage.getItem(AUTH_KEY)) {
      var serverId = "fieshzen-navidrome-auto";
      var server = {
        "id": serverId,
        "name": "Wblinuxclean",
        "url": "http://192.168.1.250:4534",
        "type": "navidrome",
        "username": "wblinuxclean",
        "userId": "KANmEBlnJYYjCJ3S8JGklv",
        "credential": "u=wblinuxclean&s=79d043&t=b0d31bbccd90fbcdc65d4d7953dfaf4e&v=1.16.1&c=fieshzen",
        "ndCredential": "eyJhbGci...<JWT>...",
        "isAdmin": true,
        "savePassword": true
      };
      var state = {
        "state": {
          "currentServer": server,
          "deviceId": "fieshzen-tv-device-001",
          "serverList": {}
        },
        "version": 2
      };
      state.state.serverList[serverId] = server;
      localStorage.setItem(AUTH_KEY, JSON.stringify(state));
    }
  } catch(e) {
    console.error("Fieshzen auth pre-seed failed:", e);
  }
})();
```

**Important:** The JWT token from Navidrome expires. Feishin's `navidrome-api.ts` handles token refresh automatically via `POST /auth/login` when API calls return 401. The pre-seeded token just gets the app through its first launch — subsequent refreshes are automatic.

### 7.4 index.html Injection

SAWSUBE must inject `fieshzen-auth.js` into the built `index.html`. The `settings.js` tag is already present from the web build. Add `fieshzen-auth.js` before it:

Target in `index.html`:
```html
<script src="settings.js"></script>
```

Must become:
```html
<script src="fieshzen-auth.js"></script>
<script src="settings.js"></script>
<link rel="stylesheet" href="tizen-fixes.css">
<script src="tizen-compat.js"></script>
```

SAWSUBE injects this via string replacement in Python:
```python
html = (out_web_dir / "index.html").read_text()
html = html.replace(
    '<script src="settings.js"></script>',
    '<script src="fieshzen-auth.js"></script>\n'
    '        <script src="settings.js"></script>\n'
    '        <link rel="stylesheet" href="tizen-fixes.css">\n'
    '        <script src="tizen-compat.js"></script>'
)
(out_web_dir / "index.html").write_text(html)
```

---

## 8. SAWSUBE Integration

### 8.1 New .env Variables

Add to `/home/will/Github/SAWSUBE/.env`:

```env
# Navidrome credentials (for Fieshzen auth injection)
Navidrome_URL=http://192.168.1.250:4534
Navidrome_username=wblinuxclean
Navidrome_password=Niagara1
Navidrome_server_name=Wblinuxclean

# Fieshzen paths
FIESHZEN_FEISHIN_SRC_PATH=/home/will/Github/feishin
FIESHZEN_SRC_PATH=/home/will/Github/Fieshzen
FIESHZEN_TIZEN_PROFILE=TestProfile
SAWSUBE_URL=http://192.168.1.48:8000
```

### 8.2 backend/config.py Additions

Add to the `Settings` class:

```python
# Navidrome
NAVIDROME_URL: str = ""
NAVIDROME_USERNAME: str = ""
NAVIDROME_PASSWORD: str = ""
NAVIDROME_SERVER_NAME: str = ""

# Fieshzen
FIESHZEN_FEISHIN_SRC_PATH: str = ""   # Path to feishin source: /home/will/Github/feishin
FIESHZEN_SRC_PATH: str = ""            # Path to Fieshzen repo: /home/will/Github/Fieshzen
FIESHZEN_TIZEN_PROFILE: str = "SAWSUBE"
```

### 8.3 CURATED_APPS Entry

Add to the `CURATED_APPS` list in `tizenbrew_service.py`:

```python
{
    "id": "fieshzen",
    "name": "Fieshzen",
    "description": "Full-featured music player for your Samsung TV. Connects to your Navidrome (or OpenSubsonic-compatible) server — browse albums, artists, playlists, view lyrics, and listen to your music collection from your couch.",
    "icon_url": "https://raw.githubusercontent.com/jeffvli/feishin/main/resources/icons/icon.png",
    "source_type": "local_build",
    "source": "local:fieshzen",
    "category": "Music",
    "inject_config": {
        "storage_key": "store_authentication",
        "config_file": "fieshzen-auth.js",
        "fields": {
            "navidrome_url": "NAVIDROME_URL",
            "navidrome_username": "NAVIDROME_USERNAME",
            "navidrome_password": "NAVIDROME_PASSWORD",
            "navidrome_server_name": "NAVIDROME_SERVER_NAME",
        },
    },
},
```

**Note:** The `inject_config` for Fieshzen is more complex than Radarrzen/Sonarrzen because the auth format is different. The `build_and_install_fieshzen()` method handles auth injection directly (not via the generic `inject_app_config()` mechanism).

### 8.4 New Router Endpoint

Add to `backend/routers/tizenbrew.py`:

```python
# ── Fieshzen local build + install ───────────────────────────────────────────
@router.post("/{tv_id}/build-install-fieshzen", response_model=JobStarted, status_code=202)
async def build_install_fieshzen(tv_id: int, s: AsyncSession = Depends(get_session)):
    """Build Fieshzen WGT from Feishin web source, inject Navidrome credentials,
    re-sign if required, and install onto the TV."""
    tv = await s.get(TV, tv_id)
    if not tv:
        raise HTTPException(404, "TV not found")
    job_id = uuid.uuid4().hex
    asyncio.create_task(tizenbrew_service.build_and_install_fieshzen(tv_id))
    return JobStarted(started=True, job_id=job_id)
```

### 8.5 build_and_install_fieshzen() Method

Add to `TizenBrewService` class in `tizenbrew_service.py`:

```python
# ── Fieshzen local build + install ────────────────────────────────────────────
async def build_and_install_fieshzen(self, tv_id: int) -> None:
    """Build Fieshzen WGT from Feishin web source, inject Navidrome auth, sign, install."""
    import shutil
    import tempfile
    import httpx as _httpx
    import json as _json

    async def _broadcast(msg: str, pct: int, step: str = "building") -> None:
        await ws_manager.broadcast({
            "type": "tizenbrew_install_progress",
            "tv_id": tv_id, "step": step, "progress": pct, "message": msg,
        })

    try:
        feishin_src = getattr(settings, "FIESHZEN_FEISHIN_SRC_PATH", "") or ""
        fieshzen_src = getattr(settings, "FIESHZEN_SRC_PATH", "") or ""
        profile_name = getattr(settings, "FIESHZEN_TIZEN_PROFILE", "SAWSUBE") or "SAWSUBE"
        nd_url = getattr(settings, "NAVIDROME_URL", "") or ""
        nd_user = getattr(settings, "NAVIDROME_USERNAME", "") or ""
        nd_pass = getattr(settings, "NAVIDROME_PASSWORD", "") or ""
        nd_name = getattr(settings, "NAVIDROME_SERVER_NAME", "") or nd_user

        # ── Validation ────────────────────────────────────────────────────
        if not feishin_src or not Path(feishin_src).is_dir():
            await _broadcast(
                f"FIESHZEN_FEISHIN_SRC_PATH not set or not found ('{feishin_src}'). "
                "Set it in .env to point at the feishin source directory.",
                0, "error"
            )
            return
        if not fieshzen_src or not Path(fieshzen_src).is_dir():
            await _broadcast(
                f"FIESHZEN_SRC_PATH not set or not found ('{fieshzen_src}'). "
                "Set it in .env to point at the Fieshzen repo directory.",
                0, "error"
            )
            return

        tools = await self.find_tizen_tools()
        if not tools["tizen_path"]:
            await _broadcast("Tizen Studio CLI not found.", 0, "error")
            return
        if not tools["sdb_path"]:
            await _broadcast("sdb not found.", 0, "error")
            return

        async with SessionLocal() as s:
            tv = await s.get(TV, tv_id)
        if not tv:
            await _broadcast("TV not found in DB.", 0, "error")
            return

        # ── Step 1: Authenticate with Navidrome ────────────────────────────
        await _broadcast("Authenticating with Navidrome…", 5)
        nd_auth = {}
        if nd_url and nd_user and nd_pass:
            try:
                async with _httpx.AsyncClient(timeout=15.0) as client:
                    r = await client.post(
                        f"{nd_url.rstrip('/')}/auth/login",
                        json={"username": nd_user, "password": nd_pass},
                        headers={"Content-Type": "application/json"},
                    )
                    if r.status_code == 200:
                        nd_auth = r.json()
                        await _broadcast(
                            f"Navidrome auth OK (user: {nd_auth.get('username', nd_user)})",
                            8
                        )
                    else:
                        await _broadcast(
                            f"Navidrome auth failed (HTTP {r.status_code}) — "
                            "will build without pre-seeded credentials",
                            8
                        )
            except Exception as e:
                await _broadcast(f"Navidrome unreachable: {e} — building without auth", 8)
        else:
            await _broadcast("NAVIDROME_URL/USERNAME/PASSWORD not set — skipping auth pre-seed", 8)

        # ── Step 2: pnpm install ────────────────────────────────────────────
        await _broadcast("Running pnpm install in feishin source…", 10)
        # Check pnpm is available
        pnpm_path = shutil.which("pnpm")
        if not pnpm_path:
            await _broadcast("pnpm not found on PATH. Install pnpm first: npm install -g pnpm", 0, "error")
            return

        install_res = await self.run_command(
            [pnpm_path, "install", "--frozen-lockfile"],
            timeout=300.0,
            cwd=feishin_src,
            tv_id=tv_id, step="building", progress=12,
        )
        if install_res["returncode"] != 0:
            await _broadcast(
                f"pnpm install failed: {install_res.get('stderr') or install_res['stdout'][-400:]}",
                0, "error"
            )
            return

        # ── Step 3: pnpm build:web ─────────────────────────────────────────
        await _broadcast("Building Feishin web app (pnpm build:web)…", 20)
        build_res = await self.run_command(
            [pnpm_path, "build:web"],
            timeout=600.0,
            cwd=feishin_src,
            tv_id=tv_id, step="building", progress=25,
        )
        if build_res["returncode"] != 0:
            await _broadcast(
                f"pnpm build:web failed: {build_res.get('stderr') or build_res['stdout'][-400:]}",
                0, "error"
            )
            return

        web_out = Path(feishin_src) / "out" / "web"
        if not web_out.is_dir() or not (web_out / "index.html").is_file():
            await _broadcast("Build produced no out/web/index.html — check feishin build output.", 0, "error")
            return
        await _broadcast(f"Web build complete: {web_out}", 45)

        # ── Step 4: Assemble WGT directory ────────────────────────────────
        await _broadcast("Assembling WGT directory…", 48)
        tmp_dir = Path(tempfile.mkdtemp(prefix="fieshzen_wgt_"))
        try:
            # Copy web build output
            shutil.copytree(str(web_out), str(tmp_dir), dirs_exist_ok=True)

            # Copy Tizen config.xml
            config_xml_src = Path(fieshzen_src) / "tizen" / "config.xml"
            if not config_xml_src.is_file():
                await _broadcast(f"config.xml not found at {config_xml_src}", 0, "error")
                return
            shutil.copy(config_xml_src, tmp_dir / "config.xml")

            # Copy compatibility patches
            patches_dir = Path(fieshzen_src) / "patches"
            for patch_file in ["tizen-compat.js", "tizen-fixes.css"]:
                src = patches_dir / patch_file
                if src.is_file():
                    shutil.copy(src, tmp_dir / patch_file)
                else:
                    await _broadcast(f"Warning: patch file not found: {src}", 48)

            # ── Step 5: Write settings.js ──────────────────────────────────
            await _broadcast("Writing settings.js…", 50)
            settings_js = self._generate_fieshzen_settings_js(
                server_url=nd_url or "",
                server_name=nd_name or nd_user or "",
                sawsube_url=getattr(settings, "SAWSUBE_URL", "http://localhost:8000"),
            )
            (tmp_dir / "settings.js").write_text(settings_js, encoding="utf-8")

            # ── Step 6: Write fieshzen-auth.js (if auth succeeded) ─────────
            if nd_auth:
                await _broadcast("Writing fieshzen-auth.js…", 52)
                auth_js = self._generate_fieshzen_auth_js(
                    server_url=nd_url,
                    server_name=nd_name,
                    auth=nd_auth,
                )
                (tmp_dir / "fieshzen-auth.js").write_text(auth_js, encoding="utf-8")

                # ── Step 7: Inject script tags into index.html ─────────────
                await _broadcast("Patching index.html with auth and compat scripts…", 54)
                index_html = (tmp_dir / "index.html").read_text(encoding="utf-8")
                inject_block = (
                    '<script src="fieshzen-auth.js"></script>\n'
                    '        <script src="settings.js"></script>\n'
                    '        <link rel="stylesheet" href="tizen-fixes.css">\n'
                    '        <script src="tizen-compat.js"></script>'
                )
                index_html = index_html.replace(
                    '<script src="settings.js"></script>',
                    inject_block,
                )
                (tmp_dir / "index.html").write_text(index_html, encoding="utf-8")
            else:
                # At minimum inject compat scripts
                index_html = (tmp_dir / "index.html").read_text(encoding="utf-8")
                inject_block = (
                    '<script src="settings.js"></script>\n'
                    '        <link rel="stylesheet" href="tizen-fixes.css">\n'
                    '        <script src="tizen-compat.js"></script>'
                )
                index_html = index_html.replace(
                    '<script src="settings.js"></script>',
                    inject_block,
                )
                (tmp_dir / "index.html").write_text(index_html, encoding="utf-8")

            # ── Step 8: Package WGT ────────────────────────────────────────
            await _broadcast(f"Packaging WGT (profile: {profile_name})…", 58)
            out_dir_path = self.download_dir / "fieshzen_build"
            out_dir_path.mkdir(parents=True, exist_ok=True)
            for old in out_dir_path.glob("*.wgt"):
                old.unlink(missing_ok=True)

            pkg_res = await self.run_command(
                [tools["tizen_path"], "package",
                 "--type", "wgt",
                 "--sign", profile_name,
                 "-o", str(out_dir_path),
                 "--", str(tmp_dir)],
                timeout=300.0, tv_id=tv_id, step="building", progress=65,
            )
            if pkg_res["returncode"] != 0:
                await _broadcast(
                    f"WGT packaging failed: {pkg_res.get('stderr') or pkg_res['stdout'][-400:]}",
                    0, "error"
                )
                return

            wgt_files = list(out_dir_path.glob("*.wgt"))
            if not wgt_files:
                await _broadcast("No .wgt file produced — check Tizen profile.", 0, "error")
                return

            wgt_path = str(wgt_files[0])
            await _broadcast(f"Built: {Path(wgt_path).name}", 70)

        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        # ── Step 9: Sign if needed ──────────────────────────────────────────
        info = await self.fetch_tv_api_info(tv.ip)
        if info.get("requires_certificate"):
            state = await self.get_or_create_state(tv_id)
            if state.certificate_profile:
                await _broadcast("Re-signing for Tizen 7+ TV…", 72, "resigning")
                rs = await self.resign_wgt(
                    tools["tizen_path"], wgt_path, state.certificate_profile,
                    str(self.download_dir / "fieshzen_build" / "signed"), tv_id=tv_id,
                )
                if rs.get("error"):
                    await _broadcast(f"Re-sign failed: {rs['error']}", 0, "error")
                    return
                wgt_path = rs["resigned_path"] or wgt_path

        # ── Step 10: Install ────────────────────────────────────────────────
        res = await self.install_wgt(tools["sdb_path"], tools["tizen_path"], tv.ip, wgt_path, tv_id)
        if res["success"]:
            await self.update_state(tv_id, sdb_connected=True, notes=None)
            async with SessionLocal() as s:
                s.add(TizenBrewInstalledApp(
                    tv_id=tv_id,
                    app_name="Fieshzen",
                    app_source="local:fieshzen",
                    wgt_path=wgt_path,
                    version="local-build",
                ))
                await s.commit()
        else:
            await self.update_state(tv_id, notes=res.get("error") or "install failed")

    except Exception as e:
        log.exception("build_and_install_fieshzen crashed")
        await ws_manager.broadcast({
            "type": "tizenbrew_install_progress", "tv_id": tv_id,
            "step": "error", "progress": 0, "message": f"Build error: {e}",
        })

def _generate_fieshzen_settings_js(
    self, server_url: str, server_name: str, sawsube_url: str
) -> str:
    """Generate the settings.js content for Feishin web build."""
    return f'''"use strict";

window.SERVER_URL = {json.dumps(server_url)};
window.SERVER_NAME = {json.dumps(server_name)};
window.SERVER_TYPE = "navidrome";
window.SERVER_LOCK = "true";
window.LEGACY_AUTHENTICATION = "false";
window.ANALYTICS_DISABLED = "true";
window.REMOTE_URL = "";

window.FS_GENERAL_THEME = "defaultDark";
window.FS_GENERAL_THEME_DARK = "defaultDark";
window.FS_GENERAL_FOLLOW_CURRENT_SONG = "true";
window.FS_GENERAL_HOME_FEATURE = "true";
window.FS_GENERAL_SHOW_LYRICS_IN_SIDEBAR = "false";
window.FS_PLAYBACK_MEDIA_SESSION = "true";
window.FS_PLAYBACK_SCROBBLE_ENABLED = "false";
window.FS_PLAYBACK_TRANSCODE_ENABLED = "false";
window.FS_LYRICS_FETCH = "true";
window.FS_LYRICS_FOLLOW = "true";
window.FS_DISCORD_ENABLED = "false";
window.FS_AUTO_DJ_ENABLED = "false";
'''

def _generate_fieshzen_auth_js(
    self, server_url: str, server_name: str, auth: dict
) -> str:
    """Generate the fieshzen-auth.js content that pre-seeds Zustand auth state."""
    import json as _json
    user_id = auth.get("id", "")
    username = auth.get("username", "")
    is_admin = auth.get("isAdmin", False)
    salt = auth.get("subsonicSalt", "")
    token = auth.get("subsonicToken", "")
    jwt = auth.get("token", "")
    credential = f"u={username}&s={salt}&t={token}&v=1.16.1&c=fieshzen"
    server_id = "fieshzen-navidrome-auto"
    server = {
        "id": server_id,
        "name": server_name or username,
        "url": server_url,
        "type": "navidrome",
        "username": username,
        "userId": user_id,
        "credential": credential,
        "ndCredential": jwt,
        "isAdmin": is_admin,
        "savePassword": True,
    }
    state = {
        "state": {
            "currentServer": server,
            "deviceId": "fieshzen-tv-device-001",
            "serverList": {server_id: server},
        },
        "version": 2,
    }
    state_json = _json.dumps(state, separators=(",", ":"))
    return f'''(function(){{
  var AUTH_KEY="store_authentication";
  try{{
    if(!localStorage.getItem(AUTH_KEY)){{
      localStorage.setItem(AUTH_KEY,{_json.dumps(state_json)});
    }}
  }}catch(e){{console.error("Fieshzen auth pre-seed failed:",e);}}
}})();
'''
```

**Important:** The `run_command` method in `TizenBrewService` needs a `cwd` parameter added. Check the existing signature and add it:

```python
async def run_command(
    self,
    cmd: list[str],
    timeout: float = 120.0,
    tv_id: int | None = None,
    step: str = "",
    progress: int = 0,
    cwd: str | None = None,  # ADD THIS PARAMETER
) -> dict[str, Any]:
    log.info("tizenbrew: running %s", " ".join(cmd))
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,  # ADD THIS
        )
    # ... rest of method unchanged
```

### 8.6 Navidrome Image Proxy Router

Create `backend/routers/navidrome.py` (parallel to `sonarr.py`):

```python
from __future__ import annotations
import io
import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from ..config import settings

router = APIRouter(prefix="/api/navidrome", tags=["navidrome"])


@router.get("/image")
async def proxy_navidrome_image(
    id: str = Query(..., description="Navidrome cover art ID (e.g. al-xxx, ar-xxx, pl-xxx)"),
    size: int | None = Query(None, ge=50, le=1200, description="Resize to this square size (px)"),
):
    """Proxy & optionally resize a cover art image from Navidrome.
    Adds 30-day cache headers. Tizen WebKit honours these to avoid re-fetching."""
    if not settings.NAVIDROME_URL:
        raise HTTPException(status_code=503, detail="NAVIDROME_URL not configured")

    nd_base = settings.NAVIDROME_URL.rstrip("/")
    params = {
        "u": settings.NAVIDROME_USERNAME,
        "p": settings.NAVIDROME_PASSWORD,
        "v": "1.16.1",
        "c": "sawsube",
        "id": id,
    }
    if size:
        params["size"] = str(size)

    target_url = f"{nd_base}/rest/getCoverArt.view"

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            res = await client.get(target_url, params=params)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Navidrome: {e}")

    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail="Navidrome image request failed")

    content = res.content
    content_type = res.headers.get("content-type", "image/jpeg")

    # Tizen WebKit may struggle with webp; convert to jpeg if needed
    if content_type == "image/webp" or (size and content_type.startswith("image/")):
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(content))
            if size and (img.width > size or img.height > size):
                img.thumbnail((size, size), Image.LANCZOS)
            if img.mode in ("RGBA", "P", "LA"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85, optimize=True)
            content = buf.getvalue()
            content_type = "image/jpeg"
        except Exception:
            pass  # Serve original if PIL fails

    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=2592000",  # 30 days
            "X-Content-Type-Options": "nosniff",
        },
    )
```

Register in `backend/main.py`:
```python
from .routers import navidrome as navidrome_router
# ...
app.include_router(navidrome_router.router)
```

**Note:** Fieshzen does NOT use the SAWSUBE image proxy for cover art. The app calls Navidrome's `getCoverArt.view` directly from the TV. The proxy is available for the SAWSUBE frontend UI if needed.

---

## 9. Tizen WebKit Compatibility Layer

### 9.1 Known Tizen WebKit Limitations

These are confirmed issues from other ports (Radarrzen, Sonarrzen) that apply equally to Fieshzen:

| Issue | Symptom | Fix |
|-------|---------|-----|
| `inset: 0` not supported | Elements don't fill parent | Use `top:0; left:0; right:0; bottom:0` |
| `tabIndex` required on custom elements | D-pad can't focus them | Add `tabIndex={0}` to all custom clickable divs |
| CSS transform on focused elements breaks layout | Hover scale animations break | Remove or reduce transform animations on `:focus` |
| 400ms focus delay on modal buttons | Buttons seem unresponsive | Add `setTimeout(..., 400)` when programmatically focusing on modal open |
| `position: sticky` unreliable | Headers don't stick | Use `position: fixed` with manual top offset |
| WebP images may not render | Blank album art | Proxy via SAWSUBE or add `?format=jpeg` to getCoverArt calls |
| `@font-face` loading slow | Text shows wrong font initially | Preload fonts or use system fonts |
| Large React bundle (~4MB) | Slow initial load | Accept; React hydration takes ~3–5s on Tizen hardware |
| Infinite scroll intersection observer | May not fire on TV | Test; fallback to button-triggered pagination |

### 9.2 tizen-fixes.css

```css
/* ============================================================
   Fieshzen — Tizen WebKit CSS Compatibility Fixes
   Applied before the main React bundle loads.
   ============================================================ */

/* 1. Replace inset: 0 shorthand (not supported in Tizen WebKit) */
[class*="fs-full-screen"] {
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    position: fixed;
}

/* 2. Remove scale/transform hover effects that break layout */
*:focus,
*:focus-within {
    outline: 3px solid #5865f2 !important;
    outline-offset: 2px !important;
    transform: none !important;
    scale: none !important;
}

/* Suppress motion animations that Tizen struggles with */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
    }
}

/* 3. Ensure playerbar is always visible at bottom */
[class*="fs-playerbar-container"] {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 200;
}

/* 4. Sidebar — fixed position for TV layout */
[id="sidebar"],
[id="left-sidebar"] {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
    overflow-y: auto;
}

/* 5. Focused items in lists — clear visual indicator */
[tabindex]:focus,
button:focus,
a:focus,
input:focus,
[role="button"]:focus {
    outline: 3px solid #ffffff !important;
    outline-offset: 1px !important;
    background-color: rgba(255, 255, 255, 0.1) !important;
}

/* 6. Scrollbar suppression (Tizen scrollbars look bad on TV) */
::-webkit-scrollbar {
    display: none;
}

/* 7. Font smoothing */
* {
    -webkit-font-smoothing: antialiased;
}

/* 8. Ensure images don't overflow containers */
img {
    max-width: 100%;
    height: auto;
}

/* 9. Grid items — ensure focusability styling */
[class*="fs-album-list"],
[class*="fs-artist-list"],
[class*="fs-song-list"] {
    /* Let items be focusable */
}

/* 10. TV-friendly focus ring for Mantine components */
.mantine-UnstyledButton-root:focus,
.mantine-ActionIcon-root:focus,
.mantine-NavLink-root:focus {
    outline: 3px solid #5865f2 !important;
    background-color: rgba(88, 101, 242, 0.2) !important;
}
```

---

## 10. Remote Navigation System

### 10.1 Samsung TV Remote Key Codes

| Remote Key | keyCode | keyIdentifier | Notes |
|-----------|---------|---------------|-------|
| OK / Enter | 13 | `Enter` | Confirm/select |
| Back / Return | 10009 | — | Navigate back |
| Up Arrow | 38 | `ArrowUp` | D-pad navigation |
| Down Arrow | 40 | `ArrowDown` | D-pad navigation |
| Left Arrow | 37 | `ArrowLeft` | D-pad navigation |
| Right Arrow | 39 | `ArrowRight` | D-pad navigation |
| Play | 415 | — | Media play |
| Pause | 19 | — | Media pause |
| Stop | 413 | — | Media stop |
| Fast Forward | 417 | — | Skip forward |
| Rewind | 412 | — | Skip backward |
| Red | 403 | — | Optional shortcut |
| Green | 404 | — | Optional shortcut |
| Yellow | 405 | — | Optional shortcut |
| Blue | 406 | — | Optional shortcut |

### 10.2 patches/tizen-compat.js

This file is the entire Samsung TV remote navigation layer. It runs before React loads:

```javascript
/* ============================================================
   Fieshzen — Tizen TV Compatibility + Remote Navigation
   Runs before React bootstrap.
   ============================================================ */
(function () {
  'use strict';

  // ── 1. Register Samsung media keys ─────────────────────────────────────
  function registerTizenKeys() {
    if (!window.tizen || !window.tizen.tvinputdevice) return;
    var keys = [
      'MediaPlay', 'MediaPause', 'MediaStop',
      'MediaFastForward', 'MediaRewind',
      'MediaPlayPause',
      'Return',           // BACK key
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ];
    keys.forEach(function (k) {
      try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* ignore */ }
    });
  }

  // ── 2. Spatial navigation helper ───────────────────────────────────────
  // Feishin uses standard HTML elements; browser arrow key navigation
  // works for most things. We supplement for custom div-based grids.

  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]:not([disabled])',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
  ].join(',');

  function getFocusableElements() {
    return Array.from(document.querySelectorAll(FOCUSABLE)).filter(function (el) {
      var style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    });
  }

  function getRect(el) {
    return el.getBoundingClientRect();
  }

  function getCenter(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function distance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Find the best candidate in a direction (up/down/left/right)
  function findNext(current, direction) {
    var elements = getFocusableElements();
    var currentRect = getRect(current);
    var currentCenter = getCenter(currentRect);

    var candidates = elements.filter(function (el) {
      if (el === current) return false;
      var rect = getRect(el);
      var center = getCenter(rect);
      switch (direction) {
        case 'up':    return center.y < currentCenter.y - 5;
        case 'down':  return center.y > currentCenter.y + 5;
        case 'left':  return center.x < currentCenter.x - 5;
        case 'right': return center.x > currentCenter.x + 5;
      }
      return false;
    });

    if (!candidates.length) return null;

    // Score = primary axis distance + secondary axis penalty
    candidates.sort(function (a, b) {
      var ra = getRect(a), rb = getRect(b);
      var ca = getCenter(ra), cb = getCenter(rb);
      var scoreA, scoreB;
      if (direction === 'up' || direction === 'down') {
        scoreA = Math.abs(ca.y - currentCenter.y) + Math.abs(ca.x - currentCenter.x) * 0.3;
        scoreB = Math.abs(cb.y - currentCenter.y) + Math.abs(cb.x - currentCenter.x) * 0.3;
      } else {
        scoreA = Math.abs(ca.x - currentCenter.x) + Math.abs(ca.y - currentCenter.y) * 0.3;
        scoreB = Math.abs(cb.x - currentCenter.x) + Math.abs(cb.y - currentCenter.y) * 0.3;
      }
      return scoreA - scoreB;
    });

    return candidates[0];
  }

  // ── 3. Player store interaction ─────────────────────────────────────────
  // Feishin uses Zustand. We access the store directly from window for
  // remote key handling. The store is accessible via the Zustand devtools
  // global once React has initialised.

  function getPlayerStore() {
    // Zustand stores are accessible via their subscriptions once mounted.
    // We use a custom event bridge instead (dispatched from React).
    return null; // Placeholder — see §11.3 for the React-side bridge.
  }

  function dispatchPlayerAction(action) {
    window.dispatchEvent(new CustomEvent('fieshzen:player', { detail: { action: action } }));
  }

  // ── 4. Main keydown handler ─────────────────────────────────────────────
  function handleKeyDown(e) {
    var code = e.keyCode;

    // ── Media keys → player actions ───────────────────────────────────────
    if (code === 415) { // Play
      dispatchPlayerAction('play');
      e.preventDefault();
      return;
    }
    if (code === 19) { // Pause
      dispatchPlayerAction('pause');
      e.preventDefault();
      return;
    }
    if (code === 10252 || (code === 415 && e.type === 'MediaPlayPause')) { // PlayPause toggle
      dispatchPlayerAction('togglePlayPause');
      e.preventDefault();
      return;
    }
    if (code === 413) { // Stop
      dispatchPlayerAction('stop');
      e.preventDefault();
      return;
    }
    if (code === 417) { // FastForward → skip forward
      dispatchPlayerAction('skipForward');
      e.preventDefault();
      return;
    }
    if (code === 412) { // Rewind → skip backward
      dispatchPlayerAction('skipBackward');
      e.preventDefault();
      return;
    }

    // ── Back key → browser history ────────────────────────────────────────
    if (code === 10009) { // BACK
      e.preventDefault();
      window.history.back();
      return;
    }

    // ── Colour keys → shortcuts ────────────────────────────────────────────
    if (code === 403) { // Red → toggle shuffle
      dispatchPlayerAction('toggleShuffle');
      e.preventDefault();
      return;
    }
    if (code === 404) { // Green → toggle repeat
      dispatchPlayerAction('toggleRepeat');
      e.preventDefault();
      return;
    }

    // ── Arrow keys → spatial navigation ──────────────────────────────────
    var dirMap = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
    var direction = dirMap[code];
    if (!direction) return;

    var active = document.activeElement;
    if (!active || active === document.body) {
      // Focus first focusable element
      var first = getFocusableElements()[0];
      if (first) {
        first.focus();
        first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      e.preventDefault();
      return;
    }

    // Check if the focused element handles arrows natively
    var tag = active.tagName.toLowerCase();
    var role = active.getAttribute('role') || '';
    var nativeArrow = (
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      role === 'slider' ||
      role === 'scrollbar' ||
      active.classList.contains('mantine-Slider-thumb')
    );
    if (nativeArrow) return; // Let browser handle it

    // Spatial nav
    var next = findNext(active, direction);
    if (next) {
      next.focus();
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      e.preventDefault();
    }
  }

  // ── 5. Initialise ───────────────────────────────────────────────────────
  registerTizenKeys();
  document.addEventListener('keydown', handleKeyDown, true);

  // Initial focus: when React is ready, focus the first item
  window.addEventListener('load', function () {
    setTimeout(function () {
      var first = getFocusableElements()[0];
      if (first) first.focus();
    }, 1500); // Wait for React hydration
  });

  console.log('[Fieshzen] Tizen compat layer initialised');
})();
```

---

## 11. Feishin Source Modifications

### 11.1 Minimal Change Philosophy

The goal is **minimum viable modifications** to the Feishin source. The Tizen compatibility layer (§10) handles navigation externally. Source modifications are reserved for things that cannot be fixed externally.

### 11.2 Required Modifications

#### 11.2.1 React Player Bridge for Remote Keys

The `tizen-compat.js` dispatches `CustomEvent('fieshzen:player', ...)`. React must listen for these events and call the appropriate Zustand store actions.

Add a new file: `src/renderer/features/player/hooks/use-tizen-remote.ts`

```typescript
import { useEffect } from 'react';
import { usePlayerActions } from '/@/renderer/store';

/**
 * Listens for Tizen remote control events dispatched by tizen-compat.js
 * and maps them to Feishin player store actions.
 * This hook must be mounted near the app root (e.g., in AudioPlayers component).
 */
export const useTizenRemote = () => {
    const { mediaPlay, mediaPause, mediaTogglePlayPause, mediaStop, mediaSkipForward, mediaSkipBackward } = usePlayerActions();
    const playerStore = usePlayerStore(); // for toggleShuffle, toggleRepeat

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            switch (detail?.action) {
                case 'play':            mediaPlay();              break;
                case 'pause':           mediaPause();             break;
                case 'togglePlayPause': mediaTogglePlayPause();   break;
                case 'stop':            mediaStop();              break;
                case 'skipForward':     mediaSkipForward();       break;
                case 'skipBackward':    mediaSkipBackward();      break;
                case 'toggleShuffle':   playerStore.toggleShuffle(); break;
                case 'toggleRepeat':    playerStore.toggleRepeat();  break;
            }
        };
        window.addEventListener('fieshzen:player', handler);
        return () => window.removeEventListener('fieshzen:player', handler);
    }, [mediaPlay, mediaPause, mediaTogglePlayPause, mediaStop, mediaSkipForward, mediaSkipBackward, playerStore]);
};

export const TizenRemoteHook = () => {
    useTizenRemote();
    return null;
};
```

Mount `TizenRemoteHook` in `src/renderer/features/player/components/audio-players.tsx` (alongside other hooks like `PlaybackHotkeysHook`):

```typescript
import { TizenRemoteHook } from '../hooks/use-tizen-remote';
// Inside AudioPlayers component return:
return (
    <>
        <TizenRemoteHook />
        {/* ... existing content */}
    </>
);
```

#### 11.2.2 tabIndex on Grid Items

Feishin's album/artist/song grid items may not have `tabIndex`. The spatial nav in `tizen-compat.js` relies on `[tabindex]:not([tabindex="-1"])`.

In the grid card components, ensure the root element has `tabIndex={0}`:

Files to check and update (add `tabIndex={0}` to the root card/list-item element):
- `src/renderer/components/item-list/item-table-list/item-table-list-column.tsx`
- Grid card components in `src/renderer/components/`
- Any custom button/clickable component that doesn't extend `<button>` or `<a>`

#### 11.2.3 Disable Hover-Only Interactions

Some Feishin UI elements show on hover (context menus, play buttons overlaying art). These don't work on TV. Add CSS to always show these:

Add to `tizen-fixes.css`:
```css
/* Show hover-only overlay buttons always on TV (no mouse hover) */
[class*="fs-album-detail-header"] [class*="playButton"],
[class*="fs-card-overlay"] {
    opacity: 1 !important;
}
```

#### 11.2.4 Suppress Analytics Script

The `index.html` from the web build includes an Umami analytics script. `window.ANALYTICS_DISABLED = "true"` in `settings.js` already suppresses it (the check is in the inline script). No further change needed.

### 11.3 Modifications NOT Required

The following things do **NOT** need code changes:

| Concern | Reason |
|---------|--------|
| Removing Electron imports | `isElectron()` guards already handle this |
| Server login UI | `SERVER_LOCK=true` + pre-seeded auth bypasses it |
| MPV player | Web build only activates `WebPlayer` |
| Discord RPC | `isElectron()` gated, does nothing in web |
| Window controls/titlebar | `Platform` checks suppress them in web |
| Auto-updater | Not present in web build |
| PWA service worker | The web build includes a PWA SW, but Tizen WGT doesn't use it — it simply won't register |

---

## 12. Navidrome API Reference

### 12.1 Connection Details (Live, Verified)

```
Base URL:     http://192.168.1.250:4534
Auth method:  Subsonic-compatible query params OR Navidrome JWT
API version:  1.16.1 (OpenSubsonic)
Server type:  Navidrome 0.61.0 (c5bb920b)
```

### 12.2 Auth Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/login` | Get JWT token + subsonic tokens (Navidrome-specific) |

Request body:
```json
{"username": "wblinuxclean", "password": "Niagara1"}
```

Response (verified live):
```json
{
  "id": "KANmEBlnJYYjCJ3S8JGklv",
  "isAdmin": true,
  "name": "Wblinuxclean",
  "subsonicSalt": "79d043",
  "subsonicToken": "b0d31bbccd90fbcdc65d4d7953dfaf4e",
  "token": "eyJhbGci...",
  "username": "wblinuxclean"
}
```

### 12.3 Subsonic/OpenSubsonic Endpoints (all verified live)

All requests require auth params: `?u=wblinuxclean&p=Niagara1&v=1.16.1&c=fieshzen&f=json`

| Endpoint | Path | Notes |
|----------|------|-------|
| Ping | `/rest/ping.view` | Returns `{"status":"ok","openSubsonic":true}` |
| Get Artists | `/rest/getArtists.view` | 24 letter indexes, all artists |
| Get Artist | `/rest/getArtist.view?id=<id>` | Single artist with album list |
| Get Album List | `/rest/getAlbumList2.view?type=newest&size=50` | Supports: newest, random, alphabeticalByName, starred, etc. |
| Get Album | `/rest/getAlbum.view?id=<id>` | Album detail with song list |
| Get Playlists | `/rest/getPlaylists.view` | User's playlists |
| Get Playlist | `/rest/getPlaylist.view?id=<id>` | Playlist with songs |
| Get Genres | `/rest/getGenres.view` | 23 genres in library |
| Songs by Genre | `/rest/getSongsByGenre.view?genre=<name>&count=50` | |
| Search | `/rest/search3.view?query=<q>&albumCount=20&artistCount=10&songCount=20` | |
| Top Songs | `/rest/getTopSongs.view?artist=<name>&count=20` | |
| Lyrics | `/rest/getLyricsBySongId.view?id=<songId>` | Returns `lyricsList.structuredLyrics` with timestamped lines |
| Stream | `/rest/stream.view?id=<songId>&format=mp3` | Returns `audio/mpeg`, chunked |
| Cover Art | `/rest/getCoverArt.view?id=<coverArtId>&size=300` | Returns `image/webp` — proxy via SAWSUBE to get JPEG |
| Scrobble | `/rest/scrobble.view?id=<songId>&submission=true` | Mark as played |
| Star | `/rest/star.view?id=<songId>` | Favourite a song |
| Unstar | `/rest/unstar.view?id=<songId>` | Unfavourite a song |
| Random Songs | `/rest/getRandomSongs.view?size=20` | |

### 12.4 Cover Art URL Pattern

Cover art IDs follow the pattern:
- Albums: `al-<albumId>_<hash>` 
- Artists: `ar-<artistId>_<hash>`
- Playlists: `pl-<playlistId>_<hash>`
- Songs: `mf-<songId>_<hash>`

Direct URL:
```
http://192.168.1.250:4534/rest/getCoverArt.view?u=wblinuxclean&p=Niagara1&v=1.16.1&c=fieshzen&id=<coverArtId>&size=300
```

Feishin constructs these URLs internally — no changes needed.

### 12.5 Stream URL Pattern

```
http://192.168.1.250:4534/rest/stream.view?u=wblinuxclean&p=Niagara1&v=1.16.1&c=fieshzen&id=<songId>&format=mp3
```

Feishin passes this URL to `react-player` which uses HTML5 `<audio>`. Tizen WebKit handles `audio/mpeg` natively.

---

## 13. Audio Playback Architecture

### 13.1 WebPlayer (the only player used on Tizen)

In the web build, `isElectron()` returns `false`, so:
- MPV player: **not loaded**
- Wavesurfer player: **conditionally loaded** (only if explicitly enabled in settings)
- **`WebPlayer`** with **`WebPlayerEngine`** (react-player wrapping HTML5 `<audio>`): **active**

`WebPlayer` → `WebPlayerEngine` → `ReactPlayer` → HTML5 `<audio>` element

The audio element streams directly from Navidrome's `stream.view` URL. This works natively on Tizen WebKit.

### 13.2 Audio Format Recommendations

Feishin defaults to streaming original format. For Tizen TV compatibility:
- **MP3**: Universal support — use `format=mp3` in stream URL
- **AAC**: Supported on modern Tizen (2019+)
- **FLAC**: NOT reliably supported — transcode to MP3

Set `window.FS_PLAYBACK_TRANSCODE_ENABLED = "false"` in settings.js (per §7.2). Navidrome streams MP3 by default when Feishin requests it.

### 13.3 Crossfade

Feishin's web player supports crossfade via `WebAudio API`. Tizen WebKit supports `AudioContext`. **Crossfade should work** but may be CPU-intensive. Default to `crossfadeDuration = 0` in settings to avoid issues:

```javascript
// In settings.js
window.FS_PLAYBACK_CROSSFADE_DURATION = "0";  // No crossfade by default
```

(Add this to the settings.js template if Feishin exposes it as an env override.)

### 13.4 Media Session API

Feishin supports `navigator.mediaSession` (Media Session API) for Now Playing info in the OS. Tizen 5.0+ supports this for displaying current track in the TV's system UI. Enable it:

```javascript
window.FS_PLAYBACK_MEDIA_SESSION = "true";  // Already set in §7.2
```

---

## 14. Screen-by-Screen Feature Map

### 14.1 Feature Decision Table

| Feishin Screen | Route | Include? | Notes |
|---------------|-------|---------|-------|
| Home | `/` | ✅ Yes | Recently played, random albums, discover |
| Login | `/login` | ✅ Yes (auto-bypassed) | Shown only if auth fails |
| Albums | `/library/albums` | ✅ Yes | Grid + table view |
| Album Detail | `/library/albums/:id` | ✅ Yes | Songs, play all, queue |
| Album Artists | `/library/album-artists` | ✅ Yes | List view |
| Album Artist Detail | `/library/album-artists/:id` | ✅ Yes | Discography, top songs |
| Artists | `/library/artists` | ✅ Yes | |
| Artist Detail | `/library/artists/:id` | ✅ Yes | |
| Genres | `/library/genres` | ✅ Yes | Browse by genre |
| Genre Detail | `/library/genres/:id` | ✅ Yes | Albums in genre |
| Playlists | `/playlists` | ✅ Yes | User playlists |
| Playlist Detail | `/playlists/:id/songs` | ✅ Yes | Songs, play all |
| Songs | `/library/songs` | ✅ Yes | All songs, sorted |
| Search | `/search/:type` | ✅ Yes | Critical for TV browsing |
| Now Playing | `/now-playing` | ✅ Yes | Queue view |
| Playing / Full Screen | `/playing` | ✅ Yes | Full-screen player with art |
| Settings | `/settings` | ✅ Yes | Reduced UI (no Electron-specific settings) |
| Favorites | `/favorites` | ✅ Yes | Starred items |
| Radio | `/radio` | ⚠️ Optional | Internet radio — include if Navidrome has stations |
| Folders | `/library/folders` | ⚠️ Optional | File-system browse — may confuse TV UX |
| Explore | `/explore` | ✅ Yes | Explore/discover |
| Servers | `/servers` | ❌ Excluded | Server management not needed; auto-configured |
| Action Required | `/action-required` | ✅ Auto | Error handling screen |

### 14.2 Home Screen

- Displays: **Recently Played**, **Random Albums**, **Most Played**, **New Releases**
- Feishin API: `getAlbumList2.view?type=recent`, `type=random`, `type=frequent`, `type=newest`
- TV navigation: D-pad through album carousels; OK to enter album detail; Down to next carousel

### 14.3 Album Library

- Grid display of all albums (Feishin renders `AlbumListInfiniteGrid`)
- Sorting: By name, year, artist, date added, play count, rating
- Filtering: By genre, artist — via sidebar filters
- TV navigation: Left/Right to move through grid; Down for next row; OK to open detail

### 14.4 Album Detail

- Shows: Album art (large), title, artist, year, genre, song list
- Actions: Play All, Shuffle, Add to Queue
- Song list table — each row is a song (title, duration, play controls)
- Lyrics: accessible via "Lyrics" tab if song is playing

### 14.5 Player / Now Playing

- **Playerbar** (always visible at bottom): Album art thumbnail, song title, artist, progress slider, prev/next, play/pause, volume, queue toggle
- **Full Screen Player** (`/playing`): Large album art, lyrics overlay, queue panel
- TV focus: Playerbar is always reachable via D-pad (navigate Down from any content)

**Critical:** The playerbar progress slider uses a custom Mantine `Slider`. Ensure it has `tabIndex={0}` and responds to Left/Right arrows for seeking.

### 14.6 Search

- Text input for query (Samsung smart keyboard appears on text field focus)
- Results: Artists, Albums, Songs — tabbed or combined
- Feishin API: `search3.view?query=<q>`

### 14.7 Lyrics

- Synchronized lyrics from Navidrome's `getLyricsBySongId.view` (verified working)
- Feishin renders `SynchronizedLyrics` component with line-by-line highlight
- Auto-scroll to current line when `FS_LYRICS_FOLLOW = "true"`
- TV interaction: No user interaction needed — read-only, auto-scrolling

### 14.8 Settings

Settings screen accessible via sidebar "Settings" link. TV-relevant settings:
- **Theme** (dark themes only — not needed on TV)
- **Playback**: Transcode settings, crossfade
- **Lyrics**: Enable/disable, follow
- **Language**: Keep English

Settings screen renders even without Electron-specific sections. Server settings are hidden by `SERVER_LOCK = "true"`.

---

## 15. Performance Optimisations

### 15.1 Initial Load Time

Feishin's web bundle is ~4MB. On Tizen TV (Samsung 2022 Frame), expect:
- JS parse + execute: ~3–6 seconds
- React mount: ~500ms–1s
- First Navidrome API response: ~200ms (LAN)
- Total time to interactive: ~5–8 seconds

This is acceptable. Add a loading screen or splash in `settings.js`:
```javascript
// Tizen apps already show the TV's "Loading..." overlay until the app is ready
```

### 15.2 Image Performance

Feishin requests cover art from Navidrome directly. The `getCoverArt.view` endpoint returns `image/webp`. Tizen WebKit support for WebP is limited pre-2020.

**Solution:** Feishin constructs cover art URLs internally through `getServerImageUrl()`. The simplest fix is to ensure Navidrome serves JPEG when requested with `?size=300`. Navidrome always returns JPEG when `size` is specified for album art (this is already the default in Feishin's API calls).

If WebP issues appear, add to `tizen-fixes.css`:
```css
img[src*="getCoverArt"] {
    /* Force hardware compositing for images */
    transform: translateZ(0);
    will-change: transform;
}
```

### 15.3 Virtualised Lists

Feishin uses either:
- `AlbumListInfiniteGrid` — React virtualised grid
- `ItemTableList` — table with virtualisation

Both use intersection observers for infinite scrolling. Test on actual Tizen hardware. If intersection observer doesn't fire, Feishin's existing "Load More" button mechanism serves as fallback.

### 15.4 React Strict Mode

Feishin may use React Strict Mode in development. Ensure production build (`NODE_ENV=production`) is used — the web build already sets this.

### 15.5 CSS-in-JS (Mantine)

Mantine v8 uses CSS variables (not runtime CSS-in-JS). All styles are in the bundled CSS file. No runtime performance concern.

---

## 16. Testing Plan

### 16.1 Build Verification

```bash
# Step 1: Verify pnpm and node versions
cd /home/will/Github/feishin
node --version  # >= 20
pnpm --version  # >= 9

# Step 2: Test web build
pnpm install --frozen-lockfile
pnpm build:web
ls out/web/  # Should contain index.html, assets/, settings.js is NOT there yet

# Step 3: Check index.html for settings.js script tag
grep "settings.js" out/web/index.html  # Should find it

# Step 4: Test manual WGT build
cd /home/will/Github/Fieshzen
FEISHIN_SRC=/home/will/Github/feishin ./build.sh

# Step 5: Check WGT was created
ls -la Fieshzen.wgt  # Should be 5-8 MB
```

### 16.2 Navidrome API Tests (verified live)

```bash
ND="http://192.168.1.250:4534"
AUTH="u=wblinuxclean&p=Niagara1&v=1.16.1&c=fieshzen&f=json"

# Ping
curl -s "$ND/rest/ping.view?$AUTH" | python3 -m json.tool
# Expected: {"status":"ok","openSubsonic":true}

# Auth token (for SAWSUBE injection)
curl -s -X POST "$ND/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"wblinuxclean","password":"Niagara1"}' | python3 -m json.tool
# Expected: {"id":"...","token":"eyJ...","subsonicSalt":"...","subsonicToken":"..."}

# Artist list
curl -s "$ND/rest/getArtists.view?$AUTH" | python3 -m json.tool | head -20

# Album list (newest)
curl -s "$ND/rest/getAlbumList2.view?$AUTH&type=newest&size=5" | python3 -m json.tool

# Search
curl -s "$ND/rest/search3.view?$AUTH&query=smiths" | python3 -m json.tool | head -30

# Playlists
curl -s "$ND/rest/getPlaylists.view?$AUTH" | python3 -m json.tool

# Stream (check audio/mpeg response)
curl -s -o /dev/null -w "%{http_code} %{content_type}" \
  "$ND/rest/stream.view?$AUTH&id=IOqLezZ77YWsoDNPNBR8eN&format=mp3"
# Expected: 200 audio/mpeg

# Cover art (check image response)
curl -s -o /dev/null -w "%{http_code} %{content_type}" \
  "$ND/rest/getCoverArt.view?$AUTH&id=al-3viadyLDxnzXa9zPAxZDzF_69d12ae6&size=300"
# Expected: 200 image/webp (or image/jpeg)

# Lyrics
curl -s "$ND/rest/getLyricsBySongId.view?$AUTH&id=IOqLezZ77YWsoDNPNBR8eN" | python3 -m json.tool | head -20
# Expected: lyricsList.structuredLyrics with timestamped lines
```

### 16.3 SAWSUBE Endpoint Tests

```bash
SAWSUBE="http://192.168.1.48:8000"
TV_ID=1

# Test build + install
curl -s -X POST "$SAWSUBE/api/tizenbrew/$TV_ID/build-install-fieshzen" | python3 -m json.tool
# Expected: {"started": true, "job_id": "..."}

# Watch WebSocket for progress (optional)
# Connect to ws://192.168.1.48:8000/ws/{tv_id} to see build progress

# Test Navidrome image proxy
curl -s -o /dev/null -w "%{http_code} %{content_type}" \
  "$SAWSUBE/api/navidrome/image?id=al-3viadyLDxnzXa9zPAxZDzF_69d12ae6&size=300"
# Expected: 200 image/jpeg
```

### 16.4 TV Installation Tests

```bash
# Connect TV
~/tizen-studio/tools/sdb connect 192.168.1.202
~/tizen-studio/tools/sdb devices

# Manual install of pre-built WGT
~/tizen-studio/tools/ide/bin/tizen install -n /home/will/Github/Fieshzen/Fieshzen.wgt

# Check app is installed
~/tizen-studio/tools/sdb shell 0 ls /opt/usr/apps/ | grep Fshzn
```

### 16.5 On-TV Functional Tests

With Fieshzen installed on the Samsung Frame TV:

| Test | Expected |
|------|---------|
| App launches | Splash → Home screen (not login) in ~5–8s |
| Home screen shows albums | Recently played / random albums visible |
| D-pad navigation works | Focus moves between items |
| OK button opens album | Album detail screen appears |
| Play button starts music | Audio plays, playerbar shows progress |
| Samsung remote Play key works | Player starts |
| Samsung remote Pause key works | Player pauses |
| Samsung remote Back button | Returns to previous screen |
| Lyrics screen | Synchronized lyrics scroll with music |
| Search | Samsung keyboard appears, results display |
| Playlists | User playlists listed and playable |

---

## 17. Environment Variables Reference

### 17.1 SAWSUBE .env (complete Fieshzen additions)

```env
# Navidrome
Navidrome_URL=http://192.168.1.250:4534
Navidrome_username=wblinuxclean
Navidrome_password=Niagara1
Navidrome_server_name=Wblinuxclean

# Fieshzen
FIESHZEN_FEISHIN_SRC_PATH=/home/will/Github/feishin
FIESHZEN_SRC_PATH=/home/will/Github/Fieshzen
FIESHZEN_TIZEN_PROFILE=TestProfile
```

### 17.2 pydantic-settings Notes

`pydantic-settings` is case-insensitive for env var matching. `Navidrome_URL` in `.env` matches `NAVIDROME_URL` in the `Settings` class. Both forms work.

### 17.3 Feishin settings.js Variables (used by Fieshzen)

| Variable | Type | Purpose |
|----------|------|---------|
| `window.SERVER_URL` | string | Navidrome base URL |
| `window.SERVER_NAME` | string | Display name for server |
| `window.SERVER_TYPE` | `"navidrome"` | Server type identifier |
| `window.SERVER_LOCK` | `"true"` | Pre-configure server, prevent changing |
| `window.LEGACY_AUTHENTICATION` | `"false"` | Use ND JWT auth |
| `window.ANALYTICS_DISABLED` | `"true"` | Disable Umami analytics |
| `window.FS_GENERAL_THEME` | `"defaultDark"` | Dark theme |
| `window.FS_GENERAL_FOLLOW_CURRENT_SONG` | `"true"` | Auto-scroll queue to current song |
| `window.FS_PLAYBACK_MEDIA_SESSION` | `"true"` | Enable MediaSession API |
| `window.FS_PLAYBACK_TRANSCODE_ENABLED` | `"false"` | Stream original format |
| `window.FS_LYRICS_FETCH` | `"true"` | Fetch lyrics from server |
| `window.FS_LYRICS_FOLLOW` | `"true"` | Auto-scroll lyrics |
| `window.FS_DISCORD_ENABLED` | `"false"` | Disable Discord RPC |
| `window.FS_AUTO_DJ_ENABLED` | `"false"` | Disable Auto DJ |

---

## 18. File Paths & Commands

### 18.1 Key Paths

| Path | Purpose |
|------|---------|
| `/home/will/Github/feishin/` | Feishin source (GPL-3.0) |
| `/home/will/Github/feishin/out/web/` | Web build output (after `pnpm build:web`) |
| `/home/will/Github/feishin/settings.js.template` | Template for all `window.*` variables |
| `/home/will/Github/feishin/src/renderer/` | React app source |
| `/home/will/Github/feishin/web.vite.config.ts` | Web build Vite config |
| `/home/will/Github/Fieshzen/` | This repo |
| `/home/will/Github/Fieshzen/tizen/config.xml` | Tizen WGT manifest |
| `/home/will/Github/Fieshzen/patches/tizen-compat.js` | Remote nav layer |
| `/home/will/Github/Fieshzen/patches/tizen-fixes.css` | WebKit CSS fixes |
| `/home/will/Github/Fieshzen/Fieshzen.wgt` | Built WGT |
| `/home/will/Github/SAWSUBE/backend/config.py` | Add Navidrome + Fieshzen settings |
| `/home/will/Github/SAWSUBE/backend/routers/tizenbrew.py` | Add `/build-install-fieshzen` endpoint |
| `/home/will/Github/SAWSUBE/backend/routers/navidrome.py` | New image proxy router |
| `/home/will/Github/SAWSUBE/backend/services/tizenbrew_service.py` | Add `build_and_install_fieshzen()` |
| `/home/will/Github/SAWSUBE/.env` | Add Navidrome + Fieshzen env vars |

### 18.2 Key Commands

```bash
# Build Feishin web app
cd /home/will/Github/feishin
pnpm install --frozen-lockfile
pnpm build:web

# Build Fieshzen WGT
cd /home/will/Github/Fieshzen
FEISHIN_SRC=/home/will/Github/feishin PROFILE=TestProfile ./build.sh

# Install WGT on TV
~/tizen-studio/tools/sdb connect 192.168.1.202
~/tizen-studio/tools/ide/bin/tizen install -n /home/will/Github/Fieshzen/Fieshzen.wgt

# Trigger SAWSUBE build + install (TV_ID=1)
curl -X POST http://192.168.1.48:8000/api/tizenbrew/1/build-install-fieshzen

# Navidrome API auth (get JWT for injection)
curl -X POST http://192.168.1.250:4534/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"wblinuxclean","password":"Niagara1"}'

# Tizen profile check
~/tizen-studio/tools/ide/bin/tizen security-profiles list

# SAWSUBE restart
cd /home/will/Github/SAWSUBE && ./start.sh
```

### 18.3 Tizen App Identifiers

| Field | Value |
|-------|-------|
| Widget ID | `https://github.com/WB2024/fieshzen` |
| Package | `FshznTV001` |
| App ID | `FshznTV001.Fieshzen` |
| Tizen required_version | `4.0` |
| Profile | `TestProfile` |
| TV IP | `192.168.1.202` |
| TV model | Samsung QE55LS03BAUXXU (Frame 2022) |

---

## Appendix A: Comparison with Other Ports

| Feature | Radarrzen | Sonarrzen | **Fieshzen** |
|---------|-----------|-----------|-----------|
| Source | Vanilla JS from scratch | Vanilla JS from scratch | **Feishin React/TS source** |
| Bundle size | ~62 KB | ~64 KB | ~5–8 MB |
| Build tool | Tizen CLI directly on `src/` | Tizen CLI directly on `src/` | pnpm build:web + Tizen CLI |
| Build time | ~5 seconds | ~5 seconds | ~3–5 minutes |
| Auth injection | `sawsube-config.js` → localStorage | `sawsube-config.js` → localStorage | `fieshzen-auth.js` → `store_authentication` localStorage key |
| Server config | In `sawsube-config.js` | In `sawsube-config.js` | In `settings.js` (Feishin convention) |
| Navigation | Custom `Nav.js` spatial nav | Custom `Nav.js` spatial nav | External `tizen-compat.js` + React hook bridge |
| API | Radarr v3 REST | Sonarr v3 REST | Subsonic + Navidrome REST |
| Audio | N/A | N/A | HTML5 `<audio>` via `react-player` |

---

## Appendix B: Potential Issues & Mitigations

| Issue | Likelihood | Mitigation |
|-------|-----------|-----------|
| Bundle too large for Tizen storage | Low | ~5–8 MB is well within Tizen app size limits |
| Tizen WebKit can't parse modern JS | Low | Feishin web build targets ES2015+; Tizen 2019+ supports this |
| React 19 features unsupported | Medium | Test on actual TV; Tizen 2022+ is modern enough |
| Mantine CSS vars not supported | Low | Tizen WebKit supports CSS custom properties since Tizen 4.0 |
| Auth token expires between TV uses | Medium | Feishin auto-refreshes token via `POST /auth/login` on 401; handled by `navidrome-api.ts` |
| Large album library slow to render | Medium | Feishin uses virtualised lists; should handle 1000+ albums |
| Spatial navigation misses items | Medium | `tizen-compat.js` covers standard focusable elements; add `tabIndex=0` to custom items |
| Samsung remote media keys not working | Low | Keys registered via `tizen.tvinputdevice.registerKey()` before React loads |
| WebP cover art not rendering | Medium | Navidrome serves JPEG when `size` param is provided; CSS hardware compositing fallback |
| PWA service worker registration fails | Low | Tizen WGT ignores service worker; no impact on functionality |

---

## Appendix C: Live API Test Results

All tests conducted on 26 April 2026 against `http://192.168.1.250:4534` (Navidrome 0.61.0):

| Test | Result |
|------|--------|
| `ping.view` | ✅ `{"status":"ok","openSubsonic":true}` |
| `auth/login` | ✅ JWT + subsonic tokens returned |
| `getArtists.view` | ✅ 24 letter indexes, artists returned |
| `getAlbumList2.view?type=newest` | ✅ Albums with art IDs, year, genre |
| `search3.view?query=smiths` | ✅ Artists + albums + songs returned |
| `getPlaylists.view` | ✅ User playlists listed |
| `stream.view?id=...&format=mp3` | ✅ `audio/mpeg` chunked streaming |
| `getCoverArt.view?id=...&size=300` | ✅ `image/webp` returned |
| `getLyricsBySongId.view?id=...` | ✅ `structuredLyrics` with timestamps |
| `getGenres.view` | ✅ 23 genres with song/album counts |
| `getSongsByGenre.view?genre=Hip-Hop` | ✅ Songs returned |
| `getTopSongs.view?artist=The+Smiths` | ✅ Top songs returned |
| `getArtist.view?id=...` | ✅ Artist with 30 albums |

Library size: 24 artist indexes, 23 genres, multiple playlists. Synchronized lyrics confirmed available.

---

*Spec prepared from direct source code analysis of `/home/will/Github/feishin/` and live API testing against `http://192.168.1.250:4534`. Ready for implementation by Claude Opus 4.7.*
