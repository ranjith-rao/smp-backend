const pool = require('../config/db');

// Generate slug from page name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .substring(0, 50); // Limit length
};

// Check if slug is unique
const isSlugUnique = async (slug) => {
  const result = await pool.query(
    'SELECT id FROM "Page" WHERE slug = $1',
    [slug]
  );
  return result.rows.length === 0;
};

// Get unique slug by appending number if needed
const getUniqueSlug = async (baseSlug) => {
  let slug = baseSlug;
  let counter = 1;
  
  while (!(await isSlugUnique(slug))) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  return slug;
};

// Create a new page
const createPage = async (userId, pageData) => {
  const baseSlug = generateSlug(pageData.name);
  const slug = await getUniqueSlug(baseSlug);
  
  const result = await pool.query(
    `INSERT INTO "Page" (name, slug, description, category, "bannerImageUrl", "profileImageUrl", "ownerId")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      pageData.name,
      slug,
      pageData.description,
      pageData.category,
      pageData.bannerImageUrl || null,
      pageData.profileImageUrl || null,
      userId
    ]
  );
  
  const page = result.rows[0];
  
  // Get owner
  const ownerResult = await pool.query(
    'SELECT id, "firstName", "lastName", "profileImageUrl" FROM "User" WHERE id = $1',
    [page.ownerId]
  );
  page.owner = ownerResult.rows[0];
  page.admins = [];
  page.followers = [];
  
  return page;
};

// Get page by ID with details
const getPageById = async (pageId) => {
  const result = await pool.query(
    'SELECT * FROM "Page" WHERE id = $1',
    [pageId]
  );
  
  if (result.rows.length === 0) return null;
  
  const page = result.rows[0];
  
  // Get owner
  const ownerResult = await pool.query(
    'SELECT id, "firstName", "lastName", "profileImageUrl" FROM "User" WHERE id = $1',
    [page.ownerId]
  );
  page.owner = ownerResult.rows[0];
  page.admins = [];
  
  // Get followers
  const followersResult = await pool.query(
    'SELECT "userId" FROM "PageFollower" WHERE "pageId" = $1',
    [pageId]
  );
  page.followers = followersResult.rows;
  
  // Get posts
  const postsResult = await pool.query(
    `SELECT p.*, u.id as "userId", u."firstName", u."lastName", u."profileImageUrl"
     FROM "Post" p
     JOIN "User" u ON p."userId" = u.id
     WHERE p."pageId" = $1 AND p."isHidden" = false
     ORDER BY p."createdAt" DESC`,
    [pageId]
  );
  page.posts = postsResult.rows.map(row => ({
    ...row,
    user: {
      id: row.userId,
      firstName: row.firstName,
      lastName: row.lastName,
      profileImageUrl: row.profileImageUrl
    }
  }));
  
  return page;
};

// Get page by slug
const getPageBySlug = async (slug) => {
  const result = await pool.query(
    'SELECT id FROM "Page" WHERE slug = $1',
    [slug]
  );
  
  if (result.rows.length === 0) return null;
  return getPageById(result.rows[0].id);
};

// Update page
const updatePage = async (pageId, ownerId, updateData) => {
  // Verify ownership
  const pageResult = await pool.query(
    'SELECT "ownerId" FROM "Page" WHERE id = $1',
    [pageId]
  );
  
  if (pageResult.rows.length === 0) {
    throw new Error('Page not found');
  }
  
  if (pageResult.rows[0].ownerId !== ownerId) {
    throw new Error('Only page owner can update page');
  }
  
  const fields = [];
  const values = [];
  let paramCount = 1;
  
  if (updateData.name) {
    fields.push(`name = $${paramCount}`);
    values.push(updateData.name);
    paramCount++;
  }
  if (updateData.description) {
    fields.push(`description = $${paramCount}`);
    values.push(updateData.description);
    paramCount++;
  }
  if (updateData.category) {
    fields.push(`category = $${paramCount}`);
    values.push(updateData.category);
    paramCount++;
  }
  if (updateData.bannerImageUrl !== undefined) {
    fields.push(`"bannerImageUrl" = $${paramCount}`);
    values.push(updateData.bannerImageUrl);
    paramCount++;
  }
  if (updateData.profileImageUrl !== undefined) {
    fields.push(`"profileImageUrl" = $${paramCount}`);
    values.push(updateData.profileImageUrl);
    paramCount++;
  }
  
  if (fields.length === 0) {
    return getPageById(pageId);
  }
  
  values.push(pageId);
  
  await pool.query(
    `UPDATE "Page" SET ${fields.join(', ')} WHERE id = $${paramCount}`,
    values
  );
  
  return getPageById(pageId);
};

// Delete page
const deletePage = async (pageId, ownerId) => {
  const pageResult = await pool.query(
    'SELECT "ownerId" FROM "Page" WHERE id = $1',
    [pageId]
  );
  
  if (pageResult.rows.length === 0) {
    throw new Error('Page not found');
  }
  
  if (pageResult.rows[0].ownerId !== ownerId) {
    throw new Error('Only page owner can delete page');
  }
  
  await pool.query('DELETE FROM "Page" WHERE id = $1', [pageId]);
};

// Follow page
const followPage = async (pageId, userId) => {
  const result = await pool.query(
    `INSERT INTO "PageFollower" ("pageId", "userId") VALUES ($1, $2) RETURNING *`,
    [pageId, userId]
  );
  return result.rows[0];
};

// Unfollow page
const unfollowPage = async (pageId, userId) => {
  await pool.query(
    `DELETE FROM "PageFollower" WHERE "pageId" = $1 AND "userId" = $2`,
    [pageId, userId]
  );
};

// Check if user follows page
const isUserFollowingPage = async (pageId, userId) => {
  const result = await pool.query(
    `SELECT id FROM "PageFollower" WHERE "pageId" = $1 AND "userId" = $2`,
    [pageId, userId]
  );
  return result.rows.length > 0;
};

// Get page followers count
const getPageFollowersCount = async (pageId) => {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM "PageFollower" WHERE "pageId" = $1`,
    [pageId]
  );
  return parseInt(result.rows[0].count, 10);
};

// Get all pages with pagination and search
const getAllPages = async (search = '', category = '', skip = 0, take = 20) => {
  let query = 'SELECT p.*, COUNT(DISTINCT pf."userId") as "followersCount", COUNT(DISTINCT po.id) as "postsCount" FROM "Page" p LEFT JOIN "PageFollower" pf ON p.id = pf."pageId" LEFT JOIN "Post" po ON p.id = po."pageId" WHERE 1=1';
  const values = [];
  let paramCount = 1;
  
  if (search) {
    query += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount})`;
    values.push(`%${search}%`);
    paramCount++;
  }
  
  if (category && category !== 'ALL') {
    query += ` AND p.category = $${paramCount}`;
    values.push(category);
    paramCount++;
  }
  
  query += ` GROUP BY p.id ORDER BY p."createdAt" DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
  values.push(take, skip);
  
  const result = await pool.query(query, values);
  
  // Fetch owner details for each page
  const pages = await Promise.all(
    result.rows.map(async (page) => {
      const ownerResult = await pool.query(
        'SELECT id, "firstName", "lastName", "profileImageUrl" FROM "User" WHERE id = $1',
        [page.ownerId]
      );
      return {
        ...page,
        owner: ownerResult.rows[0],
        _count: {
          followers: parseInt(page.followersCount, 10),
          posts: parseInt(page.postsCount, 10)
        }
      };
    })
  );
  
  return pages;
};

// Get user's owned pages
const getUserOwnedPages = async (userId) => {
  const result = await pool.query(
    `SELECT p.*, COUNT(DISTINCT pf."userId") as "followersCount", COUNT(DISTINCT po.id) as "postsCount"
     FROM "Page" p
     LEFT JOIN "PageFollower" pf ON p.id = pf."pageId"
     LEFT JOIN "Post" po ON p.id = po."pageId"
     WHERE p."ownerId" = $1
     GROUP BY p.id
     ORDER BY p."createdAt" DESC`,
    [userId]
  );
  
  return result.rows.map(row => ({
    ...row,
    _count: {
      followers: parseInt(row.followersCount, 10),
      posts: parseInt(row.postsCount, 10)
    }
  }));
};

// Get user's followed pages
const getUserFollowedPages = async (userId) => {
  const result = await pool.query(
    `SELECT p.id, p.name, p.slug, p.description, p.category,
            p."bannerImageUrl" as "bannerImageUrl",
            p."profileImageUrl" as "profileImageUrl",
            p."ownerId" as "pageOwnerId",
            p."createdAt" as "createdAt",
            p."updatedAt" as "updatedAt",
            COUNT(DISTINCT pf2."userId") as "followersCount", COUNT(DISTINCT po.id) as "postsCount", 
            u.id as "ownerId", u."firstName" as "ownerFirstName", u."lastName" as "ownerLastName"
     FROM "PageFollower" pf
     JOIN "Page" p ON pf."pageId" = p.id
     LEFT JOIN "PageFollower" pf2 ON p.id = pf2."pageId"
     LEFT JOIN "Post" po ON p.id = po."pageId"
     JOIN "User" u ON p."ownerId" = u.id
     WHERE pf."userId" = $1
     GROUP BY p.id, u.id
     ORDER BY p."createdAt" DESC`,
    [userId]
  );
  
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    category: row.category,
    bannerImageUrl: row.bannerImageUrl,
    profileImageUrl: row.profileImageUrl || row.profileimageurl || null,
    ownerId: row.pageOwnerId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    owner: {
      id: row.ownerId,
      firstName: row.ownerFirstName,
      lastName: row.ownerLastName
    },
    _count: {
      followers: parseInt(row.followersCount, 10),
      posts: parseInt(row.postsCount, 10)
    }
  }));
};

module.exports = {
  generateSlug,
  isSlugUnique,
  getUniqueSlug,
  createPage,
  getPageById,
  getPageBySlug,
  updatePage,
  deletePage,
  followPage,
  unfollowPage,
  isUserFollowingPage,
  getPageFollowersCount,
  getAllPages,
  getUserOwnedPages,
  getUserFollowedPages
};
