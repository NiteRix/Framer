/** Minimal test harness - no dependencies, so `node test/run.js` just works. */
'use strict';

var tests = [];
var current = null;

function test(name, fn) { tests.push({ name: name, fn: fn }); }

function fail(msg) {
  var e = new Error(msg);
  e.isAssertion = true;
  throw e;
}

var assert = {
  ok: function (v, msg) { if (!v) { fail(msg || 'expected truthy, got ' + v); } },
  equal: function (a, b, msg) {
    if (a !== b) { fail((msg || 'not equal') + ': ' + a + ' !== ' + b); }
  },
  close: function (a, b, tol, msg) {
    if (Math.abs(a - b) > tol) {
      fail((msg || 'not close') + ': ' + a + ' vs ' + b + ' (tolerance ' + tol + ')');
    }
  },
  between: function (v, lo, hi, msg) {
    if (v < lo || v > hi) { fail((msg || 'out of range') + ': ' + v + ' not in [' + lo + ',' + hi + ']'); }
  },
  throws: function (fn, msg) {
    var threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) { fail(msg || 'expected a throw'); }
  }
};

function run() {
  var passed = 0, failed = 0;
  for (var i = 0; i < tests.length; i++) {
    current = tests[i];
    try {
      current.fn();
      passed++;
      process.stdout.write('  ok   ' + current.name + '\n');
    } catch (e) {
      failed++;
      process.stdout.write('  FAIL ' + current.name + '\n         ' + e.message + '\n');
      if (!e.isAssertion) { process.stdout.write(e.stack.split('\n').slice(1, 4).join('\n') + '\n'); }
    }
  }
  process.stdout.write('\n' + passed + ' passed, ' + failed + ' failed\n');
  return failed;
}

module.exports = { test: test, assert: assert, run: run };
