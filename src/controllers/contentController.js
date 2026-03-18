const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');

const pool = require('../config/db');

const DEFAULT_SETTINGS = {
  appName: 'NEXUS',
  appTagline: 'The social platform where connections matter.',
  logoUrl: '',
  faviconUrl: '',
  contactEmail: 'support@nexus.com',
  contactPhone: '+1 (555) 123-4567',
  termsHtml: '<h2>Terms and Conditions</h2><p>Please replace this content from Admin Settings.</p>',
  privacyHtml: '<h2>Privacy Policy</h2><p>Please replace this content from Admin Settings.</p>',
  heroBadge: '✨ The next-gen social space',
  heroTitle: 'Welcome to NEXUS',
  heroSubtitle: 'The social platform where connections matter',
  heroImageUrl: '/hero-illustration.svg',
  statsJson: [
    { value: '120k+', label: 'Active Members' },
    { value: '4.6M', label: 'Posts Shared' },
    { value: '92%', label: 'Positive Interactions' },
    { value: '48+', label: 'Countries Connected' },
  ],
  aboutTitle: 'Build your community here',
  aboutDescription: 'NEXUS is a modern social platform designed to bring people together.',
  aboutBulletsJson: [
    '✨ Clean and intuitive user interface',
    '🔒 Privacy-first approach to social networking',
    '💬 Real-time messaging and notifications',
    '👥 Connect with like-minded individuals',
    '🌟 Build your community with ease',
  ],
  aboutImageUrl: '/mockup-feed.svg',
  featuresJson: [
    { icon: '💬', title: 'Real Conversations', description: 'Build meaningful connections with people who share your interests and passions.' },
    { icon: '📝', title: 'Creator Tools', description: 'Express yourself freely and share your thoughts, photos, and experiences.' },
    { icon: '❤️', title: 'Engagement', description: 'Like, comment, and interact with content from your connections.' },
    { icon: '🔔', title: 'Smart Alerts', description: 'Never miss important updates with real-time notifications.' },
  ],
  ctaTitle: 'Ready to build your social graph?',
  ctaDescription: 'Join NEXUS and discover meaningful conversations today.',
  ctaButtonText: 'Create your account',
};

const parseSettingValue = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return value;
    }
  }
  return value;
};

const serializeSettingValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

// ---------------------------------------------------------
// PUBLIC ROUTES
// ---------------------------------------------------------

/**
 * GET /api/content/landing-page
 * Fetches all site settings and converts them from a list into a single object.
 */
router.get('/landing-page', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "Setting"');

    const settingsObject = result.rows.reduce((acc, row) => {
      acc[row.key] = parseSettingValue(row.value);
      return acc;
    }, { ...DEFAULT_SETTINGS });

    // Legacy compatibility keys
    if (!settingsObject.homeTitle && settingsObject.heroTitle) settingsObject.homeTitle = settingsObject.heroTitle;
    if (!settingsObject.homeSubtitle && settingsObject.heroSubtitle) settingsObject.homeSubtitle = settingsObject.heroSubtitle;
    if (!settingsObject.homeDescription && settingsObject.aboutDescription) settingsObject.homeDescription = settingsObject.aboutDescription;

    res.json(settingsObject);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching content' });
  }
});

/**
 * POST /api/content/contact
 * Public endpoint for users to submit the contact form.
 */
router.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ message: 'Please fill in all required fields.' });
  }

  try {
    await pool.query(
      'INSERT INTO "ContactQuery" (name, email, subject, message) VALUES ($1, $2, $3, $4)',
      [name, email, subject, message]
    );
    res.status(201).json({ message: 'Your message has been sent successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to send message.' });
  }
});

// ---------------------------------------------------------
// ADMIN ROUTES (Protected)
// ---------------------------------------------------------

/**
 * PUT /api/content/settings
 * Allows Admin to update multiple settings at once.
 */
router.put('/settings', verifyToken, isAdmin, async (req, res) => {
  const settings = req.body;

  try {
    const promises = Object.entries(settings).map(([key, value]) => {
      return pool.query(
        `INSERT INTO "Setting" (key, value) 
         VALUES ($1, $2) 
         ON CONFLICT (key) 
         DO UPDATE SET value = $2`,
        [key, serializeSettingValue(value)]
      );
    });

    await Promise.all(promises);
    res.json({ message: 'Settings updated successfully!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update settings.' });
  }
});

/**
 * POST /api/content/admin/change-password
 * Allows currently logged in admin to change own password.
 */
router.post('/admin/change-password', verifyToken, isAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current password and new password are required.' });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters.' });
  }

  try {
    const userResult = await pool.query('SELECT id, password FROM "User" WHERE id = $1 AND role = $2', [req.user.userId, 'ADMIN']);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Admin account not found.' });
    }

    const admin = userResult.rows[0];
    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE "User" SET password = $1 WHERE id = $2', [hashedPassword, admin.id]);

    return res.json({ message: 'Password updated successfully.' });
  } catch (error) {
    console.error('Admin password change error:', error);
    return res.status(500).json({ message: 'Unable to change password.' });
  }
});

/**
 * GET /api/content/queries
 * Fetches all contact form submissions for the Admin.
 */
router.get('/queries', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM "ContactQuery" ORDER BY "createdAt" DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching queries.' });
  }
});

/**
 * DELETE /api/content/queries/:id
 * Allows Admin to delete a specific query.
 */
router.delete('/queries/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM "ContactQuery" WHERE id = $1', [req.params.id]);
    res.json({ message: 'Query deleted successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete query.' });
  }
});

module.exports = router;