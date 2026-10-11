const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
if (!process.env.TEST_DATABASE_URL) {
 test('integration boundaries HTTP + PostgreSQL', {skip:'TEST_DATABASE_URL required'},()=>{});
} else {
 const url=new URL(process.env.TEST_DATABASE_URL);
 assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && /test|qa/.test(url.pathname));
 Object.assign(process.env,{DATABASE_URL:process.env.TEST_DATABASE_URL,NODE_ENV:'test',INTEGRATION_SERVICE_SECRET:'integration-boundary-test'});
 const {prisma}=require('../src/config/db');
 const {syncFromApp}=require('../src/services/userLink');
 const {teacherSetAttendance,adminSetAttendance}=require('../src/services/integrationWrite');
 const createUser=(data={})=>prisma.student.create({data:{name:'Fixture',lastName:'Pupil',phone:randomUUID(),password:'unused',...data}});
 test.after(()=>prisma.$disconnect());
 test('public registration cannot claim an existing card, while established app binding stays idempotent',async()=>{
  const phone=`7701${Date.now().toString().slice(-7)}`;
  const child=await createUser({phone,phoneDigits:phone});
  const appUserId=randomUUID();
  const result=await syncFromApp({appUserId,phone,firstName:child.name,lastName:child.lastName});
  assert.equal(result.success,false);assert.equal(result.status,'manual_review');
  assert.equal((await prisma.student.findUnique({where:{id:child.id}})).appUserId,null);
  await prisma.student.update({where:{id:child.id},data:{appUserId,externalLinkStatus:'linked'}});
  assert.equal((await syncFromApp({appUserId,phone,firstName:child.name,lastName:child.lastName})).data.crmStudentId,child.id);
  assert.equal((await syncFromApp({appUserId:randomUUID(),phone,firstName:child.name,lastName:child.lastName})).status,'conflict');
 });
 test('attendance cannot add an unrelated pupil; assigned individual and group pupils and virtual trials work',async()=>{
  const teacher=await createUser({role:'teacher'}), pupil=await createUser(), stranger=await createUser();
  const base={title:'Boundary fixture',date:new Date(),startTime:'12:00',endTime:'12:45',teacherId:teacher.id,recurringDays:[]};
  const cls=await prisma.class.create({data:{...base,individualStudentId:pupil.id}});
  for(const save of [data=>teacherSetAttendance(cls.id,{crmTeacherId:teacher.id,...data}),data=>adminSetAttendance(cls.id,data)]){
   const denied=await save({studentId:stranger.id,attendanceStatus:'present'});
   assert.equal(denied.status,403);assert.equal(denied.code,'LESSON_STUDENT_NOT_ASSIGNED');
   assert.equal(await prisma.classAttendee.count({where:{classId:cls.id,studentId:stranger.id}}),0);
   assert.equal((await save({studentId:pupil.id,attendanceStatus:'present'})).success,true);
  }
  assert.equal((await teacherSetAttendance(cls.id,{crmTeacherId:stranger.id,studentId:pupil.id,attendanceStatus:'present'})).status,403);
  const group=await prisma.group.create({data:{name:'Boundary group',direction:'guitar'}});
  await prisma.studentGroup.create({data:{studentId:pupil.id,groupId:group.id,status:'active'}});
  const grouped=await prisma.class.create({data:{...base,groupId:group.id}});
  assert.equal((await teacherSetAttendance(grouped.id,{crmTeacherId:teacher.id,studentId:pupil.id,attendanceStatus:'present'})).success,true);
  assert.equal((await teacherSetAttendance(grouped.id,{crmTeacherId:teacher.id,studentId:stranger.id,attendanceStatus:'present'})).status,403);
  const trial=await prisma.class.create({data:{...base,classType:'trial'}});
  assert.equal((await teacherSetAttendance(trial.id,{crmTeacherId:teacher.id,studentId:`trial:${trial.id}`,attendanceStatus:'present'})).success,true);
 });
 test('service cannot reopen a lesson or replay an old reopen response',async()=>{
  const express=require('express');const app=express();app.use(express.json());app.use(require('../src/middleware/idempotency'));
  app.use('/api/integration/v1',require('../src/routes/integration'));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
   const key='old-reopen', path='/api/integration/v1/classes/fixture/reopen';
   const hash=require('node:crypto').createHash('sha256').update(['POST',path,'Bearer integration-boundary-test','learning-platform',key].join(':')).digest('hex');
   await prisma.idempotencyKey.upsert({where:{key:hash},create:{key:hash,responseStatus:200,responseBody:'{"success":true}',expiresAt:new Date(Date.now()+60000)},update:{expiresAt:new Date(Date.now()+60000)}});
   const r=await fetch(`http://127.0.0.1:${server.address().port}/api/integration/v1/classes/fixture/reopen`,{method:'POST',headers:{Authorization:'Bearer integration-boundary-test','X-Integration-System':'learning-platform','X-Idempotency-Key':key,'Content-Type':'application/json'},body:JSON.stringify({reason:'correct lesson'})});
   assert.equal(r.status,409);assert.equal((await r.json()).code,'CRM_REOPEN_REQUIRED');
  }finally{await new Promise(r=>server.close(r));}
 });
}
