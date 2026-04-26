/* ============================================================
   Fieshzen — Tizen TV Compatibility + Remote Navigation
   Runs before React bootstrap.
   ============================================================ */
(function () {
  'use strict';

  // ── 1. Register Samsung media keys ─────────────────────────────────────
  function registerTizenKeys() {
    if (typeof window === 'undefined') return;
    if (!window.tizen || !window.tizen.tvinputdevice) return;
    var keys = [
      'MediaPlay', 'MediaPause', 'MediaStop',
      'MediaFastForward', 'MediaRewind',
      'MediaPlayPause',
      'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
    ];
    keys.forEach(function (k) {
      try { window.tizen.tvinputdevice.registerKey(k); } catch (e) { /* ignore */ }
    });
  }

  // ── 2. Spatial navigation ──────────────────────────────────────────────
  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[role="button"]:not([disabled])',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="link"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="slider"]'
  ].join(',');

  // Sonance-style scope trap: when a modal/drawer/popover/menu is open,
  // restrict spatial nav to within it. Picks topmost open overlay.
  var OVERLAY_SELECTORS = [
    '[role="dialog"][aria-modal="true"]',
    '.mantine-Modal-content',
    '.mantine-Drawer-content',
    '.mantine-Popover-dropdown',
    '.mantine-Menu-dropdown',
    '.mantine-HoverCard-dropdown',
    '[data-context-menu]'
  ];

  function getActiveScope() {
    for (var i = OVERLAY_SELECTORS.length - 1; i >= 0; i--) {
      var nodes = document.querySelectorAll(OVERLAY_SELECTORS[i]);
      for (var j = nodes.length - 1; j >= 0; j--) {
        var n = nodes[j];
        if (n.offsetParent !== null || window.getComputedStyle(n).position === 'fixed') {
          var rect = n.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return n;
        }
      }
    }
    return document;
  }

  function getFocusableElements(scope) {
    scope = scope || getActiveScope();
    return Array.prototype.slice.call(scope.querySelectorAll(FOCUSABLE)).filter(function (el) {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.pointerEvents === 'none') return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.offsetParent === null && style.position !== 'fixed') return false;
      var rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function getRect(el) { return el.getBoundingClientRect(); }
  function getCenter(rect) { return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }

  function intersects(a1, a2, b1, b2) {
    return (b1 >= a1 && b1 <= a2) || (b2 >= a1 && b2 <= a2) ||
           (a1 >= b1 && a1 <= b2) || (a2 >= b1 && a2 <= b2);
  }

  // Jellyfin-style edge-geometry spatial nav, scoped to current overlay.
  function findNext(current, direction) {
    var elements = getFocusableElements();
    var r = getRect(current);
    var p1x = r.left, p1y = r.top;
    var p2x = r.left + r.width - 1, p2y = r.top + r.height - 1;
    var sMidX = r.left + r.width / 2, sMidY = r.top + r.height / 2;
    var dirIdx = { left: 0, right: 1, up: 2, down: 3 }[direction];

    var best = null, minDist = Infinity;
    for (var i = 0; i < elements.length; i++) {
      var c = elements[i];
      if (c === current) continue;
      var er = getRect(c);
      if (!er.width && !er.height) continue;
      switch (dirIdx) {
        case 0: if (er.left >= r.left || er.right === r.right) continue; break;
        case 1: if (er.right <= r.right || er.left === r.left) continue; break;
        case 2: if (er.top >= r.top || er.bottom >= r.bottom) continue; break;
        case 3: if (er.bottom <= r.bottom || er.top <= r.top) continue; break;
      }
      var x = er.left, y = er.top;
      var x2 = x + er.width - 1, y2 = y + er.height - 1;
      var ix = intersects(p1x, p2x, x, x2);
      var iy = intersects(p1y, p2y, y, y2);
      var midX = er.left + er.width / 2, midY = er.top + er.height / 2;
      var dx, dy;
      switch (dirIdx) {
        case 0: dx = Math.abs(p1x - Math.min(p1x, x2)); dy = iy ? 0 : Math.abs(sMidY - midY); break;
        case 1: dx = Math.abs(p2x - Math.max(p2x, x));  dy = iy ? 0 : Math.abs(sMidY - midY); break;
        case 2: dy = Math.abs(p1y - Math.min(p1y, y2)); dx = ix ? 0 : Math.abs(sMidX - midX); break;
        case 3: dy = Math.abs(p2y - Math.max(p2y, y));  dx = ix ? 0 : Math.abs(sMidX - midX); break;
      }
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) { minDist = d; best = c; }
    }
    return best;
  }

  // ── 3. Player action bridge ─────────────────────────────────────────────
  function dispatchPlayerAction(action) {
    window.dispatchEvent(new CustomEvent('fieshzen:player', { detail: { action: action } }));
  }

  // ── 3b. Per-route focus memory (sonance-inspired) ──────────────────────
  // Store last focused element by route so Back returns the user where they were.
  var routeFocus = Object.create(null);
  function routeKey() { return (location.hash || '') + '|' + (location.pathname || ''); }
  function rememberFocus() {
    var a = document.activeElement;
    if (!a || a === document.body) return;
    routeFocus[routeKey()] = a;
  }
  function restoreOrInitFocus() {
    var saved = routeFocus[routeKey()];
    if (saved && document.contains(saved)) {
      try { saved.focus(); saved.scrollIntoView({ block: 'nearest' }); return; } catch (_) {}
    }
    // Otherwise: focus first plausible content element (skip header/sidebar).
    var all = getFocusableElements(document);
    if (!all.length) return;
    // Prefer items inside main / [role=main] / .mantine-AppShell-main.
    var main = document.querySelector('main, [role="main"], .mantine-AppShell-main, #main, #root main');
    if (main) {
      var inMain = all.filter(function (e) { return main.contains(e); });
      if (inMain.length) { try { inMain[0].focus(); inMain[0].scrollIntoView({ block: 'nearest' }); return; } catch (_) {} }
    }
    try { all[0].focus(); } catch (_) {}
  }

  window.addEventListener('beforeunload', rememberFocus);
  window.addEventListener('hashchange', function () {
    setTimeout(restoreOrInitFocus, 120);
  });
  window.addEventListener('popstate', function () {
    setTimeout(restoreOrInitFocus, 120);
  });
  // Patch pushState/replaceState so SPA route changes also trigger restore.
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    if (typeof orig !== 'function') return;
    history[m] = function () {
      rememberFocus();
      var r = orig.apply(this, arguments);
      setTimeout(restoreOrInitFocus, 120);
      return r;
    };
  });

  // ── 4. Keydown handler ──────────────────────────────────────────────────
  function handleKeyDown(e) {
    var code = e.keyCode;

    // Media keys
    if (code === 415) { dispatchPlayerAction('play'); e.preventDefault(); return; }
    if (code === 19)  { dispatchPlayerAction('pause'); e.preventDefault(); return; }
    if (code === 10252) { dispatchPlayerAction('togglePlayPause'); e.preventDefault(); return; }
    if (code === 413) { dispatchPlayerAction('stop'); e.preventDefault(); return; }
    if (code === 417) { dispatchPlayerAction('skipForward'); e.preventDefault(); return; }
    if (code === 412) { dispatchPlayerAction('skipBackward'); e.preventDefault(); return; }

    // Back key (Tizen)
    if (code === 10009) {
      e.preventDefault();
      // Sonance-style: if focus is inside an input or an overlay, escape that
      // first instead of routing back.
      var ae = document.activeElement;
      var inField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (inField) {
        try { ae.blur(); } catch (_) {}
        return;
      }
      var scope = getActiveScope();
      if (scope !== document) {
        // Try to click a close button in the overlay; otherwise dispatch Esc.
        var closeBtn = scope.querySelector('[aria-label="Close"], [data-mantine-stop-propagation="true"][aria-label*="close" i], .mantine-Modal-close, .mantine-Drawer-close');
        if (closeBtn) { try { closeBtn.click(); return; } catch (_) {} }
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
        } catch (_) {}
        return;
      }
      try {
        if (window.history.length > 1) {
          window.history.back();
        } else if (window.tizen && window.tizen.application) {
          window.tizen.application.getCurrentApplication().exit();
        }
      } catch (err) { /* ignore */ }
      return;
    }

    // Colour keys
    if (code === 403) { dispatchPlayerAction('toggleShuffle'); e.preventDefault(); return; }
    if (code === 404) { dispatchPlayerAction('toggleRepeat'); e.preventDefault(); return; }

    // Enter on text input → submit + blur, then drop into results.
    if (code === 13) {
      var actv = document.activeElement;
      var atag = actv && actv.tagName ? actv.tagName.toLowerCase() : '';
      var atype = actv && actv.getAttribute ? (actv.getAttribute('type') || '') : '';
      var isTxt = (atag === 'input' && atype !== 'checkbox' && atype !== 'radio' &&
                   atype !== 'button' && atype !== 'submit' && atype !== 'reset' &&
                   atype !== 'range' && atype !== 'file') ||
                  atag === 'textarea' ||
                  (actv && actv.isContentEditable === true);
      if (isTxt) {
        try { actv.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        try { actv.blur(); } catch (_) {}
        e.preventDefault();
        setTimeout(function () {
          var nxt = findNext(actv, 'down');
          if (nxt) { nxt.focus(); try { nxt.scrollIntoView({ block: 'nearest' }); } catch (_) {} }
        }, 80);
        return;
      }
      // Enter on non-native focusable (div[role=button], list rows, etc.):
      // browser only auto-clicks <button>/<a>. Synthesise click for the rest.
      if (actv && actv !== document.body) {
        var nativelyClickable = atag === 'button' || atag === 'a' ||
          (atag === 'input' && (atype === 'submit' || atype === 'button' || atype === 'reset' ||
                                 atype === 'checkbox' || atype === 'radio'));
        if (!nativelyClickable) {
          e.preventDefault();
          try { actv.click(); } catch (_) {}
          return;
        }
      }
    }

    // Arrow keys → spatial navigation
    var dirMap = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
    var direction = dirMap[code];
    if (!direction) return;

    var active = document.activeElement;
    if (!active || active === document.body) {
      var first = getFocusableElements()[0];
      if (first) {
        first.focus();
        try { first.scrollIntoView({ block: 'nearest' }); } catch (e2) {}
      }
      e.preventDefault();
      return;
    }

    // Native arrow handlers — jellyfin model:
    //   text input/textarea  → LEFT/RIGHT pass through (caret), UP/DOWN navigate.
    //   select / slider      → all arrows pass through (native control).
    var tag = (active.tagName || '').toLowerCase();
    var role = active.getAttribute && (active.getAttribute('role') || '');
    var typeAttr = active.getAttribute && (active.getAttribute('type') || '');
    var isTextInput = (
      (tag === 'input' && typeAttr !== 'checkbox' && typeAttr !== 'radio' &&
        typeAttr !== 'button' && typeAttr !== 'submit' && typeAttr !== 'reset' &&
        typeAttr !== 'range' && typeAttr !== 'file') ||
      tag === 'textarea' ||
      (active.isContentEditable === true)
    );
    var isNativeArrowConsumer = (
      tag === 'select' ||
      role === 'slider' ||
      role === 'scrollbar' ||
      (active.classList && (
        active.classList.contains('mantine-Slider-thumb') ||
        active.classList.contains('mantine-Slider-root')
      ))
    );
    if (isNativeArrowConsumer) return;
    if (isTextInput && (direction === 'left' || direction === 'right')) return;

    var next = findNext(active, direction);
    if (next) {
      // Blur input so further keys don't go to it.
      if (isTextInput) { try { active.blur(); } catch (_) {} }
      next.focus();
      try { next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e3) {}
      e.preventDefault();
      e.stopPropagation();
    } else if (isTextInput) {
      // No candidate but still consume so caret doesn't move on up/down.
      e.preventDefault();
    }
  }

  // ── 5. Initialise ───────────────────────────────────────────────────────
  registerTizenKeys();
  document.addEventListener('keydown', handleKeyDown, true);
  // Track focus changes for route memory.
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target !== document.body) {
      routeFocus[routeKey()] = e.target;
    }
  }, true);

  // Initial focus once React mounts
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (document.activeElement && document.activeElement !== document.body) return;
      restoreOrInitFocus();
    }, 1500);
  });

  // Expose for debugging
  window.__fieshzenCompat = {
    getFocusableElements: getFocusableElements,
    findNext: findNext,
    getActiveScope: getActiveScope,
    routeFocus: routeFocus
  };

  console.log('[Fieshzen] Tizen compat layer initialised (sonance-style)');
})();
