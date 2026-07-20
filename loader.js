(function () {
  'use strict';

  var script = document.currentScript;
  var scriptUrl = script && script.src ? new URL(script.src, document.baseURI) : null;
  var settings = script ? script.dataset : {};
  var fontFamily = settings.family || 'HarmonyOSHans-Regular';
  var cssUrl = settings.css || (scriptUrl ? new URL('common.css', scriptUrl).href : 'common.css');
  var rootSelector = settings.root || 'body';
  var configuredWeights = parseWeights(settings.weights || '300,400,500,700');
  var useSplitStylesheets = settings.split ? settings.split !== 'false' : !settings.css;
  var idleTimeout = clampNumber(settings.idleTimeout, 1200, 0, 10000);
  var loadTimeout = clampNumber(settings.loadTimeout, 10000, 1000, 30000);
  var autoLoad = settings.auto !== 'false';
  var observer = null;
  var mutationTimer = null;
  var loadPromise = null;
  var aggregateStylesheetPromise = null;
  var weightStylesheetPromises = new Map();
  var resolveReady;
  var rejectReady;

  var ready = new Promise(function (resolve, reject) {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function parseWeights(value) {
    var source = Array.isArray(value) ? value : String(value).split(',');
    var parsed = source
      .map(function (weight) { return Number.parseInt(String(weight).trim(), 10); })
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
    if (configuredWeights.includes(numeric)) return numeric;

    return configuredWeights.reduce(function (closest, weight) {
      var distance = Math.abs(weight - numeric);
      var closestDistance = Math.abs(closest - numeric);
      if (distance < closestDistance) return weight;
      if (distance === closestDistance && numeric >= 500 && weight > closest) return weight;
      return closest;
    }, configuredWeights[0]);
  }

  function usesFontFamily(style) {
    return style.fontFamily
      .split(',')
      .map(function (family) { return family.trim().replace(/^['"]|['"]$/g, ''); })
      .includes(fontFamily);
  }

  function isUsableTextNode(node) {
    if (!node || !node.nodeValue || !node.nodeValue.trim()) return false;
    var parent = node.parentElement;
    if (!parent || parent.closest('script, style, noscript, template')) return false;

    var style = window.getComputedStyle(parent);
    return style.display !== 'none' && style.visibility !== 'hidden' && usesFontFamily(style);
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

  function getWeightStylesheetUrl(weight) {
    var customUrl = script && script.getAttribute('data-css-' + weight);
    if (customUrl) return new URL(customUrl, document.baseURI).href;
    if (scriptUrl) return new URL('common-' + weight + '.css', scriptUrl).href;
    return 'common-' + weight + '.css';
  }

  function findStylesheet(weight) {
    return document.querySelector(
      'link[data-harmonyos-hans="stylesheet"][data-weight="' + String(weight) + '"]'
    );
  }

  function ensureAggregateStylesheet() {
    if (aggregateStylesheetPromise) return aggregateStylesheetPromise;

    var existing = document.querySelector('link[data-harmonyos-hans="stylesheet"][data-mode="aggregate"]');
    if (existing) {
      aggregateStylesheetPromise = existing.dataset.loaded === 'true' || existing.sheet
        ? Promise.resolve(existing)
        : waitForStylesheet(existing);
      return aggregateStylesheetPromise;
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    link.crossOrigin = 'anonymous';
    link.dataset.harmonyosHans = 'stylesheet';
    link.dataset.mode = 'aggregate';
    document.head.appendChild(link);
    aggregateStylesheetPromise = waitForStylesheet(link);
    return aggregateStylesheetPromise;
  }

  function ensureWeightStylesheet(weight) {
    var normalizedWeight = closestWeight(weight);
    if (!useSplitStylesheets || aggregateStylesheetPromise) return ensureAggregateStylesheet();
    if (weightStylesheetPromises.has(normalizedWeight)) return weightStylesheetPromises.get(normalizedWeight);

    var existing = findStylesheet(normalizedWeight);
    if (existing) {
      var existingPromise = existing.dataset.loaded === 'true' || existing.sheet
        ? Promise.resolve(existing)
        : waitForStylesheet(existing);
      weightStylesheetPromises.set(normalizedWeight, existingPromise);
      return existingPromise;
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = getWeightStylesheetUrl(normalizedWeight);
    link.crossOrigin = 'anonymous';
    link.dataset.harmonyosHans = 'stylesheet';
    link.dataset.mode = 'split';
    link.dataset.weight = String(normalizedWeight);
    document.head.appendChild(link);

    var promise = waitForStylesheet(link).catch(function (error) {
      link.remove();
      weightStylesheetPromises.delete(normalizedWeight);
      console.warn('[HarmonyOSHans] Split stylesheet unavailable; falling back to common.css.', error);
      return ensureAggregateStylesheet();
    });
    weightStylesheetPromises.set(normalizedWeight, promise);
    return promise;
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

  function loadTextBuckets(buckets) {
    var requests = Object.keys(buckets).map(function (weight) {
      var normalizedWeight = closestWeight(weight);
      var text = uniqueCharacters(buckets[weight]);
      if (!text) return Promise.resolve([]);

      return ensureWeightStylesheet(normalizedWeight).then(function () {
        if (!document.fonts || typeof document.fonts.load !== 'function') return [];
        return document.fonts.load(
          normalizedWeight + ' 1em "' + fontFamily.replace(/"/g, '\\"') + '"',
          text
        );
      });
    });

    return Promise.all(requests);
  }

  function scan(target) {
    var buckets = {};
    collectText(target || resolveRoot(), buckets);
    return loadTextBuckets(buckets);
  }

  function loadWeight(weight) {
    return ensureWeightStylesheet(closestWeight(weight));
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
        if (mutation.type === 'characterData' || mutation.type === 'attributes') pendingNodes.add(mutation.target);
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
      attributes: true,
      attributeFilter: ['class', 'style'],
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

  function load(weights) {
    if (weights !== undefined && weights !== null) {
      return Promise.all(parseWeights(weights).map(loadWeight)).then(function () { return api; });
    }
    if (loadPromise) return loadPromise;

    loadPromise = scan(resolveRoot())
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
      split: useSplitStylesheets,
      weights: configuredWeights.slice()
    },
    ready: ready,
    load: load,
    loadWeight: loadWeight,
    scan: scan,
    observe: observe,
    disconnect: disconnect
  };

  window.HarmonyOSHans = api;
  if (autoLoad) scheduleAutoLoad();
})();
