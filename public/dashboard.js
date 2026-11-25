import { resourceLineTotal } from './project-template.js';

const list = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const zeroBudget = () => ({ approved: 0, paid: 0, reserved: 0, available: 0 });
const budgetKeys = ['approved', 'paid', 'reserved', 'available'];
const statuses = ['draft', 'submitted', 'reviewed', 'approved', 'returned'];

function matchesScope(data, filters) {
  return ['fiscalYear', 'group'].every(key => !text(filters[key]) || text(data?.[key]) === text(filters[key]));
}

function matchesQuery(project, query) {
  if (!query) return true;
  const data = project.data || {};
  return [project.id, data.title, data.group, data.responsible, data.strategicProjectName]
    .map(text).join(' ').normalize('NFC').toLocaleLowerCase('th-TH').includes(query);
}

function currentDate() {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Summarize already-authorized visibleState without mutating it.
 * Project lists, queues and tasks use current project fields (year/group/query).
 * Status narrows only projects, keeping status tabs and workload counts stable.
 * Money uses only approved snapshots and year/group; search/status never alter it.
 * All money is integer satang. Commitment adjustments store the remaining amount:
 * cancelled = amount 0; settled = amount paid. Preserve paid history in totals.
 */
export function buildDashboard(state = {}, user = {}, filters = {}, today = currentDate()) {
  const allProjects = list(state.projects);
  const versions = new Map(list(state.versions).map(version => [version.id, version]));
  const approvedRows = allProjects.flatMap(project => {
    const data = versions.get(project.approvedVersionId)?.data;
    return data ? [{ project, data }] : [];
  });
  const optionData = [...allProjects.map(project => project.data || {}), ...approvedRows.map(row => row.data)];
  const unique = key => [...new Set(optionData.map(data => text(data[key])).filter(Boolean))];
  const options = {
    fiscalYears: unique('fiscalYear').sort((a, b) => b.localeCompare(a, 'th', { numeric: true })),
    groups: unique('group').sort((a, b) => a.localeCompare(b, 'th')),
  };
  const query = text(filters.query).normalize('NFC').toLocaleLowerCase('th-TH');
  const scopeProjects = allProjects.filter(project => matchesScope(project.data, filters) && matchesQuery(project, query));
  const scopeIds = new Set(scopeProjects.map(project => project.id));
  const selectedStatus = text(filters.status);
  const projects = scopeProjects.filter(project => !selectedStatus || project.status === selectedStatus);
  const statusCounts = Object.fromEntries(statuses.map(status => [status, 0]));
  for (const project of scopeProjects) statusCounts[project.status] = (statusCounts[project.status] || 0) + 1;

  const budgetRows = approvedRows.filter(row => matchesScope(row.data, filters));
  const commitmentsByProject = new Map();
  for (const commitment of list(state.commitments)) {
    const rows = commitmentsByProject.get(commitment.projectId) || [];
    rows.push(commitment);
    commitmentsByProject.set(commitment.projectId, rows);
  }
  const groups = new Map();
  const budgetTotals = zeroBudget();
  for (const { project, data } of budgetRows) {
    const balance = zeroBudget();
    balance.approved = list(data.resources).reduce((sum, resource) => sum + resourceLineTotal(resource), 0);
    for (const commitment of commitmentsByProject.get(project.id) || []) {
      balance.paid += commitment.paid || 0;
      balance.reserved += (commitment.amount || 0) - (commitment.paid || 0);
    }
    balance.available = balance.approved - balance.paid - balance.reserved;
    const group = text(data.group) || 'ยังไม่ระบุกลุ่มงาน';
    if (!groups.has(group)) groups.set(group, { group, ...zeroBudget() });
    for (const key of budgetKeys) {
      budgetTotals[key] += balance[key];
      groups.get(group)[key] += balance[key];
    }
  }
  const budgetGroups = [...groups.values()].sort((a, b) => b.approved - a.approved || a.group.localeCompare(b.group, 'th'));

  const hasProjectFilters = Boolean(text(filters.fiscalYear) || text(filters.group) || query);
  const tasks = list(state.tasks).filter(task => task.projectId ? scopeIds.has(task.projectId) : !hasProjectFilters).map(task => {
    const dueDate = text(task.dueDate || task.due);
    return { ...task, dueDate, overdue: Boolean(dueDate && dueDate < today) };
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99'));

  const roles = list(user.roles);
  const reviews = roles.includes('planner') || roles.includes('plan_head');
  const approves = roles.includes('director');
  const canReview = item => reviews && item.status === 'submitted' || approves && item.status === 'reviewed';
  const queueItems = {
    projects: scopeProjects.filter(canReview),
    requests: list(state.requests).filter(request => scopeIds.has(request.projectId) && canReview(request)),
    summaries: list(state.summaries).filter(summary => reviews && summary.status === 'submitted' && scopeIds.has(summary.projectId)),
  };
  const queue = Object.fromEntries(Object.entries(queueItems).map(([key, rows]) => [key, rows.length]));
  return { options, projects, scopeProjects, statusCounts, budgetTotals, budgetGroups, budgetProjectCount: budgetRows.length, tasks, queue, queueItems };
}
