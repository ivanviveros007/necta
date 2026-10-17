// Base exclusiva de pruebas: seed/reset nunca tocan necta_demo ni bases ajenas.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI_TEST ?? 'mongodb://127.0.0.1:27018/?directConnection=true&replicaSet=rs0';
process.env.MONGO_DB = 'necta_test_api';
process.env.BUSINESS_DATE = '2026-05-25';
process.env.TODAY_POLICY = 'fullDay';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.WEB_ORIGINS = 'http://localhost:5173';
process.env.SCHEDULER_ENABLED = 'false';
process.env.DEV_ENDPOINTS = 'true';
