# Fieshzen — Tizen Wrapper Deployment

This repo (`/home/will/Github/Fieshzen`) contains the **Tizen-specific wrapper** for Fieshzen: `config.xml`, `tizen/` assets, and any patches applied to the Feishin web build.

The actual React source lives at `/home/will/Github/feishin`. SAWSUBE combines both when building the WGT for the TV.

---

## One-command deploy

After making changes to this repo (config, patches, icons, etc.):

```bash
# From /home/will/Github/feishin:
./deploy.sh

# OR directly via curl:
curl -X POST http://127.0.0.1:8000/api/tizenbrew/1/build-install-fieshzen
```

Monitor progress:
```bash
tail -f /tmp/sawsube.log
```

---

## What this repo contributes to the WGT

| File/Folder | Purpose |
|---|---|
| `tizen/config.xml` | Tizen app manifest (app ID, name, version, icons) |
| `patches/` | Patch files applied to the Feishin build output |

---

## Configuration in SAWSUBE .env

| Variable | Value |
|---|---|
| `FIESHZEN_SRC_PATH` | `/home/will/Github/Fieshzen` (this repo) |
| `FIESHZEN_FEISHIN_SRC_PATH` | `/home/will/Github/feishin` |
| `FIESHZEN_TIZEN_PROFILE` | `TestProfile` |
| `Navidrome_URL` | `http://192.168.1.250:4534` |
| `Navidrome_username` | `wblinuxclean` |
| `Navidrome_password` | *(in .env)* |

---

## Full manual build steps (what SAWSUBE does automatically)

```bash
# 1. Build feishin web
cd /home/will/Github/feishin
pnpm install --frozen-lockfile
pnpm build:web

# 2. Let SAWSUBE package + install
curl -X POST http://127.0.0.1:8000/api/tizenbrew/1/build-install-fieshzen
tail -f /tmp/sawsube.log
```
