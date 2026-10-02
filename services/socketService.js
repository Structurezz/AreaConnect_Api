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

    // ── Live audio (DJ + Podcast) ──────────────────────────────────────────
    // socket.data.live tracks what live rooms this socket is in so we can
    // clean up listener counts on disconnect.
    socket.data.live = { dj: null, podcast: null, role: null };

    const broadcastDJCount = (sessionId) => {
      const room = `dj:${sessionId}:listeners`;
      const size = io.sockets.adapter.rooms.get(room)?.size || 0;
      io.to(`dj:${sessionId}`).emit('dj:listener-count', { sessionId, count: size });
    };

    const broadcastPodcastCount = (showId) => {
      const room = `podcast:${showId}:listeners`;
      const size = io.sockets.adapter.rooms.get(room)?.size || 0;
      io.to(`podcast:${showId}`).emit('podcast:listener-count', { showId, count: size });
    };

    // DJ host — announces themselves so listeners can address offers
    socket.on('dj:host-ready', ({ sessionId }) => {
      if (!sessionId) return;
      socket.join(`dj:${sessionId}`);
      socket.join(`dj:${sessionId}:host`);
      socket.data.live.dj = sessionId;
      socket.data.live.role = 'host';
      broadcastDJCount(sessionId);
    });

    // Listener joining a DJ session
    socket.on('dj:listener-ready', ({ sessionId }) => {
      if (!sessionId) return;
      socket.join(`dj:${sessionId}`);
      socket.join(`dj:${sessionId}:listeners`);
      socket.data.live.dj = sessionId;
      socket.data.live.role = 'listener';
      // Tell the host a new listener is waiting for an offer
      io.to(`dj:${sessionId}:host`).emit('dj:new-listener', { socketId: socket.id });
      broadcastDJCount(sessionId);
    });

    socket.on('dj:leave', ({ sessionId }) => {
      if (!sessionId) return;
      socket.leave(`dj:${sessionId}`);
      socket.leave(`dj:${sessionId}:listeners`);
      socket.leave(`dj:${sessionId}:host`);
      socket.data.live.dj = null;
      broadcastDJCount(sessionId);
    });

    // Podcast host — same shape
    socket.on('podcast:host-ready', ({ showId }) => {
      if (!showId) return;
      socket.join(`podcast:${showId}`);
      socket.join(`podcast:${showId}:host`);
      socket.data.live.podcast = showId;
      socket.data.live.role = 'host';
      broadcastPodcastCount(showId);
    });

    socket.on('podcast:guest-ready', ({ showId, guestId, name }) => {
      if (!showId) return;
      socket.join(`podcast:${showId}`);
      socket.join(`podcast:${showId}:speakers`);
      socket.data.live.podcast = showId;
      socket.data.live.role = 'guest';
      socket.data.live.guestId = guestId;
      socket.data.live.guestName = name;
      io.to(`podcast:${showId}:host`).emit('podcast:new-guest', { socketId: socket.id, guestId, name });
    });

    socket.on('podcast:listener-ready', ({ showId }) => {
      if (!showId) return;
      socket.join(`podcast:${showId}`);
      socket.join(`podcast:${showId}:listeners`);
      socket.data.live.podcast = showId;
      socket.data.live.role = 'listener';
      io.to(`podcast:${showId}:host`).emit('podcast:new-listener', { socketId: socket.id });
      broadcastPodcastCount(showId);
    });

    socket.on('podcast:leave', ({ showId }) => {
      if (!showId) return;
      ['', ':host', ':speakers', ':listeners'].forEach(suffix =>
        socket.leave(`podcast:${showId}${suffix}`));
      socket.data.live.podcast = null;
      broadcastPodcastCount(showId);
    });

    // ── Call-ins (listener → raise hand → host approves → promoted to speaker) ─
    socket.on('podcast:raise-hand', ({ showId, userId, userName, userPhoto }) => {
      if (!showId) return;
      io.to(`podcast:${showId}:host`).emit('podcast:hand-raised', {
        socketId: socket.id, userId, userName, userPhoto, at: Date.now(),
      });
    });

    socket.on('podcast:lower-hand', ({ showId }) => {
      if (!showId) return;
      io.to(`podcast:${showId}:host`).emit('podcast:hand-lowered', { socketId: socket.id });
    });

    // Host approves/denies a raised hand
    socket.on('podcast:approve-hand', ({ showId, socketId }) => {
      if (!showId || !socketId) return;
      // Promote target listener to speaker
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.leave(`podcast:${showId}:listeners`);
        targetSocket.join(`podcast:${showId}:speakers`);
        targetSocket.data.live.role = 'caller';
      }
      io.to(socketId).emit('podcast:hand-approved', { showId });
      io.to(`podcast:${showId}:host`).emit('podcast:caller-promoted', { socketId });
      broadcastPodcastCount(showId);
    });

    socket.on('podcast:deny-hand', ({ showId, socketId }) => {
      if (!showId || !socketId) return;
      io.to(socketId).emit('podcast:hand-denied', { showId });
    });

    // Host removes a caller (demote back to listener)
    socket.on('podcast:remove-caller', ({ showId, socketId }) => {
      if (!showId || !socketId) return;
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.leave(`podcast:${showId}:speakers`);
        targetSocket.join(`podcast:${showId}:listeners`);
        targetSocket.data.live.role = 'listener';
      }
      io.to(socketId).emit('podcast:caller-removed', { showId });
      broadcastPodcastCount(showId);
    });

    // Generic WebRTC signaling relay (works for DJ + Podcast)
    socket.on('rtc:offer',  ({ to, sdp, meta }) => {
      if (!to) return;
      io.to(to).emit('rtc:offer', { from: socket.id, sdp, meta });
    });
    socket.on('rtc:answer', ({ to, sdp, meta }) => {
      if (!to) return;
      io.to(to).emit('rtc:answer', { from: socket.id, sdp, meta });
    });
    socket.on('rtc:ice',    ({ to, candidate, meta }) => {
      if (!to) return;
      io.to(to).emit('rtc:ice', { from: socket.id, candidate, meta });
    });

    // Live reactions (💃🔥👏 etc.) — ephemeral, no persistence
    socket.on('live:reaction', ({ roomType, roomId, emoji, userName }) => {
      if (!roomType || !roomId || !emoji) return;
      const room = `${roomType}:${roomId}`;
      io.to(room).emit('live:reaction', { emoji, userName, at: Date.now() });
    });

    socket.on('disconnect', () => {
      // Cleanup live-audio room membership (counts are tracked by room size,
      // so leaving via socket.leave on disconnect is implicit — but we still
      // need to broadcast the updated count to the room).
      const { dj, podcast } = socket.data.live || {};
      if (dj) setTimeout(() => broadcastDJCount(dj), 0);
      if (podcast) setTimeout(() => broadcastPodcastCount(podcast), 0);

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

/** A visitor has shown up early and the guard is waiting for the host's call */
const emitEarlyArrival = (hostUserId, payload) => {
  if (!io || !hostUserId) return;
  io.to(`user:${hostUserId}`).emit('visitor_early_arrival', payload);
};

/** Host has approved early entry — tell any guard on duty in the estate */
const emitEarlyApproved = (estateId, payload) => {
  if (!io) return;
  io.to(`estate:${estateId}:security`).emit('visitor_early_approved', payload);
  io.to(`estate:${estateId}:staff`).emit('visitor_early_approved', payload);
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

/**
 * Broadcast a notification to every connected client (across all estates).
 * Used for platform-wide events like AreaConnect FM going live.
 */
const emitGlobalNotification = (notification) => {
  if (!io) return;
  io.emit('notification', {
    ...notification,
    createdAt: notification.createdAt || new Date().toISOString(),
  });
};

module.exports = { initSocket, emitAlert, emitVisitorUpdate, emitEarlyArrival, emitEarlyApproved, emitAnnouncement, emitNkechiTyping, emitGroupMessage, emitNotification, emitGlobalNotification, getIO };
