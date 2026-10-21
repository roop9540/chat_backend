# Chat Backend — PostgreSQL + Firebase Firestore

A chat backend in **Node.js + TypeScript (strict)** that supports 1:1 chats, message sending with reliable ordering, read receipts, last-seen tracking, and, as bonus features, **group chats** and **message edit/delete**.

| Concern | Store | Why |
|---|---|---|
| Users, chats, chat membership | **PostgreSQL** | Relational data with integrity constraints (FKs, unique 1:1 pairs, roles) |
| Messages, read receipts, last seen | **Firebase Firestore** | High write volume, per-chat subcollections, real-time friendly |

---

## Quick start

**Prerequisites:** Node.js ≥ 22, PostgreSQL ≥ 13 (or Docker), and the Firebase CLI with Java for the Firestore emulator (`npm i -g firebase-tools`).

```bash
npm install
cp .env.example .env            # then edit values (see below)

# 1. PostgreSQL: use your own, or start one with Docker
docker compose up -d

# 2. Firestore: run the local emulator (or point at a real Firebase project)
npm run emulator                # in a separate terminal, listens on 127.0.0.1:8080

# 3. Create tables, optionally add sample users, and start the API
npm run db:migrate
npm run db:seed                 # prints 4 user ids you can use right away
npm run dev                     # http://localhost:3000
```

### Environment variables

| Variable | Description |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `FIREBASE_PROJECT_ID` | Firebase project id (any `demo-*` id works with the emulator) |
| `FIRESTORE_EMULATOR_HOST` | e.g. `127.0.0.1:8080` to use the local emulator |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to a service-account JSON, used for a real Firebase project |

For local development with the emulator:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/chat_backend
FIREBASE_PROJECT_ID=demo-chat-backend
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start with hot reload (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` and run the compiled server |
| `npm run typecheck` | Strict type check of source and tests |
| `npm run db:migrate` | Apply `db/schema.sql` (idempotent) |
| `npm run db:seed` | Insert sample users |
| `npm run emulator` | Start the Firestore emulator |
| `npm test` | Run integration tests (needs Postgres and a running emulator) |
| `npm run test:ci` | Start the emulator, run tests, stop the emulator |

Tests use the database in `TEST_DATABASE_URL` (default `postgres://localhost:5432/chat_backend_test`, which you create with `createdb chat_backend_test`). They **truncate its tables**, so never point it at real data.

---

## API

All request and response bodies are JSON. IDs for users and chats are UUIDs; message IDs are Firestore document IDs.

### Core endpoints (from the task)

#### 1. Create or get a 1:1 chat
`POST /chat/create`
```json
{ "userAId": "<uuid>", "userBId": "<uuid>" }
```
→ `201` if newly created, `200` if it already existed. Calling with the users in either order returns the same chat.
```json
{ "chatId": "<uuid>", "created": true, "chat": { "id": "...", "type": "direct", "members": [ ... ] } }
```

#### 2. Send a message
`POST /chat/:chatId/message/send`
```json
{ "senderId": "<uuid>", "text": "Hello!" }
```
→ `201` with the stored message (`createdAt` is the Firestore server timestamp). Only chat members can send. Text is trimmed and must be 1–4000 characters.

#### 3. Get messages
`GET /chat/:chatId/messages?limit=50[&before=<messageId>]`

Returns the latest `limit` messages (1–100, default 50) **in chronological order** (oldest → newest). For older history, pass the returned `nextCursor` as `before`.
```json
{
  "messages": [
    { "id": "H9Ez...", "chatId": "...", "senderId": "...", "text": "Hello!",
      "createdAt": "2026-10-21T07:42:19.158Z", "editedAt": null, "deletedAt": null,
      "readBy": { "<userId>": "2026-10-21T07:42:19.244Z" } }
  ],
  "nextCursor": null
}
```

#### 4. Mark a message as read
`POST /chat/:chatId/message/:messageId/read`
```json
{ "userId": "<uuid>" }
```
Writes `readBy.<userId>` = server timestamp on the message. The operation is idempotent: the first read time is kept. A sender reading their own message is a no-op.

#### 5. Update last seen message
`POST /chat/:chatId/lastseen`
```json
{ "userId": "<uuid>", "messageId": "<messageId>" }
```
Stores the user's last-seen pointer in `chats/{chatId}/lastSeen/{userId}`. The pointer **only moves forward**: if a client reports an older message after a newer one (for example, from out-of-order network requests), the newer one is kept.

`GET /chat/:chatId/lastseen` returns every member's pointer.

#### 6. List a user's chats
`GET /user/:userId/chats`

Returns every chat the user belongs to, with members and roles from PostgreSQL, ordered by most recent activity.

### Bonus endpoints

| Method & path | Body | Description |
|---|---|---|
| `POST /user/create` | `{ name }` | Create a user (helper for trying the API) |
| `POST /chat/group/create` | `{ creatorId, name, memberIds[] }` | Create a group; the creator becomes `admin` |
| `GET /chat/:chatId` | – | Chat details and members |
| `PATCH /chat/:chatId` | `{ requesterId, name }` | Rename a group (admin only) |
| `POST /chat/:chatId/members/add` | `{ requesterId, userIds[] }` | Add members (admin only) |
| `POST /chat/:chatId/members/remove` | `{ requesterId, userId }` | Admin removes a member, or a member leaves |
| `PATCH /chat/:chatId/message/:messageId` | `{ senderId, text }` | Edit your own message (sets `editedAt`) |
| `DELETE /chat/:chatId/message/:messageId` | `{ senderId }` | Soft-delete your own message (text cleared, `deletedAt` set) |
| `GET /health` | – | Liveness check |

### Errors

Every error uses the same shape:
```json
{ "error": { "code": "BAD_REQUEST", "message": "Validation failed",
             "details": [{ "field": "userAId", "message": "must be a valid UUID" }] } }
```
| Status | When |
|---|---|
| `400` | Invalid input, malformed JSON, a group operation on a 1:1 chat, editing a deleted message |
| `403` | The user is not a chat member, or lacks admin rights / message ownership |
| `404` | Unknown user, chat, message or route |

### Example session

```bash
API=http://localhost:3000
A=$(curl -s -XPOST $API/user/create -H 'Content-Type: application/json' -d '{"name":"Alice"}' | jq -r .id)
B=$(curl -s -XPOST $API/user/create -H 'Content-Type: application/json' -d '{"name":"Bob"}'   | jq -r .id)

CHAT=$(curl -s -XPOST $API/chat/create -H 'Content-Type: application/json' \
  -d "{\"userAId\":\"$A\",\"userBId\":\"$B\"}" | jq -r .chatId)

MSG=$(curl -s -XPOST $API/chat/$CHAT/message/send -H 'Content-Type: application/json' \
  -d "{\"senderId\":\"$A\",\"text\":\"Hi Bob\"}" | jq -r .id)

curl -s -XPOST $API/chat/$CHAT/message/$MSG/read -H 'Content-Type: application/json' -d "{\"userId\":\"$B\"}"
curl -s -XPOST $API/chat/$CHAT/lastseen -H 'Content-Type: application/json' -d "{\"userId\":\"$B\",\"messageId\":\"$MSG\"}"
curl -s "$API/chat/$CHAT/messages?limit=50" | jq
curl -s $API/user/$A/chats | jq
```

---

## Design

### Data model

**PostgreSQL** ([`db/schema.sql`](db/schema.sql))
```
users         (id uuid PK, name, created_at)
chats         (id uuid PK, type 'direct'|'group', name, created_by → users, direct_key UNIQUE, created_at, updated_at)
chat_members  (chat_id → chats, user_id → users, role 'admin'|'member', joined_at, PK(chat_id, user_id))
```

**Firestore**
```
chats/{chatId}/messages/{messageId}   { senderId, text, createdAt, editedAt, deletedAt, readBy: { [userId]: Timestamp } }
chats/{chatId}/lastSeen/{userId}      { messageId, messageCreatedAt, updatedAt }
```

### Key decisions

- **One 1:1 chat per pair, even under races.** A direct chat stores `direct_key = "<smallerId>:<largerId>"` with a `UNIQUE` constraint, and creation uses `INSERT … ON CONFLICT DO NOTHING`. Concurrent `POST /chat/create` calls for the same pair therefore return the same `chatId`; a test covers this.
- **Message ordering.** `createdAt` is the Firestore **server** timestamp, so client clocks can't affect order. Queries sort by `(createdAt, documentId)`, which makes ordering total and deterministic even if two messages share a timestamp. Sending is a single document write, so concurrent senders never contend on a shared counter document.
- **Cursor pagination.** `before=<messageId>` uses Firestore `startAfter(snapshot)` rather than offsets, so pages stay stable while new messages arrive. One extra document is fetched to compute `nextCursor` exactly, with no phantom empty last page.
- **Read receipts** are a map on the message document (`readBy.<userId>`), written in a transaction with a field path. One read returns the message together with who has read it, and marking is idempotent.
- **Last seen** is a separate document per (chat, user), updated in a transaction that refuses to move the pointer backwards.
- **Authorization.** Every write checks chat membership in PostgreSQL before touching Firestore. Group management needs the `admin` role, and edit/delete requires being the sender. If the last admin leaves a group, the longest-standing member is promoted.
- **Soft delete.** A deleted message keeps its place in history, with text cleared and `deletedAt` set, so read receipts and last-seen pointers stay valid.
- **Strict TypeScript.** `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on, and all input is validated with **zod** at the HTTP boundary.
- **Security rules.** `firestore.rules` denies all direct client access, since only this backend (Admin SDK) reads and writes.

### Project structure

```
src/
  index.ts                 server bootstrap and graceful shutdown
  app.ts                   express app factory (dependency-injected, used by tests)
  config/env.ts            env validation (zod)
  db/                      pg pool, transactions, migrate and seed scripts
  firebase/firestore.ts    Admin SDK initialisation (emulator or real project)
  repositories/
    chatRepository.ts      PostgreSQL: users, chats, members
    messageRepository.ts   Firestore: messages, read receipts, last seen
  services/chatService.ts  business rules and authorization
  routes/                  HTTP routes and request schemas
  middleware/              validation and error handling
tests/chat.test.ts         integration tests against real Postgres and the Firestore emulator
```

### Testing

The integration tests send real HTTP requests through the full stack (Express → service → PostgreSQL + Firestore emulator). They cover every endpoint, including idempotent and concurrent chat creation, message ordering under concurrent sends, pagination, read-receipt idempotency, last-seen monotonicity, group permissions, edit/delete, and validation and error responses.

```bash
npm run emulator   # terminal 1
npm test           # terminal 2
```

### Possible next steps

- Authentication (for example, Firebase Auth ID tokens) instead of passing user IDs in request bodies
- Real-time delivery over WebSockets, or clients subscribing to Firestore directly with security rules
- Unread counts, typing indicators, attachments and push notifications
