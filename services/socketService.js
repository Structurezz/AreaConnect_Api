let io = null;

const initSocket = (server) => {
  const { Server } = require('socket.io');
  const allowedOrigins = process.env.NODE_ENV === 'production'
    ? (process.env.CLIENT_URL || '').split(',').map(o => o.trim())
    : [5173, 5174, 5175, 5176, 5177, 5178].map(p => `http://localhost:${p}`);

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  const connectedUsers = new Map(); // userId -> socketId

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('join', ({ userId, estateId }) => {
      socket.join(`estate:${estateId}`);
      socket.join(`user:${userId}`);
      connectedUsers.set(userId, socket.id);
    });

    socket.on('send_message', (data) => {
      if (data.isGroupMessage) {
        io.to(`estate:${data.estateId}`).emit('new_message', data);
      } else {
        io.to(`user:${data.receiverId}`).emit('new_message', data);
        socket.emit('new_message', data); // echo back to sender
      }
    });

    socket.on('typing', ({ estateId, senderId, receiverId, isGroup }) => {
      if (isGroup) {
        socket.to(`estate:${estateId}`).emit('user_typing', { senderId });
      } else {
        io.to(`user:${receiverId}`).emit('user_typing', { senderId });
      }
    });

    socket.on('disconnect', () => {
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          break;
        }
      }
    });
  });

  return io;
};

/** Emit a security alert to all security/manager sockets in an estate */
const emitAlert = (estateId, alert) => {
  if (io) {
    io.to(`estate:${estateId}`).emit('new_alert', alert);
  }
};

/** Emit visitor check-in/out event */
const emitVisitorUpdate = (estateId, visitor) => {
  if (io) {
    io.to(`estate:${estateId}`).emit('visitor_update', visitor);
  }
};

const emitAnnouncement = (estateId, announcement) => {
  if (io) {
    io.to(`estate:${estateId}`).emit('new_announcement', announcement);
  }
};

const emitNkechiTyping = (estateId, isTyping) => {
  if (io) {
    io.to(`estate:${estateId}`).emit('nkechi_typing', { isTyping });
  }
};

const emitGroupMessage = (estateId, message) => {
  if (io) {
    io.to(`estate:${estateId}`).emit('new_message', message);
  }
};

const getIO = () => io;

module.exports = { initSocket, emitAlert, emitVisitorUpdate, emitAnnouncement, emitNkechiTyping, emitGroupMessage, getIO };
