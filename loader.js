(function () {
  'use strict';

  var script = document.currentScript;
  var scriptUrl = script && script.src ? new URL(script.src, document.baseURI) : null;
  var settings = script ? script.dataset : {};
  var fontFamily = settings.family || 'HarmonyOSHans-Regular';
  var cssUrl = settings.css || (scriptUrl ? new URL('common.css', scriptUrl).href : 'common.css');
  var rootSelector = settings.root || 'body';
  var configuredWeights = parseWeights(settings.weights || '300,400,500,700');
  var idleTimeout = clampNumber(settings.idleTimeout, 1200, 0, 10000);
  var loadTimeout = clampNumber(settings.loadTimeout, 10000, 1000, 30000);
  var autoLoad = settings.auto !== 'false';
  var observer = null;
  var mutationTimer = null;
  var loadPromise = null;
  var resolveReady;
  var rejectReady;

  var ready = new Promise(function (resolve, reject) {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function parseWeights(value) {
    var parsed = String(value)
      .split(',')
      .map(function (weight) { return Number.parseInt(weight.trim(), 10); })
      .filter(function (weight) { return Number.isFinite(weight) && weight >= 100 && weight <= 900; });

    return parsed.length ? Array.from(new Set(parsed)).sort(function (a, b) { return a - b; }) : [400];
  }

  function clampNumber(value, fallback, min, max) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function resolveRoot() {
    return document.querySelector(rootSelector) || document.body || document.documentElement;
  }

  function closestWeight(value) {
    var numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) numeric = value === 'bold' ? 700 : 400;

    return configuredWeights.reduce(function (closest, weight) {
      return Math.abs(weight - numeric) < Math.abs(closest - numeric) ? weight : closest;
    }, configuredWeights[0]);
  }

  function isUsableTextNode(node) {
    if (!node || !node.nodeValue || !node.nodeValue.trim()) return false;
    var parent = node.parentElement;
    if (!parent || parent.closest('script, style, noscript, template')) return false;

    var style = window.getComputedStyle(parent);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function collectText(node, buckets) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      if (!isUsableTextNode(node)) return;
      var parentStyle = window.getComputedStyle(node.parentElement);
      var textWeight = closestWeight(parentStyle.fontWeight);
      buckets[textWeight] = (buckets[textWeight] || '') + node.nodeValue;
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (node.nodeType === Node.ELEMENT_NODE && node.matches('script, style, noscript, template')) return;

    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    var current;
    while ((current = walker.nextNode())) collectText(current, buckets);
  }

  function uniqueCharacters(text) {
    var characters = new Set();
    for (var character of String(text)) {
      if (!/\s/u.test(character)) characters.add(character);
    }
    return Array.from(characters).join('');
  }

  function loadTextBuckets(buckets) {
    if (!document.fonts || typeof document.fonts.load !== 'function') return Promise.resolve([]);

    var requests = Object.keys(buckets).map(function (weight) {
      var text = uniqueCharacters(buckets[weight]);
      if (!text) return Promise.resolve([]);
      return document.fonts.load(weight + ' 1em "' + fontFamily.replace(/"/g, '\\"') + '"', text);
    });

    return Promise.all(requests);
  }

  function scan(target) {
    var buckets = {};
    collectText(target || resolveRoot(), buckets);
    return loadTextBuckets(buckets);
  }

  function loadStylesheet() {
    var existing = document.querySelector('link[data-harmonyos-hans="stylesheet"]');
    if (existing) {
      if (existing.dataset.loaded === 'true' || existing.sheet) return Promise.resolve(existing);
      return waitForStylesheet(existing);
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    link.crossOrigin = 'anonymous';
    link.dataset.harmonyosHans = 'stylesheet';
    document.head.appendChild(link);
    return waitForStylesheet(link);
  }

  function waitForStylesheet(link) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timeout = window.setTimeout(function () {
        finish(new Error('HarmonyOSHans stylesheet timed out: ' + link.href));
      }, loadTimeout);

      function finish(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        link.removeEventListener('load', onLoad);
        link.removeEventListener('error', onError);
        if (error) reject(error);
        else {
          link.dataset.loaded = 'true';
          resolve(link);
        }
      }

      function onLoad() { finish(); }
      function onError() { finish(new Error('HarmonyOSHans stylesheet failed to load: ' + link.href)); }

      link.addEventListener('load', onLoad, { once: true });
      link.addEventListener('error', onError, { once: true });
    });
  }

  function flushMutations(nodes) {
    var buckets = {};
    nodes.forEach(function (node) { collectText(node, buckets); });
    loadTextBuckets(buckets).catch(function (error) {
      console.warn('[HarmonyOSHans] Failed to preload dynamic text.', error);
    });
  }

  function observe() {
    if (observer || typeof MutationObserver === 'undefined') return observer;

    var pendingNodes = new Set();
    observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        if (mutation.type === 'characterData') pendingNodes.add(mutation.target);
        mutation.addedNodes.forEach(function (node) { pendingNodes.add(node); });
      });

      window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(function () {
        var nodes = Array.from(pendingNodes);
        pendingNodes.clear();
        flushMutations(nodes);
      }, 80);
    });

    observer.observe(resolveRoot(), {
      childList: true,
      characterData: true,
      subtree: true
    });
    return observer;
  }

  function disconnect() {
    window.clearTimeout(mutationTimer);
    mutationTimer = null;
    if (observer) observer.disconnect();
    observer = null;
  }

  function load() {
    if (loadPromise) return loadPromise;

    loadPromise = loadStylesheet()
      .then(function () { return scan(resolveRoot()); })
      .then(function () {
        observe();
        resolveReady(api);
        return api;
      })
      .catch(function (error) {
        rejectReady(error);
        throw error;
      });

    return loadPromise;
  }

  function scheduleAutoLoad() {
    var start = function () {
      var run = function () {
        load().catch(function (error) {
          console.warn('[HarmonyOSHans] Lazy loading failed.', error);
        });
      };

      if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: idleTimeout });
      else window.setTimeout(run, Math.min(idleTimeout, 200));
    };

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }

  var api = {
    config: {
      cssUrl: cssUrl,
      family: fontFamily,
      root: rootSelector,
      weights: configuredWeights.slice()
    },
    ready: ready,
    load: load,
    scan: scan,
    observe: observe,
    disconnect: disconnect
  };

  window.HarmonyOSHans = api;
  if (autoLoad) scheduleAutoLoad();
})();
