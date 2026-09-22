/**
 * Static checks on the panel wiring. A CEP panel cannot be booted here, so
 * these catch the mistakes that would otherwise only show up as a silently
 * dead button inside Premiere.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./harness');
var test = h.test, assert = h.assert;

var ROOT = path.join(__dirname, '..');
var EXT = path.join(ROOT, 'extension');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
/** Paths inside the shipped extension payload. */
function extPath(rel) { return path.join(EXT, rel); }

var html = read('extension/index.html');
var ui = read('extension/js/app/ui.js');

function htmlIds() {
  var ids = {};
  var re = /\sid="([^"]+)"/g, m;
  while ((m = re.exec(html))) { ids[m[1]] = true; }
  return ids;
}

/** Every element id the controller looks up, in either access form. */
function requestedIds() {
  var ids = {};
  var bracket = /el\['([^']+)'\]/g, m;
  while ((m = bracket.exec(ui))) { ids[m[1]] = true; }
  var dot = /\bel\.([a-zA-Z][\w-]*)\b/g;
  while ((m = dot.exec(ui))) { ids[m[1]] = true; }
  return ids;
}

test('every element the controller looks up exists in the markup', function () {
  var have = htmlIds();
  var want = requestedIds();
  var missing = Object.keys(want).filter(function (id) { return !have[id]; });
  assert.ok(missing.length === 0, 'missing from index.html: ' + missing.join(', '));
});

test('the controller declares every id it later uses', function () {
  var block = ui.match(/\[([^\]]*?)\]\.forEach\(function \(id\) \{\s*el\[id\] = \$\(id\);/);
  assert.ok(block, 'found the element lookup table');
  var declared = {};
  var re = /'([^']+)'/g, m;
  while ((m = re.exec(block[1]))) { declared[m[1]] = true; }

  var used = Object.keys(requestedIds());
  var undeclared = used.filter(function (id) { return !declared[id]; });
  assert.ok(undeclared.length === 0, 'used but never looked up: ' + undeclared.join(', '));
});

test('every script and stylesheet the panel loads exists', function () {
  var re = /(?:src|href)="([^"]+\.(?:js|css))"/g, m;
  var checked = 0;
  while ((m = re.exec(html))) {
    var file = extPath(m[1]);
    assert.ok(fs.existsSync(file), 'referenced file is missing: ' + m[1]);
    checked++;
  }
  assert.ok(checked >= 7, 'all panel assets are referenced (found ' + checked + ')');
});

test('the manifest points at files that exist', function () {
  var manifest = read('extension/CSXS/manifest.xml');
  var main = manifest.match(/<MainPath>\.\/([^<]+)<\/MainPath>/);
  var script = manifest.match(/<ScriptPath>\.\/([^<]+)<\/ScriptPath>/);
  assert.ok(main && fs.existsSync(extPath(main[1])), 'MainPath exists');
  assert.ok(script && fs.existsSync(extPath(script[1])), 'ScriptPath exists');

  var icons = /<Icon Type="[^"]+">\.\/([^<]+)<\/Icon>/g, m;
  while ((m = icons.exec(manifest))) {
    assert.ok(fs.existsSync(extPath(m[1])), 'icon exists: ' + m[1]);
  }
});

test('the manifest and package agree on the version', function () {
  var manifest = read('extension/CSXS/manifest.xml');
  var pkg = JSON.parse(read('package.json'));
  var bundle = manifest.match(/ExtensionBundleVersion="([^"]+)"/);
  assert.ok(bundle, 'bundle version present');
  assert.equal(bundle[1], pkg.version, 'manifest matches package.json');
  var jsxVersion = read('extension/jsx/framer.jsx').match(/FRAMER_VERSION = '([^']+)'/);
  assert.ok(jsxVersion, 'host script declares a version');
  assert.equal(jsxVersion[1], pkg.version, 'host script matches package.json');
});

test('every layout has an option group and a hint', function () {
  var L = require('../extension/js/core/layout.js');
  var ids = L.layoutIds();
  for (var i = 0; i < ids.length; i++) {
    assert.ok(ui.indexOf(ids[i] + ':') >= 0, 'OPTION_CONTROLS covers ' + ids[i]);
    assert.ok(L.LAYOUTS[ids[i]].hint, ids[i] + ' has a hint');
    assert.ok(L.LAYOUTS[ids[i]].label, ids[i] + ' has a label');
  }
});

test('every option control maps to a real layout default', function () {
  var L = require('../extension/js/core/layout.js');
  var block = ui.match(/var OPTION_CONTROLS = \{([\s\S]*?)\n  \};/);
  assert.ok(block, 'found OPTION_CONTROLS');

  var ids = L.layoutIds();
  for (var i = 0; i < ids.length; i++) {
    var section = block[1].match(new RegExp('\\n    ' + ids[i] + ': \\[([\\s\\S]*?)\\n    \\]'));
    if (!section) { continue; }          // a layout may legitimately have none
    var defaults = L.layoutDefaults(ids[i]);
    var re = /key: '([^']+)'/g, m;
    while ((m = re.exec(section[1]))) {
      assert.ok(defaults.hasOwnProperty(m[1]),
                ids[i] + ' control "' + m[1] + '" has no matching default');
    }
  }
});

test('the host script exposes every entry point the bridge calls', function () {
  var jsx = read('extension/jsx/framer.jsx');
  var bridge = read('extension/js/app/host.js');
  var re = /'(framer[A-Za-z]+)'/g, m;
  var called = {};
  while ((m = re.exec(bridge))) { called[m[1]] = true; }
  var names = Object.keys(called);
  assert.ok(names.length >= 5, 'the bridge calls into the host');
  for (var i = 0; i < names.length; i++) {
    assert.ok(jsx.indexOf('function ' + names[i] + '(') >= 0,
              'jsx defines ' + names[i] + '()');
  }
});

test('the host scripts stay within ExtendScript ES3 syntax', function () {
  ['framer.jsx', 'mp4dims.jsx'].forEach(function (name) { checkEs3(name, read('extension/jsx/' + name)); });
});

function checkEs3(name, jsx) {
  // Strip comments and strings before looking for modern syntax.
  var code = jsx
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');

  var banned = [
    [/\bconst\s+\w/, 'const'],
    [/\blet\s+\w/, 'let'],
    [/=>/, 'arrow function'],
    [/`/, 'template literal'],
    [/\.\.\./, 'spread'],
    [/\.forEach\(/, 'Array.prototype.forEach'],
    [/\.map\(/, 'Array.prototype.map'],
    [/\bclass\s+\w/, 'class']
  ];
  for (var i = 0; i < banned.length; i++) {
    assert.ok(!banned[i][0].test(code), 'no ' + banned[i][1] + ' in ' + name);
  }
}
