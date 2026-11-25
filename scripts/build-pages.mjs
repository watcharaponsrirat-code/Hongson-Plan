import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const referenceCategories = ['strategicProject', 'strategy', 'standards', 'obecPolicy', 'onesqa', 'worldClass', 'kpd', 'hongson'];

function validateCatalog(catalog) {
  const fail = message => { throw new Error(`Invalid Pages reference catalog: ${message}`); };
  const text = value => typeof value === 'string' && value.trim().length > 0;
  if (catalog?.schemaVersion !== 1 || !text(catalog.version) || !Array.isArray(catalog.items) || !catalog.items.length || !Array.isArray(catalog.sources) || !catalog.sources.length || !Array.isArray(catalog.issues)) fail('missing schema, version, items, sources or issues');
  if (catalog.issues.length) fail('resolve source issues before publishing');
  const files = new Set();
  for (const source of catalog.sources) {
    if (!text(source?.file) || files.has(source.file)) fail('missing or duplicate source filename');
    files.add(source.file);
  }
  const byId = new Map();
  for (const item of catalog.items) {
    if (!text(item?.id) || !text(item.name) || !referenceCategories.includes(item.category)) fail('item ID, name or category is invalid');
    if (byId.has(item.id)) fail(`duplicate item ID ${item.id}`);
    if (!files.has(item.source?.file)) fail(`unknown source for ${item.id}`);
    byId.set(item.id, item);
  }
  for (const item of catalog.items) {
    const seen = new Set([item.id]);
    let current = item;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent || parent.category !== item.category) fail(`invalid parent for ${current.id}`);
      if (seen.has(parent.id)) fail(`cyclic hierarchy at ${parent.id}`);
      seen.add(parent.id);
      current = parent;
    }
    if (item.category === 'strategicProject') {
      if (byId.get(item.strategyId)?.category !== 'strategy') fail(`missing linked strategy for ${item.id}`);
    } else if (item.strategyId) fail(`unexpected linked strategy for ${item.id}`);
  }
  for (const category of referenceCategories) {
    if (!catalog.items.some(item => item.category === category && item.selectable !== false && !catalog.items.some(child => child.parentId === item.id))) fail(`no selectable items in ${category}`);
  }
}

function read(root, path) {
  return readFileSync(join(root, path), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function replaceOnce(source, pattern, replacement, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, 'g'))];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label}; found ${matches.length}`);
  return source.replace(pattern, replacement);
}

function imports(source, mappings, label) {
  const used = new Set();
  source = source.replace(/\bimport\s*\{([^}]+)\}\s*from\s*(['"])([^'"]+)\2\s*;/g, (_, names, quote, path) => {
    const dependency = mappings[path];
    if (!dependency) throw new Error(`Unsupported import ${path} in ${label}`);
    if (used.has(path)) throw new Error(`Duplicate import ${path} in ${label}`);
    used.add(path);
    if (!/^\s*[\w$]+(?:\s*,\s*[\w$]+)*\s*,?\s*$/.test(names)) throw new Error(`Unsupported import bindings in ${label}`);
    return `const { ${names.trim()} } = ${dependency};`;
  });
  for (const path of Object.keys(mappings)) if (!used.has(path)) throw new Error(`Missing expected import ${path} in ${label}`);
  assertNoModules(source, label);
  return source;
}

function assertNoModules(source, label) {
  if (/(?:^|[;\n])\s*import\b/m.test(source) || /\bimport\s*[.(]/.test(source)) {
    throw new Error(`Unbundled import in ${label}`);
  }
}

function factory(name, source, dependencies = {}) {
  source = imports(source, dependencies, name);
  const exports = [];
  source = source.replace(/\bexport\s+((?:async\s+)?(?:function|class|const|let))\s+([\w$]+)/g, (_, declaration, exported) => {
    if (exports.includes(exported)) throw new Error(`Duplicate export ${exported} in ${name}`);
    exports.push(exported);
    return `${declaration} ${exported}`;
  });
  if (/(?:^|[;\n])\s*export\b/m.test(source)) throw new Error(`Unsupported export in ${name}`);
  if (!exports.length) throw new Error(`No exported functions found in ${name}`);
  return `const ${name} = (() => {\n${source}\nreturn Object.freeze({ ${exports.join(', ')} });\n})();\n`;
}

// An HTML raw-text element ends before JavaScript/CSS parsing happens. Escape
// delimiters even inside comments, strings, or embedded catalog descriptions.
const inlineScript = source => source.replace(/<\/script/gi, match => match.replace('/', '\\/')).replace(/<!--/g, '<\\!--');
const inlineStyle = source => source.replace(/<\/style/gi, match => match.replace('/', '\\/'));

/** Bundle the reviewed publication catalog; never read the private local catalog. */
export function buildPages({ root = defaultRoot, output, catalogPath = 'public/school-reference-data.pages.json' } = {}) {
  root = resolve(root);
  const catalog = JSON.parse(read(root, catalogPath));
  validateCatalog(catalog);
  let referenceSource = read(root, 'src/project-references.mjs');
  referenceSource = replaceOnce(referenceSource, /import\s*\{\s*readFileSync\s*\}\s*from\s*['"]node:fs['"]\s*;/, '', 'reference filesystem import');
  referenceSource = replaceOnce(referenceSource, /export function readSchoolReferenceCatalog\([\s\S]*?(?=export function legacyReferenceTexts\()/,
    'export function readSchoolReferenceCatalog() { return structuredClone(__catalog); }\n\n', 'reference catalog reader');

  let appSource = imports(read(root, 'public/app.js'), {
    './project-template.js': '__template',
    './reference-picker.js': '__picker',
    './dashboard.js': '__dashboard',
  }, 'public/app.js');
  appSource = replaceOnce(appSource, /await startApplication\(\);\s*$/, '', 'application bootstrap');
  const uiSource = read(root, 'static-demo/ui.js');
  assertNoModules(uiSource, 'static-demo/ui.js');

  const script = `(async () => {\n'use strict';
if (typeof structuredClone !== 'function' || typeof globalThis.crypto?.randomUUID !== 'function') {
  throw new Error('เบราว์เซอร์นี้ยังไม่รองรับระบบทดลอง กรุณาเปิดด้วย Microsoft Edge, Chrome หรือ Firefox รุ่นปัจจุบัน');
}
const __catalog = ${JSON.stringify(catalog)};
const __crypto = { randomUUID: () => globalThis.crypto.randomUUID() };
${factory('__template', read(root, 'public/project-template.js'))}
${factory('__picker', read(root, 'public/reference-picker.js'))}
${factory('__dashboard', read(root, 'public/dashboard.js'), { './project-template.js': '__template' })}
${factory('__references', referenceSource)}
${factory('__domain', read(root, 'src/domain.mjs'), { 'node:crypto': '__crypto', './project-references.mjs': '__references' })}
${factory('__reports', read(root, 'src/reports.mjs'), { './domain.mjs': '__domain' })}
${factory('__store', read(root, 'static-demo/browser-store.mjs'))}
const __demoScope = location.pathname.replace(/index\\.html$/, '');
const browserDemo = __store.createBrowserDemo({
  domain: __domain,
  references: __references,
  catalog: __catalog,
  persistence: __store.createIndexedDbPersistence('hongson-pages-demo:' + __demoScope),
  sessionStorage: globalThis.sessionStorage,
  sessionKey: 'hongson-pages-demo-user:' + __demoScope,
});
${appSource}
${uiSource}
await startApplication();
})().catch(error => {
  const root = document.getElementById('app');
  const heading = document.createElement('h1');
  heading.textContent = 'เปิดระบบทดลองไม่สำเร็จ';
  const detail = document.createElement('p');
  detail.textContent = error?.message || 'กรุณาเปิดไฟล์อีกครั้งด้วยเบราว์เซอร์รุ่นปัจจุบัน';
  const note = document.createElement('p');
  note.textContent = 'ข้อมูลทดลองเก็บเฉพาะเบราว์เซอร์นี้ หากเบราว์เซอร์ปิดกั้นพื้นที่จัดเก็บ ให้เปิดหน้าเว็บจาก GitHub Pages หรือใช้หน้าต่างเบราว์เซอร์ปกติ';
  root.replaceChildren(heading, detail, note);
  root.style.padding = '32px';
  root.setAttribute('role', 'alert');
  console.error(error);
});
`;
  // Syntax checking does not execute browser code or touch the user's storage.
  new Script(script, { filename: 'hongson-pages-inline.js' });
  const css = `${read(root, 'public/style.css')}\n${read(root, 'static-demo/style.css')}`;
  if (/@import\b/i.test(css) || [...css.matchAll(/url\(\s*['"]?([^'"\s)]+)/gi)].some(match => !/^(?:data:|#)/i.test(match[1]))) {
    throw new Error('Pages styles must not depend on external files');
  }
  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#112c36">
  <meta name="description" content="ระบบงานแผนและงบประมาณ รุ่นทดลองในเบราว์เซอร์ ข้อมูลเก็บเฉพาะเครื่องนี้ ไม่ใช่ระบบกลางของโรงเรียน">
  <title>ห้องสอนศึกษา · งานแผนและงบประมาณ · ทดลองในเบราว์เซอร์</title>
  <style>${inlineStyle(css)}</style>
</head>
<body>
  <div id="app"><div class="initial-loading"><h1>ระบบงานแผนและงบประมาณ · รุ่นทดลอง</h1><p>ข้อมูลเก็บเฉพาะเบราว์เซอร์นี้ ไม่ใช่ระบบกลางของโรงเรียน</p><p>หากหน้าเข้าสู่ระบบไม่ปรากฏ กรุณาเปิดใช้ JavaScript และใช้เบราว์เซอร์รุ่นปัจจุบัน</p></div></div>
  <noscript><p role="alert">กรุณาเปิดใช้ JavaScript เพื่อใช้งานระบบทดลอง</p></noscript>
  <div id="toast" role="status" aria-live="polite"></div>
  <dialog id="modal" aria-labelledby="modal-title"></dialog>
  <div id="print-area"></div>
  <script id="hongson-demo-script">${inlineScript(script)}</script>
</body>
</html>
`;
  // Check the escaped raw text as well: escaping must preserve valid JavaScript.
  new Script(inlineScript(script), { filename: 'hongson-pages-inline-escaped.js' });
  const outputPaths = output === false ? [] : output
    ? [resolve(root, output)]
    : [join(root, 'index.html'), join(root, 'dist', 'github-pages', 'index.html')];
  for (const path of outputPaths) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, 'utf8');
  }
  return { html, outputPaths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = buildPages();
  for (const path of result.outputPaths) console.log(`Created: ${path}`);
  console.log(`Self-contained browser demo: ${Buffer.byteLength(result.html, 'utf8')} bytes`);
}
