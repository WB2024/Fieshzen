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

    candidates.sort(function (a, b) {
      var ca = getCenter(getRect(a));
      var cb = getCenter(getRect(b));
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

    // Native arrow handlers — let them run
    var tag = (active.tagName || '').toLowerCase();
    var role = active.getAttribute && (active.getAttribute('role') || '');
    var typeAttr = active.getAttribute && (active.getAttribute('type') || '');
    var nativeArrow = (
      tag === 'input' && typeAttr !== 'checkbox' && typeAttr !== 'radio' && typeAttr !== 'button' ||
      tag === 'textarea' ||
      tag === 'select' ||
      role === 'slider' ||
      role === 'scrollbar' ||
      (active.classList && (
        active.classList.contains('mantine-Slider-thumb') ||
        active.classList.contains('mantine-Slider-root')
      ))
    );
    if (nativeArrow) return;

    var next = findNext(active, direction);
    if (next) {
      next.focus();
      try { next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e3) {}
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
