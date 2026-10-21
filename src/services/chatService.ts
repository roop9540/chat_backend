import type { ChatRepository } from '../repositories/chatRepository';
import type { MessageRepository } from '../repositories/messageRepository';
import type { Chat, LastSeen, Message, MessagePage, MemberRole, User } from '../types/domain';
import { badRequest, forbidden, notFound } from '../utils/errors';

export class ChatService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly messages: MessageRepository,
  ) {}

  // ---------- helpers ----------

  private async requireUsers(ids: readonly string[]): Promise<void> {
    const missing = await this.chats.findMissingUserIds([...new Set(ids)]);
    if (missing.length > 0) throw notFound(`User(s) not found: ${missing.join(', ')}`);
  }

  private async requireChat(chatId: string): Promise<Chat> {
    const chat = await this.chats.findChatById(chatId);
    if (!chat) throw notFound(`Chat ${chatId} not found`);
    return chat;
  }

  private async requireMember(chatId: string, userId: string): Promise<MemberRole> {
    await this.requireChat(chatId);
    const role = await this.chats.getMemberRole(chatId, userId);
    if (!role) throw forbidden(`User ${userId} is not a member of chat ${chatId}`);
    return role;
  }

  private async requireGroupAdmin(chatId: string, userId: string): Promise<Chat> {
    const chat = await this.requireChat(chatId);
    if (chat.type !== 'group') throw badRequest('This operation is only allowed on group chats');
    const role = await this.chats.getMemberRole(chatId, userId);
    if (role !== 'admin') throw forbidden(`User ${userId} is not an admin of chat ${chatId}`);
    return chat;
  }

  private async requireOwnMessage(chatId: string, messageId: string, userId: string): Promise<Message> {
    await this.requireMember(chatId, userId);
    const message = await this.messages.getMessage(chatId, messageId);
    if (message.senderId !== userId) throw forbidden('Only the sender can modify this message');
    if (message.deletedAt) throw badRequest('Message has been deleted');
    return message;
  }

  // ---------- users ----------

  createUser(name: string): Promise<User> {
    return this.chats.createUser(name);
  }

  async listUserChats(userId: string): Promise<Chat[]> {
    await this.requireUsers([userId]);
    return this.chats.listChatsForUser(userId);
  }

  // ---------- chats ----------

  async createOrGetDirectChat(userAId: string, userBId: string): Promise<{ chat: Chat; created: boolean }> {
    if (userAId === userBId) throw badRequest('userAId and userBId must be different users');
    await this.requireUsers([userAId, userBId]);
    return this.chats.findOrCreateDirectChat(userAId, userBId);
  }

  async createGroupChat(creatorId: string, name: string, memberIds: readonly string[]): Promise<Chat> {
    await this.requireUsers([creatorId, ...memberIds]);
    return this.chats.createGroupChat(creatorId, name, memberIds);
  }

  async getChat(chatId: string): Promise<Chat> {
    return this.requireChat(chatId);
  }

  async renameGroup(chatId: string, requesterId: string, name: string): Promise<Chat> {
    await this.requireGroupAdmin(chatId, requesterId);
    return this.chats.renameChat(chatId, name);
  }

  async addGroupMembers(chatId: string, requesterId: string, userIds: readonly string[]): Promise<Chat> {
    await this.requireGroupAdmin(chatId, requesterId);
    await this.requireUsers(userIds);
    return this.chats.addMembers(chatId, userIds);
  }

  /** Admins can remove anyone; any member can remove themselves (leave the group). */
  async removeGroupMember(chatId: string, requesterId: string, userId: string): Promise<Chat> {
    const chat = await this.requireChat(chatId);
    if (chat.type !== 'group') throw badRequest('This operation is only allowed on group chats');
    const requesterRole = await this.chats.getMemberRole(chatId, requesterId);
    if (!requesterRole) throw forbidden(`User ${requesterId} is not a member of chat ${chatId}`);
    if (requesterId !== userId && requesterRole !== 'admin') {
      throw forbidden('Only admins can remove other members');
    }
    const target = chat.members.find((m) => m.userId === userId);
    if (!target) throw notFound(`User ${userId} is not a member of chat ${chatId}`);

    const updated = await this.chats.removeMember(chatId, userId);
    // Never leave a group without an admin: promote the longest-standing member.
    const nextAdmin = updated.members[0];
    if (target.role === 'admin' && nextAdmin && !updated.members.some((m) => m.role === 'admin')) {
      await this.chats.setMemberRole(chatId, nextAdmin.userId, 'admin');
      return this.requireChat(chatId);
    }
    return updated;
  }

  // ---------- messages ----------

  async sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    await this.requireMember(chatId, senderId);
    const message = await this.messages.sendMessage(chatId, senderId, text);
    await this.chats.touchChat(chatId);
    return message;
  }

  async getMessages(chatId: string, limit: number, before?: string): Promise<MessagePage> {
    await this.requireChat(chatId);
    return this.messages.listMessages(chatId, limit, before);
  }

  async markMessageRead(chatId: string, messageId: string, userId: string): Promise<Message> {
    await this.requireMember(chatId, userId);
    return this.messages.markRead(chatId, messageId, userId);
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeen> {
    await this.requireMember(chatId, userId);
    return this.messages.updateLastSeen(chatId, userId, messageId);
  }

  async getLastSeen(chatId: string): Promise<LastSeen[]> {
    await this.requireChat(chatId);
    return this.messages.listLastSeen(chatId);
  }

  async editMessage(chatId: string, messageId: string, senderId: string, text: string): Promise<Message> {
    await this.requireOwnMessage(chatId, messageId, senderId);
    return this.messages.editMessage(chatId, messageId, text);
  }

  async deleteMessage(chatId: string, messageId: string, senderId: string): Promise<Message> {
    await this.requireOwnMessage(chatId, messageId, senderId);
    return this.messages.deleteMessage(chatId, messageId);
  }
}
