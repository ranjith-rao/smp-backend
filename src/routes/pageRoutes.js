const express = require('express');
const pageController = require('../controllers/pageController');
const { verifyToken, optionalAuth, isAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();

// Admin: Get all pages (protected admin only)
router.get('/admin', verifyToken, isAdmin, pageController.getAllPagesAdmin);

// Create page (protected)
router.post('/', verifyToken, pageController.createPage);

// Get all pages (public)
router.get('/', pageController.getAllPages);

// Get user's owned pages (protected)
router.get('/user/owned-pages', verifyToken, pageController.getUserOwnedPages);

// Get user's followed pages (protected)
router.get('/user/followed-pages', verifyToken, pageController.getUserFollowedPages);

// Get posts from followed pages (protected)
router.get('/feed/followed-pages', verifyToken, pageController.getFollowedPagesPosts);

// Get page by slug (public, optional auth)
router.get('/slug/:slug', optionalAuth, pageController.getPageBySlug);

// Get page by ID (public, optional auth)
router.get('/:pageId', optionalAuth, pageController.getPage);

// Update page (protected, owner only)
router.patch('/:pageId', verifyToken, pageController.updatePage);

// Delete page (protected, owner only)
router.delete('/:pageId', verifyToken, pageController.deletePage);

// Create page post (protected, owner/admin only)
router.post('/:pageId/posts', verifyToken, pageController.createPagePost);

// Follow page (protected)
router.post('/:pageId/follow', verifyToken, pageController.followPage);

// Unfollow page (protected)
router.delete('/:pageId/follow', verifyToken, pageController.unfollowPage);

// Report page (protected)
router.post('/:pageId/report', verifyToken, pageController.createPageReport);

module.exports = router;
