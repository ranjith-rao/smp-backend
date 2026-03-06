const pageService = require('../services/pageService');
const pool = require('../config/db');

// Create a new page
const createPage = async (req, res) => {
  try {
    const { name, description, category, bannerImageUrl, profileImageUrl } = req.body;
    const userId = req.user.userId || req.user.id;

    // Validation
    if (!name || !description || !category) {
      return res.status(400).json({ message: 'Missing required fields: name, description, category' });
    }

    if (name.length < 3 || name.length > 100) {
      return res.status(400).json({ message: 'Page name must be between 3 and 100 characters' });
    }

    if (description.length < 10 || description.length > 1000) {
      return res.status(400).json({ message: 'Description must be between 10 and 1000 characters' });
    }

    const page = await pageService.createPage(userId, {
      name,
      description,
      category,
      bannerImageUrl,
      profileImageUrl
    });

    res.status(201).json({
      message: 'Page created successfully',
      page
    });
  } catch (error) {
    console.error('Error creating page:', error);
    res.status(500).json({ message: 'Error creating page', error: error.message });
  }
};

// Get page details by ID
const getPage = async (req, res) => {
  try {
    const { pageId } = req.params;

    if (!pageId || isNaN(pageId)) {
      return res.status(400).json({ message: 'Invalid page ID' });
    }

    const page = await pageService.getPageById(parseInt(pageId));

    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }

    // Check if current user is following
    let isFollowing = false;
    if (req.user) {
      isFollowing = await pageService.isUserFollowingPage(page.id, req.user.userId || req.user.id);
    }

    res.status(200).json({
      ...page,
      isFollowing,
      followerCount: page.followers.length
    });
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ message: 'Error fetching page', error: error.message });
  }
};

// Get page by slug
const getPageBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json({ message: 'Slug is required' });
    }

    const page = await pageService.getPageBySlug(slug);

    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }

    // Check if current user is following
    let isFollowing = false;
    if (req.user) {
      isFollowing = await pageService.isUserFollowingPage(page.id, req.user.userId || req.user.id);
    }

    res.status(200).json({
      ...page,
      isFollowing,
      followerCount: page.followers.length
    });
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ message: 'Error fetching page', error: error.message });
  }
};

// Update page
const updatePage = async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user.userId || req.user.id;
    const { name, description, category, bannerImageUrl, profileImageUrl } = req.body;

    if (!pageId || isNaN(pageId)) {
      return res.status(400).json({ message: 'Invalid page ID' });
    }

    const page = await pageService.updatePage(parseInt(pageId), userId, {
      name,
      description,
      category,
      bannerImageUrl,
      profileImageUrl
    });

    res.status(200).json({
      message: 'Page updated successfully',
      page
    });
  } catch (error) {
    console.error('Error updating page:', error);
    if (error.message.includes('Only page owner')) {
      return res.status(403).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error updating page', error: error.message });
  }
};

// Delete page
const deletePage = async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user.userId || req.user.id;

    if (!pageId || isNaN(pageId)) {
      return res.status(400).json({ message: 'Invalid page ID' });
    }

    await pageService.deletePage(parseInt(pageId), userId);

    res.status(200).json({
      message: 'Page deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting page:', error);
    if (error.message.includes('Only page owner')) {
      return res.status(403).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error deleting page', error: error.message });
  }
};

// Get all pages with search and filtering
const getAllPages = async (req, res) => {
  try {
    const { search = '', category = 'ALL', page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const pageLimit = Math.min(100, parseInt(limit));
    const skip = (pageNum - 1) * pageLimit;

    const pages = await pageService.getAllPages(search, category, skip, pageLimit);

    res.status(200).json({
      pages,
      pagination: {
        currentPage: pageNum,
        pageSize: pageLimit,
        total: pages.length
      }
    });
  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ message: 'Error fetching pages', error: error.message });
  }
};

// Get user's owned pages
const getUserOwnedPages = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const pages = await pageService.getUserOwnedPages(userId);

    res.status(200).json({
      message: 'User pages fetched successfully',
      pages
    });
  } catch (error) {
    console.error('Error fetching user pages:', error);
    res.status(500).json({ message: 'Error fetching user pages', error: error.message });
  }
};

// Get user's followed pages
const getUserFollowedPages = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;

    const pages = await pageService.getUserFollowedPages(userId);

    res.status(200).json({
      message: 'Followed pages fetched successfully',
      pages
    });
  } catch (error) {
    console.error('Error fetching followed pages:', error);
    res.status(500).json({ message: 'Error fetching followed pages', error: error.message });
  }
};

// Create a post for a page (owner/admin only)
const createPagePost = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { content, feeling, mediaType, mediaUrl } = req.body;
    const userId = req.user.userId || req.user.id;

    if (!pageId || isNaN(pageId)) {
      return res.status(400).json({ message: 'Invalid page ID' });
    }

    if (!content && !mediaUrl) {
      return res.status(400).json({ message: 'Post content or media is required.' });
    }

    if (mediaType && !['image', 'video'].includes(mediaType)) {
      return res.status(400).json({ message: 'Invalid media type.' });
    }

    const pageResult = await pool.query(
      'SELECT "ownerId" FROM "Page" WHERE id = $1',
      [pageId]
    );

    if (pageResult.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }

    const ownerId = pageResult.rows[0].ownerId;
    if (ownerId !== userId) {
      return res.status(403).json({ message: 'Only page owner can create page posts' });
    }

    const result = await pool.query(
      `INSERT INTO "Post" (content, feeling, "mediaType", "mediaUrl", "userId", "pageId")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, content, feeling, "mediaType", "mediaUrl", "userId", "pageId", "createdAt"`,
      [content || null, feeling || null, mediaType || null, mediaUrl || null, userId, parseInt(pageId)]
    );

    const post = result.rows[0];
    const userResult = await pool.query(
      `SELECT id, "firstName", "lastName", "username", "profileImageUrl"
       FROM "User" WHERE id = $1`,
      [userId]
    );

    res.status(201).json({
      message: 'Page post created successfully',
      post: {
        ...post,
        user: userResult.rows[0]
      }
    });
  } catch (error) {
    console.error('Error creating page post:', error);
    res.status(500).json({ message: 'Error creating page post', error: error.message });
  }
};

// Follow page
const followPage = async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user.userId || req.user.id;

    if (!pageId || isNaN(pageId)) {
      return res.status(400).json({ message: 'Invalid page ID' });
    }

    // Check if already following
    const isFollowing = await pageService.isUserFollowingPage(parseInt(pageId), userId);
    if (isFollowing) {
      return res.status(400).json({ message: 'Already following this page' });
    }

    await pageService.followPage(parseInt(pageId), userId);

    res.status(200).json({
      message: 'Page followed successfully'
    });
  } catch (error) {
    console.error('Error following page:', error);
    res.status(500).json({ message: 'Error following page', error: error.message });
  }
};

// Unfollow page
const unfollowPage = async (req, res) => {
  try {
    const { pageId } = req.params;
    const userId = req.user.userId || req.user.id;

    if (!pageId || isNaN(pageId)) {
      return res.status(400).json({ message: 'Invalid page ID' });
    }

    // Check if following
    const isFollowing = await pageService.isUserFollowingPage(parseInt(pageId), userId);
    if (!isFollowing) {
      return res.status(400).json({ message: 'Not following this page' });
    }

    await pageService.unfollowPage(parseInt(pageId), userId);

    res.status(200).json({
      message: 'Page unfollowed successfully'
    });
  } catch (error) {
    console.error('Error unfollowing page:', error);
    res.status(500).json({ message: 'Error unfollowing page', error: error.message });
  }
};

// Get posts from followed pages
const getFollowedPagesPosts = async (req, res) => {
  try {
    const userId = req.user.userId || req.user.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const result = await pool.query(
      `SELECT p.id, p.content, p.feeling, p."mediaType", p."mediaUrl", p."createdAt", p."pageId",
              u.id as "userId", u."firstName", u."lastName", u."username", u."profileImageUrl",
              pg.name as "pageName"
       FROM "Post" p
       JOIN "User" u ON p."userId" = u.id
       JOIN "Page" pg ON p."pageId" = pg.id
       JOIN "PageFollower" pf ON pf."pageId" = pg.id
       WHERE pf."userId" = $1
         AND p."pageId" IS NOT NULL
         AND p."isHidden" = false
         AND u."isVerified" = true
         AND u."isBlocked" = false
         AND u."isDeleted" = false
       ORDER BY p."createdAt" DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const posts = result.rows.map((row) => ({
      id: row.id,
      content: row.content,
      feeling: row.feeling,
      mediaType: row.mediaType,
      mediaUrl: row.mediaUrl,
      createdAt: row.createdAt,
      pageId: row.pageId,
      pageName: row.pageName,
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
    console.error('Error fetching followed pages posts:', error);
    res.status(500).json({ message: 'Unable to fetch followed pages posts' });
  }
};

// Get all pages for admin with pagination and search
const getAllPagesAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build search condition
    const searchCondition = search 
      ? `(p.name ILIKE $1 OR p.slug ILIKE $1 OR u.username ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1 OR p.category ILIKE $1)`
      : 'TRUE';
    
    const searchParam = search ? `%${search}%` : null;

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM "Page" p
      LEFT JOIN "User" u ON p."ownerId" = u.id
      WHERE ${searchCondition}
    `;
    const countParams = searchParam ? [searchParam] : [];
    const countResult = await pool.query(countQuery, countParams);
    const totalPages = Math.ceil(countResult.rows[0].total / parseInt(limit));

    // Get paginated pages with owner info and post count
    const query = `
      SELECT 
        p.id,
        p.name,
        p.slug,
        p.category,
        p.description,
        p."profileImageUrl",
        p."bannerImageUrl",
        p."ownerId",
        json_build_object(
          'id', u.id,
          'firstName', u."firstName",
          'lastName', u."lastName",
          'username', u.username
        ) as owner,
        (SELECT COUNT(*) FROM "Post" WHERE "pageId" = p.id AND "isDeleted" = false) as post_count,
        (SELECT COUNT(*) FROM "PageFollower" WHERE "pageId" = p.id) as follower_count,
        p."createdAt" as created_at,
        p."updatedAt"
      FROM "Page" p
      LEFT JOIN "User" u ON p."ownerId" = u.id
      WHERE ${searchCondition}
      ORDER BY p."createdAt" DESC
      LIMIT $${searchParam ? 2 : 1} OFFSET $${searchParam ? 3 : 2}
    `;
    
    const params = searchParam 
      ? [searchParam, parseInt(limit), offset]
      : [parseInt(limit), offset];
    
    const result = await pool.query(query, params);

    // Parse JSON responses
    const pages = result.rows.map(row => ({
      ...row,
      postCount: parseInt(row.post_count) || 0,
      followerCount: parseInt(row.follower_count) || 0,
      createdDate: row.created_at,
      owner: typeof row.owner === 'string' ? JSON.parse(row.owner) : row.owner
    }));

    res.json({
      pages,
      totalPages,
      currentPage: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Error fetching admin pages:', error);
    res.status(500).json({ message: 'Error fetching pages', error: error.message });
  }
};

// Create a page report
const createPageReport = async (req, res) => {
  try {
    const { pageId } = req.params;
    const { reason, description } = req.body;
    const userId = req.user.userId || req.user.id;

    // Validation
    if (!pageId || isNaN(pageId)) {
      return res.status(400).json({ message: 'Invalid page ID' });
    }

    if (!reason || !['INAPPROPRIATE', 'SPAM', 'HARASSMENT', 'COPYRIGHT', 'OTHER'].includes(reason.toUpperCase())) {
      return res.status(400).json({ message: 'Invalid report reason' });
    }

    // Check if page exists
    const pageResult = await pool.query('SELECT id, "ownerId" FROM "Page" WHERE id = $1', [pageId]);
    if (pageResult.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }

    const pageOwnerId = pageResult.rows[0].ownerId;

    // Check if user is the page owner (owners cannot report their own pages)
    if (userId === pageOwnerId) {
      return res.status(403).json({ message: 'You cannot report your own page' });
    }

    // Check if user has already reported this page
    const existingReportResult = await pool.query(
      'SELECT id FROM "PageReport" WHERE "pageId" = $1 AND "reportedById" = $2',
      [pageId, userId]
    );
    
    if (existingReportResult.rows.length > 0) {
      return res.status(400).json({ message: 'You have already reported this page' });
    }

    // Create the report
    const reportResult = await pool.query(
      'INSERT INTO "PageReport" ("pageId", "reportedById", reason, description, status, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id',
      [pageId, userId, reason.toUpperCase(), description || null, 'PENDING']
    );

    res.status(201).json({
      message: 'Report submitted successfully',
      reportId: reportResult.rows[0].id
    });
  } catch (error) {
    console.error('Error creating page report:', error);
    res.status(500).json({ message: 'Error creating report', error: error.message });
  }
};

module.exports = {
  createPage,
  getPage,
  getPageBySlug,
  updatePage,
  deletePage,
  getAllPages,
  getUserOwnedPages,
  getUserFollowedPages,
  createPagePost,
  followPage,
  unfollowPage,
  getFollowedPagesPosts,
  getAllPagesAdmin,
  createPageReport};