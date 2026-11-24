import { totals } from './domain.mjs';

// The server and standalone Pages demo must export the same approved data.
// Draft fields never substitute for a missing approved snapshot.
export function reportProjects(state, filters = {}) {
  return state.projects.flatMap(project => {
    const data = state.versions.find(version => version.id === project.approvedVersionId)?.data;
    if (!data || filters.projectId && project.id !== filters.projectId) return [];
    if (['fiscalYear', 'academicYear', 'term', 'group'].some(key => filters[key] && String(data[key]) !== String(filters[key]))) return [];
    if (filters.source && !(data.resources || []).some(resource => resource.source === filters.source)) return [];
    return [{ project, data }];
  });
}

export function reportCsvRows(state, type, filters = {}) {
  const projects = reportProjects(state, filters);
  const source = filters.source;
  if (type === 'summaries') {
    const rows = projects.flatMap(({ project, data }) => {
      const summary = state.summaries.find(item => item.projectId === project.id);
      if (!summary || !['submitted', 'accepted', 'returned'].includes(summary.status)) return [];
      const scores = summary.data.scores;
      const percent = scores?.length === 8 && scores.every(score => Number(score) >= 1 && Number(score) <= 4)
        ? Number((scores.reduce((sum, score) => sum + Number(score), 0) / 32 * 100).toFixed(2)) : '';
      return [[project.id, data.title, summary.status, summary.data.success ?? '', percent, (summary.actualPaid ?? 0) / 100,
        (summary.data.problems || []).map(problem => `${problem.category}: ${problem.status} ${problem.cause || ''}`).join('; ')]];
    });
    return [['รหัสกิจกรรม', 'กิจกรรม', 'สถานะสรุป', 'ความสำเร็จ (%)', 'ความพึงพอใจ (%)', 'จ่ายจริง ณ วันส่งสรุป (บาท)', 'ปัญหา'], ...rows];
  }
  if (type === 'quarter') return [
    ['รหัสกิจกรรม', 'กิจกรรม', 'ปีงบประมาณ', 'ภาคเรียน', 'เดือนใช้เงิน', 'แหล่งเงิน', 'ยอด (บาท)'],
    ...projects.flatMap(({ project, data }) => (data.resources || []).filter(resource => !source || resource.source === source)
      .flatMap(resource => (resource.spending || []).map(month => [project.id, data.title, data.fiscalYear, data.term, month.month, resource.source, month.amount / 100]))),
  ];
  if (['strategy', 'standards', 'plan'].includes(type)) return [
    ['รหัสกิจกรรม', 'กิจกรรม', 'ปีงบประมาณ', 'ปีการศึกษา', 'ภาคเรียน', 'กลุ่มงาน', 'โครงการเชิงกลยุทธ์', 'กลยุทธ์', 'มาตรฐาน (รวมในช่องเดียวไม่รวมงบซ้ำ)', 'งบอนุมัติ (บาท)'],
    ...projects.map(({ project, data }) => {
      const balance = totals(state, project.id);
      return [project.id, data.title, data.fiscalYear, data.academicYear, data.term, data.group, data.strategicProjectName || data.strategicProjectId,
        data.strategy, (data.standards || []).join('; '), (source ? balance.bySource[source]?.approved || 0 : balance.approved) / 100];
    }),
  ];
  return [
    ['รหัสกิจกรรม', 'กิจกรรม', 'ปีงบประมาณ', 'ภาคเรียน', 'กลุ่มงาน', 'แหล่งเงิน', 'อนุมัติ (บาท)', 'กันไว้ค้างจ่าย (บาท)', 'จ่ายจริง (บาท)', 'คงเหลือ (บาท)'],
    ...projects.flatMap(({ project, data }) => Object.entries(totals(state, project.id).bySource)
      .filter(([name]) => !source || name === source)
      .map(([name, balance]) => [project.id, data.title, data.fiscalYear, data.term, data.group, name, balance.approved / 100, balance.reserved / 100, balance.paid / 100, balance.available / 100])),
  ];
}
