const mongoose = require('mongoose');
require('dotenv').config();

async function checkBookings() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
        
        const Booking = mongoose.model('Booking', new mongoose.Schema({}, { strict: false }));
        const count = await Booking.countDocuments();
        console.log(`📊 Total bookings in DB: ${count}`);
        
        if (count > 0) {
            const sample = await Booking.findOne();
            console.log('📋 Sample booking:', {
                _id: sample._id,
                status: sample.status,
                createdAt: sample.createdAt
            });
        }
        
        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkBookings();
