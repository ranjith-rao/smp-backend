const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const pool = require('../config/db');
const {
  createNotification,
  getUserById,
  formatActorName,
} = require('../services/notificationService');

const FOLLOW_REQUEST_STATUS = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
};

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
         AND id NOT IN (
           SELECT "toUserId"
           FROM "FollowRequest"
           WHERE "fromUserId" = $2 AND status = 'PENDING'
         )
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
      `SELECT id, role, "isDeleted", "isBlocked"
       FROM "User"
       WHERE id = $1`,
      [id]
    );

    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const targetUser = userExists.rows[0];
    if (targetUser.role === 'ADMIN' || targetUser.isDeleted || targetUser.isBlocked) {
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

    // Create or re-open follow request (all user-user follows require approval)
    const existingRequest = await pool.query(
      `SELECT id, status
       FROM "FollowRequest"
       WHERE "fromUserId" = $1 AND "toUserId" = $2`,
      [followerId, id]
    );

    if (existingRequest.rows.length > 0) {
      const request = existingRequest.rows[0];
      if (request.status === FOLLOW_REQUEST_STATUS.PENDING) {
        return res.status(400).json({ message: 'Follow request already sent', status: 'REQUESTED' });
      }

      await pool.query(
        `UPDATE "FollowRequest"
         SET status = $3, "respondedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP
         WHERE id = $1 AND "fromUserId" = $2`,
        [request.id, followerId, FOLLOW_REQUEST_STATUS.PENDING]
      );
    } else {
      await pool.query(
        `INSERT INTO "FollowRequest" ("fromUserId", "toUserId", status)
         VALUES ($1, $2, $3)`,
        [followerId, id, FOLLOW_REQUEST_STATUS.PENDING]
      );
    }

    try {
      const actor = await getUserById(followerId);
      const actorName = formatActorName(actor) || 'Someone';

      await createNotification({
        userId: id,
        actorId: followerId,
        type: 'FOLLOW_REQUEST_RECEIVED',
        title: 'New follow request',
        body: `${actorName} sent you a follow request.`,
        entityType: 'user',
        entityId: Number(followerId),
      });
    } catch (notificationError) {
      console.error('Follow request notification error:', notificationError?.message || notificationError);
    }

    res.status(201).json({ success: true, status: 'REQUESTED', message: 'Follow request sent' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unfollow user
router.delete('/:id/follow', verifyToken, async (req, res) => {
  const { id } = req.params;
  const followerId = req.user.userId;

  try {
    const unfollowResult = await pool.query(
      `DELETE FROM "Follow" WHERE "followerId" = $1 AND "followingId" = $2 RETURNING id`,
      [followerId, id]
    );

    if (unfollowResult.rows.length > 0) {
      return res.json({ success: true, status: 'UNFOLLOWED', message: 'Successfully unfollowed user' });
    }

    const cancelResult = await pool.query(
      `UPDATE "FollowRequest"
       SET status = $3, "respondedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "fromUserId" = $1 AND "toUserId" = $2 AND status = $4
       RETURNING id`,
      [followerId, id, FOLLOW_REQUEST_STATUS.CANCELLED, FOLLOW_REQUEST_STATUS.PENDING]
    );

    if (cancelResult.rows.length > 0) {
      return res.json({ success: true, status: 'REQUEST_CANCELLED', message: 'Follow request cancelled' });
    }

    return res.status(404).json({ message: 'No follow or pending request found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get relationship with another user
router.get('/:id/relationship', verifyToken, async (req, res) => {
  const targetUserId = Number(req.params.id);
  const currentUserId = Number(req.user.userId);

  if (!targetUserId || Number.isNaN(targetUserId)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  if (targetUserId === currentUserId) {
    return res.json({ relationship: 'SELF' });
  }

  try {
    const followResult = await pool.query(
      `SELECT id FROM "Follow" WHERE "followerId" = $1 AND "followingId" = $2 LIMIT 1`,
      [currentUserId, targetUserId]
    );

    if (followResult.rows.length > 0) {
      return res.json({ relationship: 'FOLLOWING' });
    }

    const outgoingResult = await pool.query(
      `SELECT id FROM "FollowRequest"
       WHERE "fromUserId" = $1 AND "toUserId" = $2 AND status = $3
       LIMIT 1`,
      [currentUserId, targetUserId, FOLLOW_REQUEST_STATUS.PENDING]
    );

    if (outgoingResult.rows.length > 0) {
      return res.json({ relationship: 'REQUESTED', requestId: outgoingResult.rows[0].id });
    }

    const incomingResult = await pool.query(
      `SELECT id FROM "FollowRequest"
       WHERE "fromUserId" = $1 AND "toUserId" = $2 AND status = $3
       LIMIT 1`,
      [targetUserId, currentUserId, FOLLOW_REQUEST_STATUS.PENDING]
    );

    if (incomingResult.rows.length > 0) {
      return res.json({ relationship: 'INCOMING_REQUEST', requestId: incomingResult.rows[0].id });
    }

    return res.json({ relationship: 'NONE' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Incoming follow requests for current user
router.get('/follow-requests/incoming', verifyToken, async (req, res) => {
  const currentUserId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT
          fr.id,
          fr.status,
          fr."createdAt",
          fr."fromUserId",
          u."firstName",
          u."lastName",
          u.username,
          u.email,
          u."profileImageUrl"
       FROM "FollowRequest" fr
       JOIN "User" u ON u.id = fr."fromUserId"
       WHERE fr."toUserId" = $1
         AND fr.status = $2
         AND u."isDeleted" = false
         AND u."isBlocked" = false
         AND u.role != 'ADMIN'
       ORDER BY fr."createdAt" DESC`,
      [currentUserId, FOLLOW_REQUEST_STATUS.PENDING]
    );

    return res.json({ requests: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Outgoing follow requests for current user
router.get('/follow-requests/outgoing', verifyToken, async (req, res) => {
  const currentUserId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT
          fr.id,
          fr.status,
          fr."createdAt",
          fr."toUserId",
          u."firstName",
          u."lastName",
          u.username,
          u.email,
          u."profileImageUrl"
       FROM "FollowRequest" fr
       JOIN "User" u ON u.id = fr."toUserId"
       WHERE fr."fromUserId" = $1
         AND fr.status = $2
         AND u."isDeleted" = false
         AND u."isBlocked" = false
         AND u.role != 'ADMIN'
       ORDER BY fr."createdAt" DESC`,
      [currentUserId, FOLLOW_REQUEST_STATUS.PENDING]
    );

    return res.json({ requests: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Accept incoming follow request
router.patch('/follow-requests/:requestId/accept', verifyToken, async (req, res) => {
  const requestId = Number(req.params.requestId);
  const currentUserId = Number(req.user.userId);

  if (!requestId || Number.isNaN(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const requestResult = await client.query(
      `SELECT id, "fromUserId", "toUserId", status
       FROM "FollowRequest"
       WHERE id = $1 AND "toUserId" = $2
       FOR UPDATE`,
      [requestId, currentUserId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Follow request not found' });
    }

    const request = requestResult.rows[0];
    if (request.status !== FOLLOW_REQUEST_STATUS.PENDING) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Follow request is not pending' });
    }

    await client.query(
      `UPDATE "FollowRequest"
       SET status = $2, "respondedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [requestId, FOLLOW_REQUEST_STATUS.ACCEPTED]
    );

    await client.query(
      `INSERT INTO "Follow" ("followerId", "followingId")
       VALUES ($1, $2)
       ON CONFLICT ("followerId", "followingId") DO NOTHING`,
      [request.fromUserId, request.toUserId]
    );

    await client.query('COMMIT');

    try {
      const actor = await getUserById(currentUserId);
      const actorName = formatActorName(actor) || 'Someone';

      await createNotification({
        userId: request.fromUserId,
        actorId: currentUserId,
        type: 'FOLLOW_REQUEST_ACCEPTED',
        title: 'Follow request accepted',
        body: `${actorName} accepted your follow request.`,
        entityType: 'user',
        entityId: Number(currentUserId),
      });
    } catch (notificationError) {
      console.error('Follow accepted notification error:', notificationError?.message || notificationError);
    }

    return res.json({ success: true, status: 'ACCEPTED', message: 'Follow request accepted' });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Reject incoming follow request
router.patch('/follow-requests/:requestId/reject', verifyToken, async (req, res) => {
  const requestId = Number(req.params.requestId);
  const currentUserId = Number(req.user.userId);

  if (!requestId || Number.isNaN(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' });
  }

  try {
    const result = await pool.query(
      `UPDATE "FollowRequest"
       SET status = $3, "respondedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1 AND "toUserId" = $2 AND status = $4
       RETURNING id`,
      [requestId, currentUserId, FOLLOW_REQUEST_STATUS.REJECTED, FOLLOW_REQUEST_STATUS.PENDING]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Pending follow request not found' });
    }

    return res.json({ success: true, status: 'REJECTED', message: 'Follow request rejected' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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