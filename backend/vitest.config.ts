import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: 'test',
      DB_NAME: process.env.TEST_DB_NAME || 'umema_test',
      STORAGE_DIR: 'storage-test',
      BACKUP_DIR: 'storage-test/backups',
      RUN_WORKER_IN_API: 'false',
      APP_URL: 'http://192.168.100.198:3000',
    },
  },
});
