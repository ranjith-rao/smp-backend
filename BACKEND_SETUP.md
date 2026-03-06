# Backend Setup

Express + PostgreSQL backend for SMP.

## Core Modules

- Auth (`/api/auth`)
- Users (`/api/users`)
- Posts + moderation (`/api/posts`)
- Pages + page reports (`/api/pages`)
- Presence (`/api/presence`)
- Chats (`/api/chats`)

## Prerequisites

- Node.js 18+
- PostgreSQL running locally or remotely

## Install

```bash
npm install
```

## Environment Variables

Create `.env` in this folder:

```env
PORT=5000
DATABASE_URL="postgresql://user:password@localhost:5432/smp_database"
JWT_SECRET="replace-with-strong-secret"
FRONTEND_URL="http://localhost:5173"

# Optional SMTP (if omitted, verification/reset links are returned in API response in dev)
# EMAIL_HOST=smtp.gmail.com
# EMAIL_PORT=587
# EMAIL_USER=your@email.com
# EMAIL_PASS=app-password
```

## Database

Sync schema and seed demo data:

```bash
npx prisma db push
node prisma/seed.js
```

## Run

Development:

```bash
npm run dev
```

Production-like:

```bash
node src/server.js
```

Server defaults to `http://localhost:5000`.

## Auth API (Important)

### Register
`POST /api/auth/register`

Required fields:
- `email`
- `password`
- `firstName`
- `lastName`
- `phone`

### Login
`POST /api/auth/login`

Returns JWT (`expiresIn: 1h`).

### Verify Email
`GET /api/auth/verify?token=...`

### Forgot/Reset Password
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

