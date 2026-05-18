const prisma = require('./src/prisma');
const { computeMembershipPrice } = require('./src/utils/pricing');

async function test() {
    try {
        const booking = await prisma.booking.findFirst({ where: { status: 'new' } });
        if (!booking) return console.log('no booking');
        
        console.log('Testing with booking:', booking.id);
        const res = await computeMembershipPrice(null, 'monthly', { previewReferrerId: `booking_${booking.id}` });
        console.log('Result:', res);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}
test();
