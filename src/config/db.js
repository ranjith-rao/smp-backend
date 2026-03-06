const { Pool } = require('pg');
require('dotenv').config();

// Create ONE pool for the whole app
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Log when a connection is made
// pool.on('connect', () => {
//   console.log('Database connected successfully');
// });

module.exports = pool;