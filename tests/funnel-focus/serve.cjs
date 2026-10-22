// Isolated UI fixture: no database, real client records, external tools or provider calls.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const postcss = require('postcss');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'tmp/funnel-focus-ui');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const globals = await postcss([require('@tailwindcss/postcss')({ base: root })]).process(fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8'), { from: path.join(root, 'src/app/globals.css') });
  fs.writeFileSync(path.join(output, 'globals.css'), globals.css);
  await esbuild.build({ entryPoints: [path.join(__dirname, 'fixture.tsx')], outfile: path.join(output, 'app.js'), bundle: true, jsx: 'automatic', loader: { '.png': 'file' }, define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{
    name: 'isolated-server-actions', setup(build) {
      build.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'fixture' }));
      build.onResolve({ filter: /app\/actions\/portal-actions$/ }, () => ({ path: 'sign', namespace: 'fixture' }));
      build.onResolve({ filter: /AgreementPdfViewer$/ }, () => ({ path: 'pdf', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'jsx', resolveDir: root, contents: args.path === 'image'
        ? 'import React from "react"; export default function Image({src,priority,sizes,...props}) { return <img src={src} {...props}/> }'
        : args.path === 'pdf' ? 'import React from "react"; export function AgreementPdfViewer(){return <p>Illustrative agreement preview. No real document.</p>}'
        : 'export async function signClientAgreementAction(){window.qaRevision++;return {error:"",signed:true,revision:window.qaRevision}}' }));
    },
  }] });
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Funnel focus · isolated test</title><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(url.pathname.endsWith('/health') ? { configured: true, model: 'Isolated test provider' } : { onboardings: [] })); return; }
    const publicFile = path.join(root, 'public', path.basename(url.pathname));
    const file = path.join(output, path.basename(url.pathname));
    if (url.pathname === '/' || !path.extname(url.pathname)) { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
    const target = fs.existsSync(file) ? file : publicFile;
    if (!fs.existsSync(target)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', target.endsWith('.js') ? 'text/javascript' : target.endsWith('.css') ? 'text/css' : 'image/png');
    res.end(fs.readFileSync(target));
  }).listen(3141, '127.0.0.1', () => console.log('Isolated funnel focus fixture: http://127.0.0.1:3141'));
})().catch(error => { console.error(error); process.exitCode = 1; });
