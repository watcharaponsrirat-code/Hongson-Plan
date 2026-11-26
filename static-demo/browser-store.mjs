// Browser-only demonstration storage. Role selection simulates the workflow;
// it is not authentication and all data stays in this browser's origin.
const DEMO_TABLES = ['projects', 'versions', 'requests', 'commitments', 'payments', 'summaries', 'audit', 'outbox', 'allocations', 'references', 'notifications'];
const DEMO_NAMES = { teacher: 'ครูทดลอง', teacher2: 'ครูทดลองคนที่ 2', planner: 'เจ้าหน้าที่งานแผนทดลอง', plan_head: 'หัวหน้างานแผนทดลอง', director: 'ผู้อำนวยการทดลอง', procurement: 'พัสดุทดลอง', finance: 'การเงินทดลอง', admin: 'ผู้ดูแลระบบทดลอง', multi: 'ครูและงานแผนทดลอง' };
const demoUsers = () => Object.entries(DEMO_NAMES).map(([username, name]) => ({ id: `u-${username}`, username, name, roles: username === 'multi' ? ['teacher', 'planner'] : [username === 'teacher2' ? 'teacher' : username], version: 1, disabled: false }));
const copy = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const MAX_FILE = 5 * 1024 * 1024;
const MAX_BACKUP = 50 * 1024 * 1024;
const PROFILE_ROLES = ['teacher', 'planner', 'plan_head', 'director', 'procurement', 'finance', 'admin'];
function profileFields(data, defaults) {
  const username = String(data.username || '').trim().toLowerCase();
  const name = String(data.name || '').trim();
  const roles = defaults.roles || data.roles;
  if (!/^[a-z0-9_.-]{3,64}$/.test(username)) fail(422, 'ชื่อผู้ใช้ต้องเป็น a-z ตัวเลข จุด ขีดกลาง หรือขีดล่าง 3–64 ตัว');
  if (!name || name.length > 200) fail(422, 'กรุณาระบุชื่อผู้ใช้งานไม่เกิน 200 ตัวอักษร');
  if (!Array.isArray(roles) || !roles.length || roles.some(role => !PROFILE_ROLES.includes(role))) fail(422, 'กรุณาเลือกบทบาทที่ถูกต้องอย่างน้อยหนึ่งบทบาท');
  return { ...defaults, username, name, roles: [...new Set(roles)], disabled: data.disabled === true };
}
function validateProfiles(profiles, allowEmpty = false) {
  if (!Array.isArray(profiles) || profiles.length > 1000) fail(422, 'รายชื่อผู้ใช้ในไฟล์สำรองไม่ถูกต้อง');
  const ids = new Set(), names = new Set();
  for (const user of profiles) {
    if (!plain(user) || typeof user.id !== 'string' || !user.id || ids.has(user.id) || names.has(user.username) || !Number.isSafeInteger(user.version) || user.version < 1) fail(422, 'รายชื่อผู้ใช้ในไฟล์สำรองไม่ถูกต้องหรือซ้ำ');
    const normalized = profileFields(user, {});
    if (user.username !== normalized.username || typeof user.disabled !== 'boolean') fail(422, 'ชื่อบัญชีหรือสถานะผู้ใช้ในไฟล์สำรองไม่ถูกต้อง');
    ids.add(user.id); names.add(user.username);
  }
  if (!(allowEmpty && profiles.length === 0) && !profiles.some(user => !user.disabled && user.roles.includes('admin'))) fail(422, 'ต้องมีผู้ดูแลพื้นที่ทำงานที่ใช้งานได้อย่างน้อยหนึ่งคน');
}
const utf8Bytes = text => new TextEncoder().encode(text).byteLength;
const backupText = document => JSON.stringify({ format: document.users ? 'hongson-plan-backup' : 'hongson-pages-demo-backup', version: 1, exportedAt: new Date().toISOString(), document }, null, 2);
const backupSize = document => utf8Bytes(backupText(document));
const backupLimitError = () => fail(413, 'ข้อมูลและไฟล์แนบรวมเกินขนาดที่สำรองและนำเข้าได้ รายการนี้ยังไม่ถูกบันทึก ข้อมูลเดิมยังอยู่ กรุณาสำรองข้อมูลปัจจุบันก่อน');

function storageError(error) {
  if (error?.status) return error;
  const message = error?.name === 'QuotaExceededError'
    ? 'พื้นที่เก็บข้อมูลของเบราว์เซอร์เต็ม รายการนี้ยังไม่ถูกบันทึก กรุณาสำรองข้อมูลและตรวจพื้นที่ว่าง'
    : 'ไม่สามารถอ่านหรือบันทึกข้อมูลในเบราว์เซอร์ได้ กรุณาตรวจการอนุญาตพื้นที่จัดเก็บ ข้อมูลเดิมจะไม่ถูกล้าง';
  return Object.assign(new Error(message, { cause: error }), { status: 503 });
}

/** Native readwrite transactions serialize mutations across tabs of this origin. */
export function createIndexedDbPersistence(name = 'hongson-pages-demo-v1') {
  let opening;
  const open = () => opening ||= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(storageError()); return; }
    let request;
    try { request = globalThis.indexedDB.open(name, 1); } catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('demo')) request.result.createObjectStore('demo');
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(Object.assign(new Error('กรุณาปิดแท็บทดลองอื่น แล้วเปิดหน้านี้ใหม่เพื่อเตรียมพื้นที่เก็บข้อมูล'), { status: 503 }));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
  });
  async function transact(mode, transform) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let transaction, result, cause;
      try { transaction = db.transaction('demo', mode); } catch (error) { reject(storageError(error)); return; }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(cause || storageError(transaction.error));
      transaction.onerror = () => { /* The abort event reports the failed write. */ };
      const store = transaction.objectStore('demo');
      const request = store.get('document');
      request.onsuccess = () => {
        try {
          if (mode === 'readonly') { result = request.result; return; }
          const changed = transform(request.result);
          if (!changed || changed instanceof Promise || !Object.hasOwn(changed, 'document')) throw new TypeError('Persistence update must return {document,result} synchronously');
          result = changed.result;
          store.put(changed.document, 'document');
        } catch (error) { cause = error; transaction.abort(); }
      };
    });
  }
  return { read: () => transact('readonly'), update: transform => transact('readwrite', transform) };
}

function seedDocument(workspace = false) {
  const state = Object.fromEntries(DEMO_TABLES.map(table => [table, []]));
  state.settings = { projectDeadline: '', summaryDeadline: '', reminderDays: 7 };
  state.references = workspace ? [] : [
    { id: 'ref-demo-project', kind: 'strategic_project', name: 'โครงการเชิงกลยุทธ์ทดลอง A', code: 'DEMO-A' },
    { id: 'ref-demo-group', kind: 'group', name: 'กลุ่มงานทดลอง', code: 'DEMO-G' },
    { id: 'ref-demo-source', kind: 'source', name: 'แหล่งเงินทดลอง A', code: 'DEMO-F' },
    { id: 'ref-demo-price', kind: 'price', name: 'กระดาษทดลอง', code: 'DEMO-P', data: { spec: 'ตัวอย่างสำหรับทดลองระบบ', brand: 'ยี่ห้อทดลอง', unit: 'รีม', unitPrice: 12000, source: 'แหล่งเงินทดลอง A', priceVersion: 'DEMO-1', priceDate: '2026-11-09' } },
  ].map(row => ({ ...row, version: 1, isDemo: true, origin: 'ข้อมูลสมมติ ไม่ใช่ข้อมูลทางการของโรงเรียน', edition: 'DEMO-1' }));
  return { schemaVersion: 1, state, attachments: [], ...(workspace ? { users: [] } : {}) };
}

function checkedDocument(document) {
  if (!plain(document) || document.schemaVersion !== 1 || !plain(document.state) || !plain(document.state.settings) || !Array.isArray(document.attachments) || DEMO_TABLES.some(table => !Array.isArray(document.state[table]))) {
    fail(422, 'รูปแบบหรือรุ่นข้อมูลทดลองไม่รองรับ ข้อมูลเดิมจะไม่ถูกล้างหรือแทนที่');
  }
  return document;
}

function decodeFile(encoded) {
  // A repeated four-character group overflows V8's regexp stack for valid
  // multi-megabyte files. Length plus a flat character check is sufficient.
  if (typeof encoded !== 'string' || !encoded || encoded.length > Math.ceil(MAX_FILE / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail(422, 'ไฟล์ไม่ถูกต้องหรือมีขนาดเกิน 5 MB');
  let decoded;
  try { decoded = atob(encoded); } catch { fail(422, 'อ่านข้อมูลไฟล์ไม่สำเร็จ'); }
  if (!decoded.length || decoded.length > MAX_FILE) fail(422, 'ไฟล์ต้องมีขนาดมากกว่า 0 และไม่เกิน 5 MB');
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}

function validateBackup(text, maxBackupBytes) {
  if (typeof text !== 'string' || !text) fail(422, 'ไฟล์สำรองไม่ถูกต้อง');
  if (text.length > maxBackupBytes || utf8Bytes(text) > maxBackupBytes) backupLimitError();
  let envelope;
  try {
    envelope = JSON.parse(text, (key, value) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(422, 'ไฟล์สำรองมีชื่อช่องข้อมูลที่ไม่รองรับ');
      return value;
    });
  } catch (error) { if (error.status) throw error; fail(422, 'ไฟล์สำรองต้องเป็น JSON ของระบบทดลอง'); }
  if (!plain(envelope) || !['hongson-plan-backup', 'hongson-pages-demo-backup'].includes(envelope.format) || envelope.version !== 1) fail(422, 'ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบงานแผนบน GitHub Pages');
  const document = checkedDocument(envelope.document), state = document.state;
  if (envelope.format === 'hongson-plan-backup' && !Array.isArray(document.users)) fail(422, 'ไฟล์สำรองพื้นที่ทำงานต้องมีรายชื่อผู้ใช้งาน');
  for (const table of [...DEMO_TABLES, 'attachments']) {
    const rows = table === 'attachments' ? document.attachments : state[table];
    if (rows.length > 100000 || rows.some(row => !plain(row) || typeof row.id !== 'string' || !row.id || row.id.length > 200) || new Set(rows.map(row => row.id)).size !== rows.length) fail(422, `รายการ ${table} ในไฟล์สำรองไม่ถูกต้องหรือมีรหัสซ้ำ`);
  }
  if (document.users !== undefined) validateProfiles(document.users);
  const projects = new Set(state.projects.map(row => row.id)), users = new Set((document.users || demoUsers()).map(row => row.id));
  for (const project of state.projects) {
    if (!users.has(project.ownerId) || !plain(project.data) || !Number.isSafeInteger(project.version) || project.version < 1 || !['draft', 'submitted', 'reviewed', 'approved', 'returned'].includes(project.status)) fail(422, 'ข้อมูลโครงการในไฟล์สำรองไม่ถูกต้อง');
    if (project.approvedVersionId && !state.versions.some(version => version.id === project.approvedVersionId && version.projectId === project.id)) fail(422, 'ไม่พบฉบับอนุมัติที่โครงการอ้างถึงในไฟล์สำรอง');
  }
  for (const table of ['versions', 'requests', 'commitments', 'payments', 'summaries', 'outbox']) {
    for (const row of state[table]) if ((table !== 'requests' || row.projectId) && !projects.has(row.projectId)) fail(422, `รายการ ${table} อ้างถึงโครงการที่ไม่มีในไฟล์สำรอง`);
  }
  for (const attachment of document.attachments) {
    if (!projects.has(attachment.projectId) || !users.has(attachment.ownerId) || typeof attachment.name !== 'string' || !attachment.name.trim() || decodeFile(attachment.data).length !== attachment.size) fail(422, 'ข้อมูลไฟล์แนบในไฟล์สำรองไม่ถูกต้อง');
  }
  for (const version of state.versions) if (!plain(version.data) || !Number.isSafeInteger(version.number) || version.number < 1) fail(422, 'ข้อมูลฉบับอนุมัติในไฟล์สำรองไม่ถูกต้อง');
  for (const request of state.requests) {
    if (!users.has(request.ownerId) || !Number.isSafeInteger(request.version) || request.version < 1 || !['draft', 'submitted', 'reviewed', 'approved', 'returned'].includes(request.status) || !['unable', 'items', 'spend', 'quarter', 'purchase', 'budget'].includes(request.type) || !Array.isArray(request.history) || (request.proposed !== null && !plain(request.proposed))) fail(422, 'ข้อมูลคำขอในไฟล์สำรองไม่ถูกต้อง');
  }
  for (const summary of state.summaries) {
    if (!users.has(summary.ownerId) || !Number.isSafeInteger(summary.version) || summary.version < 1 || !['draft', 'submitted', 'returned', 'accepted'].includes(summary.status) || !Array.isArray(summary.history) || !plain(summary.data) || !Array.isArray(summary.data.scores) || summary.data.scores.length !== 8 || summary.data.scores.some(score => score !== null && (!Number.isInteger(score) || score < 1 || score > 4)) || !Array.isArray(summary.data.problems) || summary.data.problems.some(problem => !plain(problem) || !['unanswered', 'none', 'problem'].includes(problem.status))) fail(422, 'ข้อมูลสรุปในไฟล์สำรองไม่ถูกต้อง');
  }
  const proof = (ids, projectId) => {
    if (!Array.isArray(ids) || ids.some(id => !document.attachments.some(file => file.id === id && file.projectId === projectId))) fail(422, 'รายการหลักฐานในไฟล์สำรองไม่ตรงกับโครงการ');
  };
  for (const request of state.requests) proof(request.evidence, request.projectId);
  for (const summary of state.summaries) proof(summary.data.evidence, summary.projectId);
  for (const payment of state.payments) {
    if (!state.commitments.some(commitment => commitment.id === payment.commitmentId && commitment.projectId === payment.projectId) || !Number.isSafeInteger(payment.amount) || payment.amount <= 0) fail(422, 'ข้อมูลการจ่ายในไฟล์สำรองไม่ถูกต้อง');
    proof(payment.evidence, payment.projectId);
  }
  for (const commitment of state.commitments) {
    if (!Number.isSafeInteger(commitment.amount) || !Number.isSafeInteger(commitment.paid) || commitment.amount < commitment.paid || commitment.paid < 0 || !state.requests.some(request => request.id === commitment.requestId && request.projectId === commitment.projectId)) fail(422, 'ข้อมูลวงเงินในไฟล์สำรองไม่ถูกต้อง');
    if (commitment.evidence) proof(commitment.evidence, commitment.projectId);
  }
  return document;
}

/** The injected domain is the same workflow used by the Node application. */
export function createBrowserDemo({ domain, references, catalog, materials, workspace = false, persistence, sessionStorage = globalThis.sessionStorage, uuid = () => crypto.randomUUID(), sessionKey, maxBackupBytes = MAX_BACKUP } = {}) {
  const scope = (globalThis.location?.pathname || '/').replace(/index\.html$/, '');
  const databaseName = `hongson-pages-demo-v1:${scope}`;
  persistence ||= createIndexedDbPersistence(databaseName);
  sessionKey ||= `${databaseName}:user`;
  let users = workspace ? [] : demoUsers();
  if (!domain?.mutate || !domain?.visibleState || !domain?.totals || !references?.prepareReferenceAction || !catalog?.version || !Array.isArray(catalog.items)) throw new TypeError('Browser demo dependencies are incomplete');
  if (!Number.isSafeInteger(maxBackupBytes) || maxBackupBytes < 1 || maxBackupBytes > MAX_BACKUP) throw new TypeError('Backup size limit must be a positive integer no greater than 50 MiB');
  function currentUser() {
    let username;
    try { username = sessionStorage?.getItem(sessionKey); } catch (error) { throw storageError(error); }
    const user = users.find(row => row.username === username && !row.disabled);
    if (!user) fail(401, 'กรุณาเลือกบทบาททดลองเพื่อใช้งานต่อ');
    return user;
  }
  async function update(transform) {
    try {
      return await persistence.update(stored => {
        const document = stored === undefined ? seedDocument(workspace) : checkedDocument(stored);
        prepare(document);
        const previousBytes = stored === undefined ? 0 : backupSize(document);
        const result = transform(document);
        const nextBytes = backupSize(document);
        // Preserve legacy oversized data, including no-op retries and changes
        // that reduce its size. New growth must remain restorable.
        if (nextBytes > maxBackupBytes && nextBytes > previousBytes) backupLimitError();
        return { document, result };
      });
    } catch (error) { throw storageError(error); }
  }
  async function read() {
    try {
      const document = await persistence.read();
      if (document !== undefined) return prepare(checkedDocument(document));
      return await update(stored => copy(stored));
    } catch (error) { throw storageError(error); }
  }
  function prepare(document) {
    if (workspace) {
      // Retain legacy owners and records when upgrading an existing browser.
      if (document.users === undefined) document.users = demoUsers().map(user => ({ ...user, name: user.name.replaceAll('ทดลอง', '') }));
      validateProfiles(document.users, true);
      users = document.users;
    }
    if (materials?.items) {
      const ids = new Set(document.state.references.map(row => row.id));
      document.state.references.push(...copy(materials.items.filter(row => !ids.has(row.id))));
    }
    return document;
  }
  function view(document, user) {
    const state = domain.visibleState(document.state, user);
    state.schoolReferenceCatalog = copy(catalog);
    if (materials) state.materialCatalog = { version: materials.version, sources: copy(materials.sources), unpricedItems: copy(materials.unpricedItems || []) };
    state.budgets = state.projects.map(project => ({ projectId: project.id, ...domain.totals(document.state, project.id) }));
    const allowed = new Set(state.projects.map(project => project.id));
    state.attachments = document.attachments.filter(file => allowed.has(file.projectId)).map(({ data, ownerId, ...metadata }) => metadata);
    return state;
  }
  function checkProject(document, user, id) {
    if (!domain.visibleState(document.state, user).projects.some(project => project.id === id)) fail(403, 'บทบาททดลองนี้เข้าถึงโครงการดังกล่าวไม่ได้');
  }
  function documentUser(document, user) {
    const actor = workspace ? document.users.find(row => row.id === user.id && !row.disabled) : user;
    if (!actor) fail(401, 'ผู้ใช้งานนี้ถูกระงับแล้วหรือไม่มีในพื้นที่ทำงาน');
    return actor;
  }
  function checkEvidence(document, user, input) {
    const evidence = input.evidence || input.data?.evidence || [];
    if (!Array.isArray(evidence)) fail(422, 'รายการไฟล์หลักฐานไม่ถูกต้อง');
    const state = document.state;
    const target = input.projectId || state.projects.find(row => row.id === input.id)?.id || state.requests.find(row => row.id === input.id)?.projectId || state.commitments.find(row => row.id === (input.commitmentId || input.id))?.projectId || state.summaries.find(row => row.id === input.id)?.projectId;
    for (const id of evidence) {
      const file = document.attachments.find(row => row.id === id);
      if (!file) fail(422, 'ไม่พบไฟล์หลักฐาน');
      checkProject(document, user, file.projectId);
      if (target && file.projectId !== target) fail(422, 'ไฟล์หลักฐานต้องเป็นของโครงการเดียวกัน');
    }
  }
  async function api(path, data) {
    if (workspace) {
      const document = await read();
      if (path === '/api/setup') {
        if (!data) return { required: !document.users.length, mode: 'browser-local', profiles: copy(document.users.filter(user => !user.disabled)) };
        const user = await update(stored => {
          if (stored.users.length) fail(409, 'พื้นที่ทำงานนี้ตั้งค่าแล้ว กรุณาเลือกผู้ใช้งาน');
          const user = profileFields({ ...data, disabled: false }, { id: uuid(), version: 1, roles: [...PROFILE_ROLES] });
          stored.users.push(user);
          return copy(user);
        });
        try { sessionStorage.setItem(sessionKey, user.username); } catch (error) { throw storageError(error); }
        return { user, mode: 'browser-local' };
      }
      if (!document.users.length) throw Object.assign(new Error('กรุณาตั้งค่าพื้นที่ทำงานครั้งแรก'), { status: 401, setupRequired: true });
    }
    if (path === '/api/login') {
      const username = String(data?.username || '').trim().toLowerCase();
      const user = users.find(row => row.username === username && !row.disabled);
      if (!user) fail(401, 'ไม่พบบทบาททดลองที่เลือก');
      await read();
      try { sessionStorage.setItem(sessionKey, username); } catch (error) { throw storageError(error); }
      return { user: copy(user), csrf: 'browser-demo', mode: workspace ? 'browser-local' : 'browser-demo' };
    }
    if (path === '/api/logout') {
      try { sessionStorage.removeItem(sessionKey); } catch (error) { throw storageError(error); }
      return { ok: true };
    }
    const user = currentUser();
    if (path === '/api/bootstrap') {
      const document = await read(), actor = documentUser(document, user);
      return { user: copy(actor), users: copy(users), state: view(document, actor), csrf: 'browser-demo', mode: workspace ? 'browser-local' : 'browser-demo', integrations: { sheets: false, phone: false } };
    }
    if (path === '/api/action') {
      if (!plain(data) || typeof data.action !== 'string') fail(400, 'ไม่ระบุการทำงาน');
      if (data.action === 'user.save' && workspace) return update(document => {
        const current = document.users.find(row => row.id === user.id && !row.disabled);
        if (!current?.roles.includes('admin')) fail(403, 'ต้องใช้ผู้ดูแลพื้นที่ทำงานเพื่อแก้ไขผู้ใช้งาน');
        const existing = data.id ? document.users.find(row => row.id === data.id) : null;
        if (data.id && !existing) fail(404, 'ไม่พบผู้ใช้งาน');
        if (existing && Number(data.version) !== existing.version) fail(409, 'ข้อมูลผู้ใช้เปลี่ยนแล้ว กรุณาโหลดใหม่');
        const changed = profileFields(data, { id: existing?.id || uuid(), version: (existing?.version || 0) + 1 });
        if (document.users.some(row => row.id !== changed.id && row.username === changed.username)) fail(409, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
        const next = document.users.filter(row => row.id !== changed.id).concat(changed);
        validateProfiles(next);
        document.users = next; users = next;
        document.state.audit.push({ id: uuid(), action: 'user.save', userId: current.id, entityId: changed.id, createdAt: new Date().toISOString(), before: existing ? copy(existing) : null, after: copy(changed) });
        return { result: copy(changed) };
      });
      if (data.action === 'user.save') fail(422, 'พื้นที่เดิมใช้รายชื่อคงที่ ไม่สร้างรหัสผ่าน');
      const input = copy(data);
      return update(document => {
        const actor = documentUser(document, user);
        checkEvidence(document, actor, input);
        references.prepareReferenceAction(document.state, input);
        const result = domain.mutate(document.state, actor, input);
        return { result, state: view(document, actor) };
      });
    }
    if (path === '/api/upload') {
      if (!plain(data) || typeof data.name !== 'string' || !data.name.trim()) fail(422, 'กรุณาระบุไฟล์แนบ');
      const bytes = decodeFile(data.data);
      return update(document => {
        const actor = documentUser(document, user);
        checkProject(document, actor, data.projectId);
        const file = { id: uuid(), projectId: data.projectId, ownerId: user.id, name: data.name.replace(/[\\/\r\n\x00]/g, '_').slice(0, 180), type: String(data.type || 'application/octet-stream').slice(0, 100), size: bytes.length, data: data.data, createdAt: new Date().toISOString() };
        document.attachments.push(file);
        return { id: file.id, name: file.name };
      });
    }
    fail(404, 'ไม่พบคำสั่งในระบบทดลอง');
  }
  async function download(path) {
    if (workspace) await read();
    const user = currentUser();
    if (!path.startsWith('/api/files/')) fail(404, 'ไม่พบไฟล์ทดลอง');
    let id;
    try { id = decodeURIComponent(path.slice('/api/files/'.length)); } catch { fail(400, 'รหัสไฟล์ไม่ถูกต้อง'); }
    const document = await read(), file = document.attachments.find(row => row.id === id);
    if (!file) fail(404, 'ไม่พบไฟล์แนบ');
    checkProject(document, documentUser(document, user), file.projectId);
    return { name: file.name, bytes: decodeFile(file.data), type: 'application/octet-stream' };
  }
  async function backup() {
    if (workspace) await read();
    currentUser();
    return backupText(await read());
  }
  async function restore(text) {
    if (workspace) await read();
    currentUser();
    const document = validateBackup(text, maxBackupBytes);
    prepare(document);
    // Compact input may fit even though our formatted export would not.
    if (backupSize(document) > maxBackupBytes) backupLimitError();
    // Validate normalized project structures before replacing any stored data.
    if (domain.validateProject) {
      const proposals = [...document.state.projects, ...document.state.versions].map(row => row.data);
      proposals.push(...document.state.requests.filter(row => row.proposed).map(row => row.proposed));
      for (const data of proposals) domain.validateProject(data, false, { previous: data });
    }
    try { await persistence.update(() => ({ document, result: { ok: true } })); } catch (error) { throw storageError(error); }
    return { ok: true };
  }
  return { api, download, backup, restore };
}
