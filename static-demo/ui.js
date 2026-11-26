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

const demoStorageNote = 'ข้อมูลเก็บเฉพาะเบราว์เซอร์นี้ ไม่แชร์ข้ามเครื่องหรือข้ามเบราว์เซอร์ การล้างข้อมูลเว็บไซต์อาจทำให้ข้อมูลหาย ควรสำรองไฟล์ไว้';
const demoReferenceNote = `ข้อมูลอ้างอิงโรงเรียน ${__catalog.items.length} รายการ และบัญชีราคาวัสดุ ${__materials.items.length} ตัวเลือก พร้อมไฟล์ราคาเครื่องเขียน 2569`;
const localAccessNote = 'พื้นที่ส่วนบุคคลในเครื่องนี้ ผู้ที่เข้าถึงเบราว์เซอร์สามารถเลือกผู้ใช้งานได้ การเลือกชื่อและบทบาทเป็นการบันทึกผู้ดำเนินงาน หากต้องการบัญชีและสิทธิ์แยกสำหรับหลายคน ให้ใช้ระบบเซิร์ฟเวอร์';
projectStorageNote = 'บันทึกในเบราว์เซอร์นี้เมื่อกดบันทึกฉบับร่าง';
function localWelcome(body) {
  return `<div class="login"><div class="login-hero"><div class="brand"><div class="brand-mark">H</div><div><strong>ห้องสอนศึกษา</strong><small>PLAN & BUDGET</small></div></div><div class="login-story"><div class="eyebrow">งานแผนและงบประมาณ</div><h1>วางแผนชัดเจน<br>ติดตามได้ทุกขั้นตอน</h1><p>จัดทำโครงการ เลือกวัสดุจากบัญชีราคา และติดตามงบประมาณพร้อมเอกสารประกอบ</p></div><div class="login-footer">โรงเรียนห้องสอนศึกษา ในพระอุปถัมภ์ฯ</div></div><div class="login-form-wrap">${body}</div></div>`;
}
renderSetup = function(message = '') {
  app.innerHTML = localWelcome(`<form id="local-setup-form" class="login-form"><h2>ตั้งค่าพื้นที่ทำงาน</h2><p>กรอกชื่อผู้ดูแลเพื่อเริ่มบันทึกงานแผนในเบราว์เซอร์นี้</p>${input('name','ชื่อผู้ใช้งาน *','','text','required maxlength="200" autocomplete="name"')}${input('username','ชื่อบัญชี *','','text','required pattern="[a-zA-Z0-9_.\\-]{3,64}" minlength="3" maxlength="64" placeholder="เช่น watcharapon" autocomplete="username"')}<p class="form-help">ชื่อบัญชีใช้ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–64 ตัว</p><div class="error" role="alert">${esc(message)}</div><button type="submit" class="primary">สร้างพื้นที่ทำงาน</button><div class="demo-accounts"><p>${esc(demoStorageNote)}</p><p>${esc(localAccessNote)}</p><p>${esc(demoReferenceNote)}</p></div></form>`);
};

renderLogin = async function(message = '') {
  try {
    const setup = await browserDemo.api('/api/setup');
    if (setup.required) { renderSetup(message); return; }
    app.innerHTML = localWelcome(`<form id="login-form" class="login-form"><h2>เข้าสู่พื้นที่ทำงาน</h2><p>เลือกชื่อผู้ดำเนินงานในเครื่องนี้</p>${select('username','ผู้ใช้งาน',setup.profiles.map(user=>({value:user.username,label:user.name+' · '+user.roles.map(role=>roleNames[role]).join(', ')})),sessionRecovery?.user.username||setup.profiles[0]?.username,null)}<div class="error" role="alert">${esc(message)}</div><button type="submit" class="primary">เปิดพื้นที่ทำงาน</button><div class="demo-accounts"><p>${esc(localAccessNote)}</p><p>${esc(demoStorageNote)}</p><p>${esc(demoReferenceNote)}</p></div></form>`);
  } catch (error) { app.innerHTML=localWelcome(`<div class="login-form"><h2>เปิดพื้นที่ทำงานไม่สำเร็จ</h2><p role="alert">${esc(error.message)}</p><p>${esc(demoStorageNote)}</p></div>`); }
};

const originalDemoRenderDashboard = renderDashboard;
renderDashboard = function() {
  originalDemoRenderDashboard();
  $('#page .page-heading').insertAdjacentHTML('afterend', notice(`<strong>พื้นที่ทำงานในเครื่อง</strong> ${esc(demoStorageNote)}`, true));
};

const originalDemoRender = render;
render = function() {
  originalDemoRender();
  if (!boot?.user) return;
  const footer = $('.sidebar-foot');
  if (footer) footer.textContent = 'งานแผนและงบประมาณ · บันทึกในเครื่อง';
  $('.topbar').insertAdjacentHTML('afterend', `<section class="browser-demo-bar" aria-label="พื้นที่ทำงานในเครื่อง"><div><strong>บันทึกอัตโนมัติเมื่อกดบันทึก</strong><span>ข้อมูลในเบราว์เซอร์นี้ · สำรองไฟล์เพื่อย้ายเครื่องหรือเก็บรักษา</span></div><div class="actions">${btn('สำรองข้อมูล', 'demo-backup', '', 'small')}${btn('นำเข้าไฟล์สำรอง', 'demo-import', '', 'small')}</div></section>`);
  const exitButton = $('[data-action=logout]');
  if (exitButton) exitButton.textContent = 'เปลี่ยนผู้ใช้งาน';
};

const originalDemoRenderAdmin = renderAdmin;
renderAdmin = function() {
  originalDemoRenderAdmin();
  const intro = $('#page .page-heading p');
  if (intro) intro.textContent = 'จัดการผู้ดำเนินงานและข้อมูลอ้างอิงในเครื่องนี้';
  $('#page .page-heading').insertAdjacentHTML('afterend', notice(esc(localAccessNote),true));
};
const originalLocalUserForm = userForm;
userForm = function(id = '') { originalLocalUserForm(id); $('[name=password]', modal)?.closest('label')?.remove(); };

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
      demoDownload(`hongson-plan-backup-${new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'})}.json`, backup, 'application/json');
      if (new Blob([backup]).size > 50 * 1024 * 1024) {
        showModal('ไฟล์สำรองเกินขนาดที่นำเข้าได้', `<p>ดาวน์โหลดข้อมูลเดิมให้แล้ว แต่ไฟล์นี้มีขนาดเกิน 50 MB จึงยังนำกลับผ่านหน้าเว็บนี้ไม่ได้ กรุณาเก็บไฟล์ไว้และอย่าล้างข้อมูลเว็บไซต์จนกว่าจะจัดการข้อมูลให้มีขนาดที่นำเข้าได้</p><div class="modal-footer">${btn('ปิด', 'close')}</div>`);
        return;
      }
      toast('สร้างไฟล์สำรองแล้ว รวมข้อมูลทุกบทบาทและไฟล์แนบในเบราว์เซอร์นี้');
      return;
    }
    showModal('นำเข้าไฟล์สำรอง', `<form id="demo-import-form"><p>นำเข้าไฟล์สำรองจากระบบงานแผน ข้อมูลผู้ใช้งาน โครงการ และไฟล์แนบปัจจุบันจะถูกแทนที่ ควรสำรองข้อมูลปัจจุบันก่อน</p><label>ไฟล์สำรอง JSON<input type="file" name="backup" accept=".json,application/json" required></label><label class="inline-check"><input type="checkbox" name="confirmed" required>ยืนยันแทนที่ข้อมูลปัจจุบัน</label><div class="error" role="alert"></div><div class="modal-footer">${btn('ยกเลิก', 'close')}<button type="submit" class="primary">นำเข้าข้อมูล</button></div></form>`);
  } catch (error) { toast(error.message || String(error)); }
}, true);

document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id === 'local-setup-form') {
    event.preventDefault(); event.stopImmediatePropagation();
    const button = $('[type=submit]', form);
    if (button.disabled) return;
    button.disabled = true;
    try { await browserDemo.api('/api/setup', Object.fromEntries(new FormData(form))); await completeLogin(); }
    catch(error) { showError(error,form); }
    finally { button.disabled = false; }
    return;
  }
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
    toast('นำเข้าข้อมูลแล้ว กรุณาเลือกผู้ใช้งาน');
  } catch (error) { showError(error, form); }
  finally { button.disabled = false; }
}, true);
