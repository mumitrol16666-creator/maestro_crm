const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { requiredPermissions, effectivePermissions, validatePermissionPatch } = require('../src/services/rolePermissions');
const cases = [
 ['POST','/api/payments','canManagePayments'], ['POST','/api/users','canCreateUsers'],
 ['POST','/api/users/teachers','canCreateUsers'], ['DELETE','/api/users/person','canDeleteUsers'],
 ['PATCH','/api/users/person/role','canEditRoles'], ['GET','/api/activity-logs?entityType=students','canViewLogs'],
 ['POST','/api/integration-logs/event/retry','canViewLogs'], ['POST','/api/bookings/create-admin','canManageBookings'],
 ['PATCH','/api/bookings/id/trial-details','canManagePayments'], ['PATCH','/api/bookings/id/trial-details','canManageSchedule'],
 ['POST','/api/bookings/id/convert','canManageStudents'], ['PUT','/api/students/id/schedule','canManageSchedule'],
 ['POST','/api/students/id/add-to-group','canManageGroups'], ['POST','/api/groups/id/students/student','canManageStudents'],
 ['PUT','/api/groups/id','canManageSchedule'], ['POST','/api/classes/id/approve','canManagePayments'],
 ['POST','/api/classes/id/reopen','canManagePayments'], ['POST','/api/classes/id/postpone','canManagePayments'],
 ['POST','/api/students/id/balance-adjustment','canManagePayments'], ['POST','/api/memberships','canManagePayments'],
 ['PUT','/api/salary/id/pay','canManagePayments'], ['POST','/api/directions','canManageDirections'],
];
test('permission aliases include side effects; malformed grants deny, omitted legacy flags preserve route ceiling', () => {
 for (const [method, originalUrl, key] of cases) assert.ok(requiredPermissions({ method, originalUrl }).includes(key), `${method} ${originalUrl}: ${key}`);
 assert.deepEqual(requiredPermissions({ method:'POST', originalUrl:'/api/bookings' }), []);
 assert.deepEqual(requiredPermissions({ method:'GET', originalUrl:'/api/directions/public' }), []);
 assert.equal(effectivePermissions('sales_manager', {}) .canManageGroups, true);
 for (const invalid of [null, [], 'true', { canManagePayments:'true' }]) assert.equal(effectivePermissions('admin',invalid).canManagePayments,false);
 for (const body of [{permissions:{unknown:true}}, {permissions:{canViewLogs:1}}, {visibility:null}, {visibility:[]}, {permissions:{canViewLogs:false},extra:true}]) assert.equal(validatePermissionPatch(body),false);
 assert.equal(validatePermissionPatch({permissions:{canViewLogs:false},visibility:{shop:false}}),true);
});
if (!process.env.TEST_DATABASE_URL) {
 test('role revocation HTTP + PostgreSQL', { skip:'TEST_DATABASE_URL required' }, () => {});
} else {
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
 Object.assign(process.env,{DATABASE_URL:process.env.TEST_DATABASE_URL,NODE_ENV:'test',JWT_SECRET:'permission-test-secret'});
 const express=require('express');
 const { prisma }=require('../src/config/db');
 const { authenticate,requireAdmin }=require('../src/middleware/auth');
 const { signSession }=require('../src/utils/sessionVersion');
 let server,base,admin,superAdmin,executions=0;
 const request=async (method,path,token,body={},key=randomUUID())=>{
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Idempotency-Key':key},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json()};
 };
 test.before(async()=>{
  admin=await prisma.student.create({data:{name:'Permission',lastName:'Test',role:'admin',phone:randomUUID(),password:'unused'}});
  superAdmin=await prisma.student.create({data:{name:'Permission owner',lastName:'Test',role:'super_admin',phone:randomUUID(),password:'unused'}});
  const app=express();app.use(express.json());
  const idempotency=require('../src/middleware/idempotency');
  app.use((req,res,next)=>['GET','HEAD'].includes(req.method)?next():idempotency(req,res,next));
  app.use('/api/permissions',require('../src/routes/permissions'));
  app.use(authenticate,requireAdmin,(_req,res)=>res.json({execution:++executions}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
 });
 test.after(async()=>{if(server) await new Promise(r=>server.close(r));await prisma.rolePermissions.deleteMany();await prisma.$disconnect();});
 test('same session and idempotency key cannot replay after permission revocation; reset restores access',async()=>{
  const token=signSession(admin),owner=signSession(superAdmin),key=randomUUID();
  await prisma.rolePermissions.upsert({where:{role:'admin'},create:{role:'admin',permissions:{},visibility:{}},update:{permissions:{},visibility:{}}});
  const first=await request('POST','/api/bookings/create-admin',token,{},key);assert.equal(first.status,200);
  assert.deepEqual(await request('POST','/api/bookings/create-admin',token,{},key),first);
  const changed=await request('PATCH','/api/permissions/admin',owner,{permissions:{canManageBookings:false},visibility:{shop:false}});assert.equal(changed.status,200);
  const before=executions;
  assert.equal((await request('POST','/api/bookings/create-admin',token,{},key)).status,403);assert.equal(executions,before);
  assert.equal((await prisma.rolePermissions.findUnique({where:{role:'admin'}})).visibility.shop,false);
  assert.equal((await request('POST','/api/permissions/admin/reset',owner)).status,200);
  assert.deepEqual(await request('POST','/api/bookings/create-admin',token,{},key),first);
 });
 test('every revoked alias rejects before the handler, including case/trailing slash variants',async()=>{
  for(const [method,path,permission] of cases){
   await prisma.rolePermissions.update({where:{role:'admin'},data:{permissions:{[permission]:false}}});
   const before=executions;
   const result=await request(method,path,signSession(admin));assert.equal(result.status,403,`${method} ${path}`);assert.equal(executions,before);
  }
  await prisma.rolePermissions.update({where:{role:'admin'},data:{permissions:{canManagePayments:false}}});
  assert.equal((await request('POST','/API/CLASSES/id/APPROVE/',signSession(admin))).status,403);
 });
 test('configured grants never grant CRM access to teachers/students or admin routes to sales',async()=>{
  for(const role of ['teacher','student','sales_manager']){
   const user=await prisma.student.create({data:{name:'Denied',lastName:'Test',role,phone:randomUUID(),password:'unused'}});
   await prisma.rolePermissions.upsert({where:{role},create:{role,permissions:{canManagePayments:true},visibility:{}},update:{permissions:{canManagePayments:true}}});
   assert.equal((await request('POST','/api/payments',signSession(user))).status,403);
  }
 });
}
