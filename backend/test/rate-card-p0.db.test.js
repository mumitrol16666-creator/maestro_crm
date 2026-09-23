const test=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {spawnSync}=require('node:child_process');const path=require('node:path');
if(!process.env.TEST_DATABASE_URL) test('P0 migration and SQL PostgreSQL checks',{skip:'TEST_DATABASE_URL is required'},()=>{});
else {
 const url=new URL(process.env.TEST_DATABASE_URL);assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&/test|qa/.test(url.pathname));
 process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
 const {prisma}=require('../src/config/db');const {capture,readSnapshot}=require('../scripts/audit-rate-cards');const {buildMigrationPlan}=require('../src/services/rateCardMigration');const {applyPlan}=require('../scripts/migrate-rate-cards');const {rateCardMembershipData}=require('../src/services/rateCards');
 async function reset(){ const tables=await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations'`);await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t=>'"'+t.tablename+'"').join(',')} CASCADE`); }
 test.beforeEach(reset);test.after(()=>prisma.$disconnect());
 async function student(extra={}){return prisma.student.create({data:{name:'P0',lastName:randomUUID(),phone:randomUUID(),password:'test',role:'student',learningDirections:[],teacherDirections:[],accountBalance:50000,...extra}});}
 async function old(s,extra={}){return prisma.membership.create({data:{studentId:s.id,type:'duet',lessonFormat:'group',totalPrice:22000,basePrice:22000,totalClasses:8,classesRemaining:8,startDate:new Date('2026-01-01'),endDate:new Date('2026-12-31'),emergencyFreezesAvailable:2,...extra}});}
 test('conflicting prices block archival even when issues or assignments are edited out',async()=>{
  const s=await student();const a=await old(s);await old(s,{totalPrice:20000});
  const plan=buildMigrationPlan(await capture(prisma));
  assert.ok(plan.issues.some(issue=>issue.kind==='superseded_rate'));
  await assert.rejects(()=>applyPlan(prisma,plan),/заблокирован/);
  await assert.rejects(()=>applyPlan(prisma,{...plan,issues:[]}),/План изменён/);
  await assert.rejects(()=>applyPlan(prisma,{...plan,issues:[],assignments:[],archiveIds:[]}),/План изменён/);
  assert.equal((await prisma.membership.findUnique({where:{id:a.id}})).status,'active');
  assert.equal(await prisma.membership.count({where:{billingModel:'rate_card'}}),0);
  assert.equal((await prisma.student.findUnique({where:{id:s.id}})).accountBalance,50000);
 });
 test('valid plan cannot silently change prices; frozen and mixed sources remain blocked',async()=>{
  const s=await student();const m=await old(s);let plan=buildMigrationPlan(await capture(prisma));
  plan.assignments[0].lessonRates.duo.price=1;
  await assert.rejects(()=>applyPlan(prisma,plan),/План изменён/);
  await prisma.membership.update({where:{id:m.id},data:{status:'frozen'}});
  plan=buildMigrationPlan(await capture(prisma));assert.ok(plan.issues.some(i=>i.kind==='unreplaced_source'));
  await assert.rejects(()=>applyPlan(prisma,plan),/заблокирован/);
  await prisma.membership.update({where:{id:m.id},data:{status:'active',type:'hybrid_2m',lessonFormat:'mixed',totalPrice:50000,totalClasses:20}});
  plan=buildMigrationPlan(await capture(prisma));assert.ok(plan.issues.some(i=>i.kind==='legacy_price_review'));
  await assert.rejects(()=>applyPlan(prisma,plan),/заблокирован/);
 });
 test('SQL has no participant multiplication, counts adjustments and distinguishes paid, free and missing events',async()=>{
  const s=await student({accountBalance:950});const b=await student({accountBalance:0});const admin=await student({role:'admin'});
  await prisma.payment.create({data:{studentId:s.id,managerId:admin.id,amount:1000,status:'completed',type:'membership_full',paymentMethod:'cash'}});
  await prisma.payment.create({data:{studentId:s.id,managerId:admin.id,amount:100,status:'refunded',type:'membership_full',paymentMethod:'cash'}});
  await prisma.activityLog.create({data:{userId:admin.id,action:'balance_adjustment',entityType:'Student',entityId:s.id,metadata:{amount:50}}});
  const m=await old(s);const mb=await old(b);const g=await prisma.group.create({data:{name:'P0',direction:'Test',billingType:'duo'}});
  async function lesson(status){return prisma.class.create({data:{title:'P0',groupId:g.id,date:new Date('2026-09-20'),startTime:'10:00',endTime:'11:00',status,classType:'group'}});}
  const cancelled=await lesson('cancelled');
  for(const [st,mm] of [[s,m],[b,mb]]){await prisma.classAttendee.create({data:{classId:cancelled.id,studentId:st.id,attendanceStatus:'unexcused_absence',autoDeducted:true}});await prisma.membershipTransaction.create({data:{membershipId:mm.id,classId:cancelled.id,type:'manual_deduct',amount:0,reason:'legacy'}});}
  const held=await lesson('completed');const free=await prisma.membership.create({data:rateCardMembershipData({studentId:s.id,name:'free',rates:{duo:{basePrice:0,reason:'Льгота'}}})});
  await prisma.classAttendee.create({data:{classId:held.id,studentId:s.id,chargedMembershipId:free.id,attendanceStatus:'present',autoDeducted:true}});
  await prisma.membershipTransaction.create({data:{membershipId:free.id,classId:held.id,type:'manual_deduct',amount:1,chargeAmount:0,reason:'Free'}});
  await prisma.classAttendee.create({data:{classId:held.id,studentId:b.id,attendanceStatus:'unexcused_absence'}});
  // Prisma's schema URL parameter is not a libpq/psql connection option.
  const psqlUrl = new URL(process.env.TEST_DATABASE_URL);
  psqlUrl.searchParams.delete('schema');
  const run=spawnSync('psql',['-X',psqlUrl.toString(),'-A','-t','-v','as_of=2026-09-23T00:00:00Z','-f',path.join(__dirname,'../scripts/audit-lesson-charges.sql')],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const section=n=>run.stdout.split(`=== ${n}.`)[1].split('=== ')[0];
  assert.ok(!section(1).includes(s.id),'valid payment/refund/adjustment must reconcile');
  assert.equal(section(5).split('\n').filter(l=>l.includes(cancelled.id)).length,2,'one row per attendee');
  assert.equal(section(7).split('\n').filter(l=>l.includes(held.id)).length,1);assert.ok(section(7).includes(b.id));assert.ok(!section(7).includes(s.id));
  // Running the diagnostics cannot mutate any financial rows.
  assert.equal((await prisma.student.findUnique({where:{id:s.id}})).accountBalance,950);
 });
}
