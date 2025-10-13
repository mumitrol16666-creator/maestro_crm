// Устанавливаем JWT_SECRET для тестов
process.env.JWT_SECRET = 'test-secret-key-for-testing';

module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testTimeout: 10000,
  verbose: false,
  maxWorkers: 1,
  bail: false,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',
    '!src/config/db.js'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js']
};

