// Build the SelfOS relay (08-questionnaires §5.4) into a single self-contained dist/worker.js that the
// app uploads to Cloudflare. Two passes: (1) bundle the React answering page to one JS + one CSS string,
// (2) bundle the Worker with that page inlined as static HTML via a build-time define.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELAY_VERSION = '1';

/** Pass 1: bundle the answering page to in-memory JS + CSS. */
async function buildPage() {
  const result = await build({
    entryPoints: [resolve(root, 'src/page/main.tsx')],
    bundle: true,
    format: 'iife',
    minify: true,
    jsx: 'automatic',
    target: ['es2022'],
    loader: { '.module.css': 'local-css', '.css': 'css' },
    write: false,
    outdir: 'out',
    logLevel: 'warning',
  });
  let js = '';
  let css = '';
  for (const file of result.outputFiles) {
    if (file.path.endsWith('.js')) js = file.text;
    else if (file.path.endsWith('.css')) css = file.text;
  }
  return { js, css };
}

function pageHtml({ js, css }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex, nofollow" />
<title>SelfOS questionnaire</title>
<style>${css}</style>
</head>
<body>
<div id="relay-root"></div>
<noscript><div class="noscript">This questionnaire needs JavaScript to open securely (your answers are encrypted in your browser). Please enable JavaScript and reload.</div></noscript>
<script>${js}</script>
</body>
</html>`;
}

async function buildWorker(html) {
  const result = await build({
    entryPoints: [resolve(root, 'src/worker/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    define: {
      __RELAY_PAGE_HTML__: JSON.stringify(html),
      __RELAY_VERSION__: JSON.stringify(RELAY_VERSION),
    },
    write: false,
    outfile: 'worker.js',
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

const page = await buildPage();
const html = pageHtml(page);
const worker = await buildWorker(html);
await mkdir(resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist/worker.js'), worker, 'utf8');
await writeFile(
  resolve(root, 'dist/meta.json'),
  JSON.stringify({ relayVersion: RELAY_VERSION }),
  'utf8',
);
console.log(
  `relay built: dist/worker.js (${(worker.length / 1024).toFixed(0)} KB, page ${(html.length / 1024).toFixed(0)} KB)`,
);
