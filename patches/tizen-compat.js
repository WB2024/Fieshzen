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
    '[role="option"]',
    '[role="tab"]',
    '[role="link"]'
  ].join(',');

  function getFocusableElements() {
    return Array.from(document.querySelectorAll(FOCUSABLE)).filter(function (el) {
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
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

  // Jellyfin-style edge-geometry spatial nav.
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
      // If at the entry route, allow exit; otherwise go back
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

  // Initial focus once React mounts
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (document.activeElement && document.activeElement !== document.body) return;
      var first = getFocusableElements()[0];
      if (first) first.focus();
    }, 1500);
  });

  // Expose for debugging
  window.__fieshzenCompat = { getFocusableElements: getFocusableElements, findNext: findNext };

  console.log('[Fieshzen] Tizen compat layer initialised');
})();
