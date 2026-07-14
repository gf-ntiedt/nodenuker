#!/usr/bin/env node
/**
 * Rebuilds bookmarklet.uri.txt and injects it into index.html.
 * Run this after every change to nodenuker.js.
 */
var fs = require('fs');
var path = require('path');

var dir = __dirname;
var src = fs.readFileSync(path.join(dir, 'nodenuker.js'), 'utf8');

// Comment stripping is regex-based, not a real parser: it does not skip
// string/regex literals. The [^:] guard below avoids the common case of
// gutting a "://" URL, but any other literal "//" or "/*" would still be
// cut — check new string literals against this before adding them.
src = src.replace(/\/\*[\s\S]*?\*\//g, '');
src = src.split('\n').map(function (l) { return l.replace(/(^|[^:])\/\/.*$/, '$1'); }).join('\n');
src = src.replace(/\n\s*/g, '\n').replace(/\n+/g, '\n').trim();

var uri = 'javascript:' + encodeURIComponent(src);
fs.writeFileSync(path.join(dir, 'bookmarklet.uri.txt'), uri);

new Function(src); // throws on syntax error

var htmlPath = path.join(dir, 'index.html');
var html = fs.readFileSync(htmlPath, 'utf8');
var updated = html.replace(
  /(id="bookmarklet-link" href=")[^"]*(")/,
  '$1' + uri.replace(/&/g, '&amp;') + '$2'
);
fs.writeFileSync(htmlPath, updated);

console.log('Built bookmarklet: ' + uri.length + ' chars');
