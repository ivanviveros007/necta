/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/ios',
  setupFiles: ['<rootDir>/test/setup.ts'],
  moduleNameMapper: {
    '^@necta/cash-engine$': '<rootDir>/../../packages/cash-engine/src/index.ts',
    '^@necta/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)', '<rootDir>/test/**/*.test.ts?(x)'],
  testTimeout: 20000,
};
