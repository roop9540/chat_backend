import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/postgres';
import type { Chat, ChatMember, ChatType, MemberRole, User } from '../types/domain';

interface UserRow {
  id: string;
  name: string;
  created_at: Date;
}

interface ChatRow {
  id: string;
  type: ChatType;
  name: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  members: Array<{ userId: string; role: MemberRole; joinedAt: string }>;
}

const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, createdAt: row.created_at.toISOString() });

const toChat = (row: ChatRow): Chat => ({
  id: row.id,
  type: row.type,
  name: row.name,
  createdBy: row.created_by,
  members: row.members.map(
    (m): ChatMember => ({ userId: m.userId, role: m.role, joinedAt: new Date(m.joinedAt).toISOString() }),
  ),
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/** Selects chats with their members aggregated as JSON. Callers append a WHERE clause. */
const CHAT_SELECT = `
  SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.updated_at,
         COALESCE(
           (SELECT json_agg(json_build_object('userId', m.user_id, 'role', m.role, 'joinedAt', m.joined_at)
                            ORDER BY m.joined_at, m.user_id)
              FROM chat_members m WHERE m.chat_id = c.id),
           '[]'::json
         ) AS members
    FROM chats c`;

export const directKey = (userAId: string, userBId: string): string =>
  [userAId, userBId].sort().join(':');

/** Relational storage for users, chats and membership (PostgreSQL). */
export class ChatRepository {
  constructor(private readonly pool: Pool) {}

  async createUser(name: string): Promise<User> {
    const { rows } = await this.pool.query<UserRow>(
      'INSERT INTO users (name) VALUES ($1) RETURNING id, name, created_at',
      [name],
    );
    return toUser(rows[0]!);
  }

  async findUserById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT id, name, created_at FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  /** Returns the subset of `ids` that do not exist in the users table. */
  async findMissingUserIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query<{ id: string }>('SELECT id FROM users WHERE id = ANY($1::uuid[])', [ids]);
    const found = new Set(rows.map((r) => r.id));
    return ids.filter((id) => !found.has(id));
  }

  async findChatById(chatId: string, client: Pool | PoolClient = this.pool): Promise<Chat | null> {
    const { rows } = await client.query<ChatRow>(`${CHAT_SELECT} WHERE c.id = $1`, [chatId]);
    return rows[0] ? toChat(rows[0]) : null;
  }

  /**
   * Returns the 1:1 chat between two users, creating it if needed.
   * Safe under concurrency: the unique `direct_key` makes the insert idempotent.
   */
  async findOrCreateDirectChat(userAId: string, userBId: string): Promise<{ chat: Chat; created: boolean }> {
    const key = directKey(userAId, userBId);
    return withTransaction(this.pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO chats (type, created_by, direct_key) VALUES ('direct', $1, $2)
         ON CONFLICT (direct_key) DO NOTHING RETURNING id`,
        [userAId, key],
      );
      const newId = inserted.rows[0]?.id;
      if (newId) {
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, 'member'), ($1, $3, 'member')`,
          [newId, userAId, userBId],
        );
        return { chat: (await this.findChatById(newId, client))!, created: true };
      }
      const { rows } = await client.query<ChatRow>(`${CHAT_SELECT} WHERE c.direct_key = $1`, [key]);
      return { chat: toChat(rows[0]!), created: false };
    });
  }

  async createGroupChat(creatorId: string, name: string, memberIds: readonly string[]): Promise<Chat> {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO chats (type, name, created_by) VALUES ('group', $1, $2) RETURNING id`,
        [name, creatorId],
      );
      const chatId = rows[0]!.id;
      await client.query(`INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, 'admin')`, [
        chatId,
        creatorId,
      ]);
      const others = memberIds.filter((id) => id !== creatorId);
      if (others.length > 0) {
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id, role)
           SELECT $1, unnest($2::uuid[]), 'member' ON CONFLICT DO NOTHING`,
          [chatId, others],
        );
      }
      return (await this.findChatById(chatId, client))!;
    });
  }

  async listChatsForUser(userId: string): Promise<Chat[]> {
    const { rows } = await this.pool.query<ChatRow>(
      `${CHAT_SELECT}
        WHERE EXISTS (SELECT 1 FROM chat_members me WHERE me.chat_id = c.id AND me.user_id = $1)
        ORDER BY c.updated_at DESC, c.id`,
      [userId],
    );
    return rows.map(toChat);
  }

  async getMemberRole(chatId: string, userId: string): Promise<MemberRole | null> {
    const { rows } = await this.pool.query<{ role: MemberRole }>(
      'SELECT role FROM chat_members WHERE chat_id = $1 AND user_id = $2',
      [chatId, userId],
    );
    return rows[0]?.role ?? null;
  }

  async addMembers(chatId: string, userIds: readonly string[]): Promise<Chat> {
    return withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO chat_members (chat_id, user_id, role)
         SELECT $1, unnest($2::uuid[]), 'member' ON CONFLICT DO NOTHING`,
        [chatId, userIds],
      );
      await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
      return (await this.findChatById(chatId, client))!;
    });
  }

  async removeMember(chatId: string, userId: string): Promise<Chat> {
    return withTransaction(this.pool, async (client) => {
      await client.query('DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2', [chatId, userId]);
      await client.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
      return (await this.findChatById(chatId, client))!;
    });
  }

  async setMemberRole(chatId: string, userId: string, role: MemberRole): Promise<void> {
    await this.pool.query('UPDATE chat_members SET role = $3 WHERE chat_id = $1 AND user_id = $2', [
      chatId,
      userId,
      role,
    ]);
  }

  async renameChat(chatId: string, name: string): Promise<Chat> {
    await this.pool.query('UPDATE chats SET name = $2, updated_at = now() WHERE id = $1', [chatId, name]);
    return (await this.findChatById(chatId))!;
  }

  async touchChat(chatId: string): Promise<void> {
    await this.pool.query('UPDATE chats SET updated_at = now() WHERE id = $1', [chatId]);
  }
}
