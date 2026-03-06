const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/mailer');
const { verifyToken } = require('../middlewares/authMiddleware');
require('dotenv').config();

const pool = require('../config/db');

// Register with email + password

router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, phone } = req.body;
  const hasEmailConfig = !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
  
  // Validate required fields
  if (!email || !password || !firstName || !lastName || !phone) {
    return res.status(400).json({ 
      message: 'email, password, firstName, lastName, and phone are required' 
    });
  }
  
  try {
    const exists = await pool.query('SELECT 1 FROM "User" WHERE email = $1', [email]);
    if (exists.rows.length > 0) return res.status(409).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    // 1. Generate a random hex token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    await pool.query(
      'INSERT INTO "User" ("email","password","firstName","lastName","phone","role","isVerified","verificationToken") VALUES ($1,$2,$3,$4,$5,$6,false,$7)',
      [email, hashedPassword, firstName, lastName, phone, 'USER', verificationToken]
    );

    // 2. SEND EMAIL 
    await sendVerificationEmail(email, verificationToken);

    if (!hasEmailConfig) {
      const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/verify?token=${verificationToken}`;
      return res.status(201).json({ message: 'Registered! Please verify your email.', verifyUrl });
    }

    res.status(201).json({ message: 'Registered! Please check your email to verify.' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Registration failed' });
  }
});

// Request password reset
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: 'email is required' });
  const hasEmailConfig = !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);

  try {
    const result = await pool.query('SELECT id FROM "User" WHERE email = $1', [email]);
    if (result.rows.length > 0) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiry = new Date(Date.now() + 60 * 60 * 1000);

      await pool.query(
        'UPDATE "User" SET "resetToken" = $1, "resetTokenExpiry" = $2 WHERE email = $3',
        [resetToken, expiry, email]
      );

      await sendPasswordResetEmail(email, resetToken);

      if (!hasEmailConfig) {
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
        return res.json({ message: 'If an account exists for this email, a reset link has been sent.', resetUrl });
      }
    }

    res.json({ message: 'If an account exists for this email, a reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Unable to process request' });
  }
});

router.get('/verify', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ message: 'Token is required' });

  try {
    const result = await pool.query(
      'UPDATE "User" SET "isVerified" = true, "verificationToken" = NULL WHERE "verificationToken" = $1 RETURNING id',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    res.json({ message: 'Email verified successfully! You can now log in.' });
  } catch (error) {
    res.status(500).json({ message: 'Verification failed' });
  }
});

// Get current user profile
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, "firstName", "lastName", "username", "profileImageUrl", "bio", role FROM "User" WHERE id = $1 AND "isDeleted" = false',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch profile' });
  }
});

// Update current user profile
router.patch('/me', verifyToken, async (req, res) => {
  const { firstName, lastName, username, bio, profileImageUrl } = req.body;

  if (username && !/^[a-zA-Z0-9_.]{3,20}$/.test(username)) {
    return res.status(400).json({ message: 'Username must be 3-20 chars, letters/numbers/._ only.' });
  }

  try {
    const fields = [];
    const values = [];
    let idx = 1;

    if (firstName !== undefined) {
      fields.push(`"firstName" = $${idx++}`);
      values.push(firstName);
    }
    if (lastName !== undefined) {
      fields.push(`"lastName" = $${idx++}`);
      values.push(lastName);
    }
    if (username !== undefined) {
      fields.push(`"username" = $${idx++}`);
      values.push(username);
    }
    if (bio !== undefined) {
      fields.push(`"bio" = $${idx++}`);
      values.push(bio);
    }
    if (profileImageUrl !== undefined) {
      fields.push(`"profileImageUrl" = $${idx++}`);
      values.push(profileImageUrl);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'No profile fields provided' });
    }

    values.push(req.user.userId);
    const query = `UPDATE "User" SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, "firstName", "lastName", "username", "profileImageUrl", "bio", role`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Unable to update profile' });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ message: 'token and password required' });

  try {
    const result = await pool.query(
      'SELECT id FROM "User" WHERE "resetToken" = $1 AND "resetTokenExpiry" > NOW()',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE "User" SET "password" = $1, "resetToken" = NULL, "resetTokenExpiry" = NULL WHERE id = $2',
      [hashedPassword, result.rows[0].id]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Unable to reset password' });
  }
});

// Login with email + password
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'email and password required' });
  try {
    // 1. Fetch user AND the isVerified status
    const result = await pool.query(
      'SELECT id, password, role, "isVerified", "isBlocked", "isDeleted" FROM "User" WHERE email = $1', 
      [email]
    );
    const user = result.rows[0];
    // 2. Check if user exists
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
   // 3. Check if user is deleted
    if (user.isDeleted) return res.status(403).json({ message: 'This account has been deleted.' });
   // 4. Check if user is blocked
    if (user.isBlocked) return res.status(403).json({ message: 'Your account has been suspended.' });
   // 5. Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });
    // 6. THE CRITICAL CHECK: Is the email verified?
    if (!user.isVerified) {
      return res.status(403).json({ 
        message: 'Email not verified. Please check your inbox for the verification link.' 
      });
    }
    // 7. Issue JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role }, 
      process.env.JWT_SECRET, 
      { expiresIn: '1h' }
    );
    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

