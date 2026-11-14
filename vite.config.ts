/**
 * Build configuration.
 *
 * `vite build` bundles the app into dist/web/ (the installable PWA). The
 * offlineBuild() plugin then:
 *   1. writes dist/LocalCalc.html — the same app with every script and
 *      stylesheet inlined, so it runs from a double-click with no server;
 *   2. writes dist/web/sw.js — the service worker, with the exact list of
 *      built files and a version hash of their contents.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

function listFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

function offlineBuild(): Plugin {
  let outDir = '';
  let root = '';
  return {
    name: 'offline-build',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const read = (f: string) => fs.readFileSync(path.join(outDir, f), 'utf8');

      // 1. Single self-contained file.
      let html = read('index.html');
      html = html.replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '');
      html = html.replace(/<link rel="stylesheet"[^>]*href="\.?\/?([^"]+)"[^>]*>/g, (_m, href: string) => `<style>\n${read(href)}</style>`);
      html = html.replace(/<script type="module"[^>]*src="\.?\/?([^"]+)"[^>]*><\/script>/g, (_m, src: string) =>
        // "</script" inside the code would end the inline <script> early.
        `<script type="module">\n${read(src).replace(/<\/script/gi, '<\\/script')}</script>`);
      const outside = html.replace(/<script[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, '');
      const external = outside.match(/(?:src|href)="(?!data:|#)[^"]*"/g);
      if (external) throw new Error('Single-file build still references external files: ' + external.join(', '));
      fs.writeFileSync(path.join(outDir, '..', 'LocalCalc.html'), html);
      fs.writeFileSync(path.join(outDir, 'LocalCalc.html'), html);

      // 2. Service worker with the precise file list and a content hash.
      const files = listFiles(outDir).filter((f) => f !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(fs.readFileSync(path.join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = fs.readFileSync(path.join(root, 'src/sw.template.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__FILES__', JSON.stringify(['./', ...files]));
      fs.writeFileSync(path.join(outDir, 'sw.js'), sw);

      const kb = (f: string) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
      this.info?.(`single file: dist/LocalCalc.html (${kb(path.join(outDir, '..', 'LocalCalc.html'))}); ` +
        `service worker caches ${files.length} files, version ${version}`);
    },
  };
}

export default defineConfig({
  // Relative URLs, so the app works from any folder (GitHub Pages serves it at /Squared/).
  base: './',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    target: 'es2022',
    // No preload polyfill: it would fetch files, which a single offline file can't do.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  plugins: [offlineBuild()],
  test: {
    include: ['tests/engine/**/*.test.ts'],
  },
});
