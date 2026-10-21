import {
  FieldPath,
  FieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase-admin/firestore';
import type { LastSeen, Message, MessagePage } from '../types/domain';
import { notFound } from '../utils/errors';

/**
 * Firestore layout
 *
 *   chats/{chatId}/messages/{messageId}  { senderId, text, createdAt, editedAt, deletedAt, readBy: { [userId]: Timestamp } }
 *   chats/{chatId}/lastSeen/{userId}     { messageId, messageCreatedAt, updatedAt }
 *
 * Ordering: messages are ordered by their server-assigned `createdAt`, with the document id
 * as a deterministic tie-breaker. Sending is a single write, so concurrent senders never contend.
 */
interface MessageDoc {
  senderId: string;
  text: string;
  createdAt: Timestamp;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  readBy: Record<string, Timestamp>;
}

interface LastSeenDoc {
  messageId: string;
  messageCreatedAt: Timestamp;
  updatedAt: Timestamp;
}

const iso = (ts: Timestamp): string => ts.toDate().toISOString();

function toMessage(chatId: string, id: string, d: MessageDoc): Message {
  return {
    id,
    chatId,
    senderId: d.senderId,
    text: d.text,
    createdAt: iso(d.createdAt),
    editedAt: d.editedAt ? iso(d.editedAt) : null,
    deletedAt: d.deletedAt ? iso(d.deletedAt) : null,
    readBy: Object.fromEntries(Object.entries(d.readBy ?? {}).map(([userId, ts]) => [userId, iso(ts)])),
  };
}

const snapToMessage = (chatId: string, snap: DocumentSnapshot): Message =>
  toMessage(chatId, snap.id, snap.data() as MessageDoc);

function toLastSeen(chatId: string, userId: string, d: LastSeenDoc): LastSeen {
  return { chatId, userId, messageId: d.messageId, messageCreatedAt: iso(d.messageCreatedAt), updatedAt: iso(d.updatedAt) };
}

/** True if message (aTime, aId) comes after message (bTime, bId) in chat order. */
function isAfter(aTime: Timestamp, aId: string, bTime: Timestamp, bId: string): boolean {
  const cmp = aTime.toMillis() - bTime.toMillis() || aTime.nanoseconds - bTime.nanoseconds;
  return cmp > 0 || (cmp === 0 && aId > bId);
}

/** Message, read-receipt and last-seen storage (Firebase Firestore). */
export class MessageRepository {
  constructor(private readonly db: Firestore) {}

  private messages(chatId: string): CollectionReference {
    return this.db.collection('chats').doc(chatId).collection('messages');
  }

  private messageRef(chatId: string, messageId: string): DocumentReference {
    return this.messages(chatId).doc(messageId);
  }

  private async getMessageOrThrow(chatId: string, messageId: string): Promise<DocumentSnapshot> {
    const snap = await this.messageRef(chatId, messageId).get();
    if (!snap.exists) throw notFound(`Message ${messageId} not found in chat ${chatId}`);
    return snap;
  }

  /** Stores a message stamped with the Firestore server time. */
  async sendMessage(chatId: string, senderId: string, text: string): Promise<Message> {
    const ref = this.messages(chatId).doc();
    await ref.create({
      senderId,
      text,
      createdAt: FieldValue.serverTimestamp(),
      editedAt: null,
      deletedAt: null,
      readBy: {},
    });
    // Re-read so the response carries the exact server timestamp that was stored.
    return snapToMessage(chatId, await ref.get());
  }

  async getMessage(chatId: string, messageId: string): Promise<Message> {
    return snapToMessage(chatId, await this.getMessageOrThrow(chatId, messageId));
  }

  /**
   * Returns the latest `limit` messages in ascending order (oldest first).
   * With `before`, returns the page of messages immediately older than that message.
   */
  async listMessages(chatId: string, limit: number, before?: string): Promise<MessagePage> {
    let query = this.messages(chatId).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
    if (before !== undefined) query = query.startAfter(await this.getMessageOrThrow(chatId, before));
    // Fetch one extra document to know whether an older page exists.
    const snap = await query.limit(limit + 1).get();

    const hasMore = snap.docs.length > limit;
    const messages = snap.docs.slice(0, limit).map((doc) => snapToMessage(chatId, doc)).reverse();
    return { messages, nextCursor: hasMore ? (messages[0]?.id ?? null) : null };
  }

  /** Records that `userId` read the message. Idempotent: the first read time is kept. */
  async markRead(chatId: string, messageId: string, userId: string): Promise<Message> {
    const ref = this.messageRef(chatId, messageId);
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw notFound(`Message ${messageId} not found in chat ${chatId}`);
      const data = snap.data() as MessageDoc;
      if (data.senderId === userId || data.readBy?.[userId]) return;
      tx.update(ref, new FieldPath('readBy', userId), FieldValue.serverTimestamp());
    });
    return snapToMessage(chatId, await ref.get());
  }

  /**
   * Moves the user's last-seen pointer to `messageId`.
   * The pointer only moves forward: an older message never overwrites a newer one.
   */
  async updateLastSeen(chatId: string, userId: string, messageId: string): Promise<LastSeen> {
    const msgRef = this.messageRef(chatId, messageId);
    const seenRef = this.db.collection('chats').doc(chatId).collection('lastSeen').doc(userId);

    await this.db.runTransaction(async (tx) => {
      const [msgSnap, seenSnap] = await Promise.all([tx.get(msgRef), tx.get(seenRef)]);
      if (!msgSnap.exists) throw notFound(`Message ${messageId} not found in chat ${chatId}`);
      const { createdAt } = msgSnap.data() as MessageDoc;
      const current = seenSnap.data() as LastSeenDoc | undefined;
      if (current && !isAfter(createdAt, messageId, current.messageCreatedAt, current.messageId)) return;
      tx.set(seenRef, { messageId, messageCreatedAt: createdAt, updatedAt: FieldValue.serverTimestamp() });
    });

    return toLastSeen(chatId, userId, (await seenRef.get()).data() as LastSeenDoc);
  }

  async listLastSeen(chatId: string): Promise<LastSeen[]> {
    const snap = await this.db.collection('chats').doc(chatId).collection('lastSeen').get();
    return snap.docs.map((doc) => toLastSeen(chatId, doc.id, doc.data() as LastSeenDoc));
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<Message> {
    const ref = this.messageRef(chatId, messageId);
    await ref.update({ text, editedAt: FieldValue.serverTimestamp() });
    return snapToMessage(chatId, await ref.get());
  }

  /** Soft delete: the message keeps its place in the ordering but its text is cleared. */
  async deleteMessage(chatId: string, messageId: string): Promise<Message> {
    const ref = this.messageRef(chatId, messageId);
    await ref.update({ text: '', deletedAt: FieldValue.serverTimestamp() });
    return snapToMessage(chatId, await ref.get());
  }
}
