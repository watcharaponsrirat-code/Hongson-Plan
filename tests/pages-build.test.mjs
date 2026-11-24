import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { buildPages } from '../scripts/build-pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = [
  'public/app.js', 'public/style.css', 'public/project-template.js',
  'public/reference-picker.js', 'public/school-reference-data.example.json',
  'public/school-reference-data.pages.json',
  'src/domain.mjs', 'src/project-references.mjs', 'src/reports.mjs',
  'static-demo/browser-store.mjs', 'static-demo/ui.js', 'static-demo/style.css',
];
const scriptFrom = html => {
  const match = html.match(/<script id="hongson-demo-script">([\s\S]*)<\/script>/);
  assert.ok(match, 'the classic inline script is present');
  return match[1];
};
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'hongson-pages-build-'));
  for (const input of inputs) {
    const destination = join(directory, input);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, input), destination);
  }
  return directory;
}
function cleanup(directory) {
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('hongson-pages-build-')) {
    throw new Error('Refusing to remove an unexpected test directory');
  }
  rmSync(directory, { recursive: true, force: true });
}

test('Pages artifact bundles the actual application deterministically without linked assets or modules', () => {
  const first = buildPages({ root, output: false });
  const second = buildPages({ root, output: false });
  assert.equal(first.html, second.html);
  assert.deepEqual(first.outputPaths, []);
  assert.doesNotMatch(first.html, /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*["']stylesheet|<script\b[^>]*\btype\s*=\s*["']module/i);
  assert.doesNotMatch(scriptFrom(first.html), /\bimport\.meta|from\s*['"]node:/);
  const embedded = JSON.parse(scriptFrom(first.html).match(/const __catalog = (.*);\n/)[1]);
  const published = JSON.parse(readFileSync(join(root, 'public/school-reference-data.pages.json'), 'utf8'));
  assert.deepEqual(embedded, published, 'all published IDs, text, source locations and editions are embedded unchanged');
  assert.equal(embedded.version, 'school-9e29c67576f7d07a');
  assert.notEqual(embedded.isDemo, true);
  assert.equal(embedded.sources.length, 8);
  assert.equal(embedded.items.length, 207);
  assert.deepEqual(Object.fromEntries(['strategy', 'strategicProject', 'standards', 'obecPolicy', 'onesqa', 'worldClass', 'kpd', 'hongson'].map(category => [category, embedded.items.filter(item => item.category === category).length])), {
    strategy: 5, strategicProject: 21, standards: 26, obecPolicy: 71, onesqa: 21, worldClass: 27, kpd: 29, hongson: 7,
  });
  assert.equal(embedded.items.find(item => item.id === 'strategicProject:1.1').strategyId, 'strategy:1');
  assert.ok(embedded.items.every(item => !item.id.startsWith('demo:')));
  assert.match(first.html, /ไม่ใช่ระบบกลางของโรงเรียน/);
  assert.match(first.html, /<noscript>/);
  new Script(scriptFrom(first.html));
});

test('Pages build ignores the private catalog and explicit synthetic fixtures protect inline raw-text boundaries', () => {
  const directory = fixture();
  try {
    writeFileSync(join(directory, 'public/school-reference-data.json'), '{"secret":"PRIVATE_CATALOG_MUST_STAY_LOCAL"}');
    assert.doesNotMatch(buildPages({ root: directory, output: false }).html, /PRIVATE_CATALOG_MUST_STAY_LOCAL/);
    const catalogPath = join(directory, 'public/school-reference-data.example.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    catalog.description = '</ScRiPt><script>globalThis.compromised=true</script><!--';
    writeFileSync(catalogPath, JSON.stringify(catalog));
    writeFileSync(join(directory, 'static-demo/style.css'), '.demo::before{content:"</StYlE><script>malicious()</script>"}');
    const { html, outputPaths } = buildPages({ root: directory, catalogPath: 'public/school-reference-data.example.json' });
    assert.equal(outputPaths.length, 2);
    for (const path of outputPaths) assert.equal(readFileSync(path, 'utf8'), html);
    assert.doesNotMatch(html, /PRIVATE_CATALOG_MUST_STAY_LOCAL/);
    assert.equal((html.match(/<\/style\s*>/gi) || []).length, 1);
    const script = scriptFrom(html);
    assert.doesNotMatch(script, /<\/script\b/i);
    new Script(script);
  } finally { cleanup(directory); }
});

test('missing or invalid published references fail before output without falling back to private or synthetic data', () => {
  const directory = fixture();
  try {
    const catalogPath = join(directory, 'public/school-reference-data.pages.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    copyFileSync(catalogPath, join(directory, 'public/school-reference-data.json'));
    const badHierarchy = structuredClone(catalog);
    badHierarchy.items.find(item => item.category === 'strategicProject').strategyId = 'missing-strategy';
    for (const contents of [null, '{broken', JSON.stringify({ version: 'incomplete', items: [] }), JSON.stringify(badHierarchy)]) {
      if (contents === null) unlinkSync(catalogPath);
      else writeFileSync(catalogPath, contents);
      assert.throws(() => buildPages({ root: directory }));
      assert.equal(existsSync(join(directory, 'index.html')), false);
      assert.equal(existsSync(join(directory, 'dist/github-pages/index.html')), false);
    }
  } finally { cleanup(directory); }
});

test('unsupported module additions fail loudly before writing a broken artifact', () => {
  const directory = fixture();
  try {
    const path = join(directory, 'public/project-template.js');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nimport unexpected from './new-dependency.js';\n`);
    assert.throws(() => buildPages({ root: directory, output: false }), /Unbundled import/);
  } finally { cleanup(directory); }
});

test('unsupported browser shows a human-readable error instead of an endless loading message', async () => {
  const { html } = buildPages({ root, output: false });
  const displayed = [];
  const app = { style: {}, replaceChildren(...nodes) { displayed.push(...nodes.map(node => node.textContent)); }, setAttribute() {} };
  const document = { getElementById() { return app; }, createElement() { return { textContent: '' }; } };
  await new Script(scriptFrom(html)).runInNewContext({ document, console: { error() {} } });
  assert.equal(displayed[0], 'เปิดระบบทดลองไม่สำเร็จ');
  assert.match(displayed[1], /เบราว์เซอร์นี้ยังไม่รองรับ/);
});
