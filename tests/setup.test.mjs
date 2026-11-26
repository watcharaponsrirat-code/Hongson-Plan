import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../server.mjs';
import { openDatabase } from '../src/database.mjs';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

async function application(t,options={}) {
  const app=createApplication({dbPath:':memory:',...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  let closed=false;
  const close=async()=>{if(!closed){closed=true;await app.close();}};
  t.after(close);
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=async(path,{body,headers={}}={})=>{
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
    return {response,data:await response.json()};
  };
  return {app,base,call,close};
}
const credentials={username:'school.admin',name:'ผู้ดูแลโรงเรียน',password:'Correct-horse-2569'};

test('fresh database contains no shared-password accounts or fabricated price references',()=>{
  const store=openDatabase(':memory:');
  try {
    assert.deepEqual(store.users(),[]);
    assert.deepEqual(store.load().projects,[]);
    assert.deepEqual(store.load().references,[]);
  } finally {store.close();}
});

test('first-run setup validates credentials, creates one administrator, and closes setup',async t=>{
  const {app,base,call}=await application(t);
  assert.deepEqual((await call('/api/setup')).data,{required:true});
  const initial=await call('/api/bootstrap');
  assert.equal(initial.response.status,401);
  assert.equal(initial.data.setupRequired,true);
  for(const body of [{...credentials,password:'too-short'},{...credentials,username:'invalid name'},{...credentials,name:''},
    {...credentials,username:'a'.repeat(41)},{...credentials,name:'ก'.repeat(151)},
    {...credentials,password:'p'.repeat(201)},{...credentials,password:123456789012},
    {...credentials,username:12345},{...credentials,name:{given:'test'}}]) {
    assert.equal((await call('/api/setup',{body})).response.status,400);
  }
  assert.equal((await call('/api/setup',{body:credentials,headers:{Origin:'https://unrelated.example'}})).response.status,403);
  assert.equal(app.store.users().length,0);
  const setup=await call('/api/setup',{body:credentials});
  assert.equal(setup.response.status,200);
  assert.deepEqual(setup.data.user.roles,['admin']);
  assert.ok(setup.data.csrf);
  assert.equal(setup.data.user.passwordHash,undefined);
  const cookie=setup.response.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Strict/);
  assert.deepEqual((await call('/api/setup')).data,{required:false});
  assert.equal((await call('/api/setup',{body:{...credentials,username:'second.admin'}})).response.status,409);
  assert.equal(app.store.users().length,1);
  const boot=await call('/api/bootstrap',{headers:{Cookie:cookie.split(';')[0]}});
  assert.equal(boot.response.status,200);
  const catalog=JSON.parse(readFileSync(new URL('../public/material-catalog.json',import.meta.url),'utf8'));
  assert.equal(boot.data.state.references.filter(row=>row.kind==='price').length,catalog.items.length);
  assert.equal(boot.data.state.materialCatalog.version,catalog.version);
  assert.equal(boot.data.state.projects.length,0);
  assert.ok(!JSON.stringify(boot.data).includes(credentials.password));
  assert.equal((await call('/api/login',{body:{username:'teacher',password:'Demo@2569'}})).response.status,401);
  assert.equal((await call('/api/login',{body:credentials})).response.status,200);
  for(const path of ['/dashboard.js','/downloads/material-prices-2569.xlsx'])assert.equal((await fetch(base+path)).status,200,path);
});

test('simultaneous first-run requests can create only one administrator',async t=>{
  const {app,call}=await application(t);
  const results=await Promise.all(['first.admin','second.admin'].map(username=>call('/api/setup',{body:{...credentials,username}})));
  assert.deepEqual(results.map(row=>row.response.status).sort(),[200,409]);
  assert.equal(app.store.users().length,1);
  assert.equal(app.store.load().audit.filter(row=>row.action==='system.setup').length,1);
});

test('first administrator at setup limits can be edited and log in again without replacing its password',async t=>{
  const {app,call}=await application(t);
  const input={username:'a'.repeat(40),name:'ก'.repeat(150),password:'p'.repeat(200)};
  const setup=await call('/api/setup',{body:{...input,username:` ${input.username.toUpperCase()} `}});
  assert.equal(setup.response.status,200);
  assert.equal(setup.data.user.username,input.username);
  const oldHash=app.store.user(setup.data.user.id).passwordHash;
  const headers={Cookie:setup.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':setup.data.csrf};
  const update=await call('/api/action',{headers,body:{action:'user.save',...setup.data.user,username:` ${input.username.toUpperCase()} `,roles:['admin','teacher']}});
  assert.equal(update.response.status,200);
  assert.equal(update.data.result.name,input.name);
  assert.equal(update.data.result.username,input.username);
  assert.equal(app.store.user(setup.data.user.id).passwordHash,oldHash);
  assert.equal((await call('/api/bootstrap',{headers})).response.status,401,'editing a user revokes its previous session');
  const login=await call('/api/login',{body:input});
  assert.equal(login.response.status,200);
  assert.deepEqual(login.data.user.roles,['admin','teacher']);
});

test('invalid account input is rejected without truncating names or changing users and audit',async t=>{
  const {app,call}=await application(t);
  const setup=await call('/api/setup',{body:credentials});
  const headers={Cookie:setup.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':setup.data.csrf};
  const account={action:'user.save',username:'another.user',name:'บุคลากร',password:'Eight123',roles:['teacher']};
  const initial=JSON.stringify({users:app.store.users(),audit:app.store.load().audit});
  for(const invalid of [
    {...account,username:12345},{...account,username:'x'.repeat(41)},
    {...account,name:'ก'.repeat(151)},{...account,name:{given:'test'}},
    {...account,password:123456789},{...account,password:{password:'not a string'}},
    {...account,password:'p'.repeat(201)},{...account,password:'short'},
  ]) {
    const result=await call('/api/action',{headers,body:invalid});
    assert.equal(result.response.status,400,JSON.stringify(invalid));
    assert.equal(JSON.stringify({users:app.store.users(),audit:app.store.load().audit}),initial);
  }
  assert.equal((await call('/api/action',{headers,body:account})).response.status,200,'existing minimum of eight characters remains supported');
  assert.equal((await call('/api/login',{body:{username:account.username,password:account.password}})).response.status,200);
});

test('restart keeps existing users, project drafts and edited material prices without reopening setup',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'hongson-setup-'));
  t.after(()=>{
    if(dirname(resolve(directory))!==resolve(tmpdir())||!basename(directory).startsWith('hongson-setup-'))throw new Error('Unexpected cleanup directory');
    rmSync(directory,{recursive:true,force:true});
  });
  const dbPath=join(directory,'application.sqlite');
  const first=await application(t,{dbPath,seed:true});
  assert.deepEqual((await first.call('/api/setup')).data,{required:false});
  const login=await first.call('/api/login',{body:{username:'admin',password:'Demo@2569'}});
  const headers={Cookie:login.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.data.csrf};
  const price=first.app.store.load().references.find(row=>row.id.startsWith('material:'));
  const edit=await first.call('/api/action',{headers,body:{...price,action:'reference.save',name:'รายการราคาที่ผู้ดูแลแก้ไข',data:{...price.data,unitPrice:price.data.unitPrice+101}}});
  assert.equal(edit.response.status,200);
  const teacher=await first.call('/api/login',{body:{username:'teacher',password:'Demo@2569'}});
  const draft=await first.call('/api/action',{headers:{Cookie:teacher.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':teacher.data.csrf},body:{action:'project.save',data:{title:'ฉบับร่างเดิมก่อนอัปเดต',resources:[]}}});
  assert.equal(draft.response.status,200);
  const savedUsers=first.app.store.users();
  const savedState=first.app.store.load();
  await first.close();
  const second=await application(t,{dbPath});
  assert.deepEqual((await second.call('/api/setup')).data,{required:false});
  assert.equal((await second.call('/api/setup',{body:credentials})).response.status,409);
  assert.deepEqual(second.app.store.users(),savedUsers);
  assert.deepEqual(second.app.store.load(),savedState);
  assert.equal((await second.call('/api/login',{body:{username:'teacher',password:'Demo@2569'}})).response.status,200);
  await second.close();
});
