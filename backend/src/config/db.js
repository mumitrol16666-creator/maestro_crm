const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

// Initialize Pool and Adapter for Prisma 7
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Initialize Prisma Client
const prisma = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
});

const connectDB = async () => {
    try {
        await prisma.$connect();
        console.log(`✅ PostgreSQL Connected via Prisma (Adapter)`);
    } catch (error) {
        console.error(`❌ PostgreSQL Connection Error: ${error.message}`);
        console.warn(`⚠️ Running without DB connection!`);
    }
};

module.exports = { prisma, connectDB };
