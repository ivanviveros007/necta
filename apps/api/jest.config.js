/**
 * NestJS 12 se publica solo como ESM. En Node 22 Jest no soporta require(esm) (requiere Node 24.9+),
 * así que los paquetes ESM de node_modules se transpilan a CommonJS (test/esm-to-cjs.transformer.cjs).
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+\\.js$': '<rootDir>/test/esm-to-cjs.transformer.cjs',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@nestjs|uid|load-esm|file-type|token-types|strtok3|@tokenizer|@borewit|uint8array-extras)/)'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/env.ts'],
  testTimeout: 30000,
};
