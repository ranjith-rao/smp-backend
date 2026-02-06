const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const { sendVerificationEmail } = require('../utils/mailer');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Register with email + password
const crypto = require('crypto');

router.post('/register', async (req, res) => {
  const { email, password, firstName, lastName, phone } = req.body;
  
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

    console.error('Register params:', [email, hashedPassword, firstName, lastName, phone, 'USER', verificationToken]);

    await pool.query(
      'INSERT INTO "User" ("email","password","firstName","lastName","phone","role","isVerified","verificationToken") VALUES ($1,$2,$3,$4,$5,$6,false,$7)',
      [email, hashedPassword, firstName, lastName, phone, 'USER', verificationToken]
    );

    // 2. SEND EMAIL 
    await sendVerificationEmail(email, verificationToken);

    res.status(201).json({ message: 'Registered! Please check your email to verify.' });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ message: 'Registration failed' });
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

// Login with email + password
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'email and password required' });
  try {
    // 1. Fetch user AND the isVerified status
    const result = await pool.query(
      'SELECT id, password, role, "isVerified", "isBlocked" FROM "User" WHERE email = $1', 
      [email]
    );
    const user = result.rows[0];
    // 2. Check if user exists
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
   // 3. Check if user is blocked
    if (user.isBlocked) return res.status(403).json({ message: 'Your account has been suspended.' });
   // 4. Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });
    // 5. THE CRITICAL CHECK: Is the email verified?
    if (!user.isVerified) {
      return res.status(403).json({ 
        message: 'Email not verified. Please check your inbox for the verification link.' 
      });
    }
    // 6. Issue JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role }, 
      process.env.JWT_SECRET || 'change-me', 
      { expiresIn: '1h' }
    );
    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;

