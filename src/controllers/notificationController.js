const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const pool = require('../config/db');
const { mapNotificationRow, emitUnreadCount } = require('../services/notificationService');

router.get('/', verifyToken, async (req, res) => {
  const userId = Number(req.user.userId);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const cursor = req.query.cursor ? Number(req.query.cursor) : null;

  if (cursor && Number.isNaN(cursor)) {
    return res.status(400).json({ message: 'Invalid cursor' });
  }

  try {
    const values = [userId, limit + 1];
    let cursorClause = '';

    if (cursor) {
      values.push(cursor);
      cursorClause = 'AND n.id < $3';
    }

    const query = `SELECT n.id,
                          n."userId",
                          n."actorId",
                          n.type,
                          n.title,
                          n.body,
                          n."entityType",
                          n."entityId",
                          n."isRead",
                          n."createdAt",
                          n."readAt",
                          a."firstName" AS "actorFirstName",
                          a."lastName" AS "actorLastName",
                          a.username AS "actorUsername",
                          a."profileImageUrl" AS "actorProfileImageUrl"
                   FROM "Notification" n
                   LEFT JOIN "User" a ON a.id = n."actorId"
                   WHERE n."userId" = $1
                   ${cursorClause}
                   ORDER BY n.id DESC
                   LIMIT $2`;

    const result = await pool.query(query, values);
    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const notifications = rows.map(mapNotificationRow);
    const nextCursor = hasMore ? rows[rows.length - 1]?.id : null;

    return res.json({ notifications, nextCursor, hasMore });
  } catch (error) {
    console.error('Notifications list error:', error);
    return res.status(500).json({ message: 'Unable to fetch notifications.' });
  }
});

router.get('/unread-count', verifyToken, async (req, res) => {
  const userId = Number(req.user.userId);

  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM "Notification"
       WHERE "userId" = $1 AND "isRead" = false`,
      [userId]
    );

    return res.json({ unreadCount: Number(result.rows?.[0]?.count || 0) });
  } catch (error) {
    console.error('Unread notifications error:', error);
    return res.status(500).json({ message: 'Unable to fetch unread count.' });
  }
});

router.patch('/:id/read', verifyToken, async (req, res) => {
  const userId = Number(req.user.userId);
  const notificationId = Number(req.params.id);

  if (!notificationId || Number.isNaN(notificationId)) {
    return res.status(400).json({ message: 'Invalid notification id.' });
  }

  try {
    const result = await pool.query(
      `UPDATE "Notification"
       SET "isRead" = true,
           "readAt" = COALESCE("readAt", CURRENT_TIMESTAMP)
       WHERE id = $1 AND "userId" = $2
       RETURNING id, "isRead", "readAt"`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found.' });
    }

    const unreadCount = await emitUnreadCount(userId);
    return res.json({ success: true, unreadCount, notification: result.rows[0] });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return res.status(500).json({ message: 'Unable to mark notification as read.' });
  }
});

router.patch('/read-all', verifyToken, async (req, res) => {
  const userId = Number(req.user.userId);

  try {
    await pool.query(
      `UPDATE "Notification"
       SET "isRead" = true,
           "readAt" = COALESCE("readAt", CURRENT_TIMESTAMP)
       WHERE "userId" = $1 AND "isRead" = false`,
      [userId]
    );

    const unreadCount = await emitUnreadCount(userId);
    return res.json({ success: true, unreadCount });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ message: 'Unable to mark all notifications as read.' });
  }
});

module.exports = router;
