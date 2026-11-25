import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as template from '../public/project-template.js';
import * as referencePicker from '../public/reference-picker.js';
import { buildDashboard } from '../public/dashboard.js';

// Execute the real dashboard renderer and delegated event handlers. These small
// DOM doubles check behavior and generated markup, not browser layout.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const projects = [
    { id: 'approved', status: 'approved', approvedVersionId: 'v-approved', ownerId: 'teacher', data: { title: 'โครงการอนุมัติ', fiscalYear: '2569', group: 'วิชาการ', responsible: 'ครูหนึ่ง', resources: [{ quantity: 1, unitPrice: 100000 }] } },
    { id: 'submitted', status: 'submitted', ownerId: 'teacher', data: { title: 'โครงการรอตรวจ', fiscalYear: '2569', group: 'วิชาการ', responsible: 'ครูสอง', resources: [] } },
    { id: 'older', status: 'reviewed', ownerId: 'teacher', data: { title: 'โครงการปีก่อน', fiscalYear: '2568', group: 'บริหาร', responsible: 'ครูหนึ่ง', resources: [] } },
    { id: 'returned', status: 'returned', ownerId: 'teacher', data: { title: '<img src=x onerror=alert(1)>', fiscalYear: '2570', group: 'งบประมาณ', responsible: 'ครูสาม', resources: [] } },
  ];
  return {
    projects,
    versions: [{ id: 'v-approved', projectId: 'approved', data: structuredClone(projects[0].data) }],
    commitments: [{ id: 'commitment', projectId: 'approved', source: 'เงินอุดหนุน', amount: 30000, paid: 10000 }],
    requests: [
      { id: 'request-current', projectId: 'approved', status: 'submitted', type: 'purchase', reason: 'ซื้ออุปกรณ์', amount: 30000 },
      { id: 'request-older', projectId: 'older', status: 'submitted', type: 'spend', reason: 'ค่าใช้จ่ายปีก่อน', amount: 1000 },
    ],
    summaries: [
      { id: 'summary-current', projectId: 'approved', status: 'submitted' },
      { id: 'summary-older', projectId: 'older', status: 'submitted' },
    ],
    tasks: [
      { id: 'review-task', type: 'project.review', kind: 'review', projectId: 'submitted', entityId: 'submitted', title: 'ตรวจโครงการที่ครูส่ง' },
      { id: 'old-task', type: 'project.approve', kind: 'review', projectId: 'older', entityId: 'older', title: 'พิจารณาอนุมัติโครงการ' },
    ],
    references: [], attachments: [], audit: [], outbox: [], notifications: [], settings: {},
  };
}

function dashboardUi({ state = fixture(), roles = ['planner'], userId = 'planner' } = {}) {
  const element = () => ({
    innerHTML: '', textContent: '', style: {}, open: false,
    classList: { add() {}, remove() {}, toggle() {} },
    showModal() { this.open = true; }, close() { this.open = false; },
    replaceChildren() { this.innerHTML = ''; this.textContent = ''; },
    querySelector() { return null; }, scrollIntoView() {},
  });
  const nodes = Object.fromEntries(['app', 'page', 'page-error', 'modal', 'toast', 'print-area'].map(id => [`#${id}`, element()]));
  const listeners = new Map(), routes = [], fetches = [], responses = [];
  const document = {
    createElement: element, head: { append() {} },
    querySelector: selector => nodes[selector] || null,
    querySelectorAll: () => [],
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
  };
  const context = vm.createContext({
    ...template, ...referencePicker, buildDashboard, document, structuredClone,
    setTimeout: () => 1, clearTimeout() {}, routes,
    window: { addEventListener() {}, scrollTo() {} },
    FormData: class {
      constructor(form) { this.entries = Object.entries(form.values); }
      [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
    },
    fetch: async (path, options) => {
      fetches.push({ path, options });
      assert.ok(responses.length, `Unexpected API request: ${path}`);
      return { ok: true, status: 200, json: async () => responses.shift() };
    },
  });
  const body = source.slice(source.indexOf('\n') + 1).replace(/\nawait startApplication\(\);?\s*$/, '');
  vm.runInContext(body + `
    globalThis.testUi = {
      seed(value) { boot = value; state = value.state; render(); },
      snapshot() { return { page, dashboardFilters }; },
      clearSession,
      stubDestinations() {
        viewProject = id => routes.push(['project', id]);
        viewRequest = id => routes.push(['request', id]);
        viewSummary = id => routes.push(['summary', id]);
        summaryForm = (...args) => routes.push(['summaryForm', ...args]);
        paymentForm = id => routes.push(['paymentForm', id]);
        navigate = (...args) => routes.push(['navigate', ...args]);
      }
    };
    showError = error => { throw error; };
  `, context);
  const boot = { user: { id: userId, name: 'ผู้ทดสอบ', roles }, csrf: 'test-csrf', state, users: [] };
  context.testUi.seed(boot);
  const dispatch = async (name, event) => {
    for (const listener of listeners.get(name) || []) await listener(event);
  };
  return {
    boot, state, routes, fetches, responses, modal: nodes['#modal'], toast: nodes['#toast'],
    get html() { return nodes['#page'].innerHTML; },
    snapshot: () => plain(context.testUi.snapshot()),
    clearSession: context.testUi.clearSession,
    seed: value => context.testUi.seed(value),
    stubDestinations: context.testUi.stubDestinations,
    async click(action, id = '') {
      const control = { dataset: { action, id }, closest(selector) { return selector === '[data-action]' ? this : null; } };
      await dispatch('click', { target: control });
    },
    async filter(values) {
      assert.match(nodes['#page'].innerHTML, /<form id="dashboard-filter-form"/);
      const submit = { disabled: false };
      const form = { id: 'dashboard-filter-form', dataset: {}, values,
        querySelector: selector => selector === '[type=submit]' ? submit : null };
      let prevented = false;
      await dispatch('submit', { target: form, preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(submit.disabled, false);
    },
  };
}

function projectIds(html) {
  return [...new Set([...html.matchAll(/data-action="view-project" data-id="([^"]+)"/g)].map(match => match[1]))];
}

test('dashboard renders usable filters, role queues and escaped project titles', () => {
  const ui = dashboardUi();
  assert.match(ui.html, /name="fiscalYear"/);
  assert.match(ui.html, /name="group"/);
  assert.match(ui.html, /name="query" type="search"/);
  assert.match(ui.html, /data-action="dashboard-queue" data-id="projects"/);
  assert.match(ui.html, /data-action="dashboard-queue" data-id="requests"/);
  assert.match(ui.html, /data-action="dashboard-queue" data-id="summaries"/);
  assert.deepEqual(projectIds(ui.html), ['approved', 'submitted', 'older', 'returned']);
  assert.match(ui.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(ui.html, /<img src=x/);
  assert.equal(ui.fetches.length, 0);
});

test('submitting dashboard filters updates rows and tasks while retaining approved money during search', async () => {
  const ui = dashboardUi();
  await ui.filter({ fiscalYear: ' 2569 ', group: ' วิชาการ ', query: ' ครูสอง ' });
  assert.deepEqual(ui.snapshot().dashboardFilters, { fiscalYear: '2569', group: 'วิชาการ', query: 'ครูสอง', status: '' });
  assert.deepEqual(projectIds(ui.html), ['submitted']);
  assert.match(ui.html, /data-action="open-task" data-id="review-task"/);
  assert.doesNotMatch(ui.html, /data-action="open-task" data-id="old-task"/);
  assert.match(ui.html, /<div class="metric-number">1,000\.00<\/div>/, 'approved money survives a query that matches only an unapproved project');
  assert.match(ui.html, /<div class="metric-number">700\.00<\/div>/);
  assert.equal(ui.fetches.length, 0, 'filtering is read-only and local');
});

test('status buttons preserve the scope counts and reset restores all filters and records', async () => {
  const ui = dashboardUi();
  await ui.filter({ fiscalYear: '2569', group: 'วิชาการ', query: '' });
  await ui.click('dashboard-status', 'approved');
  assert.deepEqual(projectIds(ui.html), ['approved']);
  assert.match(ui.html, /data-id="approved" aria-pressed="true"><strong>1<\/strong>/);
  assert.match(ui.html, /data-id="submitted" aria-pressed="false"><strong>1<\/strong>/);
  await ui.filter({ fiscalYear: '2569', group: 'วิชาการ', query: 'ครูสอง' });
  assert.match(ui.html, /ไม่พบโครงการตามตัวกรอง/);
  assert.equal(ui.snapshot().dashboardFilters.status, 'approved');
  await ui.click('dashboard-reset');
  assert.deepEqual(ui.snapshot().dashboardFilters, {});
  assert.deepEqual(projectIds(ui.html), ['approved', 'submitted', 'older', 'returned']);
});

test('queue buttons open the exact scoped actionable project, request and summary records', async () => {
  const ui = dashboardUi();
  await ui.filter({ fiscalYear: '2569', group: 'วิชาการ', query: '' });
  await ui.click('dashboard-queue', 'projects');
  assert.equal(ui.modal.open, true);
  assert.deepEqual(projectIds(ui.modal.innerHTML), ['submitted']);
  await ui.click('dashboard-queue', 'requests');
  assert.match(ui.modal.innerHTML, /data-action="view-request" data-id="request-current"/);
  assert.doesNotMatch(ui.modal.innerHTML, /request-older/);
  await ui.click('dashboard-queue', 'summaries');
  assert.match(ui.modal.innerHTML, /data-action="view-summary" data-id="summary-current"/);
  assert.doesNotMatch(ui.modal.innerHTML, /summary-older/);
  await ui.filter({ fiscalYear: '2570', group: '', query: '' });
  await ui.click('dashboard-queue', 'projects');
  assert.match(ui.modal.innerHTML, /ไม่มีรายการรอดำเนินการตามตัวกรอง/);
});

test('teacher has no review queue controls and director has no summary-review queue', () => {
  const teacher = dashboardUi({ roles: ['teacher'], userId: 'teacher' });
  assert.doesNotMatch(teacher.html, /data-action="dashboard-queue"/);
  assert.match(teacher.html, /data-action="new-project"/);
  const director = dashboardUi({ roles: ['director'] });
  assert.match(director.html, /data-action="dashboard-queue" data-id="projects"/);
  assert.match(director.html, /data-action="dashboard-queue" data-id="requests"/);
  assert.doesNotMatch(director.html, /data-action="dashboard-queue" data-id="summaries"/);
});

test('task buttons route real domain task shapes to the corresponding working screen', async () => {
  const state = fixture();
  state.summaries = state.summaries.filter(summary => summary.projectId !== 'older');
  state.summaries.push({ id: 'summary-draft', projectId: 'returned', status: 'draft' });
  const examples = [
    [{ id: 'summary-review', type: 'summary.review', kind: 'summary', projectId: 'approved', entityId: 'summary-current' }, ['summary', 'summary-current']],
    [{ id: 'summary-existing', type: 'summary.submit', kind: 'summary', projectId: 'returned', entityId: 'summary-draft' }, ['summaryForm', 'summary-draft', 'returned']],
    [{ id: 'summary-new', type: 'summary.submit', kind: 'summary', projectId: 'older', entityId: 'older' }, ['summaryForm', '', 'older']],
    [{ id: 'payment', type: 'payment.create', kind: 'finance', projectId: 'approved', entityId: 'commitment' }, ['paymentForm', 'commitment']],
    [{ id: 'procurement', type: 'commitment.confirm', kind: 'procurement', projectId: 'approved', entityId: 'request-current', requestId: 'request-current' }, ['request', 'request-current']],
    [{ id: 'request', type: 'request.review', kind: 'request', projectId: 'approved', entityId: 'request-current', requestId: 'request-current' }, ['request', 'request-current']],
    [{ id: 'project', type: 'project.review', kind: 'review', projectId: 'submitted', entityId: 'submitted' }, ['project', 'submitted']],
  ];
  state.tasks = examples.map(([task]) => ({ ...task, title: task.id }));
  const ui = dashboardUi({ state, roles: ['teacher', 'planner', 'procurement', 'finance'] });
  ui.stubDestinations();
  for (const [task, expected] of examples) {
    assert.ok(ui.html.includes(`data-action="open-task" data-id="${task.id}"`));
    await ui.click('open-task', task.id);
    assert.deepEqual(plain(ui.routes.at(-1)), expected, task.type);
  }
  const routeCount = ui.routes.length;
  await ui.click('open-task', 'stale-task');
  assert.equal(ui.routes.length, routeCount);
  assert.match(ui.toast.textContent, /ไม่พบงานนี้แล้ว/);
});

test('refresh retains dashboard filters and logout clears them before another user signs in', async () => {
  const ui = dashboardUi();
  await ui.filter({ fiscalYear: '2569', group: 'วิชาการ', query: '' });
  ui.responses.push(ui.boot);
  await ui.click('refresh');
  assert.equal(ui.fetches.length, 1);
  assert.equal(ui.fetches[0].path, '/api/bootstrap');
  assert.deepEqual(projectIds(ui.html), ['approved', 'submitted']);
  ui.clearSession();
  assert.deepEqual(ui.snapshot().dashboardFilters, {});
  ui.seed({ ...ui.boot, user: { id: 'director', name: 'ผู้อำนวยการ', roles: ['director'] } });
  assert.deepEqual(projectIds(ui.html), ['approved', 'submitted', 'older', 'returned']);
});
