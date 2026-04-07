const pool = require('../config/db');
const socketService = require('./socketService');

const formatActorName = (actor) => {
  if (!actor) return null;
  const full = `${actor.firstName || ''} ${actor.lastName || ''}`.trim();
  if (full) return full;
  if (actor.username) return `@${actor.username}`;
  return null;
};

const mapNotificationRow = (row) => ({
  id: row.id,
  userId: row.userId,
  actorId: row.actorId,
  type: row.type,
  title: row.title,
  body: row.body,
  entityType: row.entityType,
  entityId: row.entityId,
  isRead: row.isRead,
  createdAt: row.createdAt,
  readAt: row.readAt,
  actor: row.actorId
    ? {
        id: row.actorId,
        firstName: row.actorFirstName,
        lastName: row.actorLastName,
        username: row.actorUsername,
        profileImageUrl: row.actorProfileImageUrl,
      }
    : null,
});

const getUserById = async (userId) => {
  const result = await pool.query(
    `SELECT id, "firstName", "lastName", username, "profileImageUrl"
     FROM "User"
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
};

const getUnreadCount = async (userId) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM "Notification"
     WHERE "userId" = $1 AND "isRead" = false`,
    [userId]
  );
  return Number(result.rows?.[0]?.count || 0);
};

const emitUnreadCount = async (userId) => {
  const unreadCount = await getUnreadCount(userId);
  socketService.emitToUser(userId, 'notification:unread-count', { unreadCount });
  return unreadCount;
};

const createNotification = async ({
  userId,
  actorId = null,
  type,
  title,
  body = '',
  entityType = null,
  entityId = null,
}) => {
  const recipientUserId = Number(userId);
  const actorUserId = actorId ? Number(actorId) : null;

  if (!recipientUserId || !type || !title) {
    return null;
  }

  if (actorUserId && actorUserId === recipientUserId && type !== 'SYSTEM') {
    return null;
  }

  const insertResult = await pool.query(
    `INSERT INTO "Notification" ("userId", "actorId", type, title, body, "entityType", "entityId")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [recipientUserId, actorUserId, type, title, body || null, entityType || null, entityId || null]
  );

  const notificationId = insertResult.rows[0]?.id;

  const result = await pool.query(
    `SELECT n.id,
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
     WHERE n.id = $1
     LIMIT 1`,
    [notificationId]
  );

  const notification = result.rows[0] ? mapNotificationRow(result.rows[0]) : null;

  if (notification) {
    socketService.emitToUser(recipientUserId, 'notification:new', notification);
    await emitUnreadCount(recipientUserId);
  }

  return notification;
};

module.exports = {
  mapNotificationRow,
  getUserById,
  getUnreadCount,
  emitUnreadCount,
  createNotification,
  formatActorName,
};
