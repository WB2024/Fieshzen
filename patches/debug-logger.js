/* ============================================================
   Fieshzen — Remote Debug Logger
   Forwards console.* output, uncaught errors, and unhandled
   promise rejections to a WebSocket server on the dev machine.

   HOST and PORT are replaced at build time by build.sh when
   DEBUG_HOST is set. Do NOT hardcode these values here.
   ============================================================ */
(function () {
  'use strict';

  var WS_URL = 'ws://__DEBUG_HOST__:__DEBUG_PORT__';
  var RECONNECT_DELAY = 3000;
  var MAX_QUEUE = 200;

  var queue = [];
  var ws = null;
  var connected = false;

  function safeSend(msg) {
    if (connected && ws && ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); return true; } catch (e) { /* fall through */ }
    }
    if (queue.length < MAX_QUEUE) {
      queue.push(msg);
    }
    return false;
  }

  function flush() {
    while (queue.length > 0 && connected && ws && ws.readyState === 1) {
      try {
        ws.send(queue.shift());
      } catch (e) {
        break;
      }
    }
  }

  function serialize(a) {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'string') return a;
    if (typeof a === 'number' || typeof a === 'boolean') return String(a);
    if (a instanceof Error) return a.stack || a.message;
    try { return JSON.stringify(a, null, 2); } catch (e) { return '[unserializable]'; }
  }

  function send(obj) {
    try {
      safeSend(JSON.stringify(obj));
    } catch (e) { /* never throw from the logger itself */ }
  }

  function connect() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      setTimeout(connect, RECONNECT_DELAY);
      return;
    }

    ws.onopen = function () {
      connected = true;
      send({ type: 'connect', ua: navigator.userAgent, url: location.href, ts: Date.now() });
      flush();
    };

    ws.onclose = function () {
      connected = false;
      ws = null;
      setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = function () {
      // onclose fires after this and handles reconnect
    };
  }

  // ── Intercept Audio element to capture stream URLs + media errors ─────
  var OrigAudio = window.Audio;
  var audioInstances = [];

  function patchAudioElement(el) {
    var lastSrc = '';
    var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');

    el.addEventListener('error', function () {
      var err = el.error;
      var code = err ? err.code : 'none';
      var codeNames = {1:'ABORTED',2:'NETWORK',3:'DECODE',4:'NOT_SUPPORTED'};
      send({
        type: 'console', level: 'error', ts: Date.now(),
        args: [
          '[AUDIO_ELEMENT] error event',
          'src=' + (el.src || el.currentSrc || lastSrc || '(empty)'),
          'MediaError.code=' + code + ' (' + (codeNames[code] || 'unknown') + ')',
          'MediaError.message=' + (err && err.message ? err.message : 'none'),
          'networkState=' + el.networkState,
          'readyState=' + el.readyState,
        ]
      });
    }, true);

    el.addEventListener('stalled', function () {
      send({ type: 'console', level: 'warn', ts: Date.now(),
        args: ['[AUDIO_ELEMENT] stalled', 'src=' + (el.src || el.currentSrc || lastSrc)] });
    }, true);

    el.addEventListener('play', function () {
      lastSrc = el.src || el.currentSrc || '';
      send({ type: 'console', level: 'info', ts: Date.now(),
        args: ['[AUDIO_ELEMENT] play attempted', 'src=' + lastSrc] });
    }, true);

    return el;
  }

  try {
    window.Audio = function (src) {
      var el = src ? new OrigAudio(src) : new OrigAudio();
      patchAudioElement(el);
      audioInstances.push(el);
      send({ type: 'console', level: 'info', ts: Date.now(),
        args: ['[AUDIO_ELEMENT] created via new Audio()', 'src=' + (src || '(none)')] });
      return el;
    };
    window.Audio.prototype = OrigAudio.prototype;
  } catch (e) { /* Audio constructor patching not supported */ }

  // Also intercept document.createElement('audio') — Feishin uses this path
  var origCreateElement = document.createElement.bind(document);
  document.createElement = function (tag) {
    var el = origCreateElement(tag);
    if (typeof tag === 'string' && tag.toLowerCase() === 'audio') {
      patchAudioElement(el);
      send({ type: 'console', level: 'info', ts: Date.now(),
        args: ['[AUDIO_ELEMENT] created via createElement("audio")'] });
    }
    return el;
  };

  // Intercept src property setter on all HTMLMediaElements
  var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (srcDescriptor && srcDescriptor.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      get: srcDescriptor.get,
      set: function (val) {
        if (val && !val.startsWith('data:')) {
          send({ type: 'console', level: 'info', ts: Date.now(),
            args: ['[AUDIO_ELEMENT] src SET → ' + val, 'tag=' + this.tagName] });
        }
        return srcDescriptor.set.call(this, val);
      },
      configurable: true,
    });
  }

  // Patch HTMLMediaElement.prototype.load to catch dynamic src changes
  var origLoad = HTMLMediaElement.prototype.load;
  HTMLMediaElement.prototype.load = function () {
    var src = this.src || this.currentSrc || '';
    if (src && !src.startsWith('data:')) {
      send({ type: 'console', level: 'info', ts: Date.now(),
        args: ['[AUDIO_ELEMENT] load()', 'src=' + src, 'tag=' + this.tagName] });
    }
    return origLoad.apply(this, arguments);
  };

  // ── Intercept console methods ─────────────────────────────────────────
  ['log', 'info', 'warn', 'error', 'debug', 'trace'].forEach(function (level) {
    var orig = console[level] ? console[level].bind(console) : null;
    console[level] = function () {
      if (orig) orig.apply(console, arguments);
      var args = Array.prototype.slice.call(arguments).map(serialize);
      send({ type: 'console', level: level, args: args, ts: Date.now() });
    };
  });

  // ── Uncaught JS errors ────────────────────────────────────────────────
  var _onerror = window.onerror;
  window.onerror = function (msg, src, line, col, err) {
    send({
      type: 'error',
      msg: String(msg),
      src: src || '',
      line: line || 0,
      col: col || 0,
      stack: (err && err.stack) || '',
      ts: Date.now()
    });
    if (typeof _onerror === 'function') return _onerror.apply(this, arguments);
  };

  // ── Unhandled promise rejections ──────────────────────────────────────
  window.addEventListener('unhandledrejection', function (e) {
    var reason = e.reason;
    send({
      type: 'unhandledrejection',
      msg: reason instanceof Error ? reason.message : serialize(reason),
      stack: reason instanceof Error ? (reason.stack || '') : '',
      ts: Date.now()
    });
  });

  connect();
})();
