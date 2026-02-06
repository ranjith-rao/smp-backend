const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Mount auth routes
app.use('/api/auth', require('./controllers/authController'));

// Mount user routes
const userController = require('./controllers/userController');
app.use('/api/users', userController);

// Health check route
app.get('/', (req, res) => {
    res.send('API is running...');
});

module.exports = app;