let io = null;

const initSocket = (server) => {
  const { Server } = require('socket.io');

  const originFn = (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      /\.areaconnect\.pro$/.test(origin) ||
      /\.up\.railway\.app$/.test(origin) ||
      /^http:\/\/localhost:\d+$/.test(origin)
    ) {
      return callback(null, true);
    }
    callback(new Error(`Socket CORS: origin ${origin} not allowed`));
  };

  io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' ? originFn : true,
      credentials: true,
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true,
  });

  const connectedUsers = new Map(); // userId -> socketId

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    socket.on('join', ({ userId, estateId, role }) => {
      socket.join(`estate:${estateId}`);
      socket.join(`user:${userId}`);
      if (role === 'security') {
        socket.join(`estate:${estateId}:security`);
        socket.join(`estate:${estateId}:staff`);
      } else if (role === 'estate_manager' || role === 'super_admin') {
        socket.join(`estate:${estateId}:estate_manager`);
        socket.join(`estate:${estateId}:staff`);
      }
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

/**
 * Emit a security alert. Room targeting is derived from alert.audience:
 *   'all'            → everyone in the estate
 *   'staff'          → security + estate_manager
 *   'estate_manager' → estate_manager only
 *   'security'       → security only
 * Legacy alerts without an audience field are treated as 'all'.
 */
const emitAlert = (estateId, alert) => {
  if (!io) return;
  const audience = alert && alert.audience;
  let room = `estate:${estateId}`;
  if (audience === 'staff') room = `estate:${estateId}:staff`;
  else if (audience === 'estate_manager') room = `estate:${estateId}:estate_manager`;
  else if (audience === 'security') room = `estate:${estateId}:security`;
  io.to(room).emit('new_alert', alert);
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

/**
 * Emit a notification to a specific user or (fallback) everyone in an estate.
 * Shape: { id, type, title, body, amount?, meta?, createdAt }
 * Pass userId to target one user; omit/null to broadcast estate-wide.
 */
const emitNotification = (estateId, notification, userId = null) => {
  if (io) {
    const room = userId ? `user:${userId}` : `estate:${estateId}`;
    io.to(room).emit('notification', {
      ...notification,
      createdAt: notification.createdAt || new Date().toISOString(),
    });
  }
};

const getIO = () => io;

module.exports = { initSocket, emitAlert, emitVisitorUpdate, emitAnnouncement, emitNkechiTyping, emitGroupMessage, emitNotification, getIO };
