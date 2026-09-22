/**
 * Just enough of ExtendScript to run Framer's host scripts under Node.
 *
 * File and Folder are backed by the real filesystem, Time mirrors Premiere's
 * tick arithmetic, and `$.sleep` is a hook so a test can make things happen
 * "later" - which is how an asynchronous frame export is simulated. `app` and
 * `qe` are supplied per test, shaped like the Premiere build being imitated.
 */
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');

var TICKS_PER_SECOND = 254016000000;

function makeFile() {
  function File(p) {
    if (!(this instanceof File)) { return new File(p); }
    this._path = String(p);
    this._fd = null;
    this._pos = 0;
    this.encoding = 'UTF-8';
  }
  Object.defineProperty(File.prototype, 'exists', {
    get: function () {
      try { return fs.statSync(this._path).isFile(); } catch (e) { return false; }
    }
  });
  Object.defineProperty(File.prototype, 'fsName', { get: function () { return this._path; } });
  Object.defineProperty(File.prototype, 'name', { get: function () { return path.basename(this._path); } });
  Object.defineProperty(File.prototype, 'length', {
    get: function () {
      try { return fs.statSync(this._path).size; } catch (e) { return 0; }
    }
  });
  File.prototype.open = function (mode) {
    try {
      this._fd = fs.openSync(this._path, mode === 'r' ? 'r' : 'w');
      this._pos = 0;
      return true;
    } catch (e) { return false; }
  };
  File.prototype.seek = function (pos) { this._pos = pos; return true; };
  File.prototype.read = function (count) {
    var buf = Buffer.alloc(count);
    var n = fs.readSync(this._fd, buf, 0, count, this._pos);
    this._pos += n;
    return buf.slice(0, n).toString('latin1');
  };
  File.prototype.close = function () {
    if (this._fd !== null) { fs.closeSync(this._fd); this._fd = null; }
    return true;
  };
  File.prototype.remove = function () {
    try { fs.unlinkSync(this._path); return true; } catch (e) { return false; }
  };
  return File;
}

function makeFolder(File, tempDir) {
  function Folder(p) {
    if (!(this instanceof Folder)) { return new Folder(p); }
    this._path = String(p);
  }
  Object.defineProperty(Folder.prototype, 'exists', {
    get: function () {
      try { return fs.statSync(this._path).isDirectory(); } catch (e) { return false; }
    }
  });
  Object.defineProperty(Folder.prototype, 'fsName', { get: function () { return this._path; } });
  Folder.prototype.create = function () { fs.mkdirSync(this._path, { recursive: true }); return true; };
  Folder.prototype.getFiles = function (mask) {
    var re = mask
      ? new RegExp('^' + String(mask).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
      : null;
    var self = this;
    return fs.readdirSync(this._path)
      .filter(function (n) { return !re || re.test(n); })
      .map(function (n) { return new File(path.join(self._path, n)); });
  };
  Folder.temp = new Folder(tempDir);
  return Folder;
}

function Time() { this._ticks = 0; }
Object.defineProperty(Time.prototype, 'seconds', {
  get: function () { return this._ticks / TICKS_PER_SECOND; },
  set: function (s) { this._ticks = Math.round(Number(s) * TICKS_PER_SECOND); }
});
Object.defineProperty(Time.prototype, 'ticks', {
  get: function () { return String(this._ticks); },
  set: function (t) { this._ticks = Number(t); }
});

/**
 * Build a context and load host scripts into it.
 *
 * opts.os       '$.os' string - 'Windows 10' or 'Macintosh OS 14'
 * opts.app      the Premiere `app` object for this test
 * opts.qe       the QE `qe` object, or undefined for a build without QE
 * opts.onSleep  called from $.sleep(ms)
 * opts.scripts  jsx file paths to load, in order
 */
function createHost(opts) {
  opts = opts || {};
  var tempDir = opts.tempDir || fs.mkdtempSync(path.join(os.tmpdir(), 'framer-host-'));
  var File = makeFile();
  var Folder = makeFolder(File, tempDir);
  var sleeps = 0;

  var context = {
    File: File,
    Folder: Folder,
    Time: Time,
    JSON: JSON,
    $: {
      os: opts.os || 'Macintosh OS 14.0',
      locale: 'en_US',
      sleep: function (ms) { sleeps++; if (opts.onSleep) { opts.onSleep(ms, sleeps); } }
    },
    app: opts.app,
    qe: opts.qe
  };
  vm.createContext(context);

  (opts.scripts || []).forEach(function (file) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  });

  context.__tempDir = tempDir;
  context.__sleeps = function () { return sleeps; };
  return context;
}

module.exports = {
  createHost: createHost,
  Time: Time,
  TICKS_PER_SECOND: TICKS_PER_SECOND
};
