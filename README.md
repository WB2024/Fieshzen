# Fieshzen

Samsung Tizen TV port of [Feishin](https://github.com/jeffvli/feishin) — a self-hosted music player for Navidrome / OpenSubsonic servers.

Fieshzen wraps Feishin's existing web build (`pnpm build:web`) inside a Tizen WGT package, with three additions:

- `tizen/config.xml` — Tizen widget manifest (package `FshznTV001`).
- `patches/tizen-compat.js` — Samsung remote-key registration + spatial D-pad navigation.
- `patches/tizen-fixes.css` — Tizen WebKit compatibility tweaks.

## How it gets onto your TV

Intended route is [SAWSUBE](https://github.com/WB2024/SAWSUBE):

\`\`\`bash
curl -X POST http://<sawsube>/api/tizenbrew/<tv_id>/build-install-fieshzen
\`\`\`

SAWSUBE authenticates with Navidrome, writes settings.js + fieshzen-auth.js into the WGT (pre-seeding Zustand auth state), runs pnpm build:web, packages, re-signs if needed, installs via sdb.

## Manual build

\`\`\`bash
FEISHIN_SRC=/path/to/feishin PROFILE=TestProfile ./build.sh
~/tizen-studio/tools/sdb connect <tv-ip>
~/tizen-studio/tools/ide/bin/tizen install -n Fieshzen.wgt
\`\`\`

## Remote control

| Remote key       | Action                       |
|------------------|------------------------------|
| D-pad arrows     | Spatial navigation           |
| OK / Enter       | Activate focused element     |
| Back / Return    | History back / exit at root  |
| Play             | Play                         |
| Pause            | Pause                        |
| Play/Pause       | Toggle play/pause            |
| Stop             | Stop                         |
| FF / Rewind      | Skip forward / backward      |
| Red              | Toggle shuffle               |
| Green            | Toggle repeat                |

## License

Feishin is GPL-3.0. Fieshzen is GPL-3.0.
