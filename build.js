#!/usr/bin/env node
/*
 * Build script (no dependencies). Produces:
 *
 *   dist/LocalCalc.html  One self-contained file: every stylesheet and script is
 *                        inlined, so it runs by double-clicking, with no network.
 *   dist/web/            The installable web app (PWA): the same files plus a
 *                        manifest and a service worker that caches everything for
 *                        offline use. Host this folder once (e.g. GitHub Pages),
 *                        then "Install" / "Add to Home Screen".
 *
 * Usage: node build.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const WEB = path.join(DIST, 'web');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(WEB, { recursive: true });

/* ---------- 1. single-file build ---------- */
let html = read('index.html');
// Links to the manifest/icons only make sense for the hosted version.
html = html.replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => '<style>\n' + read(href) + '</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) =>
  // "</script" inside code would end the inline <script> early.
  '<script>\n' + read(src).replace(/<\/script/gi, '<\\/script') + '</script>');
if (/(src|href)="(?!data:|#)[^"]+"/.test(html.replace(/<script>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, ''))) {
  throw new Error('Single-file build still references an external file');
}
fs.writeFileSync(path.join(DIST, 'LocalCalc.html'), html);

/* ---------- 2. installable web app ---------- */
const files = ['index.html', 'manifest.webmanifest', 'sw.js', 'css/style.css',
  ...fs.readdirSync(path.join(ROOT, 'js')).map((f) => 'js/' + f),
  ...fs.readdirSync(path.join(ROOT, 'icons')).map((f) => 'icons/' + f)];
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(fs.readFileSync(path.join(ROOT, f)));
const version = hash.digest('hex').slice(0, 12);
for (const f of files) {
  const out = path.join(WEB, f);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let data = fs.readFileSync(path.join(ROOT, f));
  if (f === 'sw.js') data = data.toString().replace("const VERSION = 'dev';", "const VERSION = '" + version + "';");
  fs.writeFileSync(out, data);
}
// Offer the single-file version for download from the hosted app too.
fs.copyFileSync(path.join(DIST, 'LocalCalc.html'), path.join(WEB, 'LocalCalc.html'));

const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
console.log('dist/LocalCalc.html  ' + kb(path.join(DIST, 'LocalCalc.html')));
console.log('dist/web/            ' + files.length + ' files, cache version ' + version);
