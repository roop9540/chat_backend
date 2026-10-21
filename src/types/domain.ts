export type ChatType = 'direct' | 'group';
export type MemberRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export interface ChatMember {
  userId: string;
  role: MemberRole;
  joinedAt: string;
}

export interface Chat {
  id: string;
  type: ChatType;
  name: string | null;
  createdBy: string;
  members: ChatMember[];
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  /** Server-assigned commit time. Messages are ordered by (createdAt, id). */
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  /** userId -> ISO time the user read this message. */
  readBy: Record<string, string>;
}

export interface LastSeen {
  chatId: string;
  userId: string;
  messageId: string;
  /** createdAt of the last seen message. */
  messageCreatedAt: string;
  updatedAt: string;
}

export interface MessagePage {
  messages: Message[];
  /** Message id to pass as `before` to fetch the next (older) page; null when there are no older messages. */
  nextCursor: string | null;
}
