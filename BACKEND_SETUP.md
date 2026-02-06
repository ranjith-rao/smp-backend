# Backend Setup & Status

## ✅ Completed Setup

### Database & Seeding
- ✅ PostgreSQL database configured and synced with Prisma schema
- ✅ Admin user seeded: `admin@nexus.com` / `admin@nexus` (verified)
- ✅ Database schema:
  - `phone` field made optional (nullable) to allow registration without phone number
  - All required tables created and synced

### Authentication Endpoints
The backend now exposes three auth endpoints at `http://localhost:5000/api/auth`:

#### 1. **POST /register**
Registers a new user with email and password.

**Request:**
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"secure123"}'
```

**Response:**
```json
{
  "message": "Registered! Please check your email to verify."
}
```

**Note:** In development mode (no EMAIL_* env vars), a mock email sender logs verification details to the console instead of sending actual emails.

---

#### 2. **POST /login**
Logs in a user and returns a JWT token.

**Request:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@nexus.com","password":"admin@nexus"}'
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGUiOiJBRE1JTiIsImlhdCI6MTczODc4NTYxNiwiZXhwIjoxNzM4Nzg5MjE2fQ...."
}
```

**Verification requirement:** User must have verified their email (isVerified = true) to log in.

---

#### 3. **GET /verify**
Verifies an email address using a token.

**Request:**
```bash
curl http://localhost:5000/api/verify?token=<token_from_register>
```

**Response:**
```json
{
  "message": "Email verified successfully! You can now log in."
}
```

---

## Running the Backend

### Development Mode
```bash
npm run dev
```
This uses nodemon to auto-restart on file changes.

### Production Mode
```bash
node src/server.js
```

### Server Configuration
- **Port:** 5000 (configured in `.env` as `PORT=5000`)
- **Database:** PostgreSQL (connection via `DATABASE_URL` in `.env`)
- **JWT Secret:** `JWT_SECRET` in `.env` (replace with a strong secret in production)

---

## Environment Variables (.env)
Required for the backend to run:

```env
PORT=5000
DATABASE_URL="postgresql://user:password@localhost:5432/smp_database"
JWT_SECRET="change-this-to-a-strong-secret-for-production"

# Optional: Email configuration (comment out for dev mode)
# EMAIL_HOST=smtp.gmail.com
# EMAIL_PORT=587
# EMAIL_USER=your-email@gmail.com
# EMAIL_PASS=your-app-password
```

---

## Frontend Integration

### Register a new user
```javascript
const response = await fetch('http://localhost:5000/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'secure123',
    firstName: 'John',      // Optional
    lastName: 'Doe',        // Optional
    phone: '+1234567890'    // Optional
  })
});
const data = await response.json();
console.log(data.message); // "Registered! Please check your email to verify."
```

### Login and get JWT token
```javascript
const response = await fetch('http://localhost:5000/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@nexus.com',
    password: 'admin@nexus'
  })
});
const data = await response.json();
console.log(data.token); // JWT token to use for authenticated requests
localStorage.setItem('authToken', data.token); // Store for later use
```

### Using the JWT token in authenticated requests
```javascript
const token = localStorage.getItem('authToken');
const response = await fetch('http://localhost:5000/api/protected-route', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

---

## Known Issues & Solutions

### Issue: "Email not verified" error on login
**Cause:** New users must verify their email before logging in.

**Solution (dev):**
1. In development mode, check the server logs for the verification token (looks like a long hex string).
2. Call the verify endpoint: `GET http://localhost:5000/api/verify?token=<token>`
3. Then login with the verified account.

**Solution (production):**
1. Set up email configuration in `.env` with valid SMTP credentials.
2. Users will receive a verification link in their email.
3. They click the link to verify, then can log in.

---

## Code Structure

### Key Files:
- [src/controllers/authController.js](src/controllers/authController.js) - Auth routes (register, login, verify)
- [src/app.js](src/app.js) - Express app setup and middleware
- [src/server.js](src/server.js) - Server bootstrap
- [src/utils/mailer.js](src/utils/mailer.js) - Email service (dev-friendly with fallback)
- [prisma/schema.prisma](prisma/schema.prisma) - Database schema
- [prisma/seed.js](prisma/seed.js) - Database seeding script

---

## Next Steps

1. **Update JWT_SECRET** in `.env` to a strong random string for production.
2. **Set up SMTP** (Gmail, SendGrid, etc.) if you need real email verification.
3. **Configure CORS** in [src/app.js](src/app.js) to restrict to your frontend domain (replace `cors()` with `cors({ origin: 'http://localhost:5173' })` or your production domain).
4. **Add rate limiting** to prevent brute force attacks on auth endpoints.
5. **Implement password strength validation** in the register endpoint.
6. **Add tests** for auth endpoints using a testing framework like Jest or Vitest.

---

## Troubleshooting

### Server won't start
1. Check `.env` file exists with valid `DATABASE_URL`
2. Ensure PostgreSQL is running: `psql -U your_user -d smp_database`
3. Run migrations: `npx prisma db push`

### "Cannot connect to database" error
1. Verify DATABASE_URL in `.env` is correct
2. Check PostgreSQL is running on the configured host/port
3. Ensure the database exists: `createdb smp_database` (if not present)

### Auth endpoints return 500 error
1. Check server logs: `tail -f /tmp/backend.log` (or wherever you redirect logs)
2. Ensure `.env` variables are set correctly
3. Run `npx prisma db push` to sync schema

---

**Status:** ✅ Backend fully functional and ready for frontend integration
