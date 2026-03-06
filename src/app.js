const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Mount auth routes
app.use('/api/auth', require('./controllers/authController'));

// Mount user routes
const userController = require('./controllers/userController');
app.use('/api/users', userController);

app.use('/api/content', require('./controllers/contentController'));
app.use('/api/posts', require('./controllers/postController'));
app.use('/api/pages', require('./routes/pageRoutes'));
app.use('/api/presence', require('./routes/presenceRoutes'));
app.use('/api/chats', require('./routes/chatRoutes'));

// Health check route
app.get('/', (req, res) => {
    res.send('API is running...');
});

module.exports = app;