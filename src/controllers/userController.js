const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { verifyToken, isAdmin } = require('../middleware/authMiddleware');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

router.use(verifyToken);
router.use(isAdmin);

router.get('/all', async (req, res) => {
  const { page = 1, limit = 10, search = '' } = req.query;
  const offset = (page - 1) * limit;

  try {
    // Search query
    const searchQuery = `%${search}%`;
    
    // Fetch users with pagination and search
    const users = await pool.query(
      `SELECT id, email, "firstName", "lastName", "isVerified", "isBlocked", "role" 
       FROM "User" 
       WHERE email ILIKE $1 OR "firstName" ILIKE $1 
       ORDER BY "createdAt" DESC 
       LIMIT $2 OFFSET $3`,
      [searchQuery, limit, offset]
    );

    const totalCount = await pool.query(
      `SELECT COUNT(*) FROM "User" WHERE email ILIKE $1`, 
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
router.patch('/:id/toggle-block', async (req, res) => {
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

module.exports = router;