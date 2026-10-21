import { Router } from 'express';
import { parse } from '../middleware/validate';
import type { ChatService } from '../services/chatService';
import { createUserBody, userParams } from './schemas';

export function userRoutes(service: ChatService): Router {
  const router = Router();

  // Helper endpoint so the API can be exercised without seeding the database manually.
  router.post('/create', async (req, res) => {
    const { name } = parse(createUserBody, req.body);
    res.status(201).json(await service.createUser(name));
  });

  // 6. List User Chats
  router.get('/:userId/chats', async (req, res) => {
    const { userId } = parse(userParams, req.params);
    res.json({ chats: await service.listUserChats(userId) });
  });

  return router;
}
