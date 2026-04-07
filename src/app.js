const express = require('express');
const cors = require('cors');

const app = express();

const REQUEST_BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '25mb';

app.use(cors());
app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(express.urlencoded({ limit: REQUEST_BODY_LIMIT, extended: true }));

// Mount auth routes
app.use('/api/auth', require('./controllers/authController'));

// Mount user routes
const userController = require('./controllers/userController');
app.use('/api/users', userController);

app.use('/api/content', require('./controllers/contentController'));
app.use('/api/posts', require('./controllers/postController'));
app.use('/api/notifications', require('./controllers/notificationController'));
app.use('/api/stories', require('./controllers/storyController'));
app.use('/api/pages', require('./routes/pageRoutes'));
app.use('/api/presence', require('./routes/presenceRoutes'));
app.use('/api/chats', require('./routes/chatRoutes'));

// Health check route
app.get('/', (req, res) => {
    res.send('API is running...');
});

module.exports = app;