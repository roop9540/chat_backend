import { createApp } from './app';
import { loadEnv } from './config/env';
import { createPool } from './db/postgres';
import { createFirestore } from './firebase/firestore';
import { ChatRepository } from './repositories/chatRepository';
import { MessageRepository } from './repositories/messageRepository';
import { ChatService } from './services/chatService';

async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  await pool.query('SELECT 1');

  const service = new ChatService(new ChatRepository(pool), new MessageRepository(createFirestore(env.FIREBASE_PROJECT_ID)));
  const server = createApp(service).listen(env.PORT, () => {
    console.log(`Chat backend listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (): void => {
    server.close(() => void pool.end().then(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
