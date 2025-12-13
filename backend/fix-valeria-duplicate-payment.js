const mongoose = require('mongoose');
require('dotenv').config();

const Student = require('./src/models/Student');
const Payment = require('./src/models/Payment');
const Membership = require('./src/models/Membership');
const CashTransaction = require('./src/models/CashTransaction');
const Group = require('./src/models/Group');

async function fixValeriaData() {
    try {
        console.log('🔄 Подключение к БД...');
        await mongoose.connect(process.env.MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 2,
            maxIdleTimeMS: 30000,
            serverSelectionTimeoutMS: 30000, // Увеличиваем таймаут до 30 секунд
            socketTimeoutMS: 45000,
            connectTimeoutMS: 30000
        });
        console.log('✅ Подключено к MongoDB\n');

        // Найти группу Juzzfunk
        const juzzfunkGroup = await Group.findOne({ name: /Juzzfunk/i });
        if (!juzzfunkGroup) {
            console.log('❌ Группа Juzzfunk не найдена');
            process.exit(1);
        }
        console.log(`✅ Найдена группа: ${juzzfunkGroup.name} (ID: ${juzzfunkGroup._id})\n`);

        // Найти ученика "Валерия" в группе Juzzfunk
        const student = await Student.findOne({
            $or: [
                { name: /Валерия/i, lastName: /Валерия/i },
                { name: /Валерия/i }
            ],
            'groups.groupId': juzzfunkGroup._id,
            'groups.status': 'active'
        }).populate('groups.groupId');

        if (!student) {
            console.log('❌ Ученик "Валерия" в группе Juzzfunk не найден');
            console.log('💡 Ищем всех Валерий в этой группе...');
            
            const allValerias = await Student.find({
                name: /Валерия/i,
                'groups.groupId': juzzfunkGroup._id
            }).populate('groups.groupId');
            
            if (allValerias.length === 0) {
                console.log('❌ Не найдено ни одной Валерии в группе Juzzfunk');
                process.exit(1);
            }
            
            console.log(`\n📋 Найдено Валерий в группе Juzzfunk: ${allValerias.length}`);
            allValerias.forEach((s, i) => {
                console.log(`   ${i + 1}. ${s.name} ${s.lastName || ''} (ID: ${s._id})`);
            });
            
            // Берем первую найденную
            const student = allValerias[0];
            console.log(`\n✅ Используем: ${student.name} ${student.lastName || ''} (ID: ${student._id})\n`);
        } else {
            console.log(`✅ Найден ученик: ${student.name} ${student.lastName || ''} (ID: ${student._id})`);
            console.log(`   Группа: ${juzzfunkGroup.name}\n`);
        }

        // Получить все платежи ученика
        const payments = await Payment.find({ student: student._id }).sort({ paymentDate: 1 });
        console.log(`📊 Найдено платежей: ${payments.length}`);
        payments.forEach(p => {
            console.log(`   - ${p.amount}₸ (${p.type}) от ${p.paymentDate.toISOString().split('T')[0]} (ID: ${p._id})`);
        });

        // Получить все абонементы ученика
        const memberships = await Membership.find({ student: student._id }).sort({ createdAt: 1 });
        console.log(`\n📊 Найдено абонементов: ${memberships.length}`);
        memberships.forEach(m => {
            console.log(`   - ${m.type}: ${m.totalClasses} занятий, осталось ${m.classesRemaining}, оплачено ${m.paidAmount}₸ из ${m.totalPrice}₸ (ID: ${m._id})`);
        });

        console.log('\n🔍 Анализ проблемы...\n');

        // Найти дублирующиеся платежи по 5000
        const advancePayments = payments.filter(p => p.amount === 5000 && p.type === 'membership_advance');
        console.log(`💰 Найдено платежей по 5000₸ (аванс): ${advancePayments.length}`);

        if (advancePayments.length > 1) {
            console.log('⚠️  Обнаружены дублирующиеся платежи!');
            
            // Оставляем самый старый платеж, удаляем остальные
            const keepPayment = advancePayments[0];
            const duplicatePayments = advancePayments.slice(1);
            
            console.log(`✅ Оставляем платеж: ${keepPayment._id} от ${keepPayment.paymentDate.toISOString().split('T')[0]}`);
            console.log(`🗑️  Удаляем дубликаты:`);
            
            for (const dup of duplicatePayments) {
                console.log(`   - Удаление платежа ${dup._id} (${dup.amount}₸)`);
                
                // 🗑️ Удалить связанные транзакции из кассы
                const cashTransactions = await CashTransaction.find({ relatedPayment: dup._id });
                if (cashTransactions.length > 0) {
                    console.log(`   💰 Найдено транзакций в кассе: ${cashTransactions.length}`);
                    for (const cashTx of cashTransactions) {
                        await CashTransaction.deleteOne({ _id: cashTx._id });
                        console.log(`   ✅ Удалена транзакция кассы: ${cashTx._id} (${cashTx.amount}₸)`);
                    }
                }
                
                // Если платеж связан с абонементом, удаляем его из массива payments
                if (dup.membership) {
                    const membership = await Membership.findById(dup.membership);
                    if (membership) {
                        membership.payments = membership.payments.filter(
                            p => p.toString() !== dup._id.toString()
                        );
                        
                        // Пересчитать суммы
                        const remainingPayments = await Payment.find({
                            membership: dup.membership,
                            _id: { $ne: dup._id }
                        });
                        
                        membership.paidAmount = remainingPayments.reduce((sum, p) => sum + p.amount, 0);
                        membership.remainingAmount = membership.totalPrice - membership.paidAmount;
                        
                        if (membership.paidAmount === 0) {
                            membership.paymentStatus = 'not_paid';
                        } else if (membership.remainingAmount > 0) {
                            membership.paymentStatus = 'partial';
                        } else {
                            membership.paymentStatus = 'paid';
                        }
                        
                        await membership.save();
                        console.log(`   ✅ Обновлен абонемент ${membership._id}: оплачено ${membership.paidAmount}₸, остаток ${membership.remainingAmount}₸`);
                    }
                }
                
                await Payment.deleteOne({ _id: dup._id });
                console.log(`   ✅ Платеж ${dup._id} удален`);
            }
        }

        // Проверить пробное занятие (1000₸)
        const trialPayments = payments.filter(p => 
            (p.amount === 1000 && p.type === 'trial_full') || 
            (p.amount === 1000 && p.type === 'single_class')
        );
        
        if (trialPayments.length === 0) {
            console.log('\n⚠️  Платеж за пробное занятие (1000₸) не найден');
            console.log('💡 Нужно будет добавить его вручную через админ-панель');
        } else {
            console.log(`\n✅ Найдено платежей за пробное: ${trialPayments.length}`);
        }

        // Исправить количество занятий в абонементах
        console.log('\n🔧 Исправление количества занятий...');
        
        // Пересчитать все платежи после удаления дубликатов
        const remainingPayments = await Payment.find({ student: student._id }).sort({ paymentDate: 1 });
        
        for (const membership of memberships) {
            const membershipPayments = remainingPayments.filter(p => 
                p.membership && p.membership.toString() === membership._id.toString()
            );
            const totalPaid = membershipPayments.reduce((sum, p) => sum + p.amount, 0);
            
            console.log(`\n📝 Абонемент ${membership._id}:`);
            console.log(`   Текущее: ${membership.totalClasses} занятий, осталось ${membership.classesRemaining}`);
            console.log(`   Оплачено: ${totalPaid}₸`);
            
            // Если занятий больше 11, исправляем
            if (membership.totalClasses > 11 || membership.classesRemaining > 11) {
                // По описанию: должно быть 11 занятий, 5000 аванс, остаток 13000
                // Значит: totalPrice = 5000 + 13000 = 18000
                // Но обычно monthly_12 стоит 22000, значит может быть другой тип
                
                // Если оплачено 5000 и остаток должен быть 13000, то totalPrice = 18000
                // Это может быть месячный абонемент с авансом (7 занятий) или monthly_12 с авансом (11 занятий)
                
                if (totalPaid === 5000) {
                    // Аванс 5000, остаток 13000 = totalPrice 18000
                    // Это может быть месячный абонемент (22000) с авансом 5000, остаток 17000
                    // Но пользователь говорит остаток 13000, значит totalPrice = 18000
                    // Возможно, это месячный_12 с авансом (11 занятий)
                    membership.type = 'monthly_12';
                    membership.totalClasses = 11;
                    membership.classesRemaining = 11;
                    membership.totalPrice = 18000; // 5000 + 13000
                    membership.remainingAmount = 13000;
                    membership.paymentStatus = 'partial';
                    console.log(`   ✅ Исправлено: monthly_12, 11 занятий, остаток ${membership.remainingAmount}₸`);
                } else {
                    // Если оплачено больше, возможно нужно пересчитать
                    console.log(`   ⚠️  Требуется ручная проверка`);
                }
                
                await membership.save();
            } else if (totalPaid === 5000 && membership.remainingAmount !== 13000) {
                // Исправить остаток к оплате
                membership.remainingAmount = 13000;
                membership.totalPrice = totalPaid + membership.remainingAmount;
                await membership.save();
                console.log(`   ✅ Исправлен остаток: ${membership.remainingAmount}₸`);
            }
        }

        // Пересчитать общий остаток к оплате
        console.log('\n💰 Пересчет остатка к оплате...');
        const activeMemberships = await Membership.find({
            student: student._id,
            paymentStatus: { $in: ['not_paid', 'partial'] }
        });
        
        const totalRemaining = activeMemberships.reduce((sum, m) => sum + (m.remainingAmount || 0), 0);
        console.log(`   Остаток к оплате: ${totalRemaining}₸`);
        
        if (totalRemaining > 13000) {
            console.log(`   ⚠️  Остаток больше ожидаемого (13000₸)`);
            console.log(`   💡 Возможно, нужно проверить абонементы вручную`);
        }

        // Финальная проверка
        console.log('\n📊 Финальная статистика:');
        const finalPayments = await Payment.find({ student: student._id }).sort({ paymentDate: 1 });
        const finalMemberships = await Membership.find({ student: student._id });
        
        const totalPaid = finalPayments.reduce((sum, p) => sum + p.amount, 0);
        const totalClasses = finalMemberships.reduce((sum, m) => sum + (m.classesRemaining || 0), 0);
        const finalRemaining = finalMemberships
            .filter(m => m.paymentStatus !== 'paid')
            .reduce((sum, m) => sum + (m.remainingAmount || 0), 0);
        
        console.log(`   Платежей: ${finalPayments.length}`);
        console.log(`   Всего оплачено: ${totalPaid}₸`);
        console.log(`   Занятий осталось: ${totalClasses}`);
        console.log(`   Остаток к оплате: ${finalRemaining}₸`);

        console.log('\n✅ Исправление завершено!');
        
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Ошибка:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
}

fixValeriaData();

