const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const socketService = require('../services/socketService');
const pool = require('../config/db');

// Get online status for multiple users
router.get('/status', verifyToken, async (req, res) => {
  try {
    const { userIds } = req.query;
    
    if (!userIds) {
      return res.status(400).json({ message: 'userIds query parameter required' });
    }

    const ids = userIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    
    if (ids.length === 0) {
      return res.json({ statuses: {} });
    }

    const statuses = {};
    
    for (const userId of ids) {
      statuses[userId] = {
        isOnline: socketService.isUserOnline(userId),
        userId
      };
    }

    // Get lastSeenAt for offline users
    const offlineIds = ids.filter(id => !statuses[id].isOnline);
    
    if (offlineIds.length > 0) {
      const result = await pool.query(
        `SELECT id, "lastSeenAt" FROM "User" WHERE id = ANY($1)`,
        [offlineIds]
      );
      
      result.rows.forEach(row => {
        if (statuses[row.id]) {
          statuses[row.id].lastSeenAt = row.lastSeenAt;
        }
      });
    }

    res.json({ statuses });
  } catch (error) {
    console.error('Error fetching presence status:', error);
    res.status(500).json({ message: 'Failed to fetch presence status' });
  }
});

// Get all online users
router.get('/online', verifyToken, async (req, res) => {
  try {
    const onlineUserIds = socketService.getOnlineUsers();
    res.json({ onlineUsers: onlineUserIds });
  } catch (error) {
    console.error('Error fetching online users:', error);
    res.status(500).json({ message: 'Failed to fetch online users' });
  }
});

module.exports = router;
