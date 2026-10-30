// Turns client/dist-preview (Vite output) into ONE self-contained HTML page for static hosting
// (CSS and JS inlined; fonts from Google Fonts). Usage: node scripts/inline-preview.mjs <out.html>
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve('dist-preview');
const out = process.argv[2] ?? path.join(dist, 'workbench-preview.html');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const js = [...html.matchAll(/<script[^>]+src="\.\/([^"]+)"[^>]*><\/script>/g)].map((m) => fs.readFileSync(path.join(dist, m[1]), 'utf8'));
const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.\/([^"]+)"[^>]*>/g)].map((m) => fs.readFileSync(path.join(dist, m[1]), 'utf8'));
if (js.length !== 1 || css.length !== 1) throw new Error(`expected 1 js + 1 css, got ${js.length} + ${css.length}`);

const safeJs = js[0].replace(/<\/script/gi, '<\\/script');
const page = `<title>Document Workbench</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,500..800&family=Public+Sans:ital,wght@0,400;0,500;0,600;1,400&display=swap">
<style>
${css[0]}
</style>
<div id="root"></div>
<script type="module">
${safeJs}
</script>
`;
fs.writeFileSync(out, page);
console.log(`wrote ${out} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
