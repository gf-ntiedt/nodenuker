#!/usr/bin/env node
/**
 * Rebuilds all three NodeNuker distribution artifacts from nodenuker.js:
 *   1. bookmarklet.uri.txt        - direct bookmarklet (self-contained; needs
 *                                   re-adding to the bookmarks bar on every
 *                                   version bump)
 *   2. bookmarklet-loader.uri.txt - tiny bookmarklet that always fetches the
 *                                   current nodenuker.js from GitHub Pages,
 *                                   so it never needs re-adding — but is
 *                                   blocked by page CSPs that disallow
 *                                   external scripts
 *   3. nodenuker.user.js          - Violentmonkey/Tampermonkey userscript,
 *                                   triggered via a menu command, auto-
 *                                   updating via @updateURL
 * Also updates the bookmarklet hrefs embedded in index.html.
 * Run this after every change to nodenuker.js.
 */
var fs = require('fs');
var path = require('path');

var dir = __dirname;
var RAW_BASE = 'https://gf-ntiedt.github.io/nodenuker/';

var src = fs.readFileSync(path.join(dir, 'nodenuker.js'), 'utf8');

var versionMatch = /VERSION\s*=\s*'([^']+)'/.exec(src);
if (!versionMatch) throw new Error('VERSION constant not found in nodenuker.js');
var version = versionMatch[1];

// --- 1. Direct bookmarklet ---

// Comment stripping is regex-based, not a real parser: it does not skip
// string/regex literals. The [^:] guard below avoids the common case of
// gutting a "://" URL, but any other literal "//" or "/*" would still be
// cut — check new string literals against this before adding them.
function minify(code) {
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  code = code.split('\n').map(function (l) { return l.replace(/(^|[^:])\/\/.*$/, '$1'); }).join('\n');
  code = code.replace(/\n\s*/g, '\n').replace(/\n+/g, '\n').trim();
  return code;
}

var minified = minify(src);
new Function(minified); // throws on syntax error

var bookmarkletUri = 'javascript:' + encodeURIComponent(minified);
fs.writeFileSync(path.join(dir, 'bookmarklet.uri.txt'), bookmarkletUri);

// --- 2. Loader bookmarklet ---

var loaderSrc = [
  '(function () {',
  "  'use strict';",
  "  var s = document.createElement('script');",
  "  s.src = '" + RAW_BASE + "nodenuker.js?t=' + Date.now();",
  '  s.onload = function () { s.remove(); };',
  '  document.documentElement.appendChild(s);',
  '})();'
].join('\n');
new Function(loaderSrc); // throws on syntax error

var loaderUri = 'javascript:' + encodeURIComponent(loaderSrc);
fs.writeFileSync(path.join(dir, 'bookmarklet-loader.uri.txt'), loaderUri);

// --- 3. Violentmonkey/Tampermonkey userscript ---

var userscriptHeader = [
  '// ==UserScript==',
  '// @name         NodeNuker',
  '// @namespace    https://github.com/gf-ntiedt/nodenuker',
  '// @version      ' + version,
  '// @description  Point. Click. Nuke. Interactive DOM element picker, deleter & undo tool.',
  '// @author       Gedankenfolger GmbH',
  '// @match        *://*/*',
  '// @grant        GM_registerMenuCommand',
  '// @run-at       document-idle',
  '// @updateURL    ' + RAW_BASE + 'nodenuker.user.js',
  '// @downloadURL  ' + RAW_BASE + 'nodenuker.user.js',
  '// @license      GPL-3.0-or-later',
  '// ==/UserScript=='
].join('\n');

var userscript = userscriptHeader + '\n\n' +
  'window.__NODENUKER_NO_AUTORUN = true;\n\n' +
  src.trim() + '\n\n' +
  "if (typeof GM_registerMenuCommand === 'function') {\n" +
  "  GM_registerMenuCommand('Toggle NodeNuker', nodeNukerToggle);\n" +
  '}\n';
new Function(userscript); // throws on syntax error
fs.writeFileSync(path.join(dir, 'nodenuker.user.js'), userscript);

// --- sync hrefs in index.html ---

var htmlPath = path.join(dir, 'index.html');
var html = fs.readFileSync(htmlPath, 'utf8');
html = html.replace(
  /(id="bookmarklet-link" href=")[^"]*(")/,
  '$1' + bookmarkletUri.replace(/&/g, '&amp;') + '$2'
);
html = html.replace(
  /(id="bookmarklet-loader-link" href=")[^"]*(")/,
  '$1' + loaderUri.replace(/&/g, '&amp;') + '$2'
);
fs.writeFileSync(htmlPath, html);

console.log('Version: ' + version);
console.log('Built direct bookmarklet: ' + bookmarkletUri.length + ' chars');
console.log('Built loader bookmarklet: ' + loaderUri.length + ' chars');
console.log('Built userscript: ' + userscript.length + ' chars -> nodenuker.user.js');
