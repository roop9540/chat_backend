# Chat Backend API

A TypeScript backend for one-to-one and group conversations. It uses
PostgreSQL for relational entities and Firebase Firestore for chat
messages and conversation activity metadata.

## Technology Overview

  Component                Responsibility
  ------------------------ -------------------------------------------------
  Node.js and TypeScript   HTTP API and application logic
  Express                  Request routing
  PostgreSQL               Users, conversations, memberships, and roles
  Firebase Firestore       Messages, read receipts, and last-seen pointers
  Zod                      Request and environment validation
  Firestore Emulator       Local development and integration testing

## Requirements

Install or provide the following before running the service:

-   Node.js 22 or later
-   PostgreSQL 13 or later, or Docker
-   Firebase CLI
-   Java, required by the local Firestore Emulator

Install the Firebase CLI if needed:

``` bash
npm install --global firebase-tools
```

## Run Locally

1.  Install the project dependencies and prepare the environment file:

    ``` bash
    npm install
    cp .env.example .env
    ```

2.  Edit `.env` with the values for your local environment.

3.  Start PostgreSQL. If you use the included Docker Compose
    configuration:

    ``` bash
    docker compose up -d
    ```

4.  Start the Firestore Emulator in a separate terminal:

    ``` bash
    npm run emulator
    ```

    The local emulator is expected to listen on `127.0.0.1:8080`.

5.  Create the database schema and optional sample users:

    ``` bash
    npm run db:migrate
    npm run db:seed
    ```

    The seed command prints four user IDs for trying the API.

6.  Start the development server:

    ``` bash
    npm run dev
    ```

The API is available at `http://localhost:3000` by default.

## Configuration

Set these values in `.env`:

  -----------------------------------------------------------------------
  Variable                            Purpose
  ----------------------------------- -----------------------------------
  `PORT`                              HTTP listener port; defaults to
                                      `3000`

  `DATABASE_URL`                      PostgreSQL connection string

  `FIREBASE_PROJECT_ID`               Firebase project ID; a `demo-`
                                      project ID can be used with the
                                      emulator

  `FIRESTORE_EMULATOR_HOST`           Emulator address, for example
                                      `127.0.0.1:8080`

  `GOOGLE_APPLICATION_CREDENTIALS`    Path to a service-account JSON file
                                      when connecting to a real Firebase
                                      project
  -----------------------------------------------------------------------

Example local settings:

``` env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/chat_backend
FIREBASE_PROJECT_ID=demo-chat-backend
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
```

Do not commit real credentials or service-account files to version
control.

## Available npm Commands

  -----------------------------------------------------------------------
  Command                             Description
  ----------------------------------- -----------------------------------
  `npm run dev`                       Run the server with hot reload
                                      using `tsx`

  `npm run build`                     Compile the application into
                                      `dist/`

  `npm start`                         Run the compiled server

  `npm run typecheck`                 Check application and test types

  `npm run db:migrate`                Apply the SQL schema; safe to rerun

  `npm run db:seed`                   Add sample users

  `npm run emulator`                  Launch the Firestore Emulator

  `npm test`                          Run integration tests against
                                      PostgreSQL and the emulator

  `npm run test:ci`                   Start the emulator, execute tests,
                                      and stop the emulator
  -----------------------------------------------------------------------

Tests use `TEST_DATABASE_URL`. Its default is
`postgres://localhost:5432/chat_backend_test`; create that database
before running tests, for example with `createdb chat_backend_test`. The
test suite truncates tables in this database, so never configure it to
point at production or other valuable data.

## HTTP API

Requests and responses use JSON. User and chat identifiers are UUIDs;
message identifiers are Firestore document IDs.

### Core routes

#### Create or retrieve a direct conversation

`POST /chat/create`

Request:

``` json
{
  "userAId": "<uuid>",
  "userBId": "<uuid>"
}
```

Returns `201` when a conversation is created and `200` when the pair
already has one. The order of the two user IDs does not change which
conversation is returned.

Example response shape:

``` json
{
  "chatId": "<uuid>",
  "created": true,
  "chat": {
    "id": "<uuid>",
    "type": "direct",
    "members": []
  }
}
```

#### Send a message

`POST /chat/:chatId/message/send`

Request:

``` json
{
  "senderId": "<uuid>",
  "text": "Hello!"
}
```

Returns `201` with the saved message. The server assigns `createdAt`
using a Firestore server timestamp. Only members of the conversation can
send messages. Text is trimmed and must contain between 1 and 4000
characters.

#### Read message history

`GET /chat/:chatId/messages?limit=50[&before=<messageId>]`

The `limit` parameter accepts values from 1 to 100 and defaults to 50.
Results are returned from oldest to newest. Use the `nextCursor` value
as `before` to request an earlier page.

A message includes fields such as `id`, `chatId`, `senderId`, `text`,
`createdAt`, `editedAt`, `deletedAt`, and `readBy`.

#### Mark a message as read

`POST /chat/:chatId/message/:messageId/read`

Request:

``` json
{
  "userId": "<uuid>"
}
```

The reader's timestamp is recorded in the message's `readBy` map.
Repeating the operation does not replace the first read timestamp.
Marking your own message as read has no effect.

#### Update last-seen position

`POST /chat/:chatId/lastseen`

Request:

``` json
{
  "userId": "<uuid>",
  "messageId": "<messageId>"
}
```

The stored pointer represents the latest message seen by a user. Updates
cannot move it backwards if an older request arrives after a newer one.

`GET /chat/:chatId/lastseen` returns the members' last-seen pointers.

#### List conversations for a user

`GET /user/:userId/chats`

Returns conversations the user belongs to, including member and role
details from PostgreSQL, ordered by recent activity.

### Additional routes

  ------------------------------------------------------------------------------------------------------------------------------
  Method and path                             Request body                                               Purpose
  ------------------------------------------- ---------------------------------------------------------- -----------------------
  `POST /user/create`                         `{ "name": "..." }`                                        Create a user for
                                                                                                         development or API
                                                                                                         testing

  `POST /chat/group/create`                   `{ "creatorId": "...", "name": "...", "memberIds": [] }`   Create a group; the
                                                                                                         creator is an admin

  `GET /chat/:chatId`                         ---                                                        Retrieve chat details
                                                                                                         and members

  `PATCH /chat/:chatId`                       `{ "requesterId": "...", "name": "..." }`                  Rename a group; admin
                                                                                                         access required

  `POST /chat/:chatId/members/add`            `{ "requesterId": "...", "userIds": [] }`                  Add group members;
                                                                                                         admin access required

  `POST /chat/:chatId/members/remove`         `{ "requesterId": "...", "userId": "..." }`                Remove a member as
                                                                                                         admin, or leave the
                                                                                                         group

  `PATCH /chat/:chatId/message/:messageId`    `{ "senderId": "...", "text": "..." }`                     Edit your own message

  `DELETE /chat/:chatId/message/:messageId`   `{ "senderId": "..." }`                                    Soft-delete your own
                                                                                                         message

  `GET /health`                               ---                                                        Check whether the API
                                                                                                         is alive
  ------------------------------------------------------------------------------------------------------------------------------

### Error responses

Errors share a consistent structure:

``` json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Validation failed",
    "details": [
      {
        "field": "userAId",
        "message": "must be a valid UUID"
      }
    ]
  }
}
```

Common status codes:

  -----------------------------------------------------------------------
  Status                              Meaning
  ----------------------------------- -----------------------------------
  `400`                               Invalid input, malformed JSON,
                                      unsupported operation, or invalid
                                      message state

  `403`                               Caller is not a member, is not an
                                      admin, or does not own the message

  `404`                               Requested user, chat, message, or
                                      route was not found
  -----------------------------------------------------------------------

## Try the API

With the server running, you can create two users, open a direct chat,
send a message, and mark it as read. The following example uses `curl`
and `jq`:

``` bash
API=http://localhost:3000

A=$(curl -s -X POST "$API/user/create" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice"}' | jq -r .id)

B=$(curl -s -X POST "$API/user/create" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bob"}' | jq -r .id)

CHAT=$(curl -s -X POST "$API/chat/create" \
  -H 'Content-Type: application/json' \
  -d "{\"userAId\":\"$A\",\"userBId\":\"$B\"}" | jq -r .chatId)

MSG=$(curl -s -X POST "$API/chat/$CHAT/message/send" \
  -H 'Content-Type: application/json' \
  -d "{\"senderId\":\"$A\",\"text\":\"Hi Bob\"}" | jq -r .id)

curl -s -X POST "$API/chat/$CHAT/message/$MSG/read" \
  -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$B\"}"

curl -s "$API/chat/$CHAT/messages?limit=50" | jq
curl -s "$API/user/$A/chats" | jq
```

## Architecture Notes

### PostgreSQL data

The relational schema is defined in `db/schema.sql`.

-   `users`: UUID, name, creation timestamp
-   `chats`: UUID, type (`direct` or `group`), optional name, creator,
    unique direct-chat key, timestamps
-   `chat_members`: chat and user references, role (`admin` or
    `member`), join timestamp, composite primary key

### Firestore documents

Messages and activity metadata are stored in these paths:

``` text
chats/{chatId}/messages/{messageId}
chats/{chatId}/lastSeen/{userId}
```

Message documents contain sender, text, timestamps for
creation/edit/deletion, and a `readBy` map. Last-seen documents contain
the message pointer and timestamps.

### Implementation choices

-   **Avoid duplicate direct chats:** The application builds a stable
    key from the two user IDs and enforces uniqueness in PostgreSQL.
    `INSERT ... ON CONFLICT DO NOTHING` handles simultaneous create
    requests.
-   **Consistent message ordering:** Firestore server timestamps avoid
    reliance on client clocks. Queries use creation time plus document
    ID as a deterministic tie-breaker.
-   **Cursor-based history:** Pagination uses Firestore snapshots rather
    than offsets and fetches one extra record to determine whether
    another page exists.
-   **Idempotent read receipts:** A transaction preserves the first read
    timestamp for each user.
-   **Forward-only last-seen pointers:** A transaction prevents a user's
    pointer from moving to an older message.
-   **Authorization checks:** Membership is checked in PostgreSQL before
    Firestore writes. Group administration requires the admin role;
    editing and deleting messages requires sender ownership.
-   **Group admin continuity:** If the last administrator leaves, the
    longest-standing remaining member is promoted.
-   **Soft deletion:** Deletion clears message text and sets `deletedAt`
    without removing the document, preserving its place in the
    conversation history.
-   **Strict input validation:** TypeScript strict options are enabled,
    and Zod validates inputs at the HTTP boundary.
-   **Server-controlled Firestore access:** `firestore.rules` blocks
    direct client access; the backend accesses Firestore through the
    Admin SDK.

## Code Layout

``` text
src/
  index.ts                  # Server startup and graceful shutdown
  app.ts                    # Express app factory, also used by tests
  config/env.ts             # Environment validation
  db/                       # PostgreSQL pool, migrations, and seed scripts
  firebase/firestore.ts     # Firebase Admin SDK setup
  repositories/
    chatRepository.ts       # Users, chats, and memberships
    messageRepository.ts    # Messages, receipts, and last-seen data
  services/chatService.ts   # Application rules and authorization
  routes/                   # HTTP routes and request schemas
  middleware/               # Validation and error handling
tests/chat.test.ts          # Integration tests
```

## Run Tests

Start the emulator in one terminal:

``` bash
npm run emulator
```

Then run the test suite in another terminal:

``` bash
npm test
```

The integration tests exercise the HTTP stack and its PostgreSQL and
Firestore dependencies. Coverage includes concurrent direct-chat
creation, message ordering, pagination, read-receipt idempotency,
last-seen behavior, group permissions, editing/deleting messages,
validation, and error responses.

For CI, use:

``` bash
npm run test:ci
```

## Potential Improvements

Possible follow-on work includes adding Firebase Authentication token
verification, real-time message delivery with WebSockets, unread counts,
typing indicators, attachments, and push notifications.
