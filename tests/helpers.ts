import type { Express } from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/app';
import { createPool } from '../src/db/postgres';
import { migrate } from '../src/db/migrate';
import { createFirestore } from '../src/firebase/firestore';
import { ChatRepository } from '../src/repositories/chatRepository';
import { MessageRepository } from '../src/repositories/messageRepository';
import { ChatService } from '../src/services/chatService';

const PROJECT_ID = 'demo-chat-backend';
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/chat_backend_test';

export interface TestContext {
  app: Express;
  pool: Pool;
  reset: () => Promise<void>;
}

export async function setupTestContext(): Promise<TestContext> {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulatorHost) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Start it with `npm run emulator`.');
  }

  const pool = createPool(DATABASE_URL);
  await migrate(pool);
  const firestore = createFirestore(PROJECT_ID);
  const app = createApp(new ChatService(new ChatRepository(pool), new MessageRepository(firestore)));

  const reset = async (): Promise<void> => {
    await pool.query('TRUNCATE chat_members, chats, users CASCADE');
    const res = await fetch(
      `http://${emulatorHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(`Failed to clear Firestore emulator: ${res.status}`);
  };

  return { app, pool, reset };
}

export async function createUser(app: Express, name: string): Promise<string> {
  const res = await request(app).post('/user/create').send({ name }).expect(201);
  return (res.body as { id: string }).id;
}
