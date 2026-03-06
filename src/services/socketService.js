const jwt = require('jsonwebtoken');
const pool = require('../config/db');

// In-memory store for online users
// Structure: Map<userId, Set<socketId>>
const onlineUsers = new Map();

class SocketService {
  constructor() {
    this.io = null;
  }

  initialize(server) {
    const { Server } = require('socket.io');
    
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    this.io.on('connection', (socket) => {
      console.log('Socket connected:', socket.id);

      // Handle authentication
      socket.on('authenticate', async (token) => {
        try {
          if (!token) {
            socket.emit('auth:error', { message: 'No token provided' });
            return;
          }

          if (socket.userId) {
            socket.emit('auth:success', { userId: socket.userId });
            return;
          }

          // Verify JWT token
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const userId = decoded.userId || decoded.id;

          if (!userId) {
            socket.emit('auth:error', { message: 'Invalid token' });
            return;
          }

          // Store userId on socket
          socket.userId = userId;

          // Add to online users
          if (!onlineUsers.has(userId)) {
            onlineUsers.set(userId, new Set());
          }
          onlineUsers.get(userId).add(socket.id);

          // Update lastSeenAt
          await pool.query(
            'UPDATE "User" SET "lastSeenAt" = NOW() WHERE id = $1',
            [userId]
          );

          // Notify user they're authenticated
          socket.emit('auth:success', { userId });

          // Send current online users to this user
          const currentOnlineUsers = Array.from(onlineUsers.keys());
          socket.emit('presence:initial', { onlineUsers: currentOnlineUsers });

          // Broadcast to all that this user is online
          this.io.emit('presence:update', {
            userId,
            isOnline: true
          });

          console.log(`User ${userId} is now online (socket: ${socket.id})`);
        } catch (error) {
          if (error?.name === 'TokenExpiredError') {
            console.warn('Socket auth warning: token expired', {
              socketId: socket.id,
              expiredAt: error.expiredAt
            });
            socket.emit('auth:error', { message: 'Token expired', code: 'TOKEN_EXPIRED' });
            socket.disconnect(true);
            return;
          }

          console.error('Socket auth error:', error?.message || error);
          socket.emit('auth:error', { message: 'Authentication failed', code: 'AUTH_FAILED' });
          socket.disconnect(true);
        }
      });

      // Handle disconnect
      socket.on('disconnect', async () => {
        console.log('Socket disconnected:', socket.id);

        const userId = socket.userId;
        if (!userId) return;

        // Remove this socket from user's set
        const userSockets = onlineUsers.get(userId);
        if (userSockets) {
          userSockets.delete(socket.id);

          // If no more sockets for this user, mark as offline
          if (userSockets.size === 0) {
            onlineUsers.delete(userId);

            // Update lastSeenAt
            try {
              await pool.query(
                'UPDATE "User" SET "lastSeenAt" = NOW() WHERE id = $1',
                [userId]
              );

              // Broadcast that user is offline
              this.io.emit('presence:update', {
                userId,
                isOnline: false
              });

              console.log(`User ${userId} is now offline`);
            } catch (error) {
              console.error('Error updating lastSeenAt:', error);
            }
          }
        }
      });
    });

    console.log('Socket.IO server initialized');
  }

  getOnlineUsers() {
    return Array.from(onlineUsers.keys());
  }

  isUserOnline(userId) {
    return onlineUsers.has(parseInt(userId));
  }

  emitToUser(userId, event, data) {
    const userSockets = onlineUsers.get(parseInt(userId));
    if (userSockets) {
      userSockets.forEach((socketId) => {
        this.io.to(socketId).emit(event, data);
      });
    }
  }
}

module.exports = new SocketService();
