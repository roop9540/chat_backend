import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Chat, LastSeen, Message, MessagePage } from '../src/types/domain';
import { createUser, setupTestContext, type TestContext } from './helpers';

let ctx: TestContext;
let alice: string;
let bob: string;
let carol: string;

beforeAll(async () => {
  ctx = await setupTestContext();
});

afterAll(async () => {
  await ctx.pool.end();
});

beforeEach(async () => {
  await ctx.reset();
  alice = await createUser(ctx.app, 'Alice');
  bob = await createUser(ctx.app, 'Bob');
  carol = await createUser(ctx.app, 'Carol');
});

async function directChat(a: string, b: string): Promise<string> {
  const res = await request(ctx.app).post('/chat/create').send({ userAId: a, userBId: b });
  return (res.body as { chatId: string }).chatId;
}

async function send(chatId: string, senderId: string, text: string): Promise<Message> {
  const res = await request(ctx.app).post(`/chat/${chatId}/message/send`).send({ senderId, text }).expect(201);
  return res.body as Message;
}

describe('POST /chat/create', () => {
  it('creates a 1:1 chat and returns the same chat for the same pair in either order', async () => {
    const first = await request(ctx.app).post('/chat/create').send({ userAId: alice, userBId: bob }).expect(201);
    expect(first.body.created).toBe(true);
    expect(first.body.chatId).toEqual(expect.any(String));

    const again = await request(ctx.app).post('/chat/create').send({ userAId: bob, userBId: alice }).expect(200);
    expect(again.body.created).toBe(false);
    expect(again.body.chatId).toBe(first.body.chatId);

    const members = (again.body.chat as Chat).members.map((m) => m.userId).sort();
    expect(members).toEqual([alice, bob].sort());
  });

  it('creates exactly one chat under concurrent requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        request(ctx.app)
          .post('/chat/create')
          .send(i % 2 ? { userAId: alice, userBId: bob } : { userAId: bob, userBId: alice }),
      ),
    );
    const ids = new Set(results.map((r) => r.body.chatId as string));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('rejects chatting with yourself, unknown users and invalid ids', async () => {
    await request(ctx.app).post('/chat/create').send({ userAId: alice, userBId: alice }).expect(400);
    await request(ctx.app)
      .post('/chat/create')
      .send({ userAId: alice, userBId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
    const bad = await request(ctx.app).post('/chat/create').send({ userAId: 'nope' }).expect(400);
    expect(bad.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'userAId' }), expect.objectContaining({ field: 'userBId' })]),
    );
  });
});

describe('messages', () => {
  it('sends messages and returns them ordered by timestamp/sequence', async () => {
    const chatId = await directChat(alice, bob);
    const m1 = await send(chatId, alice, 'Hi Bob');
    const m2 = await send(chatId, bob, 'Hey Alice');
    const m3 = await send(chatId, alice, 'How are you?');

    expect(m1).toMatchObject({ chatId, senderId: alice, text: 'Hi Bob', readBy: {}, deletedAt: null, editedAt: null });
    expect(Date.parse(m1.createdAt)).not.toBeNaN();

    const res = await request(ctx.app).get(`/chat/${chatId}/messages?limit=50`).expect(200);
    const page = res.body as MessagePage;
    expect(page.messages.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    const times = page.messages.map((m) => Date.parse(m.createdAt));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(page.nextCursor).toBeNull();
  });

  it('returns concurrently sent messages in a stable timestamp order', async () => {
    const chatId = await directChat(alice, bob);
    const sent = await Promise.all(Array.from({ length: 20 }, (_, i) => send(chatId, i % 2 ? alice : bob, `msg ${i}`)));
    const page = (await request(ctx.app).get(`/chat/${chatId}/messages`).expect(200)).body as MessagePage;

    expect(page.messages.map((m) => m.id).sort()).toEqual(sent.map((m) => m.id).sort());
    const times = page.messages.map((m) => Date.parse(m.createdAt));
    times.slice(1).forEach((t, i) => expect(t).toBeGreaterThanOrEqual(times[i]!));
    // The timestamp returned by send is the one stored.
    const sentAt = new Map(sent.map((m) => [m.id, m.createdAt]));
    page.messages.forEach((m) => expect(m.createdAt).toBe(sentAt.get(m.id)));

    // Ordering is stable across repeated reads.
    const again = (await request(ctx.app).get(`/chat/${chatId}/messages`).expect(200)).body as MessagePage;
    expect(again.messages.map((m) => m.id)).toEqual(page.messages.map((m) => m.id));
  });

  it('paginates with limit and before', async () => {
    const chatId = await directChat(alice, bob);
    for (let i = 1; i <= 5; i++) await send(chatId, alice, `msg ${i}`);

    const get = async (query: string): Promise<MessagePage> =>
      (await request(ctx.app).get(`/chat/${chatId}/messages?${query}`).expect(200)).body as MessagePage;

    const latest = await get('limit=2');
    expect(latest.messages.map((m) => m.text)).toEqual(['msg 4', 'msg 5']);
    expect(latest.nextCursor).toBe(latest.messages[0]?.id);

    const older = await get(`limit=2&before=${latest.nextCursor}`);
    expect(older.messages.map((m) => m.text)).toEqual(['msg 2', 'msg 3']);

    const oldest = await get(`limit=2&before=${older.nextCursor}`);
    expect(oldest.messages.map((m) => m.text)).toEqual(['msg 1']);
    expect(oldest.nextCursor).toBeNull();

    // Exactly `limit` messages left: no phantom next page.
    expect((await get('limit=5')).nextCursor).toBeNull();

    await request(ctx.app).get(`/chat/${chatId}/messages?before=doesNotExist`).expect(404);

    await request(ctx.app).get(`/chat/${chatId}/messages?limit=500`).expect(400);
  });

  it('only lets chat members send messages', async () => {
    const chatId = await directChat(alice, bob);
    await request(ctx.app).post(`/chat/${chatId}/message/send`).send({ senderId: carol, text: 'hi' }).expect(403);
    await request(ctx.app).post(`/chat/${chatId}/message/send`).send({ senderId: alice, text: '   ' }).expect(400);
    await request(ctx.app)
      .post('/chat/00000000-0000-4000-8000-000000000000/message/send')
      .send({ senderId: alice, text: 'hi' })
      .expect(404);
  });
});

describe('read receipts', () => {
  it('records a read receipt per user and is idempotent', async () => {
    const chatId = await directChat(alice, bob);
    const msg = await send(chatId, alice, 'Read me');

    const first = (await request(ctx.app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: bob }).expect(200))
      .body as Message;
    expect(Object.keys(first.readBy)).toEqual([bob]);

    const second = (await request(ctx.app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: bob }).expect(200))
      .body as Message;
    expect(second.readBy[bob]).toBe(first.readBy[bob]);

    // The sender's own read is not recorded as a receipt.
    const own = (await request(ctx.app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: alice }).expect(200))
      .body as Message;
    expect(own.readBy[alice]).toBeUndefined();

    const page = (await request(ctx.app).get(`/chat/${chatId}/messages`)).body as MessagePage;
    expect(page.messages[0]?.readBy[bob]).toBe(first.readBy[bob]);
  });

  it('rejects unknown messages and non-members', async () => {
    const chatId = await directChat(alice, bob);
    const msg = await send(chatId, alice, 'hi');
    await request(ctx.app).post(`/chat/${chatId}/message/doesNotExist123/read`).send({ userId: bob }).expect(404);
    await request(ctx.app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: carol }).expect(403);
  });
});

describe('POST /chat/:chatId/lastseen', () => {
  it('tracks the last seen message per user and never moves backwards', async () => {
    const chatId = await directChat(alice, bob);
    const m1 = await send(chatId, alice, 'one');
    const m2 = await send(chatId, alice, 'two');

    const seen = (await request(ctx.app).post(`/chat/${chatId}/lastseen`).send({ userId: bob, messageId: m2.id }).expect(200))
      .body as LastSeen;
    expect(seen).toMatchObject({ chatId, userId: bob, messageId: m2.id, messageCreatedAt: m2.createdAt });

    const stale = (await request(ctx.app).post(`/chat/${chatId}/lastseen`).send({ userId: bob, messageId: m1.id }).expect(200))
      .body as LastSeen;
    expect(stale.messageId).toBe(m2.id);

    await request(ctx.app).post(`/chat/${chatId}/lastseen`).send({ userId: alice, messageId: m1.id }).expect(200);
    const all = (await request(ctx.app).get(`/chat/${chatId}/lastseen`).expect(200)).body as { lastSeen: LastSeen[] };
    expect(Object.fromEntries(all.lastSeen.map((s) => [s.userId, s.messageId]))).toEqual({ [alice]: m1.id, [bob]: m2.id });
  });

  it('rejects unknown messages and non-members', async () => {
    const chatId = await directChat(alice, bob);
    const msg = await send(chatId, alice, 'hi');
    await request(ctx.app).post(`/chat/${chatId}/lastseen`).send({ userId: bob, messageId: 'missing' }).expect(404);
    await request(ctx.app).post(`/chat/${chatId}/lastseen`).send({ userId: carol, messageId: msg.id }).expect(403);
  });
});

describe('GET /user/:userId/chats', () => {
  it('lists the chats a user belongs to with member ids, most recently active first', async () => {
    const ab = await directChat(alice, bob);
    const ac = await directChat(alice, carol);
    await directChat(bob, carol);
    await send(ab, alice, 'bump');

    const res = await request(ctx.app).get(`/user/${alice}/chats`).expect(200);
    const chats = res.body.chats as Chat[];
    expect(chats.map((c) => c.id)).toEqual([ab, ac]);
    expect(chats[0]?.members.map((m) => m.userId).sort()).toEqual([alice, bob].sort());

    await request(ctx.app).get('/user/00000000-0000-4000-8000-000000000000/chats').expect(404);
  });
});

describe('bonus: group chats', () => {
  it('creates a group and manages members with admin permissions', async () => {
    const created = await request(ctx.app)
      .post('/chat/group/create')
      .send({ creatorId: alice, name: 'Team', memberIds: [bob] })
      .expect(201);
    const chatId = created.body.chatId as string;
    expect((created.body.chat as Chat).members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: alice, role: 'admin' }),
        expect.objectContaining({ userId: bob, role: 'member' }),
      ]),
    );

    // Non-admins cannot add members or rename.
    await request(ctx.app).post(`/chat/${chatId}/members/add`).send({ requesterId: bob, userIds: [carol] }).expect(403);
    await request(ctx.app).patch(`/chat/${chatId}`).send({ requesterId: bob, name: 'X' }).expect(403);

    const added = await request(ctx.app)
      .post(`/chat/${chatId}/members/add`)
      .send({ requesterId: alice, userIds: [carol] })
      .expect(200);
    expect((added.body as Chat).members).toHaveLength(3);

    const renamed = await request(ctx.app).patch(`/chat/${chatId}`).send({ requesterId: alice, name: 'Core Team' }).expect(200);
    expect((renamed.body as Chat).name).toBe('Core Team');

    await send(chatId, carol, 'Hello team');

    // Members can't remove others, but can leave.
    await request(ctx.app).post(`/chat/${chatId}/members/remove`).send({ requesterId: bob, userId: carol }).expect(403);
    await request(ctx.app).post(`/chat/${chatId}/members/remove`).send({ requesterId: carol, userId: carol }).expect(200);
    await request(ctx.app).post(`/chat/${chatId}/message/send`).send({ senderId: carol, text: 'hi' }).expect(403);

    // When the last admin leaves, the longest-standing member is promoted.
    const afterLeave = await request(ctx.app)
      .post(`/chat/${chatId}/members/remove`)
      .send({ requesterId: alice, userId: alice })
      .expect(200);
    expect((afterLeave.body as Chat).members).toEqual([expect.objectContaining({ userId: bob, role: 'admin' })]);
  });

  it('does not allow group management on 1:1 chats', async () => {
    const chatId = await directChat(alice, bob);
    await request(ctx.app).post(`/chat/${chatId}/members/add`).send({ requesterId: alice, userIds: [carol] }).expect(400);
  });
});

describe('bonus: edit and delete messages', () => {
  it('lets the sender edit and soft-delete their own message', async () => {
    const chatId = await directChat(alice, bob);
    const msg = await send(chatId, alice, 'typo');

    await request(ctx.app).patch(`/chat/${chatId}/message/${msg.id}`).send({ senderId: bob, text: 'hacked' }).expect(403);

    const edited = (await request(ctx.app).patch(`/chat/${chatId}/message/${msg.id}`).send({ senderId: alice, text: 'fixed' }).expect(200))
      .body as Message;
    expect(edited).toMatchObject({ text: 'fixed', createdAt: msg.createdAt });
    expect(edited.editedAt).not.toBeNull();

    await request(ctx.app).delete(`/chat/${chatId}/message/${msg.id}`).send({ senderId: bob }).expect(403);
    const deleted = (await request(ctx.app).delete(`/chat/${chatId}/message/${msg.id}`).send({ senderId: alice }).expect(200))
      .body as Message;
    expect(deleted).toMatchObject({ text: '', createdAt: msg.createdAt });
    expect(deleted.deletedAt).not.toBeNull();

    await request(ctx.app).patch(`/chat/${chatId}/message/${msg.id}`).send({ senderId: alice, text: 'again' }).expect(400);
  });
});

describe('misc', () => {
  it('returns JSON 404 for unknown routes and 400 for malformed JSON', async () => {
    await request(ctx.app).get('/health').expect(200, { status: 'ok' });
    await request(ctx.app).get('/nope').expect(404);
    await request(ctx.app).post('/chat/create').set('Content-Type', 'application/json').send('{bad').expect(400);
  });
});
