import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { reportCsvRows, reportProjects } from '../src/reports.mjs';
import * as domain from '../src/domain.mjs';
import { buildPages } from '../scripts/build-pages.mjs';

const reportTypes = ['budget', 'quarter', 'strategy', 'standards', 'plan', 'summaries'];
function fixture() {
  const state = { projects: [], versions: [], summaries: [], commitments: [] };
  const add = (id, sources, summaryStatus = 'submitted') => {
    const data = { title: `Approved ${id}`, academicYear: '2569', fiscalYear: '2570', term: '2', group: 'Group A',
      strategicProjectName: 'Test strategy project', strategy: 'Test strategy', standards: ['Standard 1', 'Standard 2'],
      resources: sources.map((source, index) => ({ source, quantity: 1, unitPrice: (index + 1) * 10000, spending: [{ month: '2026-11', amount: (index + 1) * 10000 }] })) };
    state.projects.push({ id, approvedVersionId: `v-${id}`, data: { ...data, title: `Unapproved ${id}`, group: 'Unapproved group' } });
    state.versions.push({ id: `v-${id}`, projectId: id, data });
    if (summaryStatus) state.summaries.push({ id: `s-${id}`, projectId: id, status: summaryStatus, actualPaid: 1500,
      data: { success: 85, scores: [4, 4, 4, 4, 3, 3, 3, 3], problems: [{ category: 'Budget', status: 'none', cause: '' }] } });
  };
  add('mixed', ['Source A', 'Source B']);
  add('other', ['Source B'], 'accepted');
  add('draft-summary', ['Source A'], 'draft');
  add('returned', ['Source A'], 'returned');
  add('no-summary', ['Source A'], null);
  state.projects.push({ id: 'draft', data: { title: 'Unapproved draft', resources: [{ source: 'Source A' }] } });
  state.projects.push({ id: 'missing-version', approvedVersionId: 'missing', data: { title: 'Unapproved fallback', resources: [{ source: 'Source A' }] } });
  return state;
}

test('all exports apply funding-source filters to projects and exclude unapproved fallback data', () => {
  const state = fixture(), before = structuredClone(state);
  for (const type of reportTypes) {
    const rows = reportCsvRows(state, type, { source: 'Source A' }).slice(1);
    assert.ok(rows.length, type);
    assert.ok(rows.every(row => !['other', 'draft', 'missing-version'].includes(row[0])), type);
    assert.ok(rows.every(row => row[1].startsWith('Approved ')), type);
    assert.equal(reportCsvRows(state, type, { source: 'Missing source' }).length, 1, type);
  }
  assert.deepEqual(state, before, 'reporting does not alter stored project or summary data');
});

test('source-specific exports use only selected funding amounts without duplicating standards', () => {
  const state = fixture(), filters = { projectId: 'mixed', source: 'Source B' };
  for (const type of ['strategy', 'standards', 'plan']) {
    const rows = reportCsvRows(state, type, filters);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].at(-1), 200);
    assert.equal(rows[1][8], 'Standard 1; Standard 2');
    assert.equal(reportCsvRows(state, type, { projectId: 'mixed' })[1].at(-1), 300);
  }
  assert.deepEqual(reportCsvRows(state, 'budget', filters)[1].slice(5), ['Source B', 200, 0, 0, 200]);
  assert.deepEqual(reportCsvRows(state, 'quarter', filters)[1].slice(4), ['2026-11', 'Source B', 200]);
});

test('summary report exports only submitted, accepted and returned summaries with frozen payment totals', () => {
  const state = fixture();
  state.summaries.find(summary => summary.projectId === 'mixed').actualPaid = 0;
  state.commitments.push({ projectId: 'mixed', source: 'Source A', amount: 9000, paid: 8000 });
  state.commitments.push({ projectId: 'returned', source: 'Source A', amount: 9000, paid: 6000 });
  const rows = reportCsvRows(state, 'summaries');
  assert.equal(rows[0][5], 'จ่ายจริง ณ วันส่งสรุป (บาท)');
  assert.deepEqual(rows.slice(1).map(row => row[0]), ['mixed', 'other', 'returned']);
  assert.deepEqual(rows.slice(1).map(row => row[2]), ['submitted', 'accepted', 'returned']);
  assert.equal(rows.find(row => row[0] === 'mixed')[5], 0, 'zero snapshot must never fall back to live payments');
  assert.equal(rows.find(row => row[0] === 'returned')[5], 15);
  assert.equal(rows.find(row => row[0] === 'mixed')[4], 87.5);
  assert.equal(reportCsvRows(state, 'summaries', { source: 'Source B', projectId: 'mixed' })[1][5], 0, 'source filter chooses projects; snapshot is the whole-project amount shown on screen');
});

test('report filters follow the current approved version, never editable project fields', () => {
  const state = fixture();
  assert.equal(reportProjects(state, { group: 'Unapproved group' }).length, 0);
  assert.equal(reportProjects(state, { projectId: 'mixed', fiscalYear: 2570, academicYear: '2569', term: '2', group: 'Group A', source: 'Source A' }).length, 1);
  for (const filters of [{ fiscalYear: '2569' }, { academicYear: '2570' }, { term: '1' }, { group: 'Group B' }, { projectId: 'missing' }]) {
    assert.equal(reportProjects(state, filters).length, 0);
  }
  const project = state.projects.find(project => project.id === 'mixed');
  state.versions.push({ id: 'v-mixed-next', projectId: project.id, data: { ...state.versions[0].data, title: 'New approved title', group: 'Group B' } });
  project.approvedVersionId = 'v-mixed-next';
  assert.equal(reportProjects(state, { projectId: project.id, group: 'Group A' }).length, 0);
  assert.equal(reportCsvRows(state, 'plan', { projectId: project.id, group: 'Group B' })[1][1], 'New approved title');
});

test('built Pages export adapter executes the bundled report dependency and matches server projections', () => {
  const { html } = buildPages({ output: false });
  const reportFactory = html.slice(html.indexOf('const __reports ='), html.indexOf('const __store ='));
  const adapter = html.slice(html.indexOf('function demoCsvRows('), html.indexOf('\nexportCsv = function'));
  assert.ok(reportFactory.length && adapter.length);
  const state = fixture();
  state.summaries[0].actualPaid = 0;
  state.commitments.push({ projectId: 'mixed', source: 'Source A', amount: 9000, paid: 8000 });
  const context = { __domain: domain, state, reportFilters: { source: 'Source A' } };
  new Script(`${reportFactory}\n${adapter}\nglobalThis.projectExport = demoCsvRows;`).runInNewContext(context);
  for (const type of reportTypes) assert.deepEqual(structuredClone(context.projectExport(type)), reportCsvRows(state, type, context.reportFilters), type);
});
