const mongoose = require('mongoose');

const commissionConfigSchema = new mongoose.Schema({
    // Роль (менеджер или преподаватель)
    role: {
        type: String,
        required: true,
        enum: ['sales_manager', 'teacher'],
        index: true
    },
    
    // Персональная конфигурация (опционально)
    // Если указан конкретный менеджер/преподаватель, то только для него
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        default: null
    },
    
    // Прогрессивные ставки по абонементам (для менеджеров)
    membershipTiers: [{
        min: {
            type: Number,
            required: true
        },
        max: {
            type: Number,
            default: null  // null = без ограничений (31+)
        },
        rate: {
            type: Number,
            required: true,
            min: 0,
            max: 1  // 0.25 = 25%
        }
    }],
    
    // Фиксированные ставки (для менеджеров)
    trialRate: {
        type: Number,
        default: 0.10,  // 10%
        min: 0,
        max: 1
    },
    
    singleClassRate: {
        type: Number,
        default: 0.10,  // 10%
        min: 0,
        max: 1
    },
    
    individualClassRate: {
        type: Number,
        default: 0.10,  // 10% (менеджеру за продажу)
        min: 0,
        max: 1
    },
    
    // Ставки для преподавателей
    teacherRates: {
        // Фиксированная ставка за групповое занятие
        groupClassFixed: {
            type: Number,
            default: 0  // 0₸ (или 1000₸ за занятие)
        },
        
        // Процент от индивидуального занятия (за проведение)
        individualClassRate: {
            type: Number,
            default: 0.20,  // 20%
            min: 0,
            max: 1
        },
        
        // Бонус от абонементов его групп
        membershipBonusRate: {
            type: Number,
            default: 0.05,  // 5%
            min: 0,
            max: 1
        },
        
        // Ставка за каждого студента в группе (фикс.)
        perStudentFixed: {
            type: Number,
            default: 0  // 0₸ (или 500₸ за студента)
        }
    },
    
    // Премия за выполнение плана
    bonusForPlan: {
        type: Number,
        default: 20000,  // 20,000₸
        min: 0
    },
    
    // Активна ли эта конфигурация
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // С какой даты действует
    effectiveFrom: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    },
    
    // Кто создал/обновил
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    
    // Примечание об изменении
    changeNote: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

// Индексы
commissionConfigSchema.index({ role: 1, isActive: 1, effectiveFrom: -1 });
commissionConfigSchema.index({ user: 1, isActive: 1, effectiveFrom: -1 });

// Метод для получения ставки по количеству абонементов
commissionConfigSchema.methods.getMembershipRate = function(membershipCount) {
    if (!this.membershipTiers || this.membershipTiers.length === 0) {
        return 0.10; // Fallback
    }
    
    for (const tier of this.membershipTiers) {
        if (membershipCount >= tier.min && 
            (tier.max === null || membershipCount <= tier.max)) {
            return tier.rate;
        }
    }
    
    return 0.10; // Fallback
};

// Статический метод для получения актуальной конфигурации
commissionConfigSchema.statics.getActiveConfig = async function(role, date = new Date(), userId = null) {
    // Сначала ищем персональную конфигурацию
    if (userId) {
        const personalConfig = await this.findOne({
            role,
            user: userId,
            isActive: true,
            effectiveFrom: { $lte: date }
        }).sort({ effectiveFrom: -1 });
        
        if (personalConfig) return personalConfig;
    }
    
    // Если нет персональной, ищем общую
    const generalConfig = await this.findOne({
        role,
        user: null,  // Общая конфигурация
        isActive: true,
        effectiveFrom: { $lte: date }
    }).sort({ effectiveFrom: -1 });
    
    return generalConfig;
};

module.exports = mongoose.model('CommissionConfig', commissionConfigSchema);

