// App bindings are supplied by build-pages.mjs. This layer is used only by the
// standalone browser demo; the Node/SQLite application keeps its original API.
api = async function(path, data) {
  try { return await browserDemo.api(path, data); }
  catch (error) {
    if (error.status === 401 && path !== '/api/login') {
      expireSession();
      error.sessionExpired = true;
    }
    throw error;
  }
};

function demoDownload(name, content, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const demoRoleChoices = [
  { value: 'teacher', label: 'ครูผู้รับผิดชอบ' },
  { value: 'teacher2', label: 'ครูคนที่ 2' },
  { value: 'planner', label: 'เจ้าหน้าที่งานแผน' },
  { value: 'plan_head', label: 'หัวหน้างานแผน' },
  { value: 'director', label: 'ผู้อำนวยการ' },
  { value: 'procurement', label: 'พัสดุ' },
  { value: 'finance', label: 'การเงิน' },
  { value: 'admin', label: 'ผู้ดูแลข้อมูลทดลอง' },
  { value: 'multi', label: 'ครู + งานแผน' },
];
const demoStorageNote = 'ข้อมูลเก็บเฉพาะเบราว์เซอร์นี้ ไม่แชร์ข้ามเครื่องหรือข้ามเบราว์เซอร์ การล้างข้อมูลเว็บไซต์อาจทำให้ข้อมูลหาย ควรสำรองไฟล์ไว้';
const demoReferenceNote = __catalog.isDemo === true
  ? 'รายการอ้างอิงและราคาที่แนบเป็นข้อมูลสมมติ ไม่ใช่ข้อมูลทางการของโรงเรียน'
  : `รายการอ้างอิงข้อ 3–4 และ 6–11 จำนวน ${__catalog.items.length} รายการ มาจากเอกสารโรงเรียน ${__catalog.sources.length} ฉบับ ส่วนราคาทรัพยากรและข้อมูลการทดลองยังเป็นข้อมูลสมมติ`;

renderLogin = function(message = '') {
  app.innerHTML = `<div class="login"><div class="login-hero"><div class="brand"><div class="brand-mark">H</div><div><strong>ห้องสอนศึกษา</strong><small>PLAN & BUDGET</small></div></div><div class="login-story"><div class="eyebrow">เว็บทดลองบน GitHub Pages</div><h1>ทดลองงานแผน<br>ครบทุกบทบาท</h1><p>เขียนโครงการ ตรวจและอนุมัติ ทดลองงานพัสดุ การเงิน และสรุปผล โดยสลับบทบาทในเบราว์เซอร์เดียวกัน</p></div><div class="login-footer">เวอร์ชันทดลอง · ข้อมูลแยกในแต่ละเบราว์เซอร์</div></div><div class="login-form-wrap"><form id="login-form" class="login-form"><h2>เลือกบทบาททดลอง</h2><p>ทุกคนสลับบทบาทได้ ไม่ใช่ระบบเข้าสู่ระบบหรือสิทธิ์ใช้งานจริง กรุณาใช้ข้อมูลสมมติ</p>${select('username', 'บทบาทที่ต้องการทดลอง', demoRoleChoices, sessionRecovery?.user.username || 'teacher', null)}<input name="password" type="hidden" value="Demo@2569"><div class="error" role="alert">${esc(message)}</div><button type="submit" class="primary">เริ่มทดลอง</button><div class="demo-accounts"><strong>บันทึกไว้ในเบราว์เซอร์</strong><p>${esc(demoStorageNote)}</p><p>เลือกบทบาทก่อน แล้วใช้ปุ่มสำรองข้อมูลหรือนำเข้าไฟล์สำรองได้จากแถบด้านบน</p><p class="demo-note">${esc(demoReferenceNote)}</p></div></form></div></div>`;
};

const originalDemoRenderDashboard = renderDashboard;
renderDashboard = function() {
  originalDemoRenderDashboard();
  const dashboardNotice = $('#page > .notice');
  if (dashboardNotice) {
    dashboardNotice.innerHTML = `<div><strong>พื้นที่ทดลองใช้งาน</strong> ${esc(demoStorageNote)} บทบาทและการอนุมัติเป็นการจำลอง ไม่มีการเชื่อมบริการภายนอก</div>`;
  }
};

const originalDemoRender = render;
render = function() {
  originalDemoRender();
  if (!boot?.user) return;
  const footer = $('.sidebar-foot');
  if (footer) footer.textContent = 'เวอร์ชันทดลอง · ข้อมูลในเบราว์เซอร์นี้';
  $('.topbar').insertAdjacentHTML('afterend', `<section class="browser-demo-bar" aria-label="โหมดทดลอง"><div><strong>โหมดทดลองบนเบราว์เซอร์</strong><span>ข้อมูลไม่แชร์ข้ามเครื่อง · สลับบทบาทเพื่อทดสอบขั้นตอนงาน</span></div><div class="actions">${btn('สำรองข้อมูล', 'demo-backup', '', 'small')}${btn('นำเข้าไฟล์สำรอง', 'demo-import', '', 'small')}</div></section>`);
  const exitButton = $('[data-action=logout]');
  if (exitButton) exitButton.textContent = 'เปลี่ยนบทบาท';
};

const originalDemoRenderAdmin = renderAdmin;
renderAdmin = function() {
  originalDemoRenderAdmin();
  $$('[data-action=new-user], [data-action=edit-user]').forEach(button => button.remove());
  const intro = $('#page .page-heading p');
  if (intro) intro.textContent = 'ใช้บทบาททดลองที่เตรียมไว้ และแก้ไขทะเบียนข้อมูลอ้างอิงในเบราว์เซอร์นี้';
};

const originalDemoToast = toast;
toast = function(message) {
  originalDemoToast(message === 'บันทึกฉบับร่างลงฐานข้อมูลแล้ว' ? 'บันทึกฉบับร่างในเบราว์เซอร์แล้ว' : message);
};

function demoCsvRows(type) {
  if (type === 'problems') {
    const table = $('#page table');
    if (!table) throw new Error('ไม่มีข้อมูลสำหรับส่งออก');
    return $$('tr', table).map(row => $$('th,td', row).map(cell => cell.innerText));
  }
  return __reports.reportCsvRows(state, type, reportFilters);
}

exportCsv = function(type) {
  const csv = '\uFEFF' + demoCsvRows(type).map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
  demoDownload(`hongson-${type}.csv`, csv, 'text/csv;charset=utf-8');
};

document.addEventListener('click', async event => {
  const fileLink = event.target.closest('a[href^="/api/files/"]');
  const control = event.target.closest('[data-action^="demo-"]');
  if (!fileLink && !['demo-backup', 'demo-import'].includes(control?.dataset.action)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try {
    if (fileLink) {
      const file = await browserDemo.download(fileLink.getAttribute('href'));
      demoDownload(file.name, file.bytes, file.type);
      return;
    }
    if (control.dataset.action === 'demo-backup') {
      const backup = await browserDemo.backup();
      demoDownload(`hongson-demo-backup-${new Date().toISOString().slice(0, 10)}.json`, backup, 'application/json');
      if (new Blob([backup]).size > 50 * 1024 * 1024) {
        showModal('ไฟล์สำรองเกินขนาดที่นำเข้าได้', `<p>ดาวน์โหลดข้อมูลเดิมให้แล้ว แต่ไฟล์นี้มีขนาดเกิน 50 MB จึงยังนำกลับผ่านหน้าเว็บนี้ไม่ได้ กรุณาเก็บไฟล์ไว้และอย่าล้างข้อมูลเว็บไซต์จนกว่าจะจัดการข้อมูลให้มีขนาดที่นำเข้าได้</p><div class="modal-footer">${btn('ปิด', 'close')}</div>`);
        return;
      }
      toast('สร้างไฟล์สำรองแล้ว รวมข้อมูลทุกบทบาทและไฟล์แนบในเบราว์เซอร์นี้');
      return;
    }
    showModal('นำเข้าไฟล์สำรอง', `<form id="demo-import-form"><p>นำเข้าไฟล์สำรองที่สร้างจากเว็บทดลองนี้ ข้อมูลทุกบทบาทและไฟล์แนบปัจจุบันจะถูกแทนที่ ควรสำรองข้อมูลปัจจุบันก่อน</p><label>ไฟล์สำรอง JSON<input type="file" name="backup" accept=".json,application/json" required></label><label class="inline-check"><input type="checkbox" name="confirmed" required>ยืนยันแทนที่ข้อมูลทดลองปัจจุบัน</label><div class="error" role="alert"></div><div class="modal-footer">${btn('ยกเลิก', 'close')}<button type="submit" class="primary">นำเข้าข้อมูล</button></div></form>`);
  } catch (error) { toast(error.message || String(error)); }
}, true);

document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id !== 'demo-import-form') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const button = $('[type=submit]', form);
  if (button.disabled) return;
  button.disabled = true;
  try {
    if (!$('[name=confirmed]', form).checked) throw new Error('กรุณายืนยันแทนที่ข้อมูลก่อนนำเข้า');
    const file = $('[name=backup]', form).files[0];
    if (!file) throw new Error('กรุณาเลือกไฟล์สำรอง');
    if (file.size > 50 * 1024 * 1024) throw new Error('ไฟล์สำรองต้องไม่เกิน 50 MB');
    await browserDemo.restore(await file.text());
    clearSession();
    toast('นำเข้าข้อมูลแล้ว กรุณาเลือกบทบาททดลอง');
  } catch (error) { showError(error, form); }
  finally { button.disabled = false; }
}, true);
