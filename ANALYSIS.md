# Fieshzen vs Sonance — Technical Analysis & Path Forward

**Date**: April 2026  
**Context**: Fieshzen is a Tizen WGT wrapper around the [Feishin](https://github.com/jeffvli/feishin) React/TypeScript web player. Sonance is a purpose-built vanilla JS Tizen Navidrome client. Both connect to Navidrome via the Subsonic API on a Samsung QE55LS03BAUXXU (Tizen 6.5, Chrome 85 WebKit).

---

## 1. Why Sonance Works (and Fieshzen Doesn't, Out of the Box)

### Root Cause: Tizen 6.5 rejects `data:` URIs on `<audio>`

Feishin (and therefore Fieshzen) includes this constant in its audio engine:

```javascript
// feishin/src/renderer/features/player/audio-player/engine/web-player-engine.tsx
const EMPTY_SOURCE = 'data:audio/mp3;base64,SUQzBAA...'; // ~300 chars of silent MP3
```

This silent MP3 is used as a Safari/WebKit autoplay unlock trick — before a user gesture has occurred, Feishin pre-loads this silent clip into its `react-player` dual-player gapless system (`src1 || EMPTY_SOURCE`, `src2 || EMPTY_SOURCE`). On desktop Safari this works fine.

On **Tizen 6.5** WebKit, every `data:` URI assigned to an `<audio>` element is hard-rejected:

```
MediaError.code=4 (MEDIA_ERR_SRC_NOT_SUPPORTED)
MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check
```

Tizen's URL safety filter is platform-level — it cannot be configured or bypassed from JavaScript. The rejection fires a DOM `error` event on the `<audio>` element.

Feishin's `react-player` wraps `<audio>` and has an error handler that retries on code 4:

```javascript
// Up to 5 retries with 2-second delay for MEDIA_ERR_SRC_NOT_SUPPORTED
const MAX_NETWORK_RETRIES = 5;
const NETWORK_RETRY_DELAY_MS = 2000;
```

This means Feishin enters an **infinite retry loop** on EMPTY_SOURCE, and the real Navidrome stream URL is **never attempted**. Result: complete silence, no music ever plays.

### Why Sonance Is Immune

Sonance detects `window.webapis.avplay` at startup and uses Tizen's **AVPlay API** — Samsung's proprietary native media engine — for all audio playback on TV:

```javascript
var IS_TIZEN = typeof window.webapis !== 'undefined' &&
               typeof window.webapis.avplay !== 'undefined';
```

AVPlay takes a direct HTTP stream URL, handles all codec negotiation at the OS level, and **has no concept of `<audio>` elements or `data:` URIs**. The entire EMPTY_SOURCE autoplay unlock pattern simply doesn't exist in Sonance.

---

## 2. The Fix We Implemented in `tizen-compat.js`

Since we cannot change Feishin's source easily (it's a compiled React app), `tizen-compat.js` runs **before React bootstraps** and patches the DOM to intercept every pathway Feishin uses to set a `data:` URI:

```javascript
// Section 0: fixTizenDataUriAudio()
// 1. HTMLMediaElement.prototype.src setter — blocks via property descriptor
// 2. Element.prototype.setAttribute — catches React reconciler path
// 3. document.createElement('audio') wrapper — patches play()/load() on every new element
// 4. window.Audio constructor — patches the Audio() constructor path
```

**Confirmed working** (10:26 debug session): logs show `[Fieshzen] Blocked data: URI via setAttribute` with zero error events from data: URIs. Authentication to Navidrome also confirmed working.

**What was NOT confirmed**: actual track playback through react-player after the data: URI is blocked. The intercept prevents the crash, but react-player's internal state machine may still not correctly trigger real URL loading without the EMPTY_SOURCE autoplay unlock it expects.

---

## 3. Remaining Fieshzen Problems (Even With the Fix)

### 3.1 Autoplay State Machine Broken

Feishin's dual-player gapless system (`src1`/`src2`) relies on EMPTY_SOURCE to:
1. Confirm the `<audio>` element is "ready" (no error = autoplay unlocked)
2. Put both players into a "primed" state before music starts

When we block the data: URI silently (no error, no success), react-player may wait indefinitely for an `onReady` or `canPlay` event that never comes. The fix makes Tizen *not crash*, but doesn't necessarily make Feishin *work*.

### 3.2 react-player Overhead on Tizen 6.5 WebKit

react-player adds a significant abstraction layer:
- Virtual DOM reconciliation on every state change (volume, src, playbackRate)
- Event mapping from React synthetic events to native DOM events
- Dual-instance management for gapless (both players always mounted in DOM)
- No awareness of Tizen's AVPlay API — always uses `<audio>` regardless of platform

Tizen 6.5 runs Chrome 85-era WebKit, which is notably slower than modern browsers. The full React/Vite bundle (Feishin) is several MB; startup time is multi-second.

### 3.3 Spatial Navigation Fragility

`tizen-compat.js` uses a geometry-based spatial navigation algorithm (ported from Jellyfin): on every D-pad keypress it queries all focusable DOM elements and picks the geometrically nearest one in the pressed direction.

Problems on Tizen:
- **Performance**: Full DOM query + geometry calculation on every keypress. On Tizen 6.5 this can lag, especially in large library grids.
- **Unpredictability**: React's virtual DOM reorders/recreates elements. The "nearest" element may jump unexpectedly after renders.
- **Grid misalignment**: Elements with fractional pixel positions (React CSS-in-JS) cause the distance algorithm to pick wrong targets in album grids.
- **Overlay conflict**: Modal dialogs and floating panels can capture focus incorrectly.

### 3.4 No Screen Saver Suppression

Feishin has no awareness of `webapis.appcommon.setScreenSaver`. The Samsung TV will dim/blank the screen mid-playback after the configured timeout (default ~5 minutes).

### 3.5 No AVPlay — No True Gapless on Tizen

Even if Feishin's react-player is coerced into loading the real stream URL, HTML5 `<audio>` gapless on Tizen 6.5 is unreliable. AVPlay (which Sonance uses) handles gapless natively with `onstreamcompleted` and pre-prepare. HTML5's `ended` + new `src` approach has a noticeable gap on Tizen WebKit.

### 3.6 Bundle Size & Memory

Feishin's compiled bundle is large. Tizen TV apps run in a constrained WebKit sandbox with limited RAM. Heavy React apps can trigger OOM crashes or severe GC pauses.

---

## 4. What Would Be Needed to Make Fieshzen Work as Well as Sonance

### Priority 1 — Fix Audio (Without This, Nothing Else Matters)

**Option A: Complete react-player replacement**
Replace `react-player` in Feishin source with a thin Tizen-aware audio module:
- Detects `webapis.avplay` → uses AVPlay
- Falls back to vanilla `<audio>` (no EMPTY_SOURCE) for browsers
- This requires forking Feishin's TypeScript source and wiring into its Zustand audio state

**Option B: tizen-compat.js deep hook (current approach)**
Extend the existing patch to also intercept react-player's internal `onReady` cycle:
- When the data: URI is blocked, *synthetically fire* the events react-player expects (`canplay`, `loadedmetadata`) on the audio element so it considers the player "primed"
- Then when the real URL arrives, ensure it's applied immediately
- Fragile, but avoids touching Feishin's source

**Option C: AVPlay injection via tizen-compat.js**
Completely replace the `<audio>` element's DOM API surface with a thin AVPlay proxy:
- `document.createElement('audio')` returns a fake element whose `.src` setter fires `avplay.open(url)`, `.play()` fires `avplay.play()`, etc.
- Events from AVPlay callbacks are dispatched as DOM events on the fake element
- This fools react-player into thinking it has a normal `<audio>`, while actually using AVPlay
- Complex but theoretically correct

### Priority 2 — Navigation Overhaul

Replace the geometry-based spatial nav in `tizen-compat.js` with a Sonance-style **zone-based system**:

```javascript
// Instead of: pick nearest element geometrically
// Do: define explicit zones matching Feishin's UI regions

registerZone('sidebar', { selector: '.nav-sidebar a', neighbors: { right: 'content' } });
registerZone('content', { selector: '.grid-item', columns: 5, neighbors: { left: 'sidebar', down: 'player' } });
registerZone('player', { selector: '.player-controls button', neighbors: { up: 'content' } });
```

Feishin's React components use predictable class names; zone definitions can be hardcoded per-route.

### Priority 3 — Screen Saver Suppression

Add to `tizen-compat.js`:
```javascript
function suppressScreenSaver(suppress) {
  if (!window.webapis || !window.webapis.appcommon) return;
  var state = window.webapis.appcommon.AppCommonScreenSaverState;
  window.webapis.appcommon.setScreenSaver(
    suppress ? state.SCREEN_SAVER_OFF : state.SCREEN_SAVER_ON,
    function(){}, function(){}
  );
}
// Hook into Feishin's play/pause state via MutationObserver on the player bar
```

### Priority 4 — Performance

- Preload only the visible route's bundle (Feishin supports lazy routes)
- Reduce React render frequency by ensuring Zustand selectors are granular
- Throttle spatial nav queries (debounce at 100ms)

---

## 5. Honest Assessment: Should We Fix Fieshzen or Start Fresh?

| Criterion | Fix Fieshzen | Build Fresh (Castafiorezen) |
|---|---|---|
| Audio reliability | Fragile patches on top of react-player | Native AVPlay — proven working |
| Navigation | Zone overhaul of an existing geometry system | Purpose-built zone system from day one |
| Features | All of Feishin's rich feature set already exists | Must be built feature by feature |
| Bundle size | 3–5MB React bundle, slow cold start | <200KB vanilla JS, instant start |
| Maintainability | Every Feishin upstream update risks breaking patches | Full ownership, no upstream dependency |
| Development effort | Medium (patching existing code) | High (greenfield build) |
| Long-term quality | Always fighting the React/Tizen mismatch | Correct by architecture |
| Risk | High — may never achieve stable audio | Low — Sonance proves the architecture works |

**Verdict**: Feishin is an outstanding desktop player and the correct tool for desktop/macOS use. It was not designed for Samsung TV WebKit, and the architectural gap (React + react-player vs Tizen's AVPlay) is too wide to bridge cleanly with patches. The right move is to build **Castafiorezen** — a purpose-built vanilla JS Tizen WGT inspired by Castafiore's UX and Sonance's proven TV architecture.

---

## 6. Sonance Code Patterns to Carry Forward

### Audio Engine (player.js)
- `IS_TIZEN` flag — `typeof window.webapis.avplay !== 'undefined'`
- AVPlay: `open(url)` → `setDisplayRect(0,0,1,1)` (audio-only, off-screen) → `prepareAsync(success, err)` → `play()`
- Gapless: pre-prepare next track URL 5s before end via `oncurrentplaytime` callback
- HTML5 fallback: dual-element swap (`_audio` ↔ `_preloadAudio`) at `onended`
- Screen saver: `webapis.appcommon.setScreenSaver` toggled on play/pause
- Custom event bus: `on(event, fn)` / `_emit(event, data)` — decouples player from UI

### Focus System (focus.js)
- Named zones: `registerZone(name, { selector, columns, neighbors, onActivate })`
- Zone transitions: explicit `neighbors` map (not geometry calculation)
- `clearContentZones()` — wipe screen-specific zones on route change; sidebar + now-playing bar persist
- Focus CSS class, `scrollIntoView({ block: 'nearest' })`
- `_inputMode` flag — suppresses D-pad when Samsung IME keyboard is active

### App Shell (app.js)
- Colour hint bar — shows remote button labels (yellow/blue/red/green keys) contextually per screen
- Toast notifications — lightweight, no library dependency
- `SonanceSettings` — `localStorage` for user preferences
- S-wave logo SVG built programmatically (no image assets)
