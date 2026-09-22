/**
 * Framer - bridge to the ExtendScript host
 * ----------------------------------------
 * One promise-returning call() that quotes its argument properly, parses the
 * JSON that comes back, and surfaces host-side logs. Nothing else in the panel
 * talks to evalScript directly.
 */
(function (root) {
  'use strict';
  root.Framer = root.Framer || {};

  var cs = new CSInterface();
  var listeners = [];
  var hostLoaded = false;

  function extensionPath() {
    return cs.getSystemPath(SystemPath.EXTENSION);
  }

  function onLog(fn) { listeners.push(fn); }

  function emitLogs(fnName, lines) {
    if (!lines || !lines.length) { return; }
    for (var i = 0; i < listeners.length; i++) {
      for (var j = 0; j < lines.length; j++) {
        listeners[i](fnName + ': ' + lines[j]);
      }
    }
  }

  function evalScript(script) {
    return new Promise(function (resolve) {
      cs.evalScript(script, function (result) { resolve(result); });
    });
  }

  /**
   * Call a host function with at most one argument, which is passed as a JSON
   * string. JSON.stringify twice is deliberate: the inner call serialises the
   * payload, the outer one turns it into a safely escaped JS string literal.
   */
  function call(fnName, payload) {
    var script = (payload === undefined)
      ? fnName + '()'
      : fnName + '(' + JSON.stringify(JSON.stringify(payload)) + ')';

    return evalScript(script).then(function (raw) {
      if (raw === 'EvalScript error.' || raw === undefined || raw === null || raw === '') {
        throw new Error('The host script did not respond to ' + fnName + '(). Try reloading the panel.');
      }
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(fnName + '() returned something unreadable: ' + String(raw).slice(0, 400));
      }
      emitLogs(fnName, parsed.log);
      if (!parsed.ok) { throw new Error(parsed.error || (fnName + '() failed')); }
      return parsed;
    });
  }

  /**
   * The manifest's ScriptPath loads framer.jsx at panel start, but a panel
   * reload during development can outrun it - so check, and load it by hand if
   * the functions are not there yet.
   */
  function ensureHost() {
    if (hostLoaded) { return Promise.resolve(true); }
    return call('framerPing').then(function () {
      hostLoaded = true;
      return true;
    }).catch(function () {
      var jsx = extensionPath() + '/jsx/framer.jsx';
      return evalScript('$.evalFile("' + jsx.replace(/\\/g, '/') + '")').then(function () {
        return call('framerPing').then(function () { hostLoaded = true; return true; });
      });
    });
  }

  function withHost(fnName, payload) {
    return ensureHost().then(function () { return call(fnName, payload); });
  }

  root.Framer.host = {
    cs: cs,
    extensionPath: extensionPath,
    onLog: onLog,
    ping: function () { return withHost('framerPing'); },
    diagnostics: function () { return withHost('framerDiagnostics'); },
    inspect: function () { return withHost('framerInspect'); },
    exportStills: function (opts) { return withHost('framerExportStills', opts || {}); },
    build: function (plan) { return withHost('framerBuild', plan); },
    calibrateCrop: function (opts) { return withHost('framerCalibrateCrop', opts || {}); },
    focus: function (opts) { return withHost('framerFocus', opts || {}); }
  };
}(window));
