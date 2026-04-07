const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middlewares/authMiddleware');

const pool = require('../config/db');
const {
  createNotification,
  getUserById,
  formatActorName,
} = require('../services/notificationService');

// Create a new post
router.post('/', verifyToken, async (req, res) => {
  const { content, feeling, mediaType, mediaUrl } = req.body;

  if (!content && !mediaUrl) {
    return res.status(400).json({ message: 'Post content or media is required.' });
  }

  if (mediaType && !['image', 'video'].includes(mediaType)) {
    return res.status(400).json({ message: 'Invalid media type.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO "Post" (content, feeling, "mediaType", "mediaUrl", "userId")
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, content, feeling, "mediaType", "mediaUrl", "userId", "createdAt"`,
      [content || null, feeling || null, mediaType || null, mediaUrl || null, req.user.userId]
    );

    const post = result.rows[0];
    const userResult = await pool.query(
      `SELECT id, "firstName", "lastName", "username", "profileImageUrl"
       FROM "User" WHERE id = $1`,
      [req.user.userId]
    );

    res.status(201).json({
      id: post.id,
      content: post.content,
      feeling: post.feeling,
      mediaType: post.mediaType,
      mediaUrl: post.mediaUrl,
      createdAt: post.createdAt,
      userId: post.userId,
      user: {
        id: userResult.rows[0].id,
        firstName: userResult.rows[0].firstName,
        lastName: userResult.rows[0].lastName,
        username: userResult.rows[0].username,
        profileImageUrl: userResult.rows[0].profileImageUrl,
      },
    });
  } catch (error) {
    console.error('Post creation error:', error);
    res.status(500).json({ message: 'Unable to create post.' });
  }
});

// Get feed posts from followed pages (must come BEFORE /feed route)
router.get('/feed/followed-pages', verifyToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  try {
    const result = await pool.query(
      `SELECT p.id, p.content, p.feeling, p."mediaType", p."mediaUrl", p."createdAt", p."pageId",
              u.id as "userId", u."firstName", u."lastName", u."username", u."profileImageUrl",
              pg.id as "pageIdFull", pg.name as "pageName", pg."profileImageUrl" as "pageProfileImageUrl"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       JOIN "Page" pg ON p."pageId" = pg.id
       JOIN "PageFollower" pf ON pf."pageId" = pg.id
       WHERE pf."userId" = $3
        AND p."isHidden" = false
         AND p."pageId" IS NOT NULL
       ORDER BY p."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, req.user.userId]
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      pageId: row.pageId,
      page: {
        id: row.pageIdFull,
        name: row.pageName,
        profileImageUrl: row.pageProfileImageUrl
      },
      userId: row.userId,
      user: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
    }));

    res.json({ posts });
  } catch (error) {
    console.error('Followed pages feed error:', error);
    res.status(500).json({ message: 'Unable to fetch followed pages feed.' });
  }
});

// Get feed posts
router.get('/feed', verifyToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  try {
    const result = await pool.query(
      `SELECT p.id, p.content, p.feeling, p."mediaType", p."mediaUrl", p."createdAt",
              u.id as "userId", u."firstName", u."lastName", u."username", u."profileImageUrl"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       JOIN "Follow" f ON f."followingId" = p."userId"
       WHERE f."followerId" = $3
        AND p."isHidden" = false
         AND p."pageId" IS NULL
         AND u."isVerified" = true
         AND u."isBlocked" = false
         AND u."isDeleted" = false
       ORDER BY p."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, req.user.userId]
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      userId: row.userId,
      user: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
    }));

    res.json({ posts });
  } catch (error) {
    console.error('Feed fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch feed.' });
  }
});

// Get trending hashtags
router.get('/trending-tags', verifyToken, async (req, res) => {
  const windowDays = Math.min(Math.max(parseInt(req.query.windowDays, 10) || 14, 1), 30);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 8, 1), 20);

  try {
    const result = await pool.query(
      `WITH recent_posts AS (
         SELECT p.id,
                COALESCE(p.content, '') AS content
         FROM "Post" p
         JOIN "User" u ON p."userId" = u.id
         WHERE p."isHidden" = false
           AND p."createdAt" >= NOW() - ($1::int * INTERVAL '1 day')
           AND u."isBlocked" = false
           AND u."isDeleted" = false
       ),
       extracted AS (
         SELECT rp.id AS "postId",
                LOWER(tag_match[1]) AS tag
         FROM recent_posts rp
         CROSS JOIN LATERAL regexp_matches(rp.content, '#([A-Za-z0-9_]{2,50})', 'g') AS tag_match
       ),
       deduplicated AS (
         SELECT DISTINCT "postId", tag
         FROM extracted
       )
       SELECT tag,
              COUNT(*)::int AS "postCount"
       FROM deduplicated
       GROUP BY tag
       ORDER BY "postCount" DESC, tag ASC
       LIMIT $2`,
      [windowDays, limit]
    );

    const tags = result.rows.map((row) => ({
      tag: `#${row.tag}`,
      postCount: row.postCount,
    }));

    res.json({
      tags,
      windowDays,
    });
  } catch (error) {
    console.error('Trending tags fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch trending tags.' });
  }
});

// Get global posts by hashtag
router.get('/hashtag/:tag', verifyToken, async (req, res) => {
  const rawTag = String(req.params.tag || '').trim().toLowerCase();
  const tag = rawTag.replace(/^#/, '');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
  const windowDays = Math.min(Math.max(parseInt(req.query.windowDays, 10) || 30, 1), 90);

  if (!/^[a-z0-9_]{2,50}$/i.test(tag)) {
    return res.status(400).json({ message: 'Invalid hashtag.' });
  }

  try {
    const regexPattern = `(^|[^A-Za-z0-9_])#${tag}([^A-Za-z0-9_]|$)`;
    const result = await pool.query(
      `SELECT p.id,
              p.content,
              p.feeling,
              p."mediaType",
              p."mediaUrl",
              p."createdAt",
              p."pageId",
              u.id as "userId",
              u."firstName",
              u."lastName",
              u."username",
              u."profileImageUrl",
              pg.id as "pageIdFull",
              pg.name as "pageName",
              pg."profileImageUrl" as "pageProfileImageUrl"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       LEFT JOIN "Page" pg ON p."pageId" = pg.id
       WHERE p."isHidden" = false
         AND p."createdAt" >= NOW() - ($1::int * INTERVAL '1 day')
         AND u."isVerified" = true
         AND u."isBlocked" = false
         AND u."isDeleted" = false
         AND COALESCE(p.content, '') ~* $2
       ORDER BY p."createdAt" DESC
       LIMIT $3`,
      [windowDays, regexPattern, limit]
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      pageId: row.pageId,
      page: row.pageId
        ? {
            id: row.pageIdFull,
            name: row.pageName,
            profileImageUrl: row.pageProfileImageUrl,
          }
        : null,
      userId: row.userId,
      user: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
    }));

    res.json({
      hashtag: `#${tag}`,
      posts,
      windowDays,
    });
  } catch (error) {
    console.error('Hashtag posts fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch hashtag posts.' });
  }
});

// Search global posts by text
router.get('/search', verifyToken, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

  if (q.length < 2) {
    return res.status(400).json({ message: 'Search query must be at least 2 characters.' });
  }

  try {
    const likePattern = `%${q}%`;
    const result = await pool.query(
      `SELECT p.id,
              p.content,
              p.feeling,
              p."mediaType",
              p."mediaUrl",
              p."createdAt",
              p."pageId",
              u.id as "userId",
              u."firstName",
              u."lastName",
              u."username",
              u."profileImageUrl",
              pg.id as "pageIdFull",
              pg.name as "pageName",
              pg."profileImageUrl" as "pageProfileImageUrl"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       LEFT JOIN "Page" pg ON p."pageId" = pg.id
       WHERE p."isHidden" = false
         AND u."isBlocked" = false
         AND u."isDeleted" = false
         AND COALESCE(p.content, '') ILIKE $1
       ORDER BY p."createdAt" DESC
       LIMIT $2`,
      [likePattern, limit]
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      pageId: row.pageId,
      page: row.pageId
        ? {
            id: row.pageIdFull,
            name: row.pageName,
            profileImageUrl: row.pageProfileImageUrl,
          }
        : null,
      userId: row.userId,
      user: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
    }));

    res.json({
      query: q,
      posts,
    });
  } catch (error) {
    console.error('Post search error:', error);
    res.status(500).json({ message: 'Unable to search posts.' });
  }
});

// Get current user's own posts
router.get('/my-posts', verifyToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT p.id, p.content, p.feeling, p."mediaType", p."mediaUrl", p."createdAt", p."isHidden",
              u.id as "userId", u."firstName", u."lastName", u."username", u."profileImageUrl"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       WHERE p."userId" = $1
       ORDER BY p."createdAt" DESC`,
      [userId]
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      isHidden: row.isHidden,
      userId: row.userId,
      user: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
    }));

    res.json({ posts });
  } catch (error) {
    console.error('My posts fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch your posts.' });
  }
});

// Get posts by user ID
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `SELECT p.id as "postId", p.content, p.feeling, p."mediaType", p."mediaUrl", p."userId", p."createdAt",
              u.id as "userId_user", u."firstName", u."lastName", u."username", u."profileImageUrl"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       WHERE p."userId" = $1 AND p."isHidden" = false AND u."isDeleted" = false
       ORDER BY p."createdAt" DESC`,
      [parseInt(userId)]
    );

    if (result.rows.length === 0) {
      return res.json({ posts: [] });
    }

    const posts = result.rows.map(row => ({
      id: row.postId,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      userId: row.userId,
      user: {
        id: row.userId_user,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
    }));

    res.json({ posts });
  } catch (error) {
    console.error('Fetch user posts error:', error);
    res.status(500).json({ message: 'Unable to fetch posts' });
  }
});

// Get single post by ID (for deep-linking from notifications/share links)
router.get('/:postId', verifyToken, async (req, res) => {
  const postId = Number(req.params.postId);

  if (!postId || Number.isNaN(postId)) {
    return res.status(400).json({ message: 'Invalid post id.' });
  }

  try {
    const result = await pool.query(
      `SELECT p.id,
              p.content,
              p.feeling,
              p."mediaType",
              p."mediaUrl",
              p."createdAt",
              p."pageId",
              u.id as "userId",
              u."firstName",
              u."lastName",
              u."username",
              u."profileImageUrl",
              pg.id as "pageIdFull",
              pg.name as "pageName",
              pg."profileImageUrl" as "pageProfileImageUrl"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       LEFT JOIN "Page" pg ON p."pageId" = pg.id
       WHERE p.id = $1
         AND p."isHidden" = false
         AND u."isVerified" = true
         AND u."isBlocked" = false
         AND u."isDeleted" = false
       LIMIT 1`,
      [postId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    const row = result.rows[0];
    const post = {
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      pageId: row.pageId,
      page: row.pageId
        ? {
            id: row.pageIdFull,
            name: row.pageName,
            profileImageUrl: row.pageProfileImageUrl,
          }
        : null,
      userId: row.userId,
      user: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        profileImageUrl: row.profileImageUrl,
      },
    };

    return res.json({ post });
  } catch (error) {
    console.error('Single post fetch error:', error);
    return res.status(500).json({ message: 'Unable to fetch post.' });
  }
});

// Update a post
router.put('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { content, mediaType, mediaUrl } = req.body;
  const userId = req.user.userId;

  const normalizedContent = typeof content === 'string' ? content.trim() : null;
  const normalizedMediaType = mediaType || null;
  const normalizedMediaUrl = mediaUrl || null;

  if (!normalizedContent && !normalizedMediaUrl) {
    return res.status(400).json({ message: 'Post content or media is required.' });
  }

  if (normalizedMediaType && !['image', 'video'].includes(normalizedMediaType)) {
    return res.status(400).json({ message: 'Invalid media type.' });
  }

  try {
    // Check if post exists and belongs to user
    const postResult = await pool.query(
      `SELECT id, "userId" FROM "Post" WHERE id = $1`,
      [id]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    if (postResult.rows[0].userId !== userId) {
      return res.status(403).json({ message: 'You can only edit your own posts.' });
    }

    // Update the post
    const updateResult = await pool.query(
      `UPDATE "Post"
       SET content = $1,
           "mediaType" = $2,
           "mediaUrl" = $3
       WHERE id = $4
       RETURNING id, content, feeling, "mediaType", "mediaUrl", "createdAt", "userId"`,
      [normalizedContent, normalizedMediaType, normalizedMediaUrl, id]
    );

    res.json(updateResult.rows[0]);
  } catch (error) {
    console.error('Post update error:', error);
    res.status(500).json({ message: 'Unable to update post.' });
  }
});

// Delete a post
router.delete('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  try {
    // Check if post exists and belongs to user
    const postResult = await pool.query(
      `SELECT id, "userId" FROM "Post" WHERE id = $1`,
      [id]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    if (postResult.rows[0].userId !== userId) {
      return res.status(403).json({ message: 'You can only delete your own posts.' });
    }

    // Delete the post
    await pool.query(`DELETE FROM "Post" WHERE id = $1`, [id]);

    res.json({ message: 'Post deleted successfully.' });
  } catch (error) {
    console.error('Post deletion error:', error);
    res.status(500).json({ message: 'Unable to delete post.' });
  }
});

// Report a post
router.post('/:id/report', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const userId = req.user.userId;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ message: 'Report reason is required.' });
  }

  try {
    // Check if post exists
    const postResult = await pool.query(
      `SELECT id FROM "Post" WHERE id = $1`,
      [id]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    // Store report in database
    await pool.query(
      `INSERT INTO "Report" ("postId", "userId", "reason", "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [id, userId, reason.trim()]
    );

    res.json({ message: 'Post reported successfully.' });
  } catch (error) {
    console.error('Post report error:', error);
    res.status(500).json({ message: 'Unable to report post.' });
  }
});

// Admin: Get all posts
router.get('/admin/all', verifyToken, async (req, res) => {
  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );
  
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  try {
    const result = await pool.query(
      `SELECT p.id, p.content, p.feeling, p."mediaType", p."mediaUrl", p."createdAt", p."isHidden", p."pageId",
              u.id as "userId", u."firstName", u."lastName", u."username", u."email",
              pg.id as "pageIdRef", pg.name as "pageName",
              (SELECT COUNT(*) FROM "Like" WHERE "postId" = p.id)::int as "likeCount",
              (SELECT COUNT(*) FROM "Comment" WHERE "postId" = p.id)::int as "commentCount"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       LEFT JOIN "Page" pg ON p."pageId" = pg.id
       WHERE u."isDeleted" = false
       ORDER BY p."createdAt" DESC`
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      isHidden: row.isHidden,
      createdAt: row.createdAt,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
      pageId: row.pageId,
      pageName: row.pageName,
      type: row.pageId ? 'PAGE' : 'USER',
      author: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        email: row.email,
      },
    }));

    res.json({ posts });
  } catch (error) {
    console.error('Admin posts fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch posts.' });
  }
});

// Admin: Get all reports
router.get('/admin/reports', verifyToken, async (req, res) => {
  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );
  
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  try {
    // Fetch post reports
    const postReports = await pool.query(
      `SELECT r.id, r."postId", r."userId", r.reason, r.status, r."createdAt",
              u."firstName", u."lastName", u."username", u."email",
              p.content as "postContent", p."mediaType", p."mediaUrl", p."isHidden",
              'POST' as type
       FROM "Report" r
       JOIN "User" u ON r."userId" = u.id
       JOIN "Post" p ON r."postId" = p.id
       WHERE u."isDeleted" = false
       ORDER BY r."createdAt" DESC`
    );

    // Fetch comment reports
    const commentReports = await pool.query(
      `SELECT cr.id, cr."commentId", cr."userId", cr.reason, cr.status, cr."createdAt",
              u."firstName", u."lastName", u."username", u."email",
              c.content as "commentContent", c."postId", c."isHidden",
              'COMMENT' as type
       FROM "CommentReport" cr
       JOIN "User" u ON cr."userId" = u.id
       JOIN "Comment" c ON cr."commentId" = c.id
       WHERE u."isDeleted" = false
       ORDER BY cr."createdAt" DESC`
    );

    // Fetch page reports
    const pageReports = await pool.query(
      `SELECT pr.id, pr."pageId", pr."reportedById", pr.reason, pr.description, pr.status, pr."createdAt",
              u."firstName", u."lastName", u."username", u."email",
              p.name as "pageName", p.description as "pageDescription", p.category as "pageCategory", p.slug as "pageSlug",
              p."profileImageUrl" as "pageProfileImageUrl", p."bannerImageUrl" as "pageBannerImageUrl",
              'PAGE' as type
       FROM "PageReport" pr
       JOIN "User" u ON pr."reportedById" = u.id
       JOIN "Page" p ON pr."pageId" = p.id
       WHERE u."isDeleted" = false
       ORDER BY pr."createdAt" DESC`
    );

    // Format post reports
    const formattedPostReports = postReports.rows.map((row) => ({
      id: row.id,
      type: row.type,
      postId: row.postId,
      commentId: null,
      content: row.postContent,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      isHidden: row.isHidden,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt,
      reportedBy: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        email: row.email,
      },
    }));

    // Format comment reports
    const formattedCommentReports = commentReports.rows.map((row) => ({
      id: row.id,
      type: row.type,
      commentId: row.commentId,
      postId: row.postId,
      content: row.commentContent,
      mediaType: null,
      mediaUrl: null,
      isHidden: row.isHidden,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt,
      reportedBy: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        email: row.email,
      },
    }));

    // Format page reports
    const formattedPageReports = pageReports.rows.map((row) => ({
      id: row.id,
      type: row.type,
      pageId: row.pageId,
      page: {
        id: row.pageId,
        name: row.pageName,
        slug: row.pageSlug,
        category: row.pageCategory,
        profileImageUrl: row.pageProfileImageUrl,
        bannerImageUrl: row.pageBannerImageUrl,
      },
      postId: null,
      commentId: null,
      content: row.pageDescription,
      mediaType: null,
      mediaUrl: null,
      isHidden: false,
      reason: row.reason,
      reportDescription: row.description,
      status: row.status,
      createdAt: row.createdAt,
      reportedBy: {
        id: row.reportedById,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        email: row.email,
      },
    }));

    // Combine and sort by date
    const allReports = [...formattedPostReports, ...formattedCommentReports, ...formattedPageReports]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ reports: allReports });
  } catch (error) {
    console.error('Admin reports fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch reports.' });
  }
});

// Admin: Get single post details
router.get('/admin/:id/details', verifyToken, async (req, res) => {
  const { id } = req.params;

  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );

  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  try {
    const result = await pool.query(
      `SELECT p.id, p.content, p.feeling, p."mediaType", p."mediaUrl", p."createdAt",
              u.id as "userId", u."firstName", u."lastName", u."username", u."email",
              (SELECT COUNT(*) FROM "Like" WHERE "postId" = p.id)::int as "likeCount",
              (SELECT COUNT(*) FROM "Comment" WHERE "postId" = p.id)::int as "commentCount"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       WHERE p.id = $1 AND u."isDeleted" = false`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    const row = result.rows[0];
    const post = {
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      likeCount: row.likeCount,
      commentCount: row.commentCount,
      author: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
        email: row.email,
      },
    };

    res.json({ post });
  } catch (error) {
    console.error('Admin single post fetch error:', error);
    res.status(500).json({ message: 'Unable to fetch post.' });
  }
});

// Admin: Block (hide) any post
router.delete('/admin/:id', verifyToken, async (req, res) => {
  const { id } = req.params;

  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );
  
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  try {
    // Mark all reports for this post as RESOLVED (audit trail)
    await pool.query(`UPDATE "Report" SET status = 'RESOLVED' WHERE "postId" = $1`, [id]);

    // Soft block (hide) the post
    const result = await pool.query(
      `UPDATE "Post" SET "isHidden" = true WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    res.json({ message: 'Post hidden successfully.' });
  } catch (error) {
    console.error('Admin post hide error:', error);
    res.status(500).json({ message: 'Unable to hide post.' });
  }
});

// Admin: Update post visibility
router.patch('/admin/posts/:id/visibility', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { isHidden } = req.body;

  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );
  
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  try {
    const hiddenValue = Boolean(isHidden);
    const result = await pool.query(
      `UPDATE "Post" SET "isHidden" = $1 WHERE id = $2 RETURNING id, "isHidden"`,
      [hiddenValue, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    if (hiddenValue) {
      await pool.query(`UPDATE "Report" SET status = 'RESOLVED' WHERE "postId" = $1`, [id]);
    }

    res.json({ message: 'Post visibility updated.', isHidden: result.rows[0].isHidden });
  } catch (error) {
    console.error('Admin post visibility error:', error);
    res.status(500).json({ message: 'Unable to update post visibility.' });
  }
});

// Admin: Update report status
router.patch('/admin/reports/:reportId', verifyToken, async (req, res) => {
  const { reportId } = req.params;
  const { status, type } = req.body;

  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );
  
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  if (!['PENDING', 'RESOLVED', 'DISMISSED'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status value.' });
  }

  try {
    let table = 'Report';
    if (type === 'COMMENT') table = 'CommentReport';
    if (type === 'PAGE') table = 'PageReport';

    const result = await pool.query(
      `UPDATE "${table}" SET status = $1 WHERE id = $2 RETURNING id`,
      [status, reportId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Report not found.' });
    }

    res.json({ message: 'Report status updated successfully.', status });
  } catch (error) {
    console.error('Update report status error:', error);
    res.status(500).json({ message: 'Unable to update report status.' });
  }
});

// Admin: Block (hide) comment
router.delete('/admin/comments/:commentId', verifyToken, async (req, res) => {
  const { commentId } = req.params;

  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );
  
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  try {
    // Mark all reports for this comment as RESOLVED (audit trail)
    await pool.query(
      `UPDATE "CommentReport" SET status = 'RESOLVED' WHERE "commentId" = $1`,
      [commentId]
    );
    
    const result = await pool.query(
      `UPDATE "Comment" SET "isHidden" = true WHERE id = $1 RETURNING id`,
      [commentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    res.json({ message: 'Comment hidden successfully.' });
  } catch (error) {
    console.error('Admin comment hide error:', error);
    res.status(500).json({ message: 'Unable to hide comment.' });
  }
});

// Admin: Update comment visibility
router.patch('/admin/comments/:commentId/visibility', verifyToken, async (req, res) => {
  const { commentId } = req.params;
  const { isHidden } = req.body;

  // Check if user is admin
  const userResult = await pool.query(
    `SELECT role FROM "User" WHERE id = $1`,
    [req.user.userId]
  );
  
  if (userResult.rows.length === 0 || userResult.rows[0].role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required.' });
  }

  try {
    const hiddenValue = Boolean(isHidden);
    const result = await pool.query(
      `UPDATE "Comment" SET "isHidden" = $1 WHERE id = $2 RETURNING id, "isHidden"`,
      [hiddenValue, commentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    if (hiddenValue) {
      await pool.query(`UPDATE "CommentReport" SET status = 'RESOLVED' WHERE "commentId" = $1`, [commentId]);
    }

    res.json({ message: 'Comment visibility updated.', isHidden: result.rows[0].isHidden });
  } catch (error) {
    console.error('Admin comment visibility error:', error);
    res.status(500).json({ message: 'Unable to update comment visibility.' });
  }
});

// ===== COMMENT-SPECIFIC ROUTES (must come before /:postId routes) =====

// Edit a comment
router.patch('/comments/:commentId', verifyToken, async (req, res) => {
  const { commentId } = req.params;
  const { content } = req.body;
  const userId = req.user.userId;

  if (!content || content.trim() === '') {
    return res.status(400).json({ message: 'Comment cannot be empty' });
  }

  try {
    // Verify ownership
    const commentCheck = await pool.query(
      `SELECT "userId" FROM "Comment" WHERE id = $1`,
      [commentId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (commentCheck.rows[0].userId !== userId) {
      return res.status(403).json({ message: 'Unauthorized to edit this comment' });
    }

    // Update comment
    const result = await pool.query(
      `UPDATE "Comment" SET content = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, content, "updatedAt"`,
      [content.trim(), commentId]
    );

    res.json({ 
      success: true, 
      message: 'Comment updated',
      comment: result.rows[0]
    });
  } catch (error) {
    console.error('Edit comment error:', error);
    res.status(500).json({ message: 'Unable to edit comment' });
  }
});

// Delete a comment
router.delete('/comments/:commentId', verifyToken, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.user.userId;

  try {
    // Verify ownership
    const commentCheck = await pool.query(
      `SELECT "userId" FROM "Comment" WHERE id = $1`,
      [commentId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (commentCheck.rows[0].userId !== userId) {
      return res.status(403).json({ message: 'Unauthorized to delete this comment' });
    }

    // Delete comment
    await pool.query(
      `DELETE FROM "Comment" WHERE id = $1`,
      [commentId]
    );

    res.json({ success: true, message: 'Comment deleted' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ message: 'Unable to delete comment' });
  }
});

// Create a reply to a comment
router.post('/comments/:commentId/reply', verifyToken, async (req, res) => {
  const { commentId } = req.params;
  const { content } = req.body;
  const userId = req.user.userId;

  if (!content || content.trim() === '') {
    return res.status(400).json({ message: 'Reply cannot be empty' });
  }

  try {
    // Verify parent comment exists and get postId
    const parentCheck = await pool.query(
      `SELECT "postId" FROM "Comment" WHERE id = $1`,
      [commentId]
    );

    if (parentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const postId = parentCheck.rows[0].postId;

    // Create reply
    const result = await pool.query(
      `INSERT INTO "Comment" (content, "postId", "userId", "parentCommentId", "createdAt", "updatedAt") 
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, content, "postId", "userId", "parentCommentId", "createdAt"`,
      [content.trim(), postId, userId, commentId]
    );

    const reply = result.rows[0];

    // Get user details
    const userResult = await pool.query(
      `SELECT id, "firstName", "lastName", username, email FROM "User" WHERE id = $1`,
      [userId]
    );

    const user = userResult.rows[0];

    res.status(201).json({
      id: reply.id,
      content: reply.content,
      postId: reply.postId,
      userId: reply.userId,
      parentCommentId: reply.parentCommentId,
      createdAt: reply.createdAt,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Reply creation error:', error);
    res.status(500).json({ message: 'Unable to create reply' });
  }
});

// Report a comment
router.post('/comments/:commentId/report', verifyToken, async (req, res) => {
  const { commentId } = req.params;
  const { reason } = req.body;
  const userId = req.user.userId;

  if (!reason || reason.trim() === '') {
    return res.status(400).json({ message: 'Report reason is required' });
  }

  try {
    // Verify comment exists
    const commentCheck = await pool.query(
      `SELECT id FROM "Comment" WHERE id = $1`,
      [commentId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    // Check if already reported by this user
    const existingReport = await pool.query(
      `SELECT id FROM "CommentReport" WHERE "commentId" = $1 AND "userId" = $2`,
      [commentId, userId]
    );

    if (existingReport.rows.length > 0) {
      return res.status(400).json({ message: 'You have already reported this comment' });
    }

    // Create report
    await pool.query(
      `INSERT INTO "CommentReport" ("commentId", "userId", reason, "createdAt") 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [commentId, userId, reason.trim()]
    );

    res.status(201).json({ success: true, message: 'Comment reported successfully' });
  } catch (error) {
    console.error('Report comment error:', error);
    res.status(500).json({ message: 'Unable to report comment' });
  }
});

// Like a post
router.post('/:postId/like', verifyToken, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.userId;

  try {
    // Check if already liked
    const existingLike = await pool.query(
      `SELECT id FROM "Like" WHERE "postId" = $1 AND "userId" = $2`,
      [postId, userId]
    );

    if (existingLike.rows.length > 0) {
      return res.status(400).json({ message: 'Already liked this post' });
    }

    // Create like
    await pool.query(
      `INSERT INTO "Like" ("postId", "userId") VALUES ($1, $2)`,
      [postId, userId]
    );

    const postOwnerResult = await pool.query(
      `SELECT "userId" FROM "Post" WHERE id = $1 LIMIT 1`,
      [postId]
    );

    const postOwnerId = postOwnerResult.rows[0]?.userId;
    if (postOwnerId) {
      try {
        const actor = await getUserById(userId);
        const actorName = formatActorName(actor) || 'Someone';

        await createNotification({
          userId: postOwnerId,
          actorId: userId,
          type: 'POST_LIKED',
          title: 'New like on your post',
          body: `${actorName} liked your post.`,
          entityType: 'post',
          entityId: Number(postId),
        });
      } catch (notificationError) {
        console.error('Post like notification error:', notificationError?.message || notificationError);
      }
    }

    // Get updated like count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM "Like" WHERE "postId" = $1`,
      [postId]
    );

    res.status(201).json({ success: true, likeCount: parseInt(countResult.rows[0].count) });
  } catch (error) {
    console.error('Like creation error:', error);
    res.status(500).json({ message: 'Unable to like post' });
  }
});

// Unlike a post
router.delete('/:postId/like', verifyToken, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `DELETE FROM "Like" WHERE "postId" = $1 AND "userId" = $2 RETURNING id`,
      [postId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Like not found' });
    }

    // Get updated like count
    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM "Like" WHERE "postId" = $1`,
      [postId]
    );

    res.json({ success: true, likeCount: parseInt(countResult.rows[0].count) });
  } catch (error) {
    console.error('Unlike error:', error);
    res.status(500).json({ message: 'Unable to unlike post' });
  }
});

// Get likes for a post
router.get('/:postId/likes', verifyToken, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.userId;

  try {
    const likesResult = await pool.query(
      `SELECT l."userId", u."firstName", u."lastName", u."username"
       FROM "Like" l
       JOIN "User" u ON l."userId" = u.id
       WHERE l."postId" = $1 AND u."isDeleted" = false
       ORDER BY l."createdAt" DESC`,
      [postId]
    );

    const likedByUserResult = await pool.query(
      `SELECT id FROM "Like" WHERE "postId" = $1 AND "userId" = $2`,
      [postId, userId]
    );

    const likes = likesResult.rows.map(row => ({
      userId: row.userId,
      user: {
        id: row.userId,
        firstName: row.firstName,
        lastName: row.lastName,
        username: row.username,
      },
    }));

    res.json({
      likes,
      likeCount: likes.length,
      likedByUser: likedByUserResult.rows.length > 0,
    });
  } catch (error) {
    console.error('Get likes error:', error);
    res.status(500).json({ message: 'Unable to fetch likes' });
  }
});

// Create a comment
router.post('/:postId/comments', verifyToken, async (req, res) => {
  const { postId } = req.params;
  const { content } = req.body;
  const userId = req.user.userId;

  if (!content || content.trim() === '') {
    return res.status(400).json({ message: 'Comment cannot be empty' });
  }

  try {
    // Verify post exists
    const postCheck = await pool.query(
      `SELECT id, "userId" FROM "Post" WHERE id = $1`,
      [postId]
    );

    if (postCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Create comment
    const result = await pool.query(
      `INSERT INTO "Comment" (content, "postId", "userId", "createdAt") 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       RETURNING id, content, "postId", "userId", "createdAt"`,
      [content, postId, userId]
    );

    const comment = result.rows[0];
    const postOwnerId = postCheck.rows[0]?.userId;

    if (postOwnerId) {
      try {
        const actor = await getUserById(userId);
        const actorName = formatActorName(actor) || 'Someone';

        await createNotification({
          userId: postOwnerId,
          actorId: userId,
          type: 'POST_COMMENTED',
          title: 'New comment on your post',
          body: `${actorName} commented on your post.`,
          entityType: 'post',
          entityId: Number(postId),
        });
      } catch (notificationError) {
        console.error('Post comment notification error:', notificationError?.message || notificationError);
      }
    }

    // Get user details
    const userResult = await pool.query(
      `SELECT id, "firstName", "lastName", username, email FROM "User" WHERE id = $1`,
      [userId]
    );

    const user = userResult.rows[0];

    res.status(201).json({
      id: comment.id,
      content: comment.content,
      postId: comment.postId,
      userId: comment.userId,
      createdAt: comment.createdAt,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('Comment creation error:', error);
    res.status(500).json({ message: 'Unable to create comment' });
  }
});

// Get comments for a post
router.get('/:postId/comments', verifyToken, async (req, res) => {
  const { postId } = req.params;

  try {
    // Get all comments and replies for the post
    const result = await pool.query(
      `SELECT c.id, c.content, c."postId", c."userId", c."parentCommentId", c."createdAt", c."updatedAt",
              u.id as "userId", u."firstName", u."lastName", u.username, u.email
       FROM "Comment" c
       JOIN "User" u ON c."userId" = u.id
       WHERE c."postId" = $1 AND c."isHidden" = false AND u."isDeleted" = false
       ORDER BY c."parentCommentId" NULLS FIRST, c."createdAt" DESC`,
      [postId]
    );

    // Build nested comment structure
    const commentMap = {};
    const topLevelComments = [];

    result.rows.forEach(row => {
      const comment = {
        id: row.id,
        content: row.content,
        postId: row.postId,
        userId: row.userId,
        parentCommentId: row.parentCommentId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        user: {
          id: row.userId,
          firstName: row.firstName,
          lastName: row.lastName,
          username: row.username,
          email: row.email,
        },
        replies: [],
      };

      commentMap[comment.id] = comment;

      if (row.parentCommentId === null) {
        topLevelComments.push(comment);
      } else {
        // Add as reply to parent comment
        if (commentMap[row.parentCommentId]) {
          commentMap[row.parentCommentId].replies.push(comment);
        }
      }
    });

    res.json({ comments: topLevelComments });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ message: 'Unable to fetch comments' });
  }
});

module.exports = router;
