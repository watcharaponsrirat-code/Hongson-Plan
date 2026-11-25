import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard } from '../public/dashboard.js';

function fixture() {
  const state = { projects: [], versions: [], commitments: [], requests: [], summaries: [], tasks: [] };
  const add = (id, year, group, status, amount = 0) => {
    const data = { title: `กิจกรรม ${id}`, fiscalYear: year, group, responsible: 'ครูหนึ่ง', resources: [{ quantity: 1, unitPrice: amount }] };
    const project = { id, status, data };
    if (amount) {
      project.approvedVersionId = `v-${id}`;
      state.versions.push({ id: project.approvedVersionId, projectId: id, data: structuredClone(data) });
    }
    state.projects.push(project);
    return project;
  };
  add('approved', '2569', 'วิชาการ', 'approved', 10000);
  add('old', '2568', 'บริหาร', 'approved', 7000);
  const changing = add('changing', '2569', 'วิชาการ', 'submitted', 5000);
  changing.data = { ...changing.data, title: 'ชื่อใหม่รออนุมัติ', fiscalYear: '2570', group: 'งบประมาณ', resources: [{ quantity: 1, unitPrice: 999999 }] };
  add('submitted', '2569', 'วิชาการ', 'submitted');
  add('reviewed', '2569', 'วิชาการ', 'reviewed');
  add('returned', '2569', 'บริหาร', 'returned');
  state.commitments.push(
    { id: 'partial', projectId: 'approved', amount: 4000, paid: 1500, status: 'partial' },
    { id: 'cancelled', projectId: 'approved', amount: 0, paid: 0, status: 'cancelled' },
    { id: 'settled', projectId: 'approved', amount: 500, paid: 500, status: 'settled' },
    { id: 'paid', projectId: 'changing', amount: 1000, paid: 1000, status: 'paid' },
    { id: 'old', projectId: 'old', amount: 4000, paid: 0, status: 'reserved' },
  );
  state.requests.push(
    { id: 'request-review', projectId: 'approved', status: 'submitted' },
    { id: 'request-approve', projectId: 'reviewed', status: 'reviewed' },
    { id: 'request-old', projectId: 'old', status: 'submitted' },
    { id: 'request-unlinked', projectId: null, status: 'draft' },
  );
  state.summaries.push(
    { id: 'summary-review', projectId: 'approved', status: 'submitted' },
    { id: 'summary-accepted', projectId: 'changing', status: 'accepted' },
    { id: 'summary-old', projectId: 'old', status: 'submitted' },
  );
  state.tasks.push(
    { id: 'undated', projectId: 'approved' },
    { id: 'future', projectId: 'reviewed', due: '2026-11-27' },
    { id: 'older', projectId: 'submitted', dueDate: '2026-11-20' },
    { id: 'unlinked', projectId: null },
    { id: 'today', projectId: 'approved', dueDate: '2026-11-25', overdue: true },
    { id: 'old-year', projectId: 'old', dueDate: '2026-11-01' },
    { id: 'yesterday', projectId: 'approved', dueDate: '2026-11-24' },
  );
  return state;
}

test('dashboard money follows approved year/group even while proposed edits move a project', () => {
  const state = fixture(), before = structuredClone(state);
  const result = buildDashboard(state, { roles: ['planner'] }, { fiscalYear: '2569', group: 'วิชาการ' }, '2026-11-25');
  assert.deepEqual(result.scopeProjects.map(row => row.id), ['approved', 'submitted', 'reviewed']);
  assert.equal(result.budgetProjectCount, 2);
  assert.deepEqual(result.budgetTotals, { approved: 15000, paid: 3000, reserved: 2500, available: 9500 });
  assert.deepEqual(result.budgetGroups, [{ group: 'วิชาการ', approved: 15000, paid: 3000, reserved: 2500, available: 9500 }]);
  const pendingYear = buildDashboard(state, {}, { fiscalYear: '2570' });
  assert.deepEqual(pendingYear.projects.map(row => row.id), ['changing']);
  assert.equal(pendingYear.budgetProjectCount, 0);
  assert.equal(pendingYear.budgetTotals.approved, 0);
  assert.deepEqual(result.options.fiscalYears, ['2570', '2569', '2568']);
  assert.deepEqual(state, before, 'building a dashboard must not mutate persisted data or task flags');
});

test('status narrows only project rows; text search scopes counts/tasks/queues but never budget', () => {
  const state = fixture();
  const result = buildDashboard(state, { roles: ['planner', 'director'] }, { fiscalYear: '2569', group: 'วิชาการ', status: 'submitted' });
  assert.deepEqual(result.projects.map(row => row.id), ['submitted']);
  assert.deepEqual(result.statusCounts, { draft: 0, submitted: 1, reviewed: 1, approved: 1, returned: 0 });
  assert.deepEqual(result.queue, { projects: 2, requests: 2, summaries: 1 });
  assert.equal(result.tasks.length, 5);
  const searched = buildDashboard(state, { roles: ['planner'] }, { fiscalYear: '2569', group: 'วิชาการ', query: ' SUBMITTED ' });
  assert.deepEqual(searched.scopeProjects.map(row => row.id), ['submitted']);
  assert.equal(searched.statusCounts.approved, 0);
  assert.equal(searched.budgetTotals.approved, 15000);
  assert.deepEqual(searched.tasks.map(row => row.id), ['older']);
  assert.deepEqual(searched.queue, { projects: 1, requests: 0, summaries: 0 });
  assert.equal(buildDashboard(state, {}, { query: 'ครูหนึ่ง' }).projects.length, state.projects.length);
});

test('review queues obey action roles, combine roles once, and return the exact actionable records', () => {
  const state = fixture(), filters = { fiscalYear: '2569' };
  for (const role of ['planner', 'plan_head']) {
    const result = buildDashboard(state, { roles: [role] }, filters);
    assert.deepEqual(result.queue, { projects: 1, requests: 1, summaries: 1 });
    assert.equal(result.queueItems.projects[0], state.projects.find(row => row.id === 'submitted'));
    assert.equal(result.queueItems.requests[0], state.requests[0]);
  }
  assert.deepEqual(buildDashboard(state, { roles: ['director'] }, filters).queue, { projects: 1, requests: 1, summaries: 0 });
  assert.deepEqual(buildDashboard(state, { roles: ['planner', 'plan_head', 'director'] }, filters).queue, { projects: 2, requests: 2, summaries: 1 });
  for (const role of ['teacher', 'procurement', 'finance', 'admin']) {
    assert.deepEqual(buildDashboard(state, { roles: [role] }, filters).queue, { projects: 0, requests: 0, summaries: 0 });
  }
});

test('tasks sort overdue and earliest dates first and omit unlinked tasks when project filters apply', () => {
  const state = fixture();
  const result = buildDashboard(state, {}, { fiscalYear: '2569', group: 'วิชาการ' }, '2026-11-25');
  assert.deepEqual(result.tasks.map(row => row.id), ['older', 'yesterday', 'today', 'future', 'undated']);
  assert.deepEqual(result.tasks.map(row => row.overdue), [true, true, false, false, false]);
  assert.equal(buildDashboard(state, {}, {}, '2026-11-25').tasks.some(row => row.id === 'unlinked'), true);
  const statusOnly = buildDashboard(state, {}, { status: 'submitted' }, '2026-11-25');
  assert.deepEqual(statusOnly.projects.map(row => row.id), ['changing', 'submitted']);
  assert.deepEqual(statusOnly.tasks, buildDashboard(state, {}, {}, '2026-11-25').tasks, 'project status must not change any task, including unlinked draft requests');
  assert.equal(buildDashboard(state, {}, { query: 'no match' }, '2026-11-25').tasks.length, 0);
});

test('empty/missing arrays and missing approved snapshots have no invented budget or actions', () => {
  const empty = buildDashboard();
  assert.deepEqual(empty.options, { fiscalYears: [], groups: [] });
  assert.deepEqual(empty.budgetTotals, { approved: 0, paid: 0, reserved: 0, available: 0 });
  assert.deepEqual(empty.queueItems, { projects: [], requests: [], summaries: [] });
  assert.deepEqual(empty.tasks, []);
  const result = buildDashboard({ projects: [{ id: 'lost', status: 'draft', approvedVersionId: 'missing', data: { fiscalYear: 2569, group: '__proto__', resources: [{ quantity: 1, unitPrice: 1000 }] } }] }, {}, { fiscalYear: '2569' });
  assert.equal(result.projects.length, 1);
  assert.equal(result.budgetTotals.approved, 0);
  assert.equal(result.budgetProjectCount, 0);
});

test('resource totals use integer satang rounding and group names cannot collide with object properties', () => {
  const state = { projects: [{ id: 'p', approvedVersionId: 'v', data: { group: '__proto__' } }], versions: [{ id: 'v', data: { group: '__proto__', resources: [{ quantity: 0.125, unitPrice: 100 }, { quantity: 1, unitPrice: 100 }] } }] };
  const result = buildDashboard(state);
  assert.equal(result.budgetTotals.approved, 113);
  assert.deepEqual(result.budgetGroups, [{ group: '__proto__', approved: 113, paid: 0, reserved: 0, available: 113 }]);
});
