#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { syncAllMembershipPlans } = require('../src/services/membershipPlanSync');
const { prisma } = require('../src/config/db');

syncAllMembershipPlans()
    .then((result) => {
        console.log('Membership plans synced:', result);
        return prisma.$disconnect();
    })
    .catch((error) => {
        console.error(error);
        return prisma.$disconnect().finally(() => process.exit(1));
    });
