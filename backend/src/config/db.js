const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

// Initialize Pool and Adapter for Prisma 7
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({
    connectionString,
    max: 20,                       // Increase from default 10
    idleTimeoutMillis: 30000,      // Close idle connections after 30s
    connectionTimeoutMillis: 5000, // Fail fast if can't connect in 5s
});

// Handle pool errors to prevent process crash
pool.on('error', (err) => {
    console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

const adapter = new PrismaPg(pool);

// Initialize Prisma Client (no 'query' log — it floods stdout and causes backpressure)
const prisma = new PrismaClient({
    adapter,
    log: ['info', 'warn', 'error'],
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
