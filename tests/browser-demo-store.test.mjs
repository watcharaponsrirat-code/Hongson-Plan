import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { createBrowserDemo } from '../static-demo/browser-store.mjs';
import * as references from '../src/project-references.mjs';
import { buildPages } from '../scripts/build-pages.mjs';

const catalog = JSON.parse(readFileSync(new URL('../public/school-reference-data.example.json', import.meta.url), 'utf8'));
// Retain the earlier synthetic edition to verify existing Pages data compatibility.
const domainSource = readFileSync(new URL('../src/domain.mjs', import.meta.url), 'utf8').replace(
  "import { normalizeSchoolReferences } from './project-references.mjs';",
  `import { normalizeSchoolReferences as normalizeOriginal } from '${new URL('../src/project-references.mjs', import.meta.url).href}';\nconst normalizeSchoolReferences = (data, options = {}) => normalizeOriginal(data, {...options, catalog: ${JSON.stringify(catalog)}});`,
);
const domain = await import(`data:text/javascript;base64,${Buffer.from(domainSource).toString('base64')}`);

function memoryPersistence(initial) {
  let stored = structuredClone(initial), queue = Promise.resolve(), failure;
  return {
    read: async () => structuredClone(stored),
    update(transform) {
      const operation = queue.then(() => {
        const changed = transform(structuredClone(stored));
        if (failure) { const error = failure; failure = undefined; throw error; }
        stored = structuredClone(changed.document);
        return structuredClone(changed.result);
      });
      queue = operation.catch(() => {});
      return operation;
    },
    failNext(error) { failure = error; },
  };
}
const memorySession = () => {
  const items = new Map();
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, String(value)), removeItem: key => items.delete(key) };
};
function app({ persistence = memoryPersistence(), sessionStorage = memorySession(), sessionKey, maxBackupBytes } = {}) {
  return createBrowserDemo({ domain, references, catalog, persistence, sessionStorage, sessionKey, maxBackupBytes });
}
const login = (demo, username = 'teacher') => demo.api('/api/login', { username });
const action = (demo, action, payload = {}) => demo.api('/api/action', { action, ...payload });
const draftData = () => ({ title: 'TEST ONLY browser draft', referenceSelections: {}, resources: [] });
const completeData = () => ({
  title: 'TEST ONLY browser workflow', academicYear: '2569', fiscalYear: '2570', term: '2', group: 'กลุ่มงานทดลอง', responsible: 'ครูทดลอง',
  referenceSelections: { strategicProject: [{ id: catalog.items.find(item => item.category === 'strategicProject').id }] },
  projectType: 'new', rationale: 'ตรวจโหมดทดลอง', objectives: 'ตรวจข้อมูล', quantitativeTarget: '20 คน', qualitativeTarget: 'ผ่านการทดสอบ',
  steps: 'เตรียม ทดลอง ประเมิน', startDate: '2026-11-24', endDate: '2026-11-30', evaluation: 'ทดสอบ', expectedResults: 'ข้อมูลถูกต้อง',
  resources: [{ name: 'รายการทดลอง', unit: 'ชิ้น', quantity: 1, unitPrice: 10000, source: 'แหล่งเงินทดลอง A', spending: [{ month: '2026-11', amount: 10000 }] }],
});

test('Pages draft survives a new adapter and logout; sessions remain separate between tabs', async () => {
  const persistence = memoryPersistence(), session = memorySession(), demo = app({ persistence, sessionStorage: session });
  await assert.rejects(demo.api('/api/bootstrap'), { status: 401 });
  await login(demo);
  const saved = (await action(demo, 'project.save', { data: draftData() })).result;
  const reopened = app({ persistence, sessionStorage: session });
  assert.equal((await reopened.api('/api/bootstrap')).state.projects[0].id, saved.id);
  const secondTab = app({ persistence });
  await assert.rejects(secondTab.api('/api/bootstrap'), { status: 401 });
  await login(secondTab, 'teacher2');
  assert.equal((await secondTab.api('/api/bootstrap')).state.projects.length, 0);
  await demo.api('/api/logout');
  await assert.rejects(reopened.api('/api/bootstrap'), { status: 401 });
  await login(reopened);
  assert.equal((await reopened.api('/api/bootstrap')).state.projects[0].data.title, 'TEST ONLY browser draft');
  assert.equal((await secondTab.api('/api/bootstrap')).user.username, 'teacher2');
});

test('Pages roles submit, review and approve using the shared real workflow and frozen synthetic references', async () => {
  const demo = app();
  await login(demo);
  let project = (await action(demo, 'project.save', { data: completeData() })).result;
  const originalText = project.data.strategicProjectName;
  project = (await action(demo, 'project.submit', { id: project.id, version: project.version })).result;
  await assert.rejects(action(demo, 'project.approve', { id: project.id, version: project.version, decision: 'approve' }), { status: 403 });
  await login(demo, 'planner');
  project = (await action(demo, 'project.review', { id: project.id, version: project.version, decision: 'forward' })).result;
  await login(demo, 'director');
  project = (await action(demo, 'project.approve', { id: project.id, version: project.version, decision: 'approve' })).result;
  const bootstrap = await demo.api('/api/bootstrap');
  assert.equal(project.status, 'approved');
  assert.equal(bootstrap.state.versions[0].data.strategicProjectName, originalText);
  assert.equal(bootstrap.state.budgets[0].approved, 10000);
  assert.equal(bootstrap.state.schoolReferenceCatalog.version, catalog.version);
  assert.equal(bootstrap.mode, 'browser-demo');
  assert.equal(bootstrap.integrations.sheets, false);
});

test('published Pages catalog preserves existing drafts and runs official selections through approval', async () => {
  const persistence = memoryPersistence(), sessionStorage = memorySession();
  const previous = app({ persistence, sessionStorage });
  await login(previous);
  const oldProject = (await action(previous, 'project.save', { data: completeData() })).result;
  const unrelated = (await action(previous, 'project.save', { data: draftData() })).result;
  const before = await persistence.read();

  // Execute the shipped factories, including the catalog reader used by domain validation.
  const { html } = buildPages({ output: false });
  const factories = html.slice(html.indexOf('const __catalog ='), html.indexOf('const __demoScope ='));
  const context = { crypto: globalThis.crypto, structuredClone, TextEncoder, TextDecoder, Uint8Array, atob, btoa };
  new Script(`${factories}\nglobalThis.dependencies = { domain: __domain, references: __references, catalog: __catalog }; globalThis.createDemo = __store.createBrowserDemo;`).runInNewContext(context);
  const reopen = () => context.createDemo({ ...context.dependencies, persistence, sessionStorage });
  let upgraded = reopen();
  const published = context.dependencies.catalog;
  const bootstrap = await upgraded.api('/api/bootstrap');
  assert.equal(bootstrap.state.schoolReferenceCatalog.version, published.version);
  assert.deepEqual(structuredClone(bootstrap.state.projects.find(project => project.id === oldProject.id)), oldProject);
  assert.deepEqual(await persistence.read(), before, 'opening the new edition does not replace saved data');
  let project = (await action(upgraded, 'project.save', {
    id: oldProject.id, version: oldProject.version, data: { ...oldProject.data, title: 'Retained draft after catalog upgrade' },
  })).result;
  assert.deepEqual(structuredClone(project.data.referenceSelections), oldProject.data.referenceSelections);

  const selections = Object.fromEntries(references.REFERENCE_CATEGORIES.filter(category => category !== 'strategy').map(category => {
    const item = published.items.find(item => item.category === category && item.selectable !== false && !published.items.some(child => child.parentId === item.id));
    assert.ok(item, category);
    return [category, [{ id: item.id }]];
  }));
  project = (await action(upgraded, 'project.save', {
    id: project.id, version: project.version, data: { ...project.data, referenceSelections: selections },
  })).result;
  const snapshots = structuredClone(project.data.referenceSelections);
  for (const rows of Object.values(snapshots)) for (const row of rows) {
    assert.equal(row.version, published.version);
    assert.ok(!row.id.startsWith('demo:'));
    assert.deepEqual(row.source, structuredClone(published.items.find(item => item.id === row.id).source));
  }
  upgraded = reopen();
  assert.deepEqual(structuredClone((await upgraded.api('/api/bootstrap')).state.projects.find(row => row.id === project.id).data.referenceSelections), snapshots);
  for (const [username, name, decision] of [['teacher', 'project.submit'], ['planner', 'project.review', 'forward'], ['director', 'project.approve', 'approve']]) {
    await login(upgraded, username);
    project = (await action(upgraded, name, { id: project.id, version: project.version, decision })).result;
  }
  const stored = await persistence.read();
  assert.equal(project.status, 'approved');
  assert.deepEqual(stored.state.versions.find(version => version.id === project.approvedVersionId).data.referenceSelections, snapshots);
  assert.deepEqual(stored.state.projects.find(row => row.id === unrelated.id), unrelated);
});

test('failed validation and quota errors do not replace previously stored state', async () => {
  const persistence = memoryPersistence(), demo = app({ persistence });
  await login(demo);
  const project = (await action(demo, 'project.save', { data: draftData() })).result;
  const before = await persistence.read();
  await assert.rejects(action(demo, 'project.submit', { id: project.id, version: project.version }), { status: 422 });
  assert.deepEqual(await persistence.read(), before);
  persistence.failNext(Object.assign(new Error('Disk full'), { name: 'QuotaExceededError' }));
  await assert.rejects(action(demo, 'project.save', { id: project.id, version: project.version, data: { ...draftData(), title: 'Uncommitted' } }), error => error.status === 503 && /ยังไม่ถูกบันทึก/.test(error.message));
  assert.deepEqual(await persistence.read(), before);
});

test('concurrent edits from independent tabs commit exactly one version', async () => {
  const persistence = memoryPersistence(), first = app({ persistence }), second = app({ persistence });
  await login(first); await login(second);
  const project = (await action(first, 'project.save', { data: draftData() })).result;
  const results = await Promise.allSettled([
    action(first, 'project.save', { id: project.id, version: project.version, data: { ...draftData(), title: 'first' } }),
    action(second, 'project.save', { id: project.id, version: project.version, data: { ...draftData(), title: 'second' } }),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.status, 409);
  const stored = await persistence.read();
  assert.equal(stored.state.projects[0].version, project.version + 1);
  assert.equal(stored.state.audit.length, 2);
});

test('attachments persist locally, download as bytes, and respect simulated project ownership', async () => {
  const persistence = memoryPersistence(), demo = app({ persistence });
  await login(demo);
  const project = (await action(demo, 'project.save', { data: draftData() })).result;
  const other = (await action(demo, 'project.save', { data: draftData() })).result;
  const file = await demo.api('/api/upload', { projectId: project.id, name: 'test.pdf', type: 'application/pdf', data: btoa('TEST CONTENT') });
  const bootstrap = await demo.api('/api/bootstrap');
  assert.equal(bootstrap.state.attachments[0].id, file.id);
  assert.equal(Object.hasOwn(bootstrap.state.attachments[0], 'data'), false);
  const downloaded = await demo.download(`/api/files/${file.id}`);
  assert.equal(new TextDecoder().decode(downloaded.bytes), 'TEST CONTENT');
  assert.equal(downloaded.type, 'application/octet-stream');
  assert.equal(downloaded.name, 'test.pdf');
  await assert.rejects(action(demo, 'request.save', { projectId: other.id, type: 'unable', reason: 'test', evidence: [file.id] }), { status: 422 });
  await assert.rejects(demo.api('/api/upload', { projectId: project.id, name: 'bad.txt', data: '!invalid!' }), { status: 422 });
  await login(demo, 'teacher2');
  await assert.rejects(demo.download(`/api/files/${file.id}`), { status: 403 });
  await assert.rejects(demo.api('/api/upload', { projectId: project.id, name: 'bad.txt', data: btoa('TEST') }), { status: 403 });
  await login(demo, 'planner');
  assert.equal((await demo.download(`/api/files/${file.id}`)).name, 'test.pdf');
});

test('backup restore preserves drafts and evidence, rejects malformed data without replacing existing records', async () => {
  const persistence = memoryPersistence(), source = app({ persistence });
  await login(source);
  const project = (await action(source, 'project.save', { data: draftData() })).result;
  await source.api('/api/upload', { projectId: project.id, name: 'evidence.txt', data: btoa('BACKUP TEST') });
  const backup = await source.backup(), targetPersistence = memoryPersistence(), target = app({ persistence: targetPersistence });
  await login(target);
  await target.restore(backup);
  assert.deepEqual(await targetPersistence.read(), await persistence.read());
  const before = await targetPersistence.read();
  const broken = JSON.parse(backup); broken.document.state.projects[0].approvedVersionId = 'missing';
  await assert.rejects(target.restore(JSON.stringify(broken)), { status: 422 });
  const brokenResources = JSON.parse(backup); brokenResources.document.state.projects[0].data.resources = [{ quantity: -1, unitPrice: 100 }];
  await assert.rejects(target.restore(JSON.stringify(brokenResources)), { status: 422 });
  await assert.rejects(target.restore('{"format":"hongson-pages-demo-backup","version":1,"__proto__":{}}'), { status: 422 });
  await assert.rejects(target.restore('not json'), { status: 422 });
  assert.deepEqual(await targetPersistence.read(), before);
});

test('unsupported stored schema is reported, never silently reset to an empty demo', async () => {
  const bad = { schemaVersion: 999, state: { projects: [{ id: 'retain-this' }] } };
  const persistence = memoryPersistence(bad), demo = app({ persistence });
  await assert.rejects(login(demo), { status: 422 });
  assert.deepEqual(await persistence.read(), bad);
});

test('role simulations do not create credentials and can be scoped per repository', async () => {
  const persistence = memoryPersistence(), sessionStorage = memorySession();
  const first = app({ persistence, sessionStorage, sessionKey: 'repo-a' });
  const second = app({ persistence, sessionStorage, sessionKey: 'repo-b' });
  await login(first, 'admin');
  await assert.rejects(second.api('/api/bootstrap'), { status: 401 });
  await assert.rejects(action(first, 'user.save', { username: 'real-user', password: 'never-store-this' }), { status: 422 });
  assert.doesNotMatch(JSON.stringify(await persistence.read()), /never-store-this|password/);
});

test('a full 5 MiB attachment uploads and downloads without overflowing base64 validation', async () => {
  const persistence = memoryPersistence(), demo = app({ persistence });
  await login(demo);
  const project = (await action(demo, 'project.save', { data: draftData() })).result;
  const bytes = Buffer.alloc(5 * 1024 * 1024, 65);
  const file = await demo.api('/api/upload', { projectId: project.id, name: 'limit.bin', data: bytes.toString('base64') });
  assert.deepEqual(Buffer.from((await demo.download(`/api/files/${file.id}`)).bytes), bytes);
  const before = await persistence.read();
  for (const data of [Buffer.alloc(bytes.length + 1).toString('base64'), 'A===', '=AAA', 'AA=A', 'AAAA====']) {
    await assert.rejects(demo.api('/api/upload', { projectId: project.id, name: 'invalid.bin', data }), { status: 422 });
  }
  assert.deepEqual(await persistence.read(), before);
});

test('combined attachment and action growth stays within the restorable backup byte limit atomically', async () => {
  const persistence = memoryPersistence(), source = app({ persistence });
  await login(source);
  const project = (await action(source, 'project.save', { data: draftData() })).result;
  const maxBackupBytes = Buffer.byteLength(await source.backup()) + 5000;
  const bounded = app({ persistence, maxBackupBytes });
  await login(bounded);
  const upload = () => bounded.api('/api/upload', { projectId: project.id, name: 'test.bin', data: Buffer.alloc(2048, 65).toString('base64') });
  await upload();
  const before = await persistence.read();
  await assert.rejects(upload(), error => error.status === 413 && /ยังไม่ถูกบันทึก/.test(error.message));
  await assert.rejects(action(bounded, 'project.save', { id: project.id, version: project.version, data: { ...draftData(), rationale: 'ก'.repeat(3000) } }), { status: 413 });
  assert.deepEqual(await persistence.read(), before);
  const backup = await bounded.backup();
  assert.ok(Buffer.byteLength(backup) <= maxBackupBytes);
  const targetPersistence = memoryPersistence(), target = app({ persistence: targetPersistence, maxBackupBytes });
  await login(target);
  await target.restore(backup);
  assert.deepEqual(await targetPersistence.read(), before);
});

test('restore counts UTF-8 bytes and formatted re-export size, accepting the exact boundary', async () => {
  const source = app();
  await login(source);
  await action(source, 'project.save', { data: { ...draftData(), title: 'ภาษาไทย'.repeat(100) } });
  const backup = await source.backup(), bytes = Buffer.byteLength(backup);
  assert.ok(bytes > backup.length);
  const persistence = memoryPersistence(), exact = app({ persistence, maxBackupBytes: bytes });
  await login(exact);
  await exact.restore(backup);
  assert.equal(Buffer.byteLength(await exact.backup()), bytes);
  const before = await persistence.read();
  const short = app({ persistence, maxBackupBytes: bytes - 1 });
  await login(short);
  await assert.rejects(short.restore(backup), { status: 413 });
  const characterLimit = app({ persistence, maxBackupBytes: backup.length });
  await login(characterLimit);
  await assert.rejects(characterLimit.restore(backup), { status: 413 });
  const compact = JSON.stringify(JSON.parse(backup));
  assert.ok(Buffer.byteLength(compact) < bytes - 1);
  await assert.rejects(short.restore(compact), { status: 413 });
  assert.deepEqual(await persistence.read(), before);
});

test('legacy oversized data remains readable and exportable until a smaller backup is restored', async () => {
  const persistence = memoryPersistence(), source = app({ persistence });
  await login(source);
  const smallBackup = await source.backup();
  const project = (await action(source, 'project.save', { data: draftData() })).result;
  const before = await persistence.read();
  const bounded = app({ persistence, maxBackupBytes: Buffer.byteLength(smallBackup) });
  await login(bounded);
  assert.equal((await bounded.api('/api/bootstrap')).state.projects[0].id, project.id);
  assert.deepEqual(JSON.parse(await bounded.backup()).document, before);
  await assert.rejects(bounded.api('/api/upload', { projectId: project.id, name: 'extra.txt', data: btoa('EXTRA') }), { status: 413 });
  assert.deepEqual(await persistence.read(), before);
  await bounded.restore(smallBackup);
  assert.equal((await bounded.api('/api/bootstrap')).state.projects.length, 0);
});
