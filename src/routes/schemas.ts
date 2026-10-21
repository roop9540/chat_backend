import { z } from 'zod';

export const id = z.uuid({ message: 'must be a valid UUID' });
/** Firestore auto-generated document id; restricting the charset prevents path traversal. */
export const messageId = z.string().regex(/^[A-Za-z0-9]{1,128}$/, 'must be a valid message id');
const text = z.string().trim().min(1, 'must not be empty').max(4000, 'must be at most 4000 characters');
const name = z.string().trim().min(1).max(100);

export const chatParams = z.object({ chatId: id });
export const messageParams = z.object({ chatId: id, messageId });
export const userParams = z.object({ userId: id });

export const createUserBody = z.object({ name });
export const createChatBody = z.object({ userAId: id, userBId: id });
export const createGroupBody = z.object({ creatorId: id, name, memberIds: z.array(id).max(256).default([]) });
export const renameGroupBody = z.object({ requesterId: id, name });
export const addMembersBody = z.object({ requesterId: id, userIds: z.array(id).min(1).max(256) });
export const removeMemberBody = z.object({ requesterId: id, userId: id });

export const sendMessageBody = z.object({ senderId: id, text });
export const editMessageBody = z.object({ senderId: id, text });
export const deleteMessageBody = z.object({ senderId: id });
export const markReadBody = z.object({ userId: id });
export const lastSeenBody = z.object({ userId: id, messageId });

export const messagesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: messageId.optional(),
});
