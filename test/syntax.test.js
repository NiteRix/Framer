/**
 * Parses every script the extension ships. A typo in a file that only ever
 * runs inside Premiere is otherwise invisible until someone installs the
 * build and the panel comes up blank.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var h = require('./harness');
var test = h.test, assert = h.assert;

var EXT = path.join(__dirname, '..', 'extension');

function walk(dir, out) {
  out = out || [];
  fs.readdirSync(dir).forEach(function (entry) {
    var full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) { walk(full, out); }
    else if (/\.(js|jsx)$/.test(entry)) { out.push(full); }
  });
  return out;
}

test('every shipped script parses', function () {
  var files = walk(path.join(EXT, 'js')).concat(walk(path.join(EXT, 'jsx')));
  assert.ok(files.length >= 8, 'found the shipped scripts (' + files.length + ')');

  files.forEach(function (file) {
    var source = fs.readFileSync(file, 'utf8');
    try {
      new vm.Script(source, { filename: file });
    } catch (e) {
      assert.ok(false, path.relative(EXT, file) + ' does not parse: ' + e.message);
    }
  });
});

test('the host script uses the parseable include form', function () {
  var jsx = fs.readFileSync(path.join(EXT, 'jsx', 'framer.jsx'), 'utf8');
  // `#include` is a preprocessor directive that no JS parser accepts, so the
  // comment form is what keeps this file checkable.
  assert.ok(!/^\s*#include/m.test(jsx), 'no bare #include directive');
  assert.ok(/@include\s+"json2\.jsx"/.test(jsx), 'json2 is included by the comment form');
  assert.ok(fs.existsSync(path.join(EXT, 'jsx', 'json2.jsx')), 'the included file exists');
});
