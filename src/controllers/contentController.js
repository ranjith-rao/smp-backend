const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');

const pool = require('../config/db');

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
    
    // Transform rows [{key: 'homeTitle', value: 'Nexus'}, {key: 'contactEmail', value: '..'}]
    // into a single object: { homeTitle: 'Nexus', contactEmail: '..' }
    const settingsObject = result.rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

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
  const settings = req.body; // Expects object like { homeTitle: 'Hello', homeSubtitle: 'World' }

  try {
    // We use a loop to handle each key-value pair
    const promises = Object.entries(settings).map(([key, value]) => {
      return pool.query(
        `INSERT INTO "Setting" (key, value) 
         VALUES ($1, $2) 
         ON CONFLICT (key) 
         DO UPDATE SET value = $2`,
        [key, value]
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