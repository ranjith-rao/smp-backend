# Frontend Integration Guide

This guide reflects the current backend behavior.

## Base URL

Default backend URL:

`http://localhost:5000`

## Auth Endpoints

### Register
**POST** `http://localhost:5000/api/auth/register`

Required request body:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "9000000099"
}
```

### Login
**POST** `http://localhost:5000/api/auth/login`

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

Success response:

```json
{
  "token": "<jwt-token>"
}
```

### Verify Email
**GET** `http://localhost:5000/api/auth/verify?token=<token>`

### Forgot / Reset Password
- **POST** `http://localhost:5000/api/auth/forgot-password`
- **POST** `http://localhost:5000/api/auth/reset-password`

## Token Usage

Include JWT in protected calls:

```http
Authorization: Bearer <token>
```

## Existing Frontend Auth Service

Use [src/services/authService.js](../smp-frontend/src/services/authService.js) in frontend.

Notes:
- stores token in `localStorage` as `token`
- exposes `register`, `login`, `logout`, `getToken`, `isLoggedIn`
- auto-logout on expired token checks

## API Config in Frontend

Configured in [src/config/api.js](../smp-frontend/src/config/api.js):

- `VITE_API_URL` from env, fallback `http://localhost:5000`

## Admin Test Account

- Email: `admin@nexus.com`
- Password: `admin@nexus`

## Demo User Accounts

All seeded demo users share password: `User@1234`

- `aisha.khan@nexus.com`
- `arjun.patel@nexus.com`
- `meera.iyer@nexus.com`
- `rohan.sharma@nexus.com`
- `sara.fernandez@nexus.com`
- `vivaan.mehta@nexus.com`
- `nina.dsouza@nexus.com`
- `kabir.verma@nexus.com`
- `priya.singh@nexus.com`
- `dev.kumar@nexus.com`

