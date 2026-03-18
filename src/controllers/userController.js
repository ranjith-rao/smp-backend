const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const pool = require('../config/db');

// ===== PUBLIC ROUTES (No authentication required) =====

// Protected: Search users by name or username
router.get('/search', verifyToken, async (req, res) => {
  const query = req.query.q || '';
  const userId = req.user.userId;

  try {
    let result;
    
    // If no query, return all users (for People on Nexus modal)
    if (!query.trim()) {
      result = await pool.query(
        `SELECT id, "firstName", "lastName", "username", "email", "profileImageUrl"
         FROM "User"
         WHERE "isVerified" = true
           AND "isBlocked" = false
           AND "isDeleted" = false
           AND role != 'ADMIN'
           AND id != $1
         ORDER BY "createdAt" DESC
         LIMIT 100`,
        [userId]
      );
    } else {
      const searchPattern = `%${query.toLowerCase()}%`;
      result = await pool.query(
        `SELECT id, "firstName", "lastName", "username", "email", "profileImageUrl"
         FROM "User"
         WHERE "isVerified" = true
           AND "isBlocked" = false
           AND "isDeleted" = false
           AND role != 'ADMIN'
           AND id != $2
           AND (
             LOWER("firstName") LIKE $1
             OR LOWER("lastName") LIKE $1
             OR LOWER("username") LIKE $1
             OR LOWER("email") LIKE $1
           )
         ORDER BY "createdAt" DESC
         LIMIT 10`,
        [searchPattern, userId]
      );
    }

    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Protected: New users for suggestions (exclude already followed)
router.get('/new/suggestions', verifyToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 12);
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT id, "firstName", "lastName", "username", "profileImageUrl", "createdAt", "role"
       FROM "User"
       WHERE "isVerified" = true
         AND "isBlocked" = false
         AND "isDeleted" = false
         AND role != 'ADMIN'
         AND id != $2
         AND id NOT IN (SELECT "followingId" FROM "Follow" WHERE "followerId" = $2)
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      [limit, userId]
    );

    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: New users for suggestions (no auth)
router.get('/new', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 200);

  try {
    const result = await pool.query(
      `SELECT id, "firstName", "lastName", "username", "profileImageUrl", "createdAt", "role"
       FROM "User"
       WHERE "isVerified" = true AND "isBlocked" = false AND "isDeleted" = false
       ORDER BY "createdAt" DESC
       LIMIT $1`,
      [limit]
    );

    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== PROTECTED ROUTES (Authentication required) =====

// Follow/Unfollow user
router.post('/:id/follow', verifyToken, async (req, res) => {
  const { id } = req.params;
  const followerId = req.user.userId;

  if (parseInt(followerId) === parseInt(id)) {
    return res.status(400).json({ message: 'You cannot follow yourself' });
  }

  try {
    // Check if target user exists
    const userExists = await pool.query(
      `SELECT id FROM "User" WHERE id = $1`,
      [id]
    );

    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already following
    const existingFollow = await pool.query(
      `SELECT id FROM "Follow" WHERE "followerId" = $1 AND "followingId" = $2`,
      [followerId, id]
    );

    if (existingFollow.rows.length > 0) {
      return res.status(400).json({ message: 'Already following this user' });
    }

    // Create follow relationship
    await pool.query(
      `INSERT INTO "Follow" ("followerId", "followingId") VALUES ($1, $2)`,
      [followerId, id]
    );

    res.status(201).json({ success: true, message: 'Successfully followed user' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unfollow user
router.delete('/:id/follow', verifyToken, async (req, res) => {
  const { id } = req.params;
  const followerId = req.user.userId;

  try {
    const result = await pool.query(
      `DELETE FROM "Follow" WHERE "followerId" = $1 AND "followingId" = $2 RETURNING id`,
      [followerId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Not following this user' });
    }

    res.json({ success: true, message: 'Successfully unfollowed user' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user's following list
router.get('/following/list', verifyToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT id, "firstName", "lastName", "username", "profileImageUrl"
       FROM "User"
       WHERE id IN (SELECT "followingId" FROM "Follow" WHERE "followerId" = $1)
       ORDER BY "firstName" ASC`,
      [userId]
    );

    res.json({ following: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current user's friends list (people the user follows)
router.get('/friends/list', verifyToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT u.id, u."firstName", u."lastName", u."username", u.email, u."profileImageUrl"
       FROM "User" u
       WHERE u.id IN (
         SELECT f."followingId"
         FROM "Follow" f
         WHERE f."followerId" = $1
       )
         AND u."isVerified" = true
         AND u."isBlocked" = false
         AND u."isDeleted" = false
         AND u.role != 'ADMIN'
       ORDER BY u."firstName" ASC, u."lastName" ASC`,
      [userId]
    );

    res.json({ friends: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== ADMIN-ONLY ROUTES (Require both authentication and admin role) =====

router.get('/all', verifyToken, isAdmin, async (req, res) => {
  const { page = 1, limit = 10, search = '' } = req.query;
  const offset = (page - 1) * limit;

  try {
    // Search query
    const searchQuery = `%${search}%`;
    
    // Fetch users with pagination and search (exclude deleted users)
    const users = await pool.query(
      `SELECT id, email, "firstName", "lastName", "username", "isVerified", "isBlocked", "role" 
       FROM "User" 
       WHERE (email ILIKE $1 OR "firstName" ILIKE $1) AND "isDeleted" = false
       ORDER BY "createdAt" DESC 
       LIMIT $2 OFFSET $3`,
      [searchQuery, limit, offset]
    );

    const totalCount = await pool.query(
      `SELECT COUNT(*) FROM "User" WHERE (email ILIKE $1) AND "isDeleted" = false`, 
      [searchQuery]
    );

    res.json({
      users: users.rows,
      totalPages: Math.ceil(totalCount.rows[0].count / limit),
      totalUsers: parseInt(totalCount.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Block/Unblock Toggle
router.patch('/:id/toggle-block', verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE "User" SET "isBlocked" = NOT "isBlocked" WHERE id = $1',
      [id]
    );
    res.json({ message: 'User status updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Soft Delete User
router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  const { id } = req.params;
  
  // Prevent deleting yourself
  if (parseInt(id) === req.user.userId) {
    return res.status(400).json({ message: 'Cannot delete your own account' });
  }

  try {
    // Soft delete by setting isDeleted = true
    const result = await pool.query(
      'UPDATE "User" SET "isDeleted" = true WHERE id = $1 AND "isDeleted" = false RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found or already deleted' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create User (Admin only)
router.post('/create', verifyToken, isAdmin, async (req, res) => {
  const { email, password, firstName, lastName, phone, role = 'USER' } = req.body;
  
  // Validate required fields
  if (!email || !password || !firstName || !lastName || !phone) {
    return res.status(400).json({ 
      message: 'email, password, firstName, lastName, and phone are required' 
    });
  }

  try {
    // Check if user already exists
    const exists = await pool.query('SELECT 1 FROM "User" WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      return res.status(409).json({ message: 'User with this email already exists' });
    }

    // Check if phone already exists
    const phoneExists = await pool.query('SELECT 1 FROM "User" WHERE phone = $1', [phone]);
    if (phoneExists.rows.length > 0) {
      return res.status(409).json({ message: 'User with this phone number already exists' });
    }

    const bcrypt = require('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with isVerified = true (admin-created accounts are auto-verified)
    const result = await pool.query(
      `INSERT INTO "User" ("email", "password", "firstName", "lastName", "phone", "role", "isVerified") 
       VALUES ($1, $2, $3, $4, $5, $6, true) 
       RETURNING id, email, "firstName", "lastName", phone, role, "isVerified"`,
      [email, hashedPassword, firstName, lastName, phone, role]
    );

    res.status(201).json({ 
      message: 'User created successfully', 
      user: result.rows[0] 
    });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ===== PUBLIC PROFILE ROUTE (Must be after protected routes to avoid route conflicts) =====

// Get user profile by ID (Public - accessible without auth)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, "firstName", "lastName", "username", email, "profileImageUrl", bio, "createdAt"
       FROM "User"
       WHERE id = $1 AND "isVerified" = true AND "isBlocked" = false AND "isDeleted" = false`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Get followers
    const followersResult = await pool.query(
      `SELECT id, "firstName", "lastName", "username" FROM "User"
       WHERE id IN (SELECT "followerId" FROM "Follow" WHERE "followingId" = $1)`,
      [id]
    );

    // Get following
    const followingResult = await pool.query(
      `SELECT id, "firstName", "lastName", "username" FROM "User"
       WHERE id IN (SELECT "followingId" FROM "Follow" WHERE "followerId" = $1)`,
      [id]
    );

    res.json({
      ...user,
      followers: followersResult.rows,
      following: followingResult.rows,
      followerCount: followersResult.rows.length,
      followingCount: followingResult.rows.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;