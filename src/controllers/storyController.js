const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');
const pool = require('../config/db');

const STORY_MEDIA = {
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  TEXT: 'TEXT',
};

const mapStory = (row) => ({
  id: row.id,
  userId: row.userId,
  mediaType: row.mediaType,
  mediaUrl: row.mediaUrl,
  textContent: row.textContent,
  background: row.background,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  hasViewed: Boolean(row.hasViewed),
  viewCount: Number(row.viewCount || 0),
});

router.post('/', verifyToken, async (req, res) => {
  const userId = Number(req.user.userId);
  const {
    mediaType = STORY_MEDIA.TEXT,
    mediaUrl = null,
    textContent = '',
    background = '#0f172a',
  } = req.body || {};

  const normalizedType = String(mediaType || STORY_MEDIA.TEXT).toUpperCase();
  const normalizedText = String(textContent || '').trim();

  if (![STORY_MEDIA.IMAGE, STORY_MEDIA.VIDEO, STORY_MEDIA.TEXT].includes(normalizedType)) {
    return res.status(400).json({ message: 'Invalid story media type.' });
  }

  if (!mediaUrl && !normalizedText) {
    return res.status(400).json({ message: 'Story content is required.' });
  }

  if (normalizedType !== STORY_MEDIA.TEXT && !mediaUrl) {
    return res.status(400).json({ message: 'Media URL is required for image/video stories.' });
  }

  try {
    const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000));

    const result = await pool.query(
      `INSERT INTO "Story" ("userId", "mediaType", "mediaUrl", "textContent", "background", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, "userId", "mediaType", "mediaUrl", "textContent", "background", "createdAt", "expiresAt"`,
      [userId, normalizedType, mediaUrl || null, normalizedText || null, background || null, expiresAt]
    );

    return res.status(201).json({ story: result.rows[0] });
  } catch (error) {
    console.error('Create story error:', error);
    return res.status(500).json({ message: 'Unable to create story.' });
  }
});

router.get('/feed', verifyToken, async (req, res) => {
  const userId = Number(req.user.userId);

  try {
    const result = await pool.query(
      `SELECT s.id,
              s."userId",
              s."mediaType",
              s."mediaUrl",
              s."textContent",
              s."background",
              s."createdAt",
              s."expiresAt",
              u."firstName",
              u."lastName",
              u.username,
              u."profileImageUrl",
              EXISTS(
                SELECT 1
                FROM "StoryView" sv
                WHERE sv."storyId" = s.id AND sv."viewerId" = $1
              ) AS "hasViewed",
              (
                SELECT COUNT(*)::int
                FROM "StoryView" sv2
                WHERE sv2."storyId" = s.id
              ) AS "viewCount"
       FROM "Story" s
       JOIN "User" u ON u.id = s."userId"
       WHERE s."expiresAt" > NOW()
         AND u."isVerified" = true
         AND u."isBlocked" = false
         AND u."isDeleted" = false
         AND (
           s."userId" = $1 OR
           s."userId" IN (
             SELECT f."followingId"
             FROM "Follow" f
             WHERE f."followerId" = $1
           )
         )
       ORDER BY s."createdAt" DESC`,
      [userId]
    );

    const grouped = new Map();

    result.rows.forEach((row) => {
      const uid = Number(row.userId);
      if (!grouped.has(uid)) {
        grouped.set(uid, {
          user: {
            id: uid,
            firstName: row.firstName,
            lastName: row.lastName,
            username: row.username,
            profileImageUrl: row.profileImageUrl,
          },
          stories: [],
          hasUnviewed: false,
          isOwn: uid === userId,
        });
      }

      const mapped = mapStory(row);
      grouped.get(uid).stories.push(mapped);
      if (!mapped.hasViewed && uid !== userId) {
        grouped.get(uid).hasUnviewed = true;
      }
    });

    const groups = Array.from(grouped.values())
      .map((group) => ({
        ...group,
        stories: group.stories.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      }))
      .sort((a, b) => {
        if (a.isOwn) return -1;
        if (b.isOwn) return 1;
        if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;

        const aLast = a.stories[a.stories.length - 1]?.createdAt || 0;
        const bLast = b.stories[b.stories.length - 1]?.createdAt || 0;
        return new Date(bLast) - new Date(aLast);
      });

    return res.json({ groups });
  } catch (error) {
    console.error('Story feed error:', error);
    return res.status(500).json({ message: 'Unable to fetch stories.' });
  }
});

router.post('/:storyId/view', verifyToken, async (req, res) => {
  const storyId = Number(req.params.storyId);
  const viewerId = Number(req.user.userId);

  if (!storyId || Number.isNaN(storyId)) {
    return res.status(400).json({ message: 'Invalid story id.' });
  }

  try {
    const storyResult = await pool.query(
      `SELECT id, "userId", "expiresAt"
       FROM "Story"
       WHERE id = $1
       LIMIT 1`,
      [storyId]
    );

    if (storyResult.rows.length === 0) {
      return res.status(404).json({ message: 'Story not found.' });
    }

    const story = storyResult.rows[0];
    if (new Date(story.expiresAt) <= new Date()) {
      return res.status(410).json({ message: 'Story has expired.' });
    }

    if (Number(story.userId) === viewerId) {
      return res.json({ success: true, skipped: true });
    }

    await pool.query(
      `INSERT INTO "StoryView" ("storyId", "viewerId")
       VALUES ($1, $2)
       ON CONFLICT ("storyId", "viewerId") DO NOTHING`,
      [storyId, viewerId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Story view error:', error);
    return res.status(500).json({ message: 'Unable to mark story as viewed.' });
  }
});

router.delete('/:storyId', verifyToken, async (req, res) => {
  const storyId = Number(req.params.storyId);
  const userId = Number(req.user.userId);

  if (!storyId || Number.isNaN(storyId)) {
    return res.status(400).json({ message: 'Invalid story id.' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM "Story"
       WHERE id = $1 AND "userId" = $2
       RETURNING id`,
      [storyId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Story not found.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Delete story error:', error);
    return res.status(500).json({ message: 'Unable to delete story.' });
  }
});

module.exports = router;
