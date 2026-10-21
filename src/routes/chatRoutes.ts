import { Router } from 'express';
import { parse } from '../middleware/validate';
import type { ChatService } from '../services/chatService';
import {
  addMembersBody,
  chatParams,
  createChatBody,
  createGroupBody,
  deleteMessageBody,
  editMessageBody,
  lastSeenBody,
  markReadBody,
  messageParams,
  messagesQuery,
  removeMemberBody,
  renameGroupBody,
  sendMessageBody,
} from './schemas';

export function chatRoutes(service: ChatService): Router {
  const router = Router();

  // 1. Create or Get Chat (1:1)
  router.post('/create', async (req, res) => {
    const { userAId, userBId } = parse(createChatBody, req.body);
    const { chat, created } = await service.createOrGetDirectChat(userAId, userBId);
    res.status(created ? 201 : 200).json({ chatId: chat.id, created, chat });
  });

  // Bonus: group chat creation & management
  router.post('/group/create', async (req, res) => {
    const { creatorId, name, memberIds } = parse(createGroupBody, req.body);
    const chat = await service.createGroupChat(creatorId, name, memberIds);
    res.status(201).json({ chatId: chat.id, chat });
  });

  router.get('/:chatId', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    res.json(await service.getChat(chatId));
  });

  router.patch('/:chatId', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    const { requesterId, name } = parse(renameGroupBody, req.body);
    res.json(await service.renameGroup(chatId, requesterId, name));
  });

  router.post('/:chatId/members/add', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    const { requesterId, userIds } = parse(addMembersBody, req.body);
    res.json(await service.addGroupMembers(chatId, requesterId, userIds));
  });

  router.post('/:chatId/members/remove', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    const { requesterId, userId } = parse(removeMemberBody, req.body);
    res.json(await service.removeGroupMember(chatId, requesterId, userId));
  });

  // 2. Send Message
  router.post('/:chatId/message/send', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    const { senderId, text } = parse(sendMessageBody, req.body);
    res.status(201).json(await service.sendMessage(chatId, senderId, text));
  });

  // 3. Get Messages (?limit=50&before=<messageId> for older pages)
  router.get('/:chatId/messages', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    const { limit, before } = parse(messagesQuery, req.query);
    res.json(await service.getMessages(chatId, limit, before));
  });

  // 4. Mark Message Read
  router.post('/:chatId/message/:messageId/read', async (req, res) => {
    const { chatId, messageId } = parse(messageParams, req.params);
    const { userId } = parse(markReadBody, req.body);
    res.json(await service.markMessageRead(chatId, messageId, userId));
  });

  // Bonus: message edit / delete
  router.patch('/:chatId/message/:messageId', async (req, res) => {
    const { chatId, messageId } = parse(messageParams, req.params);
    const { senderId, text } = parse(editMessageBody, req.body);
    res.json(await service.editMessage(chatId, messageId, senderId, text));
  });

  router.delete('/:chatId/message/:messageId', async (req, res) => {
    const { chatId, messageId } = parse(messageParams, req.params);
    const { senderId } = parse(deleteMessageBody, req.body);
    res.json(await service.deleteMessage(chatId, messageId, senderId));
  });

  // 5. Update Last Seen Message
  router.post('/:chatId/lastseen', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    const { userId, messageId } = parse(lastSeenBody, req.body);
    res.json(await service.updateLastSeen(chatId, userId, messageId));
  });

  router.get('/:chatId/lastseen', async (req, res) => {
    const { chatId } = parse(chatParams, req.params);
    res.json({ lastSeen: await service.getLastSeen(chatId) });
  });

  return router;
}
