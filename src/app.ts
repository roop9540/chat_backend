import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { chatRoutes } from './routes/chatRoutes';
import { userRoutes } from './routes/userRoutes';
import type { ChatService } from './services/chatService';

export function createApp(service: ChatService): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/chat', chatRoutes(service));
  app.use('/user', userRoutes(service));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
