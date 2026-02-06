# Frontend Integration Guide

## Backend Auth Endpoints

Your frontend (`smp-frontend`) should call these endpoints:

### Register
**POST** `http://localhost:5000/api/auth/register`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "firstName": "John",
  "lastName": "Doe",
  "phone": "1234567890"
}
```

**Response (201):**
```json
{
  "message": "User registered successfully"
}
```

**Response (409):**
```json
{
  "message": "User already exists"
}
```

---

### Login
**POST** `http://localhost:5000/api/auth/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (400):**
```json
{
  "message": "Invalid credentials"
}
```

---

## Frontend Implementation Steps

### 1. Create an Auth Service (e.g., `src/services/authService.js`)

```javascript
const API_URL = 'http://localhost:5000/api/auth';

export const authService = {
  async register(email, password, firstName = '', lastName = '', phone = '') {
    const res = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, firstName, lastName, phone }),
    });
    return res.json();
  },

  async login(email, password) {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok && data.token) {
      localStorage.setItem('token', data.token);
    }
    return data;
  },

  logout() {
    localStorage.removeItem('token');
  },

  getToken() {
    return localStorage.getItem('token');
  },

  isLoggedIn() {
    return !!localStorage.getItem('token');
  },
};
```

### 2. Use in Login Component

```javascript
import { authService } from './services/authService';

// In your login handler:
async function handleLogin(email, password) {
  try {
    const data = await authService.login(email, password);
    if (data.token) {
      // Redirect to dashboard or home
      window.location.href = '/dashboard';
    } else {
      alert(data.message || 'Login failed');
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
```

### 3. Use in Register Component

```javascript
async function handleRegister(email, password, firstName, lastName) {
  try {
    const data = await authService.register(email, password, firstName, lastName);
    if (data.message.includes('successfully')) {
      alert('Registered! Now log in.');
      // Redirect to login
    } else {
      alert(data.message);
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}
```

### 4. Add Token to Protected Requests

When calling other APIs, include the token:

```javascript
const token = authService.getToken();
const res = await fetch('http://localhost:5000/api/posts', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
```

### 5. (Optional) Add Protected Route Guard

```javascript
function ProtectedRoute({ component: Component }) {
  return authService.isLoggedIn() ? <Component /> : <Navigate to="/login" />;
}
```

---

## Admin Account (Pre-seeded)

- **Email:** `admin@nexus.com`
- **Password:** `admin@nexus`
- **Verified:** Yes
- **Role:** ADMIN

Use this to test login.

---

## Notes

- **CORS:** Backend allows all origins by default. For production, restrict to your frontend domain in `src/app.js`.
- **JWT Token:** Stored in `localStorage`. Include it in `Authorization: Bearer <token>` header for protected routes.
- **Port:** Backend runs on `http://localhost:5000` (or your `PORT` env var).

