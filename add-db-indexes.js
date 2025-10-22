const mongoose = require('mongoose');

// Подключение к БД
const connectDB = async () => {
    try {
        // Используем строку подключения из .env файла
        const mongoUri = 'mongodb+srv://Dmitriy:Coolpopitd12@cluster0.ecwubgs.mongodb.net/SenseOfDance?retryWrites=true&w=majority';
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }
};

// 🚀 ДОБАВЛЕНИЕ СОСТАВНЫХ ИНДЕКСОВ ДЛЯ ОПТИМИЗАЦИИ
async function addOptimizedIndexes() {
    await connectDB();
    
    try {
        console.log('🚀 Adding optimized database indexes...');
        
        // 📊 BOOKINGS - самые частые запросы
        await mongoose.connection.db.collection('bookings').createIndex({ 
            status: 1, 
            createdAt: -1 
        });
        console.log('✅ Bookings: status + createdAt');
        
        await mongoose.connection.db.collection('bookings').createIndex({ 
            name: 1, 
            lastName: 1, 
            phone: 1 
        });
        console.log('✅ Bookings: name + lastName + phone (search)');
        
        await mongoose.connection.db.collection('bookings').createIndex({ 
            status: 1, 
            processedAt: -1 
        });
        console.log('✅ Bookings: status + processedAt');
        
        // 👥 STUDENTS - поиск и фильтрация
        await mongoose.connection.db.collection('students').createIndex({ 
            role: 1, 
            status: 1, 
            createdAt: -1 
        });
        console.log('✅ Students: role + status + createdAt');
        
        await mongoose.connection.db.collection('students').createIndex({ 
            name: 1, 
            lastName: 1, 
            phone: 1 
        });
        console.log('✅ Students: name + lastName + phone (search)');
        
        // 💰 PAYMENTS - фильтрация по датам и статусам
        await mongoose.connection.db.collection('payments').createIndex({ 
            status: 1, 
            paymentDate: -1 
        });
        console.log('✅ Payments: status + paymentDate');
        
        await mongoose.connection.db.collection('payments').createIndex({ 
            student: 1, 
            status: 1, 
            paymentDate: -1 
        });
        console.log('✅ Payments: student + status + paymentDate');
        
        await mongoose.connection.db.collection('payments').createIndex({ 
            manager: 1, 
            status: 1, 
            paymentDate: -1 
        });
        console.log('✅ Payments: manager + status + paymentDate');
        
        // 📅 CLASSES - календарь и расписание
        await mongoose.connection.db.collection('classes').createIndex({ 
            date: 1, 
            startTime: 1 
        });
        console.log('✅ Classes: date + startTime');
        
        await mongoose.connection.db.collection('classes').createIndex({ 
            teacher: 1, 
            date: 1 
        });
        console.log('✅ Classes: teacher + date');
        
        await mongoose.connection.db.collection('classes').createIndex({ 
            group: 1, 
            date: 1 
        });
        console.log('✅ Classes: group + date');
        
        // 🏢 GROUPS - активные группы
        await mongoose.connection.db.collection('groups').createIndex({ 
            isActive: 1, 
            direction: 1 
        });
        console.log('✅ Groups: isActive + direction');
        
        // 💳 MEMBERSHIPS - активные абонементы
        await mongoose.connection.db.collection('memberships').createIndex({ 
            status: 1, 
            student: 1 
        });
        console.log('✅ Memberships: status + student');
        
        await mongoose.connection.db.collection('memberships').createIndex({ 
            status: 1, 
            remainingAmount: 1 
        });
        console.log('✅ Memberships: status + remainingAmount (debts)');
        
        // 💰 CASH TRANSACTIONS - касса
        await mongoose.connection.db.collection('cashtransactions').createIndex({ 
            type: 1, 
            date: -1 
        });
        console.log('✅ CashTransactions: type + date');
        
        await mongoose.connection.db.collection('cashtransactions').createIndex({ 
            category: 1, 
            date: -1 
        });
        console.log('✅ CashTransactions: category + date');
        
        // 📝 BLOG POSTS - публикации
        await mongoose.connection.db.collection('blogposts').createIndex({ 
            status: 1, 
            publishedAt: -1 
        });
        console.log('✅ BlogPosts: status + publishedAt');
        
        await mongoose.connection.db.collection('blogposts').createIndex({ 
            category: 1, 
            status: 1, 
            publishedAt: -1 
        });
        console.log('✅ BlogPosts: category + status + publishedAt');
        
        // 🧊 FREEZES - заморозки
        await mongoose.connection.db.collection('freezes').createIndex({ 
            student: 1, 
            status: 1 
        });
        console.log('✅ Freezes: student + status');
        
        await mongoose.connection.db.collection('freezes').createIndex({ 
            membership: 1, 
            status: 1 
        });
        console.log('✅ Freezes: membership + status');
        
        console.log('🎉 All optimized indexes added successfully!');
        
    } catch (error) {
        console.error('❌ Error adding indexes:', error);
    } finally {
        mongoose.connection.close();
    }
}

addOptimizedIndexes();
