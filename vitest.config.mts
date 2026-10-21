import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: {
      // Tests always run against the local emulator with a demo project id, never a real Firebase project.
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080',
      FIREBASE_PROJECT_ID: 'demo-chat-backend',
      GCLOUD_PROJECT: 'demo-chat-backend',
    },
    // Tests share one Postgres database and one Firestore emulator, so run files serially.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
