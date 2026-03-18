const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { verifyToken } = require('../middlewares/authMiddleware');
const socketService = require('../services/socketService');

router.use(verifyToken);

const normalizeConversation = (row, currentUserId) => {
  const isDirect = row.type === 'DIRECT';
  const displayName = isDirect
    ? [row.otherFirstName, row.otherLastName].filter(Boolean).join(' ').trim() || row.otherUsername || 'Unknown user'
    : row.name || 'Unnamed group';

  return {
    id: row.id,
    type: row.type,
    name: displayName,
    rawName: row.name,
    myRole: row.myRole || null,
    isGroupOwner: row.type === 'GROUP' ? Number(row.createdById) === Number(currentUserId) : false,
    avatarUrl: isDirect ? row.otherProfileImageUrl : row.avatarUrl,
    otherUser: isDirect
      ? {
          id: row.otherUserId,
          firstName: row.otherFirstName,
          lastName: row.otherLastName,
          username: row.otherUsername,
          profileImageUrl: row.otherProfileImageUrl,
        }
      : null,
    unreadCount: row.unreadCount || 0,
    messageCount: Number(row.messageCount) || 0,
    lastMessageAt: row.lastMessageAt,
    lastMessage: row.lastMessageId
      ? {
          id: row.lastMessageId,
          text: row.lastMessageText,
          messageType: row.lastMessageType,
          createdAt: row.lastMessageCreatedAt,
          senderId: row.lastMessageSenderId,
          isMine: Number(row.lastMessageSenderId) === Number(currentUserId),
        }
      : null,
  };
};

const ensureParticipant = async (conversationId, userId) => {
  const membership = await pool.query(
    `SELECT id FROM "ConversationParticipant"
     WHERE "conversationId" = $1 AND "userId" = $2 AND "leftAt" IS NULL`,
    [conversationId, userId]
  );
  return membership.rows.length > 0;
};

router.get('/conversations', async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT c.id,
              c.type,
              c.name,
              c."avatarUrl",
              c."createdById",
              c."lastMessageAt",
              cp.role AS "myRole",
              cp."unreadCount",
              lm.id AS "lastMessageId",
              lm.text AS "lastMessageText",
              lm."messageType" AS "lastMessageType",
              lm."createdAt" AS "lastMessageCreatedAt",
              lm."senderId" AS "lastMessageSenderId",
              du."otherUserId",
              du."otherFirstName",
              du."otherLastName",
              du."otherUsername",
              du."otherProfileImageUrl",
              (SELECT COUNT(*) FROM "Message" WHERE "conversationId" = c.id) AS "messageCount"
       FROM "ConversationParticipant" cp
       JOIN "Conversation" c ON c.id = cp."conversationId"
       LEFT JOIN "Message" lm ON lm.id = c."lastMessageId"
       LEFT JOIN LATERAL (
         SELECT u.id AS "otherUserId",
                u."firstName" AS "otherFirstName",
                u."lastName" AS "otherLastName",
                u.username AS "otherUsername",
                u."profileImageUrl" AS "otherProfileImageUrl"
         FROM "ConversationParticipant" cp2
         JOIN "User" u ON u.id = cp2."userId"
         WHERE cp2."conversationId" = c.id
           AND cp2."userId" != $1
           AND cp2."leftAt" IS NULL
           AND u.role != 'ADMIN'
         ORDER BY cp2.id ASC
         LIMIT 1
       ) du ON c.type = 'DIRECT'
       WHERE cp."userId" = $1
         AND cp."leftAt" IS NULL
       ORDER BY c."lastMessageAt" DESC, c.id DESC`,
      [userId]
    );

    const conversations = result.rows.map((row) => normalizeConversation(row, userId));
    const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    res.json({ conversations, unreadTotal });
  } catch (error) {
    console.error('Conversations fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch conversations' });
  }
});

router.get('/search', async (req, res) => {
  const userId = req.user.userId;
  const q = (req.query.q || '').toString().trim().toLowerCase();

  if (!q) {
    return res.json({ users: [], groups: [] });
  }

  try {
    const pattern = `%${q}%`;

    const [usersResult, groupsResult] = await Promise.all([
      pool.query(
        `SELECT id, "firstName", "lastName", username, "profileImageUrl"
         FROM "User"
         WHERE id != $2
           AND "isVerified" = true
           AND "isBlocked" = false
           AND "isDeleted" = false
           AND role != 'ADMIN'
           AND (
             LOWER("firstName") LIKE $1 OR
             LOWER("lastName") LIKE $1 OR
             LOWER(COALESCE(username, '')) LIKE $1
           )
         ORDER BY "firstName" ASC
         LIMIT 15`,
        [pattern, userId]
      ),
      pool.query(
        `SELECT c.id, c.name, c."avatarUrl", c."lastMessageAt"
         FROM "ConversationParticipant" cp
         JOIN "Conversation" c ON c.id = cp."conversationId"
         WHERE cp."userId" = $2
           AND cp."leftAt" IS NULL
           AND c.type = 'GROUP'
           AND LOWER(COALESCE(c.name, '')) LIKE $1
         ORDER BY c."lastMessageAt" DESC
         LIMIT 15`,
        [pattern, userId]
      ),
    ]);

    res.json({
      users: usersResult.rows,
      groups: groupsResult.rows,
    });
  } catch (error) {
    console.error('Chat search error:', error);
    res.status(500).json({ message: 'Unable to search chats' });
  }
});

router.post('/conversations/direct', async (req, res) => {
  const currentUserId = req.user.userId;
  const targetUserId = Number(req.body.userId);

  if (!targetUserId || targetUserId === Number(currentUserId)) {
    return res.status(400).json({ message: 'Valid target user is required' });
  }

  // Verify target user exists and is not an admin
  try {
    const userCheck = await pool.query(
      `SELECT role FROM "User" WHERE id = $1`,
      [targetUserId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (userCheck.rows[0].role === 'ADMIN') {
      return res.status(403).json({ message: 'Cannot chat with admin users' });
    }
  } catch (error) {
    console.error('User validation error:', error);
    return res.status(500).json({ message: 'Unable to validate user' });
  }

  const a = Math.min(Number(currentUserId), targetUserId);
  const b = Math.max(Number(currentUserId), targetUserId);
  const directKey = `${a}:${b}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM "Conversation" WHERE "directKey" = $1 LIMIT 1`,
      [directKey]
    );

    let conversationId;

    if (existing.rows.length > 0) {
      conversationId = existing.rows[0].id;
    } else {
      const conversationResult = await client.query(
        `INSERT INTO "Conversation" (type, "directKey", "createdById", "lastMessageAt", "updatedAt")
         VALUES ('DIRECT', $1, $2, NOW(), NOW())
         RETURNING id`,
        [directKey, currentUserId]
      );

      conversationId = conversationResult.rows[0].id;

      await client.query(
        `INSERT INTO "ConversationParticipant" ("conversationId", "userId", role)
         VALUES ($1, $2, 'MEMBER'), ($1, $3, 'MEMBER')
         ON CONFLICT ("conversationId", "userId") DO NOTHING`,
        [conversationId, currentUserId, targetUserId]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({ conversationId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create direct conversation error:', error);
    res.status(500).json({ message: 'Unable to create conversation' });
  } finally {
    client.release();
  }
});

router.post('/conversations/group', async (req, res) => {
  const currentUserId = req.user.userId;
  const name = (req.body.name || '').toString().trim();
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number) : [];
  const avatarUrl = (req.body.avatarUrl || '').toString().trim() || null;

  if (!name || name.length < 2) {
    return res.status(400).json({ message: 'Group name must be at least 2 characters' });
  }

  const uniqueMembers = [...new Set(memberIds.filter((id) => id && id !== Number(currentUserId)))];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const conversationResult = await client.query(
      `INSERT INTO "Conversation" (type, name, "avatarUrl", "profileImageUrl", "createdById", "lastMessageAt", "updatedAt")
       VALUES ('GROUP', $1, $2, $2, $3, NOW(), NOW())
       RETURNING id`,
      [name, avatarUrl, currentUserId]
    );

    const conversationId = conversationResult.rows[0].id;

    await client.query(
      `INSERT INTO "ConversationParticipant" ("conversationId", "userId", role)
       VALUES ($1, $2, 'OWNER')`,
      [conversationId, currentUserId]
    );

    if (uniqueMembers.length > 0) {
      for (const memberId of uniqueMembers) {
        await client.query(
          `INSERT INTO "ConversationParticipant" ("conversationId", "userId", role)
           VALUES ($1, $2, 'MEMBER')
           ON CONFLICT ("conversationId", "userId") DO NOTHING`,
          [conversationId, memberId]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ conversationId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create group conversation error:', error);
    res.status(500).json({ message: 'Unable to create group' });
  } finally {
    client.release();
  }
});

router.get('/conversations/:conversationId/members', async (req, res) => {
  const currentUserId = Number(req.user.userId);
  const conversationId = Number(req.params.conversationId);

  try {
    const isParticipant = await ensureParticipant(conversationId, currentUserId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    const result = await pool.query(
      `SELECT 
         u.id,
         u."firstName",
         u."lastName",
         u.username,
         u."profileImageUrl",
         cp.role,
         cp."joinedAt"
       FROM "ConversationParticipant" cp
       JOIN "User" u ON u.id = cp."userId"
       WHERE cp."conversationId" = $1
         AND cp."leftAt" IS NULL
       ORDER BY cp.role DESC, cp."joinedAt" ASC`,
      [conversationId]
    );

    const members = result.rows.map(row => ({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      username: row.username,
      profileImageUrl: row.profileImageUrl,
      role: row.role,
      joinedAt: row.joinedAt,
    }));

    res.json({ members });
  } catch (error) {
    console.error('Get group members error:', error);
    res.status(500).json({ message: 'Unable to fetch members' });
  }
});

router.post('/conversations/:conversationId/members', async (req, res) => {
  const currentUserId = Number(req.user.userId);
  const conversationId = Number(req.params.conversationId);
  const memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number) : [];

  if (!conversationId) {
    return res.status(400).json({ message: 'Valid conversationId is required' });
  }

  const uniqueMembers = [...new Set(memberIds.filter((id) => id && id !== currentUserId))];
  if (uniqueMembers.length === 0) {
    return res.status(400).json({ message: 'At least one member is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const conversationCheck = await client.query(
      `SELECT c.id, c.type, c."createdById", cp.role
       FROM "Conversation" c
       JOIN "ConversationParticipant" cp ON cp."conversationId" = c.id
       WHERE c.id = $1
         AND cp."userId" = $2
         AND cp."leftAt" IS NULL
       LIMIT 1`,
      [conversationId, currentUserId]
    );

    if (conversationCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    const conversation = conversationCheck.rows[0];
    if (conversation.type !== 'GROUP') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Members can only be added to group chats' });
    }

    const isOwner = Number(conversation.createdById) === currentUserId || conversation.role === 'OWNER';
    if (!isOwner) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Only group owner can add members' });
    }

    const validUsersResult = await client.query(
      `SELECT id
       FROM "User"
       WHERE id = ANY($1::int[])
         AND role != 'ADMIN'
         AND "isVerified" = true
         AND "isBlocked" = false
         AND "isDeleted" = false`,
      [uniqueMembers]
    );

    const validUserIds = validUsersResult.rows.map((row) => Number(row.id));
    if (validUserIds.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No valid users to add' });
    }

    const addedUserIds = [];
    for (const memberId of validUserIds) {
      const insertResult = await client.query(
        `INSERT INTO "ConversationParticipant" ("conversationId", "userId", role, "leftAt")
         VALUES ($1, $2, 'MEMBER', NULL)
         ON CONFLICT ("conversationId", "userId") DO UPDATE
         SET "leftAt" = NULL
         RETURNING "userId"`,
        [conversationId, memberId]
      );

      if (insertResult.rows.length > 0) {
        addedUserIds.push(Number(insertResult.rows[0].userId));
      }
    }

    await client.query('COMMIT');

    const participants = await pool.query(
      `SELECT "userId" FROM "ConversationParticipant"
       WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    participants.rows.forEach(({ userId }) => {
      socketService.emitToUser(userId, 'chat:conversation-updated', { conversationId });
    });

    res.json({
      success: true,
      conversationId,
      addedCount: addedUserIds.length,
      addedUserIds,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Add group members error:', error);
    res.status(500).json({ message: 'Unable to add members' });
  } finally {
    client.release();
  }
});

router.delete('/conversations/:conversationId/members/:memberId', async (req, res) => {
  const currentUserId = Number(req.user.userId);
  const conversationId = Number(req.params.conversationId);
  const memberId = Number(req.params.memberId);

  if (!conversationId || !memberId) {
    return res.status(400).json({ message: 'Valid conversationId and memberId are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actorCheck = await client.query(
      `SELECT c.id, c.type, c."createdById", cp.role
       FROM "Conversation" c
       JOIN "ConversationParticipant" cp ON cp."conversationId" = c.id
       WHERE c.id = $1
         AND cp."userId" = $2
         AND cp."leftAt" IS NULL
       LIMIT 1`,
      [conversationId, currentUserId]
    );

    if (actorCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    const actor = actorCheck.rows[0];
    if (actor.type !== 'GROUP') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Members can only be removed from group chats' });
    }

    const isOwner = Number(actor.createdById) === currentUserId || actor.role === 'OWNER';
    const isAdmin = actor.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Only group owner or admin can remove members' });
    }

    if (memberId === currentUserId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Use leave action to remove yourself' });
    }

    const targetCheck = await client.query(
      `SELECT "userId", role
       FROM "ConversationParticipant"
       WHERE "conversationId" = $1
         AND "userId" = $2
         AND "leftAt" IS NULL
       LIMIT 1`,
      [conversationId, memberId]
    );

    if (targetCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Member not found in this group' });
    }

    const target = targetCheck.rows[0];
    const targetIsOwner = Number(actor.createdById) === Number(target.userId) || target.role === 'OWNER';
    if (targetIsOwner) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Group owner cannot be removed' });
    }

    if (isAdmin && target.role === 'ADMIN') {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Admins cannot remove other admins' });
    }

    await client.query(
      `UPDATE "ConversationParticipant"
       SET "leftAt" = NOW(),
           "unreadCount" = 0,
           "lastReadMessageId" = NULL
       WHERE "conversationId" = $1
         AND "userId" = $2
         AND "leftAt" IS NULL`,
      [conversationId, memberId]
    );

    await client.query('COMMIT');

    const participants = await pool.query(
      `SELECT "userId" FROM "ConversationParticipant"
       WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    participants.rows.forEach(({ userId }) => {
      socketService.emitToUser(userId, 'chat:conversation-updated', { conversationId });
    });
    socketService.emitToUser(memberId, 'chat:conversation-updated', { conversationId });

    res.json({ success: true, conversationId, removedUserId: memberId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Remove group member error:', error);
    res.status(500).json({ message: 'Unable to remove member' });
  } finally {
    client.release();
  }
});

router.get('/conversations/:conversationId/messages', async (req, res) => {
  const userId = req.user.userId;
  const conversationId = Number(req.params.conversationId);
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  try {
    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    const result = await pool.query(
      `SELECT m.id,
              m.text,
              m."messageType",
              m."senderId",
              m."createdAt",
              m."isRead",
              m."readAt",
              u."firstName",
              u."lastName",
              u.username,
              u."profileImageUrl",
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', ma.id,
                    'fileName', ma."fileName",
                    'mimeType', ma."mimeType",
                    'sizeBytes', ma."sizeBytes",
                    'url', ma.url,
                    'thumbnailUrl', ma."thumbnailUrl"
                  )
                ) FILTER (WHERE ma.id IS NOT NULL),
                '[]'
              ) AS attachments
       FROM "Message" m
       JOIN "User" u ON u.id = m."senderId"
       LEFT JOIN "MessageAttachment" ma ON ma."messageId" = m.id
       WHERE m."conversationId" = $1
         AND m."isDeletedForEveryone" = false
       GROUP BY m.id, u.id
       ORDER BY m."createdAt" DESC
       LIMIT $2`,
      [conversationId, limit]
    );

    const messages = result.rows.reverse().map((row) => ({
      id: row.id,
      text: row.text,
      messageType: row.messageType,
      senderId: row.senderId,
      createdAt: row.createdAt,
      isRead: row.isRead,
      readAt: row.readAt,
      sender: {
        id: row.senderId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
      attachments: row.attachments || [],
    }));

    res.json({ messages });
  } catch (error) {
    console.error('Fetch messages error:', error);
    res.status(500).json({ message: 'Unable to fetch messages' });
  }
});

router.post('/conversations/:conversationId/messages', async (req, res) => {
  const senderId = req.user.userId;
  const conversationId = Number(req.params.conversationId);
  const text = (req.body.text || '').toString().trim();
  const attachments = Array.isArray(req.body.attachments) ? req.body.attachments : [];

  if (!text && attachments.length === 0) {
    return res.status(400).json({ message: 'Message text or attachment is required' });
  }

  const messageType = attachments.length > 0
    ? (attachments[0].mimeType || '').startsWith('image/') ? 'IMAGE' : 'FILE'
    : 'TEXT';

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const isParticipant = await ensureParticipant(conversationId, senderId);
    if (!isParticipant) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    const messageResult = await client.query(
      `INSERT INTO "Message" ("conversationId", "senderId", text, "messageType", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, text, "messageType", "senderId", "createdAt", "isRead", "readAt"`,
      [conversationId, senderId, text || null, messageType]
    );

    const message = messageResult.rows[0];

    const insertedAttachments = [];
    for (const attachment of attachments.slice(0, 5)) {
      const fileName = (attachment.fileName || 'file').toString().slice(0, 255);
      const mimeType = (attachment.mimeType || 'application/octet-stream').toString().slice(0, 120);
      const sizeBytes = Number(attachment.sizeBytes) || 0;
      const url = (attachment.url || '').toString();
      const thumbnailUrl = attachment.thumbnailUrl ? attachment.thumbnailUrl.toString() : null;

      if (!url) continue;

      const insertAttachment = await client.query(
        `INSERT INTO "MessageAttachment" ("messageId", "fileName", "mimeType", "sizeBytes", url, "thumbnailUrl")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, "fileName", "mimeType", "sizeBytes", url, "thumbnailUrl"`,
        [message.id, fileName, mimeType, sizeBytes, url, thumbnailUrl]
      );

      insertedAttachments.push(insertAttachment.rows[0]);
    }

    await client.query(
      `UPDATE "Conversation"
       SET "lastMessageId" = $1,
           "lastMessageAt" = NOW(),
           "updatedAt" = NOW()
       WHERE id = $2`,
      [message.id, conversationId]
    );

    await client.query(
      `UPDATE "ConversationParticipant"
       SET "unreadCount" = "unreadCount" + 1
       WHERE "conversationId" = $1
         AND "userId" != $2
         AND "leftAt" IS NULL`,
      [conversationId, senderId]
    );

    const participants = await client.query(
      `SELECT "userId" FROM "ConversationParticipant"
       WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    const senderResult = await client.query(
      `SELECT id, "firstName", "lastName", username, "profileImageUrl"
       FROM "User" WHERE id = $1`,
      [senderId]
    );

    await client.query('COMMIT');

    const payload = {
      id: message.id,
      conversationId,
      text: message.text,
      messageType: message.messageType,
      senderId: message.senderId,
      createdAt: message.createdAt,
      isRead: message.isRead,
      readAt: message.readAt,
      sender: senderResult.rows[0],
      attachments: insertedAttachments,
    };

    participants.rows.forEach(({ userId }) => {
      socketService.emitToUser(userId, 'chat:message', payload);
      socketService.emitToUser(userId, 'chat:conversation-updated', { conversationId });
    });

    res.status(201).json({ message: payload });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Unable to send message' });
  } finally {
    client.release();
  }
});

router.post('/conversations/:conversationId/read', async (req, res) => {
  const userId = req.user.userId;
  const conversationId = Number(req.params.conversationId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    await client.query(
      `UPDATE "Message"
       SET "isRead" = true,
           "readAt" = NOW()
       WHERE "conversationId" = $1
         AND "senderId" != $2
         AND "isRead" = false`,
      [conversationId, userId]
    );

    const latestMessage = await client.query(
      `SELECT id FROM "Message"
       WHERE "conversationId" = $1
       ORDER BY id DESC
       LIMIT 1`,
      [conversationId]
    );

    await client.query(
      `UPDATE "ConversationParticipant"
       SET "unreadCount" = 0,
           "lastReadMessageId" = $3
       WHERE "conversationId" = $1
         AND "userId" = $2`,
      [conversationId, userId, latestMessage.rows[0]?.id || null]
    );

    await client.query('COMMIT');

    socketService.emitToUser(userId, 'chat:conversation-updated', { conversationId });

    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Mark read error:', error);
    res.status(500).json({ message: 'Unable to mark messages as read' });
  } finally {
    client.release();
  }
});

// Delete a message
router.delete('/conversations/:conversationId/messages/:messageId', async (req, res) => {
  const userId = req.user.userId;
  const { conversationId, messageId } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify user is participant
    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    // Verify user is message sender
    const messageCheck = await client.query(
      `SELECT "senderId" FROM "Message" WHERE id = $1 AND "conversationId" = $2`,
      [messageId, conversationId]
    );

    if (messageCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Message not found' });
    }

    if (Number(messageCheck.rows[0].senderId) !== Number(userId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'You can only delete your own messages' });
    }

    // Delete message
    await client.query(
      `DELETE FROM "Message" WHERE id = $1`,
      [messageId]
    );

    await client.query('COMMIT');

    // Notify all participants
    const participants = await pool.query(
      `SELECT "userId" FROM "ConversationParticipant"
       WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    participants.rows.forEach(({ userId: participantId }) => {
      socketService.emitToUser(participantId, 'chat:message-deleted', { messageId, conversationId });
    });

    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete message error:', error);
    res.status(500).json({ message: 'Unable to delete message' });
  } finally {
    client.release();
  }
});

// Update group name
router.put('/conversations/:conversationId/name', async (req, res) => {
  const userId = Number(req.user.userId);
  const conversationId = Number(req.params.conversationId);
  const { groupName } = req.body;

  if (!groupName || typeof groupName !== 'string' || groupName.trim().length === 0) {
    return res.status(400).json({ message: 'Group name is required' });
  }

  if (groupName.trim().length > 100) {
    return res.status(400).json({ message: 'Group name must be 100 characters or less' });
  }

  try {
    const convCheck = await pool.query(
      `SELECT "createdById", type FROM "Conversation" WHERE id = $1`,
      [conversationId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const conversation = convCheck.rows[0];
    if (conversation.type !== 'GROUP') {
      return res.status(400).json({ message: 'Can only update group names' });
    }

    const isOwner = Number(conversation.createdById) === userId;
    if (!isOwner) {
      return res.status(403).json({ message: 'Only group owner can change name' });
    }

    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Not a participant of this group' });
    }

    await pool.query(
      `UPDATE "Conversation" SET name = $1, "groupName" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [groupName.trim(), conversationId]
    );

    const participants = await pool.query(
      `SELECT "userId" FROM "ConversationParticipant" WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    participants.rows.forEach(({ userId: participantId }) => {
      socketService.emitToUser(participantId, 'chat:conversation-updated', {
        conversationId,
        changes: { name: groupName.trim(), groupName: groupName.trim() }
      });
    });

    res.json({ success: true, message: 'Group name updated', groupName: groupName.trim() });
  } catch (error) {
    console.error('Update group name error:', error);
    res.status(500).json({ message: 'Unable to update group name' });
  }
});

// Update group profile photo
router.put('/conversations/:conversationId/photo', async (req, res) => {
  const userId = Number(req.user.userId);
  const conversationId = Number(req.params.conversationId);
  const { photoUrl } = req.body;

  if (!photoUrl || typeof photoUrl !== 'string') {
    return res.status(400).json({ message: 'Photo URL is required' });
  }

  try {
    const convCheck = await pool.query(
      `SELECT "createdById", type FROM "Conversation" WHERE id = $1`,
      [conversationId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const conversation = convCheck.rows[0];
    if (conversation.type !== 'GROUP') {
      return res.status(400).json({ message: 'Can only update group photos' });
    }

    const isOwner = Number(conversation.createdById) === userId;
    if (!isOwner) {
      return res.status(403).json({ message: 'Only group owner can change photo' });
    }

    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Not a participant of this group' });
    }

    await pool.query(
      `UPDATE "Conversation" SET "profileImageUrl" = $1, "avatarUrl" = $1, "updatedAt" = NOW() WHERE id = $2`,
      [photoUrl, conversationId]
    );

    const participants = await pool.query(
      `SELECT "userId" FROM "ConversationParticipant" WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    participants.rows.forEach(({ userId: participantId }) => {
      socketService.emitToUser(participantId, 'chat:conversation-updated', {
        conversationId,
        changes: { profileImageUrl: photoUrl, avatarUrl: photoUrl }
      });
    });

    res.json({ success: true, message: 'Group photo updated', photoUrl });
  } catch (error) {
    console.error('Update group photo error:', error);
    res.status(500).json({ message: 'Unable to update group photo' });
  }
});

// Delete group (owner only)
router.delete('/conversations/:conversationId', async (req, res) => {
  const userId = Number(req.user.userId);
  const conversationId = Number(req.params.conversationId);

  try {
    const convCheck = await pool.query(
      `SELECT "createdById", type FROM "Conversation" WHERE id = $1`,
      [conversationId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const conversation = convCheck.rows[0];
    if (conversation.type === 'GROUP' && Number(conversation.createdById) !== userId) {
      return res.status(403).json({ message: 'Only group owner can delete the group' });
    }

    if (conversation.type === 'DIRECT' && Number(conversation.createdById) !== userId) {
      return res.status(403).json({ message: 'Only creator can delete this conversation' });
    }

    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Not a participant of this conversation' });
    }

    const participants = await pool.query(
      `SELECT "userId" FROM "ConversationParticipant" WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    await pool.query(
      `DELETE FROM "Conversation" WHERE id = $1`,
      [conversationId]
    );

    participants.rows.forEach(({ userId: participantId }) => {
      socketService.emitToUser(participantId, 'chat:conversation-deleted', { conversationId });
    });

    res.json({ success: true, message: conversation.type === 'GROUP' ? 'Group deleted' : 'Conversation deleted' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ message: 'Unable to delete conversation' });
  }
});

// Exit group (user leaves)
router.post('/conversations/:conversationId/exit', async (req, res) => {
  const userId = Number(req.user.userId);
  const conversationId = Number(req.params.conversationId);

  try {
    const convCheck = await pool.query(
      `SELECT type, "createdById" FROM "Conversation" WHERE id = $1`,
      [conversationId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const conversation = convCheck.rows[0];
    if (conversation.type === 'DIRECT') {
      return res.status(400).json({ message: 'Cannot exit direct messages' });
    }

    const isParticipant = await ensureParticipant(conversationId, userId);
    if (!isParticipant) {
      return res.status(403).json({ message: 'Not a participant of this group' });
    }

    // Prevent owner from exiting without transferring ownership
    if (Number(conversation.createdById) === userId) {
      const adminCount = await pool.query(
        `SELECT COUNT(*) as count FROM "ConversationParticipant" WHERE "conversationId" = $1 AND role IN ('ADMIN', 'OWNER') AND "userId" != $2 AND "leftAt" IS NULL`,
        [conversationId, userId]
      );

      if (Number(adminCount.rows[0].count) === 0) {
        return res.status(400).json({ message: 'Transfer ownership before leaving group' });
      }
    }

    await pool.query(
      `UPDATE "ConversationParticipant" SET "leftAt" = NOW(), "unreadCount" = 0 WHERE "conversationId" = $1 AND "userId" = $2`,
      [conversationId, userId]
    );

    const participants = await pool.query(
      `SELECT "userId" FROM "ConversationParticipant" WHERE "conversationId" = $1 AND "leftAt" IS NULL`,
      [conversationId]
    );

    participants.rows.forEach(({ userId: participantId }) => {
      socketService.emitToUser(participantId, 'chat:conversation-updated', {
        conversationId,
        userLeftId: userId,
        message: 'User left the group'
      });
    });

    res.json({ success: true, message: 'You have left the group' });
  } catch (error) {
    console.error('Exit group error:', error);
    res.status(500).json({ message: 'Unable to exit group' });
  }
});

module.exports = router;
