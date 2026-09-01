-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('student', 'sales_manager', 'teacher', 'staff', 'admin', 'super_admin');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female');

-- CreateEnum
CREATE TYPE "GroupLevel" AS ENUM ('beginner', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('scheduled', 'started', 'pending_admin_review', 'completed', 'cancelled', 'not_filled');

-- CreateEnum
CREATE TYPE "ClassType" AS ENUM ('group', 'individual', 'practice', 'trial', 'rent', 'theory');

-- CreateEnum
CREATE TYPE "MembershipType" AS ENUM ('trial', 'monthly', 'monthly_12', 'quarterly', 'single_class', 'individual_single', 'individual_package', 'hybrid_1m', 'hybrid_2m');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('new', 'processed', 'trial', 'thinking', 'sold', 'rejected');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'completed', 'converted_to_membership', 'refunded', 'cancelled');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('trial_advance', 'trial_full', 'membership_advance', 'membership_balance', 'membership_full', 'single_class', 'individual_class');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('pending', 'included_in_month', 'recalculated', 'excluded');

-- CreateEnum
CREATE TYPE "ShopSaleStatus" AS ENUM ('completed', 'cancelled');

-- CreateEnum
CREATE TYPE "ShopStockMovementType" AS ENUM ('receipt', 'sale', 'sale_return', 'write_off', 'adjustment');

-- CreateEnum
CREATE TYPE "StaffTaskStatus" AS ENUM ('open', 'in_progress', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "StaffTaskPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT NOT NULL,
    "phoneDigits" TEXT,
    "notifyHomework" BOOLEAN,
    "notifyLessons" BOOLEAN,
    "notifyPayments" BOOLEAN,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "gender" "Gender",
    "role" "Role" NOT NULL DEFAULT 'student',
    "status" "EntityStatus" NOT NULL DEFAULT 'active',
    "pausedUntil" TIMESTAMP(3),
    "notes" TEXT,
    "oldCrmId" TEXT,
    "customerName" TEXT,
    "customerType" TEXT,
    "acquisitionSource" TEXT,
    "learningDirections" TEXT[],
    "learningLevel" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offerAccepted" BOOLEAN NOT NULL DEFAULT false,
    "offerAcceptedAt" TIMESTAMP(3),
    "accountBalance" INTEGER NOT NULL DEFAULT 0,
    "accountBalanceInitializedAt" TIMESTAMP(3),
    "penaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "studentAvatar" TEXT,
    "appUserId" TEXT,
    "externalLinkStatus" TEXT,
    "linkedAt" TIMESTAMP(3),
    "teacherDirections" TEXT[],
    "teacherBio" TEXT,
    "teacherPhoto" TEXT,
    "teacherDisplayOrder" INTEGER NOT NULL DEFAULT 0,
    "teacherScheduleColor" TEXT,
    "teacherWeeklyHours" INTEGER NOT NULL DEFAULT 40,
    "salaryIndividual" INTEGER NOT NULL DEFAULT 0,
    "salaryGroup" INTEGER NOT NULL DEFAULT 0,
    "salaryTrial" INTEGER NOT NULL DEFAULT 0,
    "salaryOther" INTEGER NOT NULL DEFAULT 0,
    "staffPosition" TEXT,
    "payrollEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlySalary" INTEGER NOT NULL DEFAULT 0,
    "salesCommissionPercent" INTEGER NOT NULL DEFAULT 0,
    "employmentStartDate" TIMESTAMP(3),
    "familyId" TEXT,
    "referredByStudentId" TEXT,
    "referredByBookingId" TEXT,
    "concessionType" TEXT,
    "assignedTeacherId" TEXT,
    "activeMembershipId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "departureNote" TEXT,
    "lostMarkedById" TEXT,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPhone" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneDigits" TEXT NOT NULL,
    "label" TEXT,
    "notifyHomework" BOOLEAN,
    "notifyLessons" BOOLEAN,
    "notifyPayments" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGroup" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "StudentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentRecovery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "recoveredByUserId" TEXT NOT NULL,
    "recoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "StudentRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "level" "GroupLevel" NOT NULL DEFAULT 'beginner',
    "instructor" TEXT NOT NULL DEFAULT 'ИМЯ ФАМИЛИЯ',
    "teacherId" TEXT,
    "maxStudents" INTEGER NOT NULL DEFAULT 15,
    "currentStudents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "description" TEXT,
    "instruments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupSchedule" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 90,
    "roomId" TEXT,
    "isPractice" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GroupSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSchedule" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 90,
    "roomId" TEXT,
    "teacherId" TEXT,
    "isPractice" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StudentSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#eb4d77',
    "workingStart" TEXT NOT NULL DEFAULT '08:00',
    "workingEnd" TEXT NOT NULL DEFAULT '21:00',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Direction" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "image" TEXT NOT NULL DEFAULT '',
    "pricingTrial" INTEGER NOT NULL DEFAULT 2000,
    "pricingMonth" INTEGER NOT NULL DEFAULT 22000,
    "pricingThreeMonths" INTEGER NOT NULL DEFAULT 55000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Direction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectionPlan" (
    "id" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "classes" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "lessonFormat" TEXT NOT NULL DEFAULT 'group',
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "individualClasses" INTEGER,
    "groupClasses" INTEGER,
    "theoryClasses" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "directionId" TEXT,
    "directionPlanId" TEXT,
    "legacyType" TEXT NOT NULL,
    "groupBindMode" TEXT NOT NULL DEFAULT 'optional',
    "billingModel" TEXT NOT NULL DEFAULT 'package',
    "unitType" TEXT NOT NULL DEFAULT 'class',
    "includedUnits" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "lessonFormat" TEXT NOT NULL DEFAULT 'group',
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "currency" TEXT NOT NULL DEFAULT 'KZT',
    "validityModel" TEXT NOT NULL DEFAULT 'fixed_days',
    "validityDays" INTEGER,
    "calendarRule" JSONB,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "prorationPolicy" TEXT NOT NULL DEFAULT 'none',
    "lateCancelPolicy" TEXT NOT NULL DEFAULT 'no_charge',
    "noShowPolicy" TEXT NOT NULL DEFAULT 'no_charge',
    "freezePolicy" JSONB,
    "makeupPolicy" JSONB,
    "carryoverPolicy" TEXT NOT NULL DEFAULT 'none',
    "debtPolicy" TEXT NOT NULL DEFAULT 'allow_with_debt',
    "branchId" TEXT,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "individualClasses" INTEGER,
    "groupClasses" INTEGER,
    "theoryClasses" INTEGER,
    "emergencyFreezes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "teacherId" TEXT,
    "originalTeacherId" TEXT,
    "roomId" TEXT,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 90,
    "status" "ClassStatus" NOT NULL DEFAULT 'scheduled',
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringFreq" TEXT NOT NULL DEFAULT 'none',
    "recurringDays" INTEGER[],
    "recurringEndDate" TIMESTAMP(3),
    "notes" TEXT,
    "backgroundColor" TEXT NOT NULL DEFAULT '#eb4d77',
    "isPractice" BOOLEAN NOT NULL DEFAULT false,
    "noOneAttended" BOOLEAN NOT NULL DEFAULT false,
    "autoDeductionDone" BOOLEAN NOT NULL DEFAULT false,
    "topic" TEXT,
    "lessonGoals" TEXT,
    "lessonSummary" TEXT,
    "homeworkDraft" TEXT,
    "nextLessonFocus" TEXT,
    "materials" JSONB,
    "teacherComment" TEXT,
    "teacherOutcomeHint" TEXT,
    "trialReport" JSONB,
    "trialAiAnalysis" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "teacherPenaltyAmount" INTEGER NOT NULL DEFAULT 0,
    "teacherPenaltyReason" TEXT,
    "teacherRateSnapshot" INTEGER,
    "teacherBaseEarning" INTEGER NOT NULL DEFAULT 0,
    "teacherFirstPaymentBonus" INTEGER NOT NULL DEFAULT 0,
    "teacherFirstPaymentId" TEXT,
    "teacherFirstPaymentAmount" INTEGER NOT NULL DEFAULT 0,
    "teacherFirstPaymentBonusDate" TIMESTAMP(3),
    "teacherEarningStatus" TEXT NOT NULL DEFAULT 'pending',
    "teacherEarningCalculatedAt" TIMESTAMP(3),
    "classType" "ClassType" NOT NULL DEFAULT 'group',
    "individualStudentId" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "managerId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeGroup" (
    "classId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "PracticeGroup_pkey" PRIMARY KEY ("classId","groupId")
);

-- CreateTable
CREATE TABLE "ClassAttendee" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "studentId" TEXT,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "attendanceStatus" TEXT NOT NULL DEFAULT 'unmarked',
    "teacherNote" TEXT,
    "homeworkStatus" VARCHAR(32),
    "homeworkCompletionPercent" INTEGER,
    "homeworkDifficulties" TEXT,
    "homeworkNotCompletedReason" TEXT,
    "markedAt" TIMESTAMP(3),
    "autoDeducted" BOOLEAN NOT NULL DEFAULT false,
    "chargeAmount" INTEGER NOT NULL DEFAULT 0,
    "chargedMembershipId" TEXT,
    "chargeSource" TEXT,

    CONSTRAINT "ClassAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "groupId" TEXT,
    "planId" TEXT,
    "teacherId" TEXT,
    "lessonFormat" TEXT NOT NULL DEFAULT 'group',
    "type" TEXT NOT NULL,
    "totalClasses" INTEGER NOT NULL,
    "classesRemaining" INTEGER NOT NULL,
    "classesUsed" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freezesAvailable" INTEGER NOT NULL DEFAULT 1,
    "freezesUsed" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "individualClassesRemaining" INTEGER,
    "groupClassesRemaining" INTEGER,
    "theoryClassesRemaining" INTEGER,
    "emergencyFreezesAvailable" INTEGER,
    "emergencyFreezesUsed" INTEGER DEFAULT 0,
    "createdById" TEXT,
    "bookingId" TEXT,
    "previousMembershipId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "totalPrice" INTEGER NOT NULL DEFAULT 0,
    "paidAmount" INTEGER NOT NULL DEFAULT 0,
    "remainingAmount" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" TEXT NOT NULL DEFAULT 'not_paid',
    "followUpStatus" TEXT NOT NULL DEFAULT 'new',
    "followUpNote" TEXT,
    "followUpAt" TIMESTAMP(3),
    "paymentPromiseDate" TIMESTAMP(3),
    "basePrice" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "discountReferralPercent" INTEGER NOT NULL DEFAULT 0,
    "discountFamilyPercent" INTEGER NOT NULL DEFAULT 0,
    "discountConcessionPercent" INTEGER NOT NULL DEFAULT 0,
    "discountManualPercent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipTransaction" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER,
    "reason" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classId" TEXT,
    "freezeId" TEXT,
    "addedById" TEXT,

    CONSTRAINT "MembershipTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentName" TEXT,
    "studentPhone" TEXT,
    "managerId" TEXT NOT NULL,
    "managerName" TEXT,
    "amount" INTEGER NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "PaymentType" NOT NULL,
    "relatedPaymentId" TEXT,
    "membershipId" TEXT,
    "bookingId" TEXT,
    "relatedClassId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'completed',
    "commissionStatus" "CommissionStatus" NOT NULL DEFAULT 'pending',
    "isFirstMembershipForManager" BOOLEAN NOT NULL DEFAULT false,
    "includedInSalaryMonth" TEXT,
    "teacherId" TEXT,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "maxClassesBeforePayment" INTEGER,
    "paymentMethod" TEXT,
    "basePrice" INTEGER,
    "discountPercent" INTEGER,
    "discountReferralPercent" INTEGER,
    "discountFamilyPercent" INTEGER,
    "discountConcessionPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashTransaction" (
    "id" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "relatedPaymentId" TEXT,
    "relatedShopSaleId" TEXT,
    "relatedBookingId" TEXT,
    "accountTransferId" TEXT,
    "paymentMethod" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAccountTransfer" (
    "id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fromPaymentMethod" TEXT NOT NULL,
    "toPaymentMethod" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAccountTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsPlan" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "revenuePlan" INTEGER NOT NULL DEFAULT 0,
    "bookingsPlan" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReportSnapshot" (
    "id" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Aqtobe',
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "generatedById" TEXT,
    "source" TEXT NOT NULL DEFAULT 'automatic',
    "primaryAdminId" TEXT,
    "primaryAdminName" TEXT,
    "sentToTelegram" BOOLEAN NOT NULL DEFAULT false,
    "sendCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "unclosedTasks" INTEGER NOT NULL DEFAULT 0,
    "unclosedBreakdown" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "aiComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAdminKpiSnapshot" (
    "id" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "bookingsProcessed" INTEGER NOT NULL DEFAULT 0,
    "lessonsReviewed" INTEGER NOT NULL DEFAULT 0,
    "paymentsProcessed" INTEGER NOT NULL DEFAULT 0,
    "paymentAmount" INTEGER NOT NULL DEFAULT 0,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "completedActions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAdminKpiSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopProduct" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Другое',
    "unit" TEXT NOT NULL DEFAULT 'шт.',
    "description" TEXT,
    "purchasePrice" INTEGER NOT NULL DEFAULT 0,
    "salePrice" INTEGER NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSale" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ShopSaleStatus" NOT NULL DEFAULT 'completed',
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "sellerId" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" INTEGER NOT NULL,
    "costAmount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" INTEGER NOT NULL,
    "purchasePrice" INTEGER NOT NULL,
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "ShopSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopStockMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ShopStockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "unitCost" INTEGER,
    "totalCost" INTEGER,
    "saleId" TEXT,
    "supplier" TEXT,
    "documentNumber" TEXT,
    "reason" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopStockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "submissionKey" TEXT,
    "externalSourceId" TEXT,
    "requestType" TEXT NOT NULL DEFAULT 'trial',
    "appStatus" TEXT,
    "onlineTeacherId" TEXT,
    "onlineTeacherName" TEXT,
    "onlineScheduledAt" TIMESTAMP(3),
    "onlineMeetingUrl" TEXT,
    "trialTeacherId" TEXT,
    "trialTeacherName" TEXT,
    "trialRoomId" TEXT,
    "trialRoomName" TEXT,
    "trialScheduledAt" TIMESTAMP(3),
    "trialClassId" TEXT,
    "depositPaid" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "phone" TEXT NOT NULL,
    "phoneDigits" TEXT,
    "direction" TEXT NOT NULL,
    "gender" TEXT DEFAULT 'male',
    "source" TEXT NOT NULL DEFAULT 'Сайт',
    "attribution" JSONB,
    "marketingClientId" TEXT,
    "marketingSessionId" TEXT,
    "landingUrl" TEXT,
    "referrerUrl" TEXT,
    "referrerStudentId" TEXT,
    "referrerBookingId" TEXT,
    "groupId" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'website',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "markedTestAt" TIMESTAMP(3),
    "markedTestById" TEXT,
    "dataQualityNote" TEXT,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "trialFunnelStage" TEXT,
    "trialManagerId" TEXT,
    "trialNextAction" TEXT,
    "trialNextActionAt" TIMESTAMP(3),
    "trialLastContactAt" TIMESTAMP(3),
    "trialFunnelNote" TEXT,
    "convertedToStudentId" TEXT,
    "convertedById" TEXT,
    "convertedAt" TIMESTAMP(3),
    "lossReason" TEXT,
    "lossStage" TEXT,
    "lostAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "content" TEXT,
    "term" TEXT,
    "clickId" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "payload" JSONB,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Freeze" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "frozenClasses" INTEGER NOT NULL,
    "classesUsed" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "createdById" TEXT,
    "processedById" TEXT,
    "processedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Freeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionConfig" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "userId" TEXT,
    "membershipTiers" JSONB,
    "trialRate" INTEGER NOT NULL DEFAULT 10,
    "singleClassRate" INTEGER NOT NULL DEFAULT 10,
    "individualClassRate" INTEGER NOT NULL DEFAULT 10,
    "teacherGroupFixed" INTEGER NOT NULL DEFAULT 0,
    "teacherIndividualRate" INTEGER NOT NULL DEFAULT 20,
    "teacherMembershipBonus" INTEGER NOT NULL DEFAULT 5,
    "teacherPerStudentFixed" INTEGER NOT NULL DEFAULT 0,
    "bonusForPlan" INTEGER NOT NULL DEFAULT 20000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salary" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "teacherName" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalClasses" INTEGER NOT NULL,
    "totalStudents" INTEGER NOT NULL,
    "totalAttendedClasses" INTEGER NOT NULL,
    "totalEarnings" INTEGER NOT NULL,
    "teacherPercentage" INTEGER NOT NULL DEFAULT 35,
    "teacherSalary" INTEGER NOT NULL,
    "penaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "penaltyDeduction" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "advance" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'calculated',
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryOperation" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "teacherName" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "cashTransactionId" TEXT,
    "createdById" TEXT NOT NULL,
    "periodKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryClass" (
    "id" TEXT NOT NULL,
    "salaryId" TEXT NOT NULL,
    "classId" TEXT,
    "className" TEXT NOT NULL,
    "classDate" TIMESTAMP(3) NOT NULL,
    "groupName" TEXT NOT NULL,
    "totalAttendedClasses" INTEGER NOT NULL,
    "totalEarnings" INTEGER NOT NULL,
    "teacherPenaltyAmount" INTEGER NOT NULL DEFAULT 0,
    "teacherPenaltyReason" TEXT,

    CONSTRAINT "SalaryClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryClassStudent" (
    "id" TEXT NOT NULL,
    "salaryClassId" TEXT NOT NULL,
    "studentId" TEXT,
    "studentName" TEXT NOT NULL,
    "paymentData" JSONB NOT NULL,
    "attendedClasses" INTEGER NOT NULL,
    "totalEarnings" INTEGER NOT NULL,

    CONSTRAINT "SalaryClassStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermissions" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "visibility" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePermissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "StaffTaskStatus" NOT NULL DEFAULT 'open',
    "priority" "StaffTaskPriority" NOT NULL DEFAULT 'normal',
    "dueAt" TIMESTAMP(3),
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responseStatus" INTEGER,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "lastAttemptAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "entityType" TEXT,
    "entityId" TEXT,
    "createdById" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSettings" (
    "id" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumber" TEXT,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 12,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 20,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 9,
    "followUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "followUpDelayMinutes" INTEGER NOT NULL DEFAULT 30,
    "geminiApiKey" TEXT,
    "geminiModel" TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
    "maxTokensPerMessage" INTEGER NOT NULL DEFAULT 500,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "systemPrompt" TEXT NOT NULL DEFAULT '...',
    "welcomeMessage" TEXT NOT NULL DEFAULT 'Welcome',
    "whatsappStatus" TEXT NOT NULL DEFAULT 'disconnected',
    "whatsappLastConnected" TIMESTAMP(3),
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "externalChatId" TEXT,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "realPhone" TEXT,
    "name" TEXT,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "automationStatus" TEXT NOT NULL DEFAULT 'observer',
    "browserAccountKey" TEXT,
    "takeoverById" TEXT,
    "takeoverAt" TIMESTAMP(3),
    "takeoverUntil" TIMESTAMP(3),
    "takeoverReason" TEXT,
    "bookingId" TEXT,
    "studentId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "firstMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "followUpStatus" TEXT NOT NULL DEFAULT 'none',
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "fingerprint" TEXT,
    "role" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'incoming',
    "messageType" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "rawPayload" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappBrowserSession" (
    "id" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "connector" TEXT NOT NULL DEFAULT 'playwright',
    "mode" TEXT NOT NULL DEFAULT 'observer',
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "workerId" TEXT,
    "phoneNumber" TEXT,
    "profileLabel" TEXT,
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastIncomingAt" TIMESTAMP(3),
    "qrRequiredAt" TIMESTAMP(3),
    "stoppedReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappBrowserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappOutbox" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'crm_manual',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "externalMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "image" TEXT,
    "authorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "metaDescription" TEXT NOT NULL DEFAULT '',
    "metaKeywords" TEXT NOT NULL DEFAULT '',
    "views" INTEGER NOT NULL DEFAULT 0,
    "readTime" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" TEXT,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_GroupBillingPlans" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_GroupBillingPlans_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_PracticeGroups" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_PracticeGroups_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Student_oldCrmId_key" ON "Student"("oldCrmId");

-- CreateIndex
CREATE UNIQUE INDEX "Student_appUserId_key" ON "Student"("appUserId");

-- CreateIndex
CREATE INDEX "Student_assignedTeacherId_idx" ON "Student"("assignedTeacherId");

-- CreateIndex
CREATE INDEX "Student_phone_idx" ON "Student"("phone");

-- CreateIndex
CREATE INDEX "Student_phoneDigits_idx" ON "Student"("phoneDigits");

-- CreateIndex
CREATE INDEX "StudentPhone_phoneDigits_idx" ON "StudentPhone"("phoneDigits");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPhone_studentId_phoneDigits_key" ON "StudentPhone"("studentId", "phoneDigits");

-- CreateIndex
CREATE INDEX "StudentGroup_studentId_status_idx" ON "StudentGroup"("studentId", "status");

-- CreateIndex
CREATE INDEX "StudentGroup_groupId_status_idx" ON "StudentGroup"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudentGroup_studentId_groupId_key" ON "StudentGroup"("studentId", "groupId");

-- CreateIndex
CREATE INDEX "StudentRecovery_studentId_recoveredAt_idx" ON "StudentRecovery"("studentId", "recoveredAt" DESC);

-- CreateIndex
CREATE INDEX "StudentRecovery_recoveredByUserId_recoveredAt_idx" ON "StudentRecovery"("recoveredByUserId", "recoveredAt" DESC);

-- CreateIndex
CREATE INDEX "Group_direction_isActive_idx" ON "Group"("direction", "isActive");

-- CreateIndex
CREATE INDEX "Group_teacherId_idx" ON "Group"("teacherId");

-- CreateIndex
CREATE INDEX "Group_isActive_idx" ON "Group"("isActive");

-- CreateIndex
CREATE INDEX "StudentSchedule_studentId_idx" ON "StudentSchedule"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "Room_name_key" ON "Room"("name");

-- CreateIndex
CREATE INDEX "Room_isActive_idx" ON "Room"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Direction_name_key" ON "Direction"("name");

-- CreateIndex
CREATE INDEX "DirectionPlan_directionId_isActive_order_idx" ON "DirectionPlan"("directionId", "isActive", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_directionPlanId_key" ON "MembershipPlan"("directionPlanId");

-- CreateIndex
CREATE INDEX "MembershipPlan_directionId_status_isVisible_idx" ON "MembershipPlan"("directionId", "status", "isVisible");

-- CreateIndex
CREATE INDEX "MembershipPlan_legacyType_status_idx" ON "MembershipPlan"("legacyType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_directionId_legacyType_key" ON "MembershipPlan"("directionId", "legacyType");

-- CreateIndex
CREATE INDEX "Class_teacherId_date_idx" ON "Class"("teacherId", "date");

-- CreateIndex
CREATE INDEX "Class_originalTeacherId_date_idx" ON "Class"("originalTeacherId", "date");

-- CreateIndex
CREATE INDEX "Class_groupId_date_idx" ON "Class"("groupId", "date");

-- CreateIndex
CREATE INDEX "Class_individualStudentId_date_idx" ON "Class"("individualStudentId", "date");

-- CreateIndex
CREATE INDEX "Class_date_status_idx" ON "Class"("date", "status");

-- CreateIndex
CREATE INDEX "Class_roomId_date_startTime_idx" ON "Class"("roomId", "date", "startTime");

-- CreateIndex
CREATE INDEX "Class_teacherId_date_startTime_idx" ON "Class"("teacherId", "date", "startTime");

-- CreateIndex
CREATE INDEX "Class_teacherEarningStatus_date_idx" ON "Class"("teacherEarningStatus", "date");

-- CreateIndex
CREATE INDEX "Class_teacherFirstPaymentBonusDate_idx" ON "Class"("teacherFirstPaymentBonusDate");

-- CreateIndex
CREATE INDEX "ClassAttendee_classId_studentId_idx" ON "ClassAttendee"("classId", "studentId");

-- CreateIndex
CREATE INDEX "Membership_studentId_status_idx" ON "Membership"("studentId", "status");

-- CreateIndex
CREATE INDEX "Membership_groupId_status_idx" ON "Membership"("groupId", "status");

-- CreateIndex
CREATE INDEX "Membership_teacherId_status_idx" ON "Membership"("teacherId", "status");

-- CreateIndex
CREATE INDEX "Membership_status_classesRemaining_idx" ON "Membership"("status", "classesRemaining");

-- CreateIndex
CREATE INDEX "Membership_followUpStatus_followUpAt_idx" ON "Membership"("followUpStatus", "followUpAt");

-- CreateIndex
CREATE INDEX "MembershipTransaction_membershipId_idx" ON "MembershipTransaction"("membershipId");

-- CreateIndex
CREATE INDEX "MembershipTransaction_membershipId_classId_type_idx" ON "MembershipTransaction"("membershipId", "classId", "type");

-- CreateIndex
CREATE INDEX "Payment_paymentDate_managerId_idx" ON "Payment"("paymentDate", "managerId");

-- CreateIndex
CREATE INDEX "Payment_studentId_paymentDate_idx" ON "Payment"("studentId", "paymentDate" DESC);

-- CreateIndex
CREATE INDEX "Payment_membershipId_idx" ON "Payment"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "CashTransaction_relatedBookingId_key" ON "CashTransaction"("relatedBookingId");

-- CreateIndex
CREATE INDEX "CashTransaction_type_date_idx" ON "CashTransaction"("type", "date" DESC);

-- CreateIndex
CREATE INDEX "CashTransaction_category_date_idx" ON "CashTransaction"("category", "date" DESC);

-- CreateIndex
CREATE INDEX "CashTransaction_relatedShopSaleId_idx" ON "CashTransaction"("relatedShopSaleId");

-- CreateIndex
CREATE INDEX "CashTransaction_accountTransferId_idx" ON "CashTransaction"("accountTransferId");

-- CreateIndex
CREATE INDEX "CashAccountTransfer_date_idx" ON "CashAccountTransfer"("date" DESC);

-- CreateIndex
CREATE INDEX "CashAccountTransfer_fromPaymentMethod_date_idx" ON "CashAccountTransfer"("fromPaymentMethod", "date" DESC);

-- CreateIndex
CREATE INDEX "CashAccountTransfer_toPaymentMethod_date_idx" ON "CashAccountTransfer"("toPaymentMethod", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsPlan_month_key" ON "AnalyticsPlan"("month");

-- CreateIndex
CREATE INDEX "AnalyticsPlan_month_idx" ON "AnalyticsPlan"("month");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReportSnapshot_reportDate_key" ON "DailyReportSnapshot"("reportDate");

-- CreateIndex
CREATE INDEX "DailyReportSnapshot_generatedAt_idx" ON "DailyReportSnapshot"("generatedAt" DESC);

-- CreateIndex
CREATE INDEX "DailyReportSnapshot_sentToTelegram_reportDate_idx" ON "DailyReportSnapshot"("sentToTelegram", "reportDate" DESC);

-- CreateIndex
CREATE INDEX "DailyAdminKpiSnapshot_adminId_dailyReportId_idx" ON "DailyAdminKpiSnapshot"("adminId", "dailyReportId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAdminKpiSnapshot_dailyReportId_adminId_key" ON "DailyAdminKpiSnapshot"("dailyReportId", "adminId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopProduct_sku_key" ON "ShopProduct"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ShopProduct_barcode_key" ON "ShopProduct"("barcode");

-- CreateIndex
CREATE INDEX "ShopProduct_active_category_idx" ON "ShopProduct"("active", "category");

-- CreateIndex
CREATE INDEX "ShopProduct_stockQuantity_idx" ON "ShopProduct"("stockQuantity");

-- CreateIndex
CREATE INDEX "ShopProduct_name_idx" ON "ShopProduct"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ShopSale_number_key" ON "ShopSale"("number");

-- CreateIndex
CREATE INDEX "ShopSale_saleDate_idx" ON "ShopSale"("saleDate" DESC);

-- CreateIndex
CREATE INDEX "ShopSale_status_saleDate_idx" ON "ShopSale"("status", "saleDate" DESC);

-- CreateIndex
CREATE INDEX "ShopSale_sellerId_saleDate_idx" ON "ShopSale"("sellerId", "saleDate" DESC);

-- CreateIndex
CREATE INDEX "ShopSale_customerId_idx" ON "ShopSale"("customerId");

-- CreateIndex
CREATE INDEX "ShopSaleItem_saleId_idx" ON "ShopSaleItem"("saleId");

-- CreateIndex
CREATE INDEX "ShopSaleItem_productId_idx" ON "ShopSaleItem"("productId");

-- CreateIndex
CREATE INDEX "ShopStockMovement_productId_occurredAt_idx" ON "ShopStockMovement"("productId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ShopStockMovement_type_occurredAt_idx" ON "ShopStockMovement"("type", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "ShopStockMovement_saleId_idx" ON "ShopStockMovement"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_submissionKey_key" ON "Booking"("submissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_externalSourceId_key" ON "Booking"("externalSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_trialClassId_key" ON "Booking"("trialClassId");

-- CreateIndex
CREATE INDEX "Booking_status_createdAt_idx" ON "Booking"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Booking_isTest_createdAt_idx" ON "Booking"("isTest", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Booking_lossStage_lostAt_idx" ON "Booking"("lossStage", "lostAt");

-- CreateIndex
CREATE INDEX "Booking_trialFunnelStage_trialNextActionAt_idx" ON "Booking"("trialFunnelStage", "trialNextActionAt");

-- CreateIndex
CREATE INDEX "Booking_trialManagerId_trialNextActionAt_idx" ON "Booking"("trialManagerId", "trialNextActionAt");

-- CreateIndex
CREATE INDEX "Booking_marketingClientId_idx" ON "Booking"("marketingClientId");

-- CreateIndex
CREATE INDEX "Booking_marketingSessionId_idx" ON "Booking"("marketingSessionId");

-- CreateIndex
CREATE INDEX "MarketingEvent_eventName_createdAt_idx" ON "MarketingEvent"("eventName", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MarketingEvent_clientId_createdAt_idx" ON "MarketingEvent"("clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MarketingEvent_sessionId_createdAt_idx" ON "MarketingEvent"("sessionId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MarketingEvent_source_medium_campaign_idx" ON "MarketingEvent"("source", "medium", "campaign");

-- CreateIndex
CREATE INDEX "MarketingEvent_bookingId_idx" ON "MarketingEvent"("bookingId");

-- CreateIndex
CREATE INDEX "Freeze_studentId_status_idx" ON "Freeze"("studentId", "status");

-- CreateIndex
CREATE INDEX "Freeze_membershipId_status_idx" ON "Freeze"("membershipId", "status");

-- CreateIndex
CREATE INDEX "Freeze_status_startDate_endDate_idx" ON "Freeze"("status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "CommissionConfig_role_isActive_effectiveFrom_idx" ON "CommissionConfig"("role", "isActive", "effectiveFrom" DESC);

-- CreateIndex
CREATE INDEX "CommissionConfig_userId_isActive_effectiveFrom_idx" ON "CommissionConfig"("userId", "isActive", "effectiveFrom" DESC);

-- CreateIndex
CREATE INDEX "Salary_teacherId_periodStart_periodEnd_idx" ON "Salary"("teacherId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "Salary_status_idx" ON "Salary"("status");

-- CreateIndex
CREATE INDEX "SalaryOperation_teacherId_date_idx" ON "SalaryOperation"("teacherId", "date" DESC);

-- CreateIndex
CREATE INDEX "SalaryOperation_type_date_idx" ON "SalaryOperation"("type", "date" DESC);

-- CreateIndex
CREATE INDEX "SalaryOperation_periodKey_status_teacherId_idx" ON "SalaryOperation"("periodKey", "status", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermissions_role_key" ON "RolePermissions"("role");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_createdAt_idx" ON "ActivityLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_action_idx" ON "ActivityLog"("entityType", "action");

-- CreateIndex
CREATE INDEX "StaffTask_assigneeId_status_dueAt_idx" ON "StaffTask"("assigneeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "StaffTask_createdById_status_dueAt_idx" ON "StaffTask"("createdById", "status", "dueAt");

-- CreateIndex
CREATE INDEX "StaffTask_status_dueAt_idx" ON "StaffTask"("status", "dueAt");

-- CreateIndex
CREATE INDEX "IntegrationLog_status_retryable_nextRetryAt_idx" ON "IntegrationLog"("status", "retryable", "nextRetryAt");

-- CreateIndex
CREATE INDEX "IntegrationLog_system_operation_createdAt_idx" ON "IntegrationLog"("system", "operation", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "IntegrationLog_entityType_entityId_idx" ON "IntegrationLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_phoneNumber_key" ON "Conversation"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_externalChatId_key" ON "Conversation"("externalChatId");

-- CreateIndex
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_automationStatus_lastInboundAt_idx" ON "Conversation"("automationStatus", "lastInboundAt" DESC);

-- CreateIndex
CREATE INDEX "Conversation_browserAccountKey_lastMessageAt_idx" ON "Conversation"("browserAccountKey", "lastMessageAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_externalMessageId_key" ON "ConversationMessage"("externalMessageId");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_timestamp_idx" ON "ConversationMessage"("conversationId", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationMessage_conversationId_fingerprint_key" ON "ConversationMessage"("conversationId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappBrowserSession_accountKey_key" ON "WhatsappBrowserSession"("accountKey");

-- CreateIndex
CREATE INDEX "WhatsappBrowserSession_status_lastHeartbeatAt_idx" ON "WhatsappBrowserSession"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappOutbox_idempotencyKey_key" ON "WhatsappOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WhatsappOutbox_status_createdAt_idx" ON "WhatsappOutbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappOutbox_conversationId_createdAt_idx" ON "WhatsappOutbox"("conversationId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "BlogPost_category_status_idx" ON "BlogPost"("category", "status");

-- CreateIndex
CREATE INDEX "_GroupBillingPlans_B_index" ON "_GroupBillingPlans"("B");

-- CreateIndex
CREATE INDEX "_PracticeGroups_B_index" ON "_PracticeGroups"("B");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_referredByStudentId_fkey" FOREIGN KEY ("referredByStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_assignedTeacherId_fkey" FOREIGN KEY ("assignedTeacherId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_activeMembershipId_fkey" FOREIGN KEY ("activeMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_lostMarkedById_fkey" FOREIGN KEY ("lostMarkedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPhone" ADD CONSTRAINT "StudentPhone_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecovery" ADD CONSTRAINT "StudentRecovery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentRecovery" ADD CONSTRAINT "StudentRecovery_recoveredByUserId_fkey" FOREIGN KEY ("recoveredByUserId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSchedule" ADD CONSTRAINT "GroupSchedule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupSchedule" ADD CONSTRAINT "GroupSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSchedule" ADD CONSTRAINT "StudentSchedule_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSchedule" ADD CONSTRAINT "StudentSchedule_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSchedule" ADD CONSTRAINT "StudentSchedule_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Direction" ADD CONSTRAINT "Direction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectionPlan" ADD CONSTRAINT "DirectionPlan_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_directionPlanId_fkey" FOREIGN KEY ("directionPlanId") REFERENCES "DirectionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_originalTeacherId_fkey" FOREIGN KEY ("originalTeacherId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_individualStudentId_fkey" FOREIGN KEY ("individualStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Class" ADD CONSTRAINT "Class_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeGroup" ADD CONSTRAINT "PracticeGroup_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeGroup" ADD CONSTRAINT "PracticeGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAttendee" ADD CONSTRAINT "ClassAttendee_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassAttendee" ADD CONSTRAINT "ClassAttendee_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_previousMembershipId_fkey" FOREIGN KEY ("previousMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTransaction" ADD CONSTRAINT "MembershipTransaction_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTransaction" ADD CONSTRAINT "MembershipTransaction_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipTransaction" ADD CONSTRAINT "MembershipTransaction_freezeId_fkey" FOREIGN KEY ("freezeId") REFERENCES "Freeze"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_relatedClassId_fkey" FOREIGN KEY ("relatedClassId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_relatedPaymentId_fkey" FOREIGN KEY ("relatedPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_relatedPaymentId_fkey" FOREIGN KEY ("relatedPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_relatedShopSaleId_fkey" FOREIGN KEY ("relatedShopSaleId") REFERENCES "ShopSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_relatedBookingId_fkey" FOREIGN KEY ("relatedBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_accountTransferId_fkey" FOREIGN KEY ("accountTransferId") REFERENCES "CashAccountTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAccountTransfer" ADD CONSTRAINT "CashAccountTransfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyAdminKpiSnapshot" ADD CONSTRAINT "DailyAdminKpiSnapshot_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReportSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopProduct" ADD CONSTRAINT "ShopProduct_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSale" ADD CONSTRAINT "ShopSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSale" ADD CONSTRAINT "ShopSale_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSale" ADD CONSTRAINT "ShopSale_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSaleItem" ADD CONSTRAINT "ShopSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ShopSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopSaleItem" ADD CONSTRAINT "ShopSaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopStockMovement" ADD CONSTRAINT "ShopStockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ShopProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopStockMovement" ADD CONSTRAINT "ShopStockMovement_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "ShopSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopStockMovement" ADD CONSTRAINT "ShopStockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_trialManagerId_fkey" FOREIGN KEY ("trialManagerId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_convertedToStudentId_fkey" FOREIGN KEY ("convertedToStudentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Freeze" ADD CONSTRAINT "Freeze_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Freeze" ADD CONSTRAINT "Freeze_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Freeze" ADD CONSTRAINT "Freeze_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Freeze" ADD CONSTRAINT "Freeze_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionConfig" ADD CONSTRAINT "CommissionConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionConfig" ADD CONSTRAINT "CommissionConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryClass" ADD CONSTRAINT "SalaryClass_salaryId_fkey" FOREIGN KEY ("salaryId") REFERENCES "Salary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryClass" ADD CONSTRAINT "SalaryClass_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryClassStudent" ADD CONSTRAINT "SalaryClassStudent_salaryClassId_fkey" FOREIGN KEY ("salaryClassId") REFERENCES "SalaryClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappOutbox" ADD CONSTRAINT "WhatsappOutbox_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupBillingPlans" ADD CONSTRAINT "_GroupBillingPlans_A_fkey" FOREIGN KEY ("A") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_GroupBillingPlans" ADD CONSTRAINT "_GroupBillingPlans_B_fkey" FOREIGN KEY ("B") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PracticeGroups" ADD CONSTRAINT "_PracticeGroups_A_fkey" FOREIGN KEY ("A") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_PracticeGroups" ADD CONSTRAINT "_PracticeGroups_B_fkey" FOREIGN KEY ("B") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
