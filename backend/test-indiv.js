const { prisma } = require('./src/config/db');

async function main() {
  try {
    const s = await prisma.student.findFirst();
    
    // Simulate req.body
    const req = {
      body: {
        studentId: s.id,
        groupId: '', // empty for individual
        type: 'individual_package',
        startDate: new Date(),
        paymentType: 'full',
      },
      user: { id: s.id }
    };
    
    const { studentId, groupId, type, startDate, paymentType } = req.body;
    const finalGroupId = groupId || null;
    
    const config = { classes: 8, days: 365, freezes: 0 };
    const newClasses = config.classes;
    const extensionDays = config.days;
    const price = 55900;
    const paidAmount = price;
    const remainingAmount = 0;
    const paymentStatus = 'paid';
    
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + extensionDays);

    const membership = await prisma.membership.create({
        data: {
            studentId,
            groupId: finalGroupId,
            type: type || 'monthly',
            totalClasses: newClasses,
            classesRemaining: newClasses,
            classesUsed: 0,
            startDate: start,
            endDate: end,
            activatedAt: new Date(),
            totalPrice: price,
            paidAmount,
            remainingAmount,
            paymentStatus,
            freezesAvailable: config.freezes,
            freezesUsed: 0,
            status: 'active',
            createdById: req.user.id,
            previousMembershipId: null,
            source: 'manual',
            basePrice: price,
            discountPercent: 0,
            discountReferralPercent: 0,
            discountFamilyPercent: 0,
            discountConcessionPercent: 0
        }
    });
    console.log("Success:", membership.id);
  } catch (e) {
    console.error('Error:', e.message);
  }
}
main().then(() => prisma.$disconnect());
