const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
require('dotenv').config();

// Database
const connectDB = require('./config/database');
const Message = require('./models/Message');
const RoomModel = require('./models/Room');
const FeedPost = require('./models/FeedPost');
const DirectMessage = require('./models/DirectMessage');
const User = require('./models/User');
const { sendMail, isMailerConfigured, getMailerDebugInfo } = require('./config/mailer');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

// Bump this string when diagnosing deployments / stale server processes.
const SERVER_BUILD = process.env.SERVER_BUILD || '2026-01-20-join-friend-room-v1';

const DEBUG_LOGS = /^(1|true|yes)$/i.test(String(process.env.DEBUG_LOGS || '').trim());
const debugLog = (...args) => {
  if (DEBUG_LOGS) console.log(...args);
};

if (process.env.NODE_ENV === 'production') {
  try {
    const configured = isMailerConfigured();
    const info = getMailerDebugInfo();
    console.log(`✉️  SMTP configured: ${configured ? 'yes' : 'no'}`);
    console.log('✉️  SMTP settings:', info);
  } catch {
    // ignore
  }
}

app.use(cors());
// Allow small base64 profile pictures (after client-side crop/resize).
app.use(express.json({ limit: '4mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024 // 8MB
  },
  fileFilter: (req, file, cb) => {
    if (file?.mimetype?.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image uploads are allowed'));
  }
});

// Database is the source of truth for persistence.
let useDatabase = false;

let uploadsBucket = null;

// Serve static files in production *only if* the client build exists.
// When deploying the frontend separately (e.g., Render Static Site), the backend
// won't have `client/build`, and attempting to serve it causes ENOENT errors.
if (process.env.NODE_ENV === 'production') {
  const clientBuildDir = path.join(__dirname, '../client/build');
  const clientIndexHtml = path.join(clientBuildDir, 'index.html');

  if (fs.existsSync(clientIndexHtml)) {
    app.use(express.static(clientBuildDir));
    // Do not intercept API routes.
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(clientIndexHtml);
    });
  } else {
    console.warn('⚠️  Client build not found at', clientBuildDir);
    console.warn('   Skipping static file serving (deploy the client separately).');
  }
}

// In-memory storage (fallback when no database)
const users = new Map();
const rooms = new Map();

// --- Voice (WebRTC signaling + presence) ---
// NOTE: This is a simple mesh/P2P signaling layer suitable for small rooms.
// In production for larger rooms, consider a SFU (e.g., mediasoup) + TURN.
const voiceChannels = new Map(); // channelId -> Map(userId -> { socketId, muted, deafened })
const voiceBySocket = new Map(); // socketId -> { channelId, userId }

function getVoiceChannel(channelId) {
  const id = String(channelId || '').trim();
  if (!id) return null;
  if (!voiceChannels.has(id)) voiceChannels.set(id, new Map());
  return voiceChannels.get(id);
}

function leaveVoiceBySocket(socketId) {
  const entry = voiceBySocket.get(socketId);
  if (!entry) return;

  const { channelId, userId } = entry;
  voiceBySocket.delete(socketId);

  const chan = voiceChannels.get(channelId);
  if (chan) {
    chan.delete(String(userId));
    // Notify others in the channel.
    for (const [_, info] of chan.entries()) {
      if (!info?.socketId) continue;
      io.to(info.socketId).emit('voice:peer-left', { userId: String(userId) });
    }
    if (chan.size === 0) voiceChannels.delete(channelId);
  }
}

// Auto-delete empty rooms after 5 minutes
const EMPTY_ROOM_DELETE_AFTER_MS = 5 * 60 * 1000;
const EMPTY_ROOM_SWEEP_INTERVAL_MS = 60 * 1000;

// --- Auth: email verification + password reset ---
const EMAIL_VERIFY_EXPIRES_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_EXPIRES_MS = 60 * 60 * 1000; // 1h

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createOpaqueToken() {
  // URL-safe enough when hex; keep simple.
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function getClientBaseUrl() {
  return process.env.CLIENT_URL || 'http://localhost:3000';
}

function getServerBaseUrl() {
  // Used for links sent via email. In production, set SERVER_PUBLIC_URL to your public backend URL.
  // Example: https://your-app.up.railway.app
  return process.env.SERVER_PUBLIC_URL || `http://localhost:${PORT}`;
}

async function sendVerificationEmail({ email, token }) {
  // Use server URL so the link works even if the frontend isn't running.
  const verifyUrl = `${getServerBaseUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const subject = 'Verify your Hangout Bar email';
  const text = `Verify your email by opening: ${verifyUrl}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>Verify your email</h2>
      <p>Thanks for signing up to Hangout Bar. Please verify your email to finish setup.</p>
      <p><a href="${verifyUrl}">Verify Email</a></p>
      <p style="color:#64748b;font-size:12px">If you didn't sign up, you can ignore this email.</p>
    </div>
  `;

  const result = await sendMail({ to: email, subject, html, text });
  if (result?.skipped) {
    console.log(`\n[Email skipped: SMTP not configured] Verification link for ${email}: ${verifyUrl}\n`);
  } else if (result?.ok === false) {
    console.error(`[Email failed] Verification email to ${email}: ${result?.error || 'unknown error'}`);
  }

  return result;
}

async function sendPasswordResetEmail({ email, token }) {
  // Use server URL so the link works even if the frontend isn't running.
  const resetUrl = `${getServerBaseUrl()}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
  const subject = 'Reset your Hangout Bar password';
  const text = `Reset your password by opening: ${resetUrl}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5">
      <h2>Password reset</h2>
      <p>We received a request to reset your Hangout Bar password.</p>
      <p><a href="${resetUrl}">Reset Password</a></p>
      <p style="color:#64748b;font-size:12px">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
    </div>
  `;

  const result = await sendMail({ to: email, subject, html, text });
  if (result?.skipped) {
    console.log(`\n[Email skipped: SMTP not configured] Password reset link for ${email}: ${resetUrl}\n`);
  } else if (result?.ok === false) {
    console.error(`[Email failed] Password reset email to ${email}: ${result?.error || 'unknown error'}`);
  }

  return result;
}

// --- Socket user helpers (DB userId <-> socket.id) ---
function findSocketIdByUserId(userId) {
  if (!userId) return null;
  const entry = Array.from(users.entries()).find(([_, u]) => u?.id === userId);
  return entry ? entry[0] : null;
}

function findOnlineUserById(userId) {
  if (!userId) return null;
  return Array.from(users.values()).find(u => u?.id === userId) || null;
}

function buildFriendPayload(friendDocOrUser, onlineUser) {
  const id = friendDocOrUser?._id ? friendDocOrUser._id.toString() : friendDocOrUser?.id;
  const roomId = onlineUser?.currentRoom || null;
  const roomName = roomId ? (rooms.get(roomId)?.name || null) : null;
  return {
    id,
    username: friendDocOrUser?.username,
    avatar: friendDocOrUser?.avatar,
    profilePicture: friendDocOrUser?.profilePicture || '',
    online: !!onlineUser,
    inRoom: !!onlineUser?.currentRoom,
    roomId,
    roomName
  };
}

function extractMentionUsernames(text) {
  const input = String(text || '');
  // Mentions: @username (letters/numbers/underscore). Keep simple and deterministic.
  const matches = input.match(/(^|\s)@([A-Za-z0-9_]{2,30})\b/g) || [];
  const names = matches
    .map(m => (m.trim().startsWith('@') ? m.trim().slice(1) : m.trim().split('@')[1]))
    .filter(Boolean);
  return Array.from(new Set(names));
}

async function resolveMentionedUsersByUsername(usernames) {
  const list = Array.isArray(usernames) ? usernames : [];
  const safe = list
    .map(u => String(u || '').trim())
    .filter(u => u.length >= 2)
    .slice(0, 15);
  if (safe.length === 0) return [];

  const docs = await User.find({ username: { $in: safe } })
    .select('_id username avatar profilePicture')
    .lean();
  return docs.map(d => ({
    id: d._id.toString(),
    username: d.username,
    avatar: d.avatar || '👤',
    profilePicture: d.profilePicture || ''
  }));
}

function emitFeedNotificationToUserId(userId, payload) {
  const socketId = findSocketIdByUserId(userId);
  if (!socketId) return;
  io.to(socketId).emit('feedNotification', payload);
}

// Room class
class Room {
  constructor(id, name, isPrivate, host) {
    this.id = id;
    this.name = name;
    this.isPrivate = isPrivate;
    // host is a DB userId string
    this.host = host;
    // members stores socket.id values (runtime only)
    this.members = new Set();
    this.messages = [];
    this.youtube = { videoId: null, playing: false, timestamp: 0, lastUpdate: Date.now() };
    this.drawings = [];
    this.createdAt = Date.now();
    this.deleteTimer = null; // Timer for auto-delete when empty

    // Guess Game state (in-memory)
    this.guessGame = {
      active: false,
      phase: 'IDLE', // IDLE | THEME_SELECT | SUBJECT_SELECT | DRAW | ANSWER
      drawerUserId: null,
      turnOrder: [],
      turnIndex: 0,
      themeOptions: [],
      theme: null,
      subjectOptions: [],
      subject: null,
      endsAt: null,
      timer: null,
      scores: {},
      correctGuessers: new Set()
    };
  }

  addMember(userId) {
    this.members.add(userId);
    // Clear auto-delete timer if someone joins
    if (this.deleteTimer) {
      clearTimeout(this.deleteTimer);
      this.deleteTimer = null;
    }
  }

  removeMember(socketId) {
    this.members.delete(socketId);
    if (this.members.size === 0) return true; // Room is empty

    // If the room host (by DB userId) disconnected, transfer host to next remaining member's DB userId.
    const leavingUserId = users.get(socketId)?.id;
    if (leavingUserId && leavingUserId === this.host && this.members.size > 0) {
      const nextSocketId = Array.from(this.members)[0];
      const nextUserId = users.get(nextSocketId)?.id;
      if (nextUserId) this.host = nextUserId;
    }

    return false;
  }

  addMessage(userId, username, message) {
    const msg = {
      id: uuidv4(),
      userId,
      username,
      message,
      timestamp: Date.now()
    };
    this.messages.push(msg);
    if (this.messages.length > 100) this.messages.shift(); // Keep last 100 messages
    return msg;
  }
}

function scheduleEmptyRoomDeletion(room) {
  if (!room) return;

  if (room.deleteTimer) {
    clearTimeout(room.deleteTimer);
    room.deleteTimer = null;
  }

  console.log(`Room "${room.name}" is now empty. Will unload from memory in 5 minutes if no one joins.`);
  room.deleteTimer = setTimeout(async () => {
    if (room.members.size !== 0) return;

    // Persistence policy: do NOT delete rooms/messages from MongoDB automatically.
    // We only unload the empty room from memory so it stops appearing in /api/rooms.
    rooms.delete(room.id);
    console.log(`Room "${room.name}" unloaded from memory after 5 minutes of being empty.`);
    broadcastRoomList();
  }, EMPTY_ROOM_DELETE_AFTER_MS);
}

async function sweepEmptyRoomsFromDB() {
  if (!useDatabase) return;

  const cutoff = new Date(Date.now() - EMPTY_ROOM_DELETE_AFTER_MS);
  let candidates = [];
  try {
    // Treat `lastActivity` as the source of truth for inactivity.
    // `members` in MongoDB can become stale across restarts/crashes, so we don't rely on it.
    candidates = await RoomModel.find({
      lastActivity: { $lt: cutoff }
    })
      .select({ _id: 1, name: 1 })
      .lean();
  } catch (e) {
    console.error('Error sweeping empty rooms:', e);
    return;
  }

  if (!candidates.length) return;

  let changedAny = false;
  for (const doc of candidates) {
    const roomId = doc._id.toString();
    const live = rooms.get(roomId);
    if (live && live.members.size > 0) continue;

    // Persistence policy: do NOT delete rooms/messages from MongoDB automatically.
    // Only unload inactive/empty rooms from memory.
    if (rooms.delete(roomId)) {
      changedAny = true;
      console.log(`Room "${doc.name || roomId}" unloaded from memory by sweep (inactive > 5 min).`);
    }
  }

  // If rooms were deleted manually in MongoDB while this server is running,
  // they can linger in-memory and still show up via /api/rooms.
  // Remove any in-memory rooms that no longer exist in MongoDB (only if empty).
  try {
    const ids = await RoomModel.find({}).select({ _id: 1 }).lean();
    const existing = new Set(ids.map(d => d._id.toString()));
    for (const [roomId, liveRoom] of rooms.entries()) {
      if (!existing.has(roomId) && liveRoom?.members?.size === 0) {
        rooms.delete(roomId);
        changedAny = true;
        console.log(`Room "${liveRoom?.name || roomId}" removed from memory (missing in DB).`);
      }
    }
  } catch (e) {
    console.error('Error reconciling in-memory rooms with DB:', e);
  }

  if (changedAny) broadcastRoomList();
}

// --- Guess Game helpers ---
const GUESS_GAME_WIN_SCORE = 100;

const GUESS_GAME_THEMES = {
  Animals: ['cat', 'dog', 'elephant', 'giraffe', 'lion', 'penguin', 'shark', 'turtle'],
  Food: ['pizza', 'burger', 'sushi', 'taco', 'ice cream', 'pancake', 'donut', 'salad'],
  Sports: ['soccer', 'basketball', 'tennis', 'boxing', 'golf', 'swimming', 'cycling', 'baseball'],
  Movies: ['superhero', 'spaceship', 'dragon', 'robot', 'pirate', 'wizard', 'dinosaur', 'monster'],
  Objects: ['chair', 'phone', 'laptop', 'key', 'umbrella', 'backpack', 'bottle', 'watch'],
  Places: ['beach', 'mountain', 'school', 'hospital', 'airport', 'museum', 'restaurant', 'stadium']
};

function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function normalizeGuess(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ');
}

async function emitBotMessage(roomId, text) {
  const room = rooms.get(roomId);
  if (!room) return;

  const msg = room.addMessage('bot', 'HangoutBot', text);
  msg.system = true;

  if (useDatabase) {
    try {
      const saved = await Message.create({
        userId: 'bot',
        username: 'HangoutBot',
        message: text,
        roomId,
        system: true,
        timestamp: new Date(msg.timestamp)
      });
      msg.id = saved._id.toString();
      msg.timestamp = new Date(saved.timestamp).getTime();
    } catch (e) {
      console.error('Error saving bot message:', e);
    }
  }

  io.to(roomId).emit('newMessage', msg);
}

function buildGuessGameStateFor(room, viewerUserId) {
  const g = room.guessGame;
  const isDrawer = viewerUserId && g.drawerUserId === viewerUserId;
  const subjectMasked = g.subject
    ? g.subject
        .split('')
        .map(ch => (/[a-z0-9]/i.test(ch) ? '_' : ch))
        .join('')
    : null;

  const scores = g.scores || {};
  return {
    active: !!g.active,
    phase: g.phase,
    drawerUserId: g.drawerUserId,
    turnIndex: g.turnIndex,
    turnCount: g.turnOrder.length,
    themeOptions: g.themeOptions,
    theme: g.theme,
    subjectOptions: isDrawer ? g.subjectOptions : (g.phase === 'SUBJECT_SELECT' ? [] : undefined),
    subject: isDrawer ? g.subject : null,
    subjectMasked: isDrawer ? g.subject : subjectMasked,
    endsAt: g.endsAt,
    scores
  };
}

function emitGuessGameState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const socketId of room.members) {
    const u = users.get(socketId);
    const viewerUserId = u?.id;
    io.to(socketId).emit('guessGameState', buildGuessGameStateFor(room, viewerUserId));
  }
}

function clearGuessGameTimer(room) {
  if (room?.guessGame?.timer) {
    clearTimeout(room.guessGame.timer);
    room.guessGame.timer = null;
  }
}

function stopGuessGame(roomId, { message } = {}) {
  const room = rooms.get(roomId);
  if (!room) return;

  clearGuessGameTimer(room);
  room.guessGame.active = false;
  room.guessGame.phase = 'IDLE';
  room.guessGame.drawerUserId = null;
  room.guessGame.themeOptions = [];
  room.guessGame.subjectOptions = [];
  room.guessGame.theme = null;
  room.guessGame.subject = null;
  room.guessGame.endsAt = null;
  room.guessGame.correctGuessers = new Set();

  emitGuessGameState(roomId);
  if (message) emitBotMessage(roomId, message);
}

function resolveUsernameByUserId(userId) {
  return Array.from(users.values()).find(u => u?.id === userId)?.username || userId;
}

function computeTurnOrder(room) {
  const order = [];
  for (const socketId of room.members) {
    const u = users.get(socketId);
    if (u?.id && !order.includes(u.id)) order.push(u.id);
  }
  return order;
}

function startThemeSelect(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  clearGuessGameTimer(room);

  const order = computeTurnOrder(room);
  room.guessGame.turnOrder = order;
  if (order.length < 2) {
    room.guessGame.active = false;
    room.guessGame.phase = 'IDLE';
    room.guessGame.drawerUserId = null;
    emitGuessGameState(roomId);
    emitBotMessage(roomId, 'Need at least 2 players to start Guess Game.');
    return;
  }

  room.guessGame.active = true;
  room.guessGame.phase = 'THEME_SELECT';
  if (room.guessGame.turnIndex >= order.length) room.guessGame.turnIndex = 0;
  room.guessGame.drawerUserId = order[room.guessGame.turnIndex];
  room.guessGame.theme = null;
  room.guessGame.subject = null;
  room.guessGame.correctGuessers = new Set();
  room.drawings = [];
  io.to(roomId).emit('canvasCleared');

  const allThemes = Object.keys(GUESS_GAME_THEMES);
  room.guessGame.themeOptions = pickRandom(allThemes, 3);
  room.guessGame.subjectOptions = [];

  const now = Date.now();
  room.guessGame.endsAt = now + 15000;
  emitGuessGameState(roomId);
  const drawerName = Array.from(users.values()).find(u => u?.id === room.guessGame.drawerUserId)?.username || room.guessGame.drawerUserId;
  emitBotMessage(roomId, `🎨 New turn! Drawer is ${drawerName}. Pick a theme!`);

  room.guessGame.timer = setTimeout(() => {
    // Auto-pick first theme if none chosen
    if (room.guessGame.active && room.guessGame.phase === 'THEME_SELECT' && !room.guessGame.theme) {
      room.guessGame.theme = room.guessGame.themeOptions[0] || allThemes[0];
      startSubjectSelect(roomId);
    }
  }, 15000);
}

function startSubjectSelect(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearGuessGameTimer(room);

  const theme = room.guessGame.theme;
  const subjects = GUESS_GAME_THEMES[theme] || [];
  room.guessGame.phase = 'SUBJECT_SELECT';
  room.guessGame.subjectOptions = pickRandom(subjects, 3);
  room.guessGame.subject = null;

  const now = Date.now();
  room.guessGame.endsAt = now + 15000;
  emitGuessGameState(roomId);
  emitBotMessage(roomId, `📝 Theme selected: ${theme}. Drawer, pick a subject!`);

  room.guessGame.timer = setTimeout(() => {
    if (room.guessGame.active && room.guessGame.phase === 'SUBJECT_SELECT' && !room.guessGame.subject) {
      room.guessGame.subject = room.guessGame.subjectOptions[0] || subjects[0];
      startDrawPhase(roomId);
    }
  }, 15000);
}

function startDrawPhase(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearGuessGameTimer(room);

  room.guessGame.phase = 'DRAW';
  room.guessGame.correctGuessers = new Set();
  room.drawings = [];
  io.to(roomId).emit('canvasCleared');

  const now = Date.now();
  room.guessGame.endsAt = now + 30000;
  emitGuessGameState(roomId);
  emitBotMessage(roomId, '⏱️ Drawing started! You have 30 seconds to guess.');

  room.guessGame.timer = setTimeout(() => {
    if (room.guessGame.active && room.guessGame.phase === 'DRAW') {
      startAnswerPhase(roomId, { reveal: true });
    }
  }, 30000);
}

function startAnswerPhase(roomId, { reveal, durationMs } = { reveal: true, durationMs: 30000 }) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearGuessGameTimer(room);

  room.guessGame.phase = 'ANSWER';
  const now = Date.now();
  const ms = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 30000;
  room.guessGame.endsAt = now + ms;
  emitGuessGameState(roomId);

  if (reveal && room.guessGame.subject) {
    emitBotMessage(roomId, `✅ Answer time! The word was: "${room.guessGame.subject}"`);
  } else {
    emitBotMessage(roomId, '✅ Answer time!');
  }

  room.guessGame.timer = setTimeout(() => {
    if (room.guessGame.active && room.guessGame.phase === 'ANSWER') {
      // next turn
      room.guessGame.turnIndex = (room.guessGame.turnIndex + 1) % Math.max(room.guessGame.turnOrder.length, 1);
      startThemeSelect(roomId);
    }
  }, ms);
}

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', build: SERVER_BUILD, users: users.size, rooms: rooms.size });
});

app.get('/api/rooms', (req, res) => {
  if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });

  RoomModel.find({ isPrivate: false })
    .sort({ lastActivity: -1 })
    .limit(200)
    .lean()
    .then(async (docs) => {
      const hostIds = Array.from(new Set(docs.map(d => d.host).filter(Boolean)));
      const usersById = new Map();
      try {
        const hostUsers = await User.find({ _id: { $in: hostIds } }).select('username').lean();
        for (const u of hostUsers) usersById.set(u._id.toString(), u);
      } catch {
        // ignore host lookup failure
      }

      res.json(docs.map(d => ({
        id: d._id.toString(),
        name: d.name,
        memberCount: Array.isArray(d.members) ? d.members.length : 0,
        host: usersById.get(String(d.host))?.username || 'Unknown'
      })));
    })
    .catch((err) => {
      console.error('Error fetching rooms:', err);
      res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
    });
});

app.post('/api/uploads', upload.single('file'), async (req, res) => {
  try {
    if (!useDatabase || !uploadsBucket) return res.status(503).json({ success: false, error: 'Database not available' });
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const filename = req.file.originalname || `upload_${Date.now()}`;
    const contentType = req.file.mimetype || 'application/octet-stream';

    const stream = uploadsBucket.openUploadStream(filename, {
      contentType,
      metadata: {
        originalName: req.file.originalname,
        uploadedAt: new Date()
      }
    });

    stream.end(req.file.buffer);

    stream.on('error', (e) => {
      console.error('Upload stream error:', e);
      res.status(500).json({ success: false, error: 'Upload failed' });
    });

    stream.on('finish', () => {
      const fileId = stream.id?.toString();
      const url = `${getServerBaseUrl()}/api/uploads/${encodeURIComponent(fileId)}`;
      res.json({ success: true, fileId, url, contentType, name: filename });
    });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

app.get('/api/uploads/:id', async (req, res) => {
  try {
    if (!useDatabase || !uploadsBucket) return res.status(503).send('Database not available');
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).send('Missing id');

    let objectId;
    try {
      objectId = new mongoose.Types.ObjectId(id);
    } catch {
      return res.status(400).send('Invalid id');
    }

    const files = await mongoose.connection.db
      .collection('uploads.files')
      .find({ _id: objectId })
      .limit(1)
      .toArray();
    if (!files.length) return res.status(404).send('Not found');

    const file = files[0];
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    uploadsBucket.openDownloadStream(objectId).pipe(res);
  } catch (e) {
    console.error('Download error:', e);
    res.status(500).send('Failed');
  }
});

// Guest Registration (temporary account)
app.post('/api/users/guest', async (req, res) => {
  try {
    const { username, avatar } = req.body;
    
    if (useDatabase) {
      // Guest usernames bypass maxlength validation
      const guestUser = new User({
        username: `Guest_${username}_${Date.now()}`,
        avatar: avatar || '👤',
        isGuest: true
      });
      // Skip validation for username length
      await guestUser.save({ validateBeforeSave: false });
      res.json({ success: true, user: guestUser, token: guestUser._id.toString(), isGuest: true });
    } else {
      res.json({ success: true, user: { username, avatar, isGuest: true }});
    }
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Signup (permanent account)
app.post('/api/users/signup', async (req, res) => {
  try {
    const { username, password, avatar, profilePicture, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    if (useDatabase) {
      // Prevent oversized base64 uploads (client is expected to crop/resize).
      if (typeof profilePicture === 'string' && profilePicture.startsWith('data:') && profilePicture.length > 2_500_000) {
        return res.status(413).json({ success: false, error: 'Profile picture is too large. Please resize it and try again.' });
      }

      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      // Basic email sanity check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ success: false, error: 'Please enter a valid email' });
      }

      let user = await User.findOne({ username, isGuest: false });
      if (user) {
        return res.status(400).json({ success: false, error: 'Username already taken' });
      }

      const existingEmail = await User.findOne({ email: normalizedEmail, isGuest: false });
      if (existingEmail) {
        return res.status(400).json({ success: false, error: 'Email already in use' });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      user = await User.create({
        username,
        email: normalizedEmail,
        isEmailVerified: false,
        password: hashedPassword,
        avatar: avatar || '👤',
        profilePicture: profilePicture || '',
        isGuest: false
      });

      // Create verification token and email it
      const token = createOpaqueToken();
      user.emailVerificationTokenHash = hashToken(token);
      user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRES_MS);
      await user.save();
      await sendVerificationEmail({ email: normalizedEmail, token });
      
      res.json({ 
        success: true, 
        user: {
          id: user._id,
          username: user.username,
          avatar: user.avatar,
          profilePicture: user.profilePicture,
          bio: user.bio,
          isEmailVerified: user.isEmailVerified,
          isGuest: false
        }, 
        token: user._id.toString(),
        verificationSent: true
      });
    } else {
      res.json({ success: true, user: { username, avatar, profilePicture, isGuest: false }});
    }
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Verify email
app.post('/api/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });
    if (!token) return res.status(400).json({ success: false, error: 'Token required' });

    const tokenHash = hashToken(token);
    const user = await User.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
      isGuest: false
    });

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid or expired verification link' });
    }

    user.isEmailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    await user.save();

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Verify email (link-friendly GET)
app.get('/api/auth/verify-email', async (req, res) => {
  try {
    const token = req.query.token;
    if (!useDatabase) return res.status(503).send('Database not available');
    if (!token) return res.status(400).send('Missing token');

    const tokenHash = hashToken(token);
    const user = await User.findOne({
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: { $gt: new Date() },
      isGuest: false
    });

    if (!user) {
      return res.status(400).send('Invalid or expired verification link');
    }

    user.isEmailVerified = true;
    user.emailVerificationTokenHash = null;
    user.emailVerificationExpiresAt = null;
    await user.save();

    const redirectUrl = `${getClientBaseUrl()}/?verified=1`;
    const seconds = 3;

    res.status(200).send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta http-equiv="refresh" content="${seconds};url=${redirectUrl}" />
          <title>Email verified • Hangout Bar</title>
          <style>
            :root {
              --bg1: #0b0d13;
              --bg2: #0a1222;
              --card: rgba(30, 41, 59, 0.82);
              --border: rgba(255, 255, 255, 0.14);
              --text: rgba(226, 232, 240, 0.98);
              --muted: rgba(148, 163, 184, 0.95);
              --accent: rgba(88, 101, 242, 1);
              --success: rgba(16, 185, 129, 1);
            }
            *{box-sizing:border-box}
            body{
              margin:0;
              min-height:100vh;
              font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
              color: var(--text);
              background:
                radial-gradient(1200px 600px at 10% 20%, rgba(88, 101, 242, 0.35), transparent 60%),
                radial-gradient(900px 520px at 85% 35%, rgba(235, 69, 158, 0.22), transparent 55%),
                radial-gradient(600px 420px at 60% 90%, rgba(16, 185, 129, 0.16), transparent 55%),
                linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 100%);
              display:grid;
              place-items:center;
              padding: 24px;
            }
            .wrap{width:min(720px, 100%);}
            .card{
              background: var(--card);
              border: 1px solid var(--border);
              border-radius: 20px;
              padding: 22px;
              box-shadow: 0 30px 80px rgba(0,0,0,0.45);
              backdrop-filter: blur(14px);
            }
            .row{display:flex; gap:14px; align-items:flex-start;}
            .badge{
              width: 44px; height: 44px; border-radius: 16px;
              display:grid; place-items:center;
              background: rgba(16, 185, 129, 0.16);
              border: 1px solid rgba(16, 185, 129, 0.26);
              font-size: 22px;
              flex: 0 0 auto;
            }
            h1{margin:0; font-size: 22px; letter-spacing: -0.02em;}
            p{margin:8px 0 0; color: var(--muted); line-height: 1.4;}
            .meta{margin-top: 14px; display:flex; gap: 10px; flex-wrap: wrap; align-items: center;}
            .pill{
              display:inline-flex; align-items:center; gap: 8px;
              padding: 8px 10px;
              border-radius: 999px;
              background: rgba(15, 23, 42, 0.45);
              border: 1px solid rgba(255,255,255,0.12);
              color: var(--muted);
              font-size: 13px;
            }
            .count{
              color: rgba(226,232,240,0.98);
              font-weight: 800;
            }
            a.btn{
              display:inline-flex;
              align-items:center;
              justify-content:center;
              padding: 10px 14px;
              border-radius: 14px;
              text-decoration:none;
              background: rgba(88, 101, 242, 0.20);
              border: 1px solid rgba(88, 101, 242, 0.35);
              color: rgba(199, 210, 254, 1);
              font-weight: 800;
              font-size: 13px;
            }
            a.btn:hover{background: rgba(88, 101, 242, 0.26);}
            .hint{margin-top: 12px; font-size: 12px; color: rgba(148,163,184,0.9)}
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="card">
              <div class="row">
                <div class="badge">✅</div>
                <div>
                  <h1>Email verified</h1>
                  <p>Your account is ready. We’re sending you back to Hangout Bar now.</p>
                  <div class="meta">
                    <div class="pill">Redirecting in <span id="count" class="count">${seconds}</span>s</div>
                    <a class="btn" href="${redirectUrl}">Continue now →</a>
                  </div>
                  <div class="hint">If you opened this on another device, make sure the app URL is reachable there.</div>
                </div>
              </div>
            </div>
          </div>
          <script>
            (function(){
              var remaining = ${seconds};
              var el = document.getElementById('count');
              var timer = setInterval(function(){
                remaining -= 1;
                if (el) el.textContent = String(Math.max(0, remaining));
                if (remaining <= 0) {
                  clearInterval(timer);
                  try { window.location.replace(${JSON.stringify(redirectUrl)}); } catch (e) { window.location.href = ${JSON.stringify(redirectUrl)}; }
                }
              }, 1000);
            })();
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(400).send(error.message || 'Verification failed');
  }
});

// Resend verification email
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return res.status(400).json({ success: false, error: 'Email required' });

    const user = await User.findOne({ email: normalizedEmail, isGuest: false });
    if (!user) {
      // Avoid account enumeration
      return res.json({ success: true, sent: true });
    }

    if (user.isEmailVerified) {
      return res.json({ success: true, sent: false, message: 'Email already verified' });
    }

    const token = createOpaqueToken();
    user.emailVerificationTokenHash = hashToken(token);
    user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRES_MS);
    await user.save();

    await sendVerificationEmail({ email: normalizedEmail, token });
    res.json({ success: true, sent: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Login (existing account)
app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    if (useDatabase) {
      const user = await User.findOne({ username, isGuest: false });
      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }

      // If the user has an email on file, require verification before login.
      if (user.email && !user.isEmailVerified) {
        return res.status(403).json({
          success: false,
          error: 'Please verify your email before logging in',
          needsEmailVerification: true,
          email: user.email
        });
      }
      
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(401).json({ success: false, error: 'Invalid username or password' });
      }
      
      user.lastActive = new Date();
      await user.save();
      
      res.json({ 
        success: true, 
        user: {
          id: user._id,
          username: user.username,
          avatar: user.avatar,
          profilePicture: user.profilePicture,
          bio: user.bio,
          isEmailVerified: user.isEmailVerified,
          isGuest: false
        }, 
        token: user._id.toString() 
      });
    } else {
      res.status(503).json({ success: false, error: 'Database not available' });
    }
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Request password reset (always returns success to avoid enumeration)
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return res.status(400).json({ success: false, error: 'Email required' });

    const user = await User.findOne({ email: normalizedEmail, isGuest: false });
    if (user) {
      const token = createOpaqueToken();
      user.passwordResetTokenHash = hashToken(token);
      user.passwordResetExpiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_MS);
      await user.save();

      await sendPasswordResetEmail({ email: normalizedEmail, token });
    }

    // Keep enumeration resistance, but help diagnose SMTP configuration.
    res.json({ success: true, mailConfigured: isMailerConfigured() });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Resend verification by userId (so clients don't need to know the email address)
app.post('/api/users/:userId/resend-verification', async (req, res) => {
  try {
    if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });

    const user = await User.findById(req.params.userId).select('email isGuest isEmailVerified');
    if (!user) {
      // Avoid enumeration: always respond success.
      return res.json({ success: true, sent: true, mailConfigured: isMailerConfigured() });
    }
    if (user.isGuest) {
      return res.status(403).json({ success: false, error: 'Guest accounts cannot verify email' });
    }
    if (!user.email) {
      return res.status(400).json({ success: false, error: 'No email on file' });
    }

    // If already verified, return ok but indicate no send needed.
    if (user.isEmailVerified) {
      return res.json({ success: true, sent: false, message: 'Email already verified', mailConfigured: isMailerConfigured() });
    }

    const token = createOpaqueToken();
    user.emailVerificationTokenHash = hashToken(token);
    user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRES_MS);
    await user.save();

    await sendVerificationEmail({ email: user.email, token });
    res.json({ success: true, sent: true, mailConfigured: isMailerConfigured() });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });
    if (!token) return res.status(400).json({ success: false, error: 'Token required' });
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const tokenHash = hashToken(token);
    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
      isGuest: false
    });

    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetTokenHash = null;
    user.passwordResetExpiresAt = null;
    user.lastActive = new Date();
    await user.save();

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Reset password (link-friendly GET -> forwards token to client UI)
app.get('/api/auth/reset-password', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).send('Missing token');
  const redirectUrl = `${getClientBaseUrl()}/?resetToken=${encodeURIComponent(token)}`;
  res.redirect(302, redirectUrl);
});

// User Profile endpoints
app.post('/api/users/register', async (req, res) => {
  try {
    const { username, avatar, profilePicture } = req.body;
    
    if (useDatabase) {
      // Check if username exists
      let user = await User.findOne({ username });
      if (user) {
        return res.json({ success: true, user: {
          id: user._id,
          username: user.username,
          avatar: user.avatar,
          profilePicture: user.profilePicture,
          bio: user.bio,
          createdAt: user.createdAt
        }});
      }
      
      // Create new user
      user = await User.create({ username, avatar, profilePicture });
      res.json({ success: true, user: {
        id: user._id,
        username: user.username,
        avatar: user.avatar,
        profilePicture: user.profilePicture,
        bio: user.bio,
        createdAt: user.createdAt
      }});
    } else {
      res.json({ success: true, user: { username, avatar, profilePicture }});
    }
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/users/:userId', async (req, res) => {
  try {
    if (useDatabase) {
      const user = await User.findById(req.params.userId).select(
        '-socketId -password -email -emailVerificationTokenHash -emailVerificationExpiresAt -passwordResetTokenHash -passwordResetExpiresAt'
      );
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    } else {
      res.json({ error: 'Database not available' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/users/:userId', async (req, res) => {
  try {
    const { avatar, profilePicture, bio } = req.body;
    if (useDatabase) {
      const existing = await User.findById(req.params.userId).select('isGuest');
      if (!existing) return res.status(404).json({ error: 'User not found' });
      if (existing.isGuest) {
        return res.status(403).json({ error: 'Guest accounts cannot update profiles' });
      }

      // Prevent oversized base64 uploads (client is expected to crop/resize).
      if (typeof profilePicture === 'string' && profilePicture.startsWith('data:') && profilePicture.length > 2_500_000) {
        return res.status(413).json({ error: 'Profile picture is too large. Please resize it and try again.' });
      }

      const update = { lastActive: Date.now() };
      if (avatar !== undefined) update.avatar = avatar;
      if (profilePicture !== undefined) update.profilePicture = profilePicture;
      if (bio !== undefined) update.bio = bio;

      const user = await User.findByIdAndUpdate(
        req.params.userId,
        update,
        { new: true }
      ).select('-socketId -password -email -emailVerificationTokenHash -emailVerificationExpiresAt -passwordResetTokenHash -passwordResetExpiresAt');
      res.json(user);
    } else {
      res.json({ error: 'Database not available' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Account settings (sensitive updates)
app.put('/api/users/:userId/password', async (req, res) => {
  try {
    if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.userId).select('password isGuest lastActive email isEmailVerified');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.isGuest) return res.status(403).json({ success: false, error: 'Guest accounts cannot change password' });

    // If the user has an email, require verification before allowing password changes.
    if (user.email && !user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        error: 'Please verify your email before changing your password',
        needsEmailVerification: true,
        mailConfigured: isMailerConfigured()
      });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid current password' });

    user.password = await bcrypt.hash(newPassword, 10);
    user.lastActive = new Date();
    await user.save();

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.put('/api/users/:userId/email', async (req, res) => {
  try {
    if (!useDatabase) return res.status(503).json({ success: false, error: 'Database not available' });

    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return res.status(400).json({ success: false, error: 'Email required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email' });
    }
    if (!password) return res.status(400).json({ success: false, error: 'Password required' });

    const user = await User.findById(req.params.userId).select('password isGuest email');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.isGuest) return res.status(403).json({ success: false, error: 'Guest accounts cannot change email' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ success: false, error: 'Invalid password' });

    const existingEmail = await User.findOne({ email: normalizedEmail, isGuest: false, _id: { $ne: user._id } }).select('_id');
    if (existingEmail) {
      return res.status(400).json({ success: false, error: 'Email already in use' });
    }

    user.email = normalizedEmail;
    user.isEmailVerified = false;
    const token = createOpaqueToken();
    user.emailVerificationTokenHash = hashToken(token);
    user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRES_MS);
    user.lastActive = new Date();
    await user.save();

    const mailResult = await sendVerificationEmail({ email: normalizedEmail, token });
    res.json({
      success: true,
      verificationSent: true,
      mailConfigured: isMailerConfigured(),
      mailOk: mailResult?.ok === true,
      mailSkipped: !!mailResult?.skipped
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// News Feed - stored in Mongo when available

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  socket.emit('serverInfo', { build: SERVER_BUILD, socketId: socket.id });

  // User Registration
  socket.on('register', async ({ username, avatar, userId }) => {
    try {
      const existingEntry = users.get(socket.id);
      let dbUser = null;
      
      // If userId provided, fetch from database
      if (userId) {
        dbUser = await User.findById(userId);
      }
      
      // If no DB user found, try to find by username
      if (!dbUser) {
        dbUser = await User.findOne({ username });
      }
      
      // Update socket ID in database
      if (dbUser) {
        dbUser.socketId = socket.id;
        dbUser.lastActive = new Date();
        await dbUser.save();
      }
      
      const user = {
        id: dbUser ? dbUser._id.toString() : socket.id,
        username: username || `User${Math.floor(Math.random() * 10000)}`,
        avatar: avatar || '👤',
        profilePicture: dbUser?.profilePicture || '',
        // Preserve runtime room membership if register() is called again on the same socket.
        currentRoom: existingEntry?.currentRoom || null,
        friends: dbUser ? new Set(dbUser.friends.map(f => f.toString())) : new Set()
      };
      
      users.set(socket.id, user);
      socket.emit('registered', { userId: user.id, user });
      {
        const profilePicturePreview = user.profilePicture
          ? (user.profilePicture.startsWith('data:')
              ? `${user.profilePicture.slice(0, 30)}… (len=${user.profilePicture.length})`
              : user.profilePicture)
          : '(none)';
        debugLog(`User registered: ${user.username}, profilePicture: ${profilePicturePreview}`);
      }

      // Emit friends list (all friends, with online status)
      if (useDatabase && dbUser) {
        try {
          const populated = await User.findById(dbUser._id).populate('friends', 'username avatar profilePicture');
          const list = (populated?.friends || []).map(f => {
            const onlineEntry = Array.from(users.values()).find(u => u.id === f._id.toString());
            return buildFriendPayload(f, onlineEntry);
          });
          socket.emit('friendsList', list);
        } catch (e) {
          console.error('Error building friendsList on register:', e);
        }
      }

      // Notify online friends that this user is now online
      const currentRoomId = user.currentRoom || null;
      const currentRoomName = currentRoomId ? (rooms.get(currentRoomId)?.name || null) : null;
      user.friends.forEach(friendUserId => {
        const friendSocketId = findSocketIdByUserId(friendUserId);
        if (friendSocketId) {
          io.to(friendSocketId).emit('friendOnline', { friendId: user.id });
          io.to(friendSocketId).emit('friendRoomUpdate', { friendId: user.id, roomId: currentRoomId, roomName: currentRoomName });
        }
      });
      
      // Send pending friend requests
      if (dbUser && dbUser.friendRequests.length > 0) {
        for (const request of dbUser.friendRequests) {
          try {
            const fromUser = await User.findById(request.from);
            if (fromUser) {
              socket.emit('friendRequest', {
                fromId: fromUser._id.toString(),
                fromUsername: fromUser.username,
                fromAvatar: fromUser.avatar,
                fromProfilePicture: fromUser.profilePicture
              });
              debugLog(`Sent pending friend request to ${user.username} from ${fromUser.username}`);
            }
          } catch (err) {
            console.error('Error loading friend request:', err);
          }
        }
      }
    } catch (error) {
      console.error('Error registering user:', error);
      socket.emit('error', { message: 'Registration failed' });
    }
  });

  // Create Room
  socket.on('createRoom', async ({ name, isPrivate }) => {
    const user = users.get(socket.id);
    if (!user) return socket.emit('error', { message: 'Not registered' });

    let roomId = uuidv4();
    if (useDatabase) {
      const created = await RoomModel.create({
        name,
        isPrivate: !!isPrivate,
        host: user.id,
        members: [user.id],
        youtube: { videoId: null, playing: false, timestamp: 0, lastUpdate: new Date() },
        lastActivity: new Date()
      });
      roomId = created._id.toString();
    }

    const room = new Room(roomId, name, isPrivate, user.id); // host is DB userId
    room.members.add(socket.id);
    rooms.set(roomId, room);
    
    socket.join(roomId);
    user.currentRoom = roomId;
    
    debugLog(`Room created by ${user.username} (socket: ${socket.id}, user.id: ${user.id})`);
    debugLog('Room members:', Array.from(room.members));
    
    const roomData = getRoomData(room);
    debugLog('Room data members:', roomData.members);
    
    socket.emit('roomCreated', { roomId, room: roomData });
    broadcastRoomList();
    console.log(`Room created: ${name} by ${user.username}`);
  });

  async function performJoinRoom(targetRoomId) {
    const user = users.get(socket.id);
    const room = rooms.get(targetRoomId);

    if (!user) {
      socket.emit('error', { message: 'Not registered' });
      return;
    }

    if (!room) {
      // If room isn't hydrated in-memory but exists in DB, hydrate it.
      if (useDatabase) {
        try {
          const doc = await RoomModel.findById(targetRoomId);
          if (doc) {
            const hydrated = new Room(doc._id.toString(), doc.name, doc.isPrivate, doc.host);
            hydrated.youtube = doc.youtube || hydrated.youtube;
            rooms.set(hydrated.id, hydrated);
          }
        } catch (e) {
          console.error('Error hydrating room from DB:', e);
        }
      }
    }

    const liveRoom = rooms.get(targetRoomId);
    if (!liveRoom) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Leave current room if any
    if (user.currentRoom && user.currentRoom !== targetRoomId) {
      socket.leave(user.currentRoom);
      const oldRoom = rooms.get(user.currentRoom);
      if (oldRoom) {
        oldRoom.removeMember(socket.id);
        io.to(user.currentRoom).emit('userLeft', {
          userId: user.id,
          username: user.username
        });
      }

      if (useDatabase) {
        try {
          await RoomModel.findByIdAndUpdate(user.currentRoom, {
            $pull: { members: user.id },
            $set: { lastActivity: new Date() }
          });
        } catch (e) {
          console.error('Error updating DB room members (leave old room):', e);
        }
      }
    }

    // Check if user is already in the room (prevent duplicates)
    if (liveRoom.members.has(socket.id)) {
      socket.emit('joinedRoom', { room: getRoomData(liveRoom) });
      return;
    }

    socket.join(targetRoomId);
    liveRoom.addMember(socket.id);
    user.currentRoom = targetRoomId;

    if (useDatabase) {
      try {
        await RoomModel.findByIdAndUpdate(targetRoomId, {
          $addToSet: { members: user.id },
          $set: { lastActivity: new Date() }
        });
      } catch (e) {
        console.error('Error updating DB room members (join):', e);
      }
    }

    // Notify friends about this user's room
    user.friends.forEach(friendUserId => {
      const friendSocketId = findSocketIdByUserId(friendUserId);
      if (friendSocketId) {
        io.to(friendSocketId).emit('friendRoomUpdate', {
          friendId: user.id,
          roomId: targetRoomId,
          roomName: liveRoom.name
        });
      }
    });

    console.log(`User ${user.username} joining room. Room now has ${liveRoom.members.size} members:`, Array.from(liveRoom.members));
  debugLog(`User ${user.username} joining room. Room now has ${liveRoom.members.size} members:`, Array.from(liveRoom.members));

    // Load message history from DB
    if (useDatabase) {
      try {
        const history = await Message.find({ roomId: targetRoomId })
          .sort({ timestamp: -1 })
          .limit(100)
          .lean();
        liveRoom.messages = history
          .reverse()
          .map(m => ({
            id: m._id.toString(),
            userId: m.userId,
            username: m.username,
            message: m.message,
            system: !!m.system,
            timestamp: new Date(m.timestamp).getTime()
          }));
      } catch (e) {
        console.error('Error loading room message history:', e);
      }
    }

    const roomData = getRoomData(liveRoom);
    console.log(`Sending room data to ${user.username} with ${roomData.members.length} members:`, roomData.members.map(m => m.username));
    debugLog(`Sending room data to ${user.username} with ${roomData.members.length} members:`, roomData.members.map(m => m.username));
    socket.emit('joinedRoom', { room: roomData });

    // Guess Game: send current state to late joiners
    if (liveRoom.guessGame?.active) {
      io.to(socket.id).emit('guessGameState', buildGuessGameStateFor(liveRoom, user.id));
    }
    io.to(targetRoomId).emit('userJoined', {
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      profilePicture: user.profilePicture || ''
    });

    broadcastRoomList();
    console.log(`${user.username} joined room: ${liveRoom.name}`);
  }

  // Join Room
  socket.on('joinRoom', async ({ roomId }, ack) => {
    debugLog(`[joinRoom] socket=${socket.id} roomId=${roomId}`);
    try {
      await performJoinRoom(roomId);
      if (typeof ack === 'function') ack({ ok: true, roomId });
    } catch (e) {
      console.error('[joinRoom] error:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Join failed' });
    }
  });

  // Join a friend's current room (when roomId isn't known client-side)
  socket.on('joinFriendRoom', async ({ friendId }, ack) => {
    debugLog(`[joinFriendRoom] socket=${socket.id} friendId=${friendId}`);
    const user = users.get(socket.id);
    if (!user) {
      socket.emit('error', { message: 'Not registered' });
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }

    const friendOnline = findOnlineUserById(friendId);
    const friendRoomId = friendOnline?.currentRoom;
    if (!friendRoomId) {
      socket.emit('error', { message: 'Friend is not in a room' });
      if (typeof ack === 'function') ack({ ok: false, message: 'Friend is not in a room' });
      return;
    }

    try {
      await performJoinRoom(friendRoomId);
      if (typeof ack === 'function') ack({ ok: true, roomId: friendRoomId });
    } catch (e) {
      console.error('[joinFriendRoom] error:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Join failed' });
    }
  });

  // Leave Room
  socket.on('leaveRoom', () => {
    handleLeaveRoom(socket.id);
  });

  // --- Voice: join/leave + WebRTC signaling ---
  socket.on('voice:join', async ({ channelId, state } = {}, ack) => {
    const user = users.get(socket.id);
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }

    const chanId = String(channelId || '').trim();
    if (!chanId) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Missing channelId' });
      return;
    }

    // Leave any previous voice channel.
    leaveVoiceBySocket(socket.id);

    const chan = getVoiceChannel(chanId);
    if (!chan) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Invalid channelId' });
      return;
    }

    const myUserId = String(user.id);
    const myState = {
      muted: !!state?.muted,
      deafened: !!state?.deafened
    };

    chan.set(myUserId, { socketId: socket.id, ...myState });
    voiceBySocket.set(socket.id, { channelId: chanId, userId: myUserId });

    // Build peer list for ack.
    const peers = [];
    for (const [uid, info] of chan.entries()) {
      if (uid === myUserId) continue;
      const online = findOnlineUserById(uid);
      peers.push({
        userId: uid,
        user: online ? {
          id: uid,
          username: online.username,
          avatar: online.avatar,
          profilePicture: online.profilePicture || ''
        } : { id: uid },
        state: {
          muted: !!info?.muted,
          deafened: !!info?.deafened
        }
      });
    }

    // Notify existing peers.
    for (const [uid, info] of chan.entries()) {
      if (uid === myUserId) continue;
      if (!info?.socketId) continue;
      io.to(info.socketId).emit('voice:peer-joined', {
        userId: myUserId,
        user: { id: myUserId, username: user.username, avatar: user.avatar, profilePicture: user.profilePicture || '' },
        state: myState
      });
    }

    if (typeof ack === 'function') {
      ack({
        ok: true,
        channelId: chanId,
        peers,
        selfState: myState,
        selfUser: { id: myUserId, username: user.username, avatar: user.avatar, profilePicture: user.profilePicture || '' }
      });
    }
  });

  socket.on('voice:leave', () => {
    leaveVoiceBySocket(socket.id);
  });

  socket.on('voice:signal', ({ channelId, toUserId, description, candidate } = {}) => {
    const user = users.get(socket.id);
    if (!user) return;
    const entry = voiceBySocket.get(socket.id);
    if (!entry) return;
    if (channelId && String(channelId) !== String(entry.channelId)) return;

    const chan = voiceChannels.get(entry.channelId);
    if (!chan) return;
    const target = chan.get(String(toUserId));
    if (!target?.socketId) return;

    io.to(target.socketId).emit('voice:signal', {
      channelId: entry.channelId,
      fromUserId: String(user.id),
      description,
      candidate
    });
  });

  socket.on('voice:state', ({ channelId, muted, deafened } = {}) => {
    const user = users.get(socket.id);
    if (!user) return;
    const entry = voiceBySocket.get(socket.id);
    if (!entry) return;
    if (channelId && String(channelId) !== String(entry.channelId)) return;

    const chan = voiceChannels.get(entry.channelId);
    if (!chan) return;
    const me = chan.get(String(user.id));
    if (!me) return;
    me.muted = !!muted;
    me.deafened = !!deafened;
    chan.set(String(user.id), me);

    for (const [uid, info] of chan.entries()) {
      if (!info?.socketId) continue;
      if (uid === String(user.id)) continue;
      io.to(info.socketId).emit('voice:state', {
        channelId: entry.channelId,
        userId: String(user.id),
        muted: me.muted,
        deafened: me.deafened
      });
    }
  });

  // Send Message
  socket.on('sendMessage', async ({ message }) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    if (!useDatabase) {
      socket.emit('error', { message: 'Database not available' });
      return;
    }

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    const msg = room.addMessage(user.id, user.username, message);
    
    // Save to database
    try {
      const saved = await Message.create({
        userId: user.id,
        username: user.username,
        message,
        roomId: room.id,
        system: false,
        timestamp: new Date(msg.timestamp)
      });
      msg.id = saved._id.toString();
      msg.timestamp = new Date(saved.timestamp).getTime();

      await RoomModel.findByIdAndUpdate(room.id, { $set: { lastActivity: new Date() } }).catch(() => {});
    } catch (error) {
      console.error('Error saving message to database:', error);
    }
    
    io.to(user.currentRoom).emit('newMessage', msg);

    // Guess Game: guess checking (after broadcasting the guess)
    if (room.guessGame?.active && (room.guessGame.phase === 'DRAW' || room.guessGame.phase === 'ANSWER')) {
      const isDrawer = room.guessGame.drawerUserId === user.id;
      const subject = room.guessGame.subject;
      if (!isDrawer && subject) {
        const guess = normalizeGuess(message);
        const target = normalizeGuess(subject);
        if (guess && target && guess === target && !room.guessGame.correctGuessers.has(user.id)) {
          room.guessGame.correctGuessers.add(user.id);

          // Scores: guesser +10, drawer +5
          room.guessGame.scores[user.id] = (room.guessGame.scores[user.id] || 0) + 10;
          if (room.guessGame.drawerUserId) {
            room.guessGame.scores[room.guessGame.drawerUserId] = (room.guessGame.scores[room.guessGame.drawerUserId] || 0) + 5;
          }

          // First to 100 wins
          const guesserScore = room.guessGame.scores[user.id] || 0;
          const drawerId = room.guessGame.drawerUserId;
          const drawerScore = drawerId ? (room.guessGame.scores[drawerId] || 0) : 0;

          emitBotMessage(room.id, `🎉 ${user.username} guessed it!`);
          emitGuessGameState(room.id);

          if (guesserScore >= GUESS_GAME_WIN_SCORE) {
            const winnerName = resolveUsernameByUserId(user.id);
            stopGuessGame(room.id, { message: `🏆 ${winnerName} wins! (first to ${GUESS_GAME_WIN_SCORE})` });
            return;
          }

          if (drawerId && drawerScore >= GUESS_GAME_WIN_SCORE) {
            const winnerName = resolveUsernameByUserId(drawerId);
            stopGuessGame(room.id, { message: `🏆 ${winnerName} wins! (first to ${GUESS_GAME_WIN_SCORE})` });
            return;
          }

          // If everyone (except the drawer) has guessed correctly, end the DRAW timer early
          if (room.guessGame.phase === 'DRAW') {
            const playerIds = new Set();
            for (const socketId of room.members) {
              const u = users.get(socketId);
              if (u?.id) playerIds.add(u.id);
            }

            const eligibleGuessers = Array.from(playerIds).filter(id => id !== room.guessGame.drawerUserId);
            const eligibleCount = eligibleGuessers.length;

            if (eligibleCount > 0 && room.guessGame.correctGuessers.size >= eligibleCount) {
              emitBotMessage(room.id, '✅ Everyone guessed it!');
              startAnswerPhase(room.id, { reveal: true, durationMs: 5000 });
            }
          }
        }
      }
    }
  });

  // YouTube Controls
  socket.on('youtubePlay', ({ videoId, timestamp }) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    room.youtube = { videoId, playing: true, timestamp, lastUpdate: Date.now() };
    socket.to(user.currentRoom).emit('youtubeSync', room.youtube);
  });

  socket.on('youtubePause', ({ timestamp }) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    room.youtube.playing = false;
    room.youtube.timestamp = timestamp;
    room.youtube.lastUpdate = Date.now();
    socket.to(user.currentRoom).emit('youtubeSync', room.youtube);
  });

  socket.on('youtubeSeek', ({ timestamp }) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    room.youtube.timestamp = timestamp;
    room.youtube.lastUpdate = Date.now();
    socket.to(user.currentRoom).emit('youtubeSync', room.youtube);
  });

  // Drawing Events
  socket.on('draw', (drawData) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    // Guess Game: only current drawer can draw during DRAW phase
    if (room.guessGame?.active) {
      if (room.guessGame.phase !== 'DRAW') return;
      if (room.guessGame.drawerUserId !== user.id) return;
    }

    room.drawings.push(drawData);
    if (room.drawings.length > 5000) room.drawings.shift();
    
    socket.to(user.currentRoom).emit('drawing', drawData);
  });

  socket.on('clearCanvas', () => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    // Guess Game: only drawer can clear during DRAW phase; otherwise ignore
    if (room.guessGame?.active && room.guessGame.phase === 'DRAW' && room.guessGame.drawerUserId !== user.id) return;

    room.drawings = [];
    io.to(user.currentRoom).emit('canvasCleared');
  });

  // Guess Game Controls
  socket.on('guessGameStart', async () => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;
    const room = rooms.get(user.currentRoom);
    if (!room) return;

    // Allow only host to start
    if (room.host !== user.id) {
      socket.emit('guessGameError', { message: 'Only the host can start the game' });
      return;
    }

    // New game: reset scores and restart turn order
    room.guessGame.scores = {};
    room.guessGame.turnIndex = 0;

    startThemeSelect(room.id);
  });

  socket.on('guessGameStop', () => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;
    const room = rooms.get(user.currentRoom);
    if (!room) return;

    if (room.host !== user.id) {
      socket.emit('guessGameError', { message: 'Only the host can stop the game' });
      return;
    }

    stopGuessGame(room.id, { message: '🛑 Guess Game stopped.' });
  });

  socket.on('guessGameSelectTheme', ({ theme }) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;
    const room = rooms.get(user.currentRoom);
    if (!room) return;

    if (!room.guessGame?.active || room.guessGame.phase !== 'THEME_SELECT') return;
    if (room.guessGame.drawerUserId !== user.id) {
      socket.emit('guessGameError', { message: 'Only the drawer can pick the theme' });
      return;
    }

    const chosen = String(theme || '').trim();
    if (!room.guessGame.themeOptions.includes(chosen)) {
      socket.emit('guessGameError', { message: 'Invalid theme selection' });
      return;
    }

    room.guessGame.theme = chosen;
    startSubjectSelect(room.id);
  });

  socket.on('guessGameSelectSubject', ({ subject }) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;
    const room = rooms.get(user.currentRoom);
    if (!room) return;

    if (!room.guessGame?.active || room.guessGame.phase !== 'SUBJECT_SELECT') return;
    if (room.guessGame.drawerUserId !== user.id) {
      socket.emit('guessGameError', { message: 'Only the drawer can pick the subject' });
      return;
    }

    const chosen = String(subject || '').trim();
    if (!room.guessGame.subjectOptions.includes(chosen)) {
      socket.emit('guessGameError', { message: 'Invalid subject selection' });
      return;
    }

    room.guessGame.subject = chosen;
    startDrawPhase(room.id);
  });

  // Friend System
  socket.on('sendFriendRequest', async ({ targetUserId }) => {
    const user = users.get(socket.id);
    if (!user) {
      debugLog('sendFriendRequest: User not found in users Map');
      socket.emit('friendRequestError', { message: 'Not registered on server. Please refresh and try again.' });
      return;
    }
    
    debugLog(`sendFriendRequest: ${user.username} (${user.id}) -> targetUserId: ${targetUserId}`);
    
    // Prevent self-friend requests
    if (user.id === targetUserId) {
      debugLog('Cannot send friend request to yourself');
      socket.emit('friendRequestError', { message: 'You cannot add yourself as a friend' });
      return;
    }
    
    try {
      // Block checks (both directions)
      const senderDoc = await User.findById(user.id).select('blockedUsers isGuest');

      // Find target user in database
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        debugLog(`Target user ${targetUserId} not found in database`);
        socket.emit('friendRequestError', { message: 'User not found' });
        return;
      }

      // Guests cannot participate in the friend system
      if (senderDoc?.isGuest) {
        socket.emit('friendRequestError', { message: 'Guest accounts cannot add friends' });
        return;
      }
      if (targetUser?.isGuest) {
        socket.emit('friendRequestError', { message: 'You cannot add guest accounts as friends' });
        return;
      }
      
        debugLog(`Found target user: ${targetUser.username}`);

      // If either side blocked the other, stop
      if (senderDoc?.blockedUsers?.some(b => b.toString() === targetUserId)) {
        socket.emit('friendRequestError', { message: 'You have blocked this user' });
        return;
      }
      if (targetUser?.blockedUsers?.some(b => b.toString() === user.id)) {
        socket.emit('friendRequestError', { message: 'Cannot send request to this user' });
        return;
      }
      
      // Check if already friends
      if (targetUser.friends.some(f => f.toString() === user.id)) {
        debugLog('Already friends');
        socket.emit('friendRequestError', { message: 'Already friends' });
        return;
      }
      
      // Check if request already exists
      const existingRequest = targetUser.friendRequests.find(
        req => req.from.toString() === user.id
      );
      if (existingRequest) {
        debugLog('Friend request already sent');
        socket.emit('friendRequestError', { message: 'Friend request already sent' });
        return;
      }
      
      // Add friend request to database
      targetUser.friendRequests.push({
        from: user.id,
        timestamp: new Date()
      });
      await targetUser.save();
      
      debugLog(`Friend request saved: ${user.username} -> ${targetUser.username}`);
      
      // If target user is online, send real-time notification
      // Prefer DB socketId (updated on register), fallback to in-memory scan.
      let targetSocketId = null;
      if (targetUser.socketId && io.sockets.sockets.has(targetUser.socketId)) {
        targetSocketId = targetUser.socketId;
      } else {
        const targetUserEntry = Array.from(users.entries()).find(([_, u]) => u.id === targetUserId);
        if (targetUserEntry) {
          ([targetSocketId] = targetUserEntry);
        }
      }

      if (targetSocketId) {
        io.to(targetSocketId).emit('friendRequest', {
          fromId: user.id,
          fromUsername: user.username,
          fromAvatar: user.avatar,
          fromProfilePicture: user.profilePicture
        });
        debugLog(`Real-time notification sent to ${targetUser.username}`);
      }
      
      socket.emit('friendRequestSuccess', { message: 'Friend request sent' });
      debugLog(`friendRequestSuccess event sent to ${user.username}`);
    } catch (error) {
      console.error('Error sending friend request:', error);
      socket.emit('friendRequestError', { message: 'Failed to send friend request' });
    }
  });

  socket.on('acceptFriendRequest', async ({ fromUserId }) => {
    const user = users.get(socket.id);
    if (!user) {
      socket.emit('friendRequestError', { message: 'Not registered on server. Please refresh and try again.' });
      return;
    }
    
    try {
      // Get both users from database
      const currentUser = await User.findById(user.id);
      const fromUser = await User.findById(fromUserId);
      
      if (!currentUser || !fromUser) {
        console.log('User not found in database');
        return;
      }

      // Guests cannot participate in the friend system
      if (currentUser.isGuest || fromUser.isGuest) {
        socket.emit('friendRequestError', { message: 'Guest accounts cannot accept friend requests' });
        return;
      }

      // Block checks
      if (currentUser.blockedUsers?.some(b => b.toString() === fromUserId) ||
          fromUser.blockedUsers?.some(b => b.toString() === user.id)) {
        socket.emit('friendRequestError', { message: 'Cannot accept due to block settings' });
        return;
      }
      
      // Remove friend request
      currentUser.friendRequests = currentUser.friendRequests.filter(
        req => req.from.toString() !== fromUserId
      );
      
      // Add to friends list (if not already friends)
      if (!currentUser.friends.some(f => f.toString() === fromUserId)) {
        currentUser.friends.push(fromUserId);
      }
      if (!fromUser.friends.some(f => f.toString() === user.id)) {
        fromUser.friends.push(user.id);
      }
      
      await currentUser.save();
      await fromUser.save();
      
      console.log(`Friend accepted: ${user.username} <-> ${fromUser.username}`);
      
      // Update in-memory friends list
      if (!user.friends) user.friends = new Set();
      user.friends.add(fromUserId);
      
      // Send confirmation to current user
      socket.emit('friendAdded', {
        id: fromUserId,
        username: fromUser.username,
        avatar: fromUser.avatar,
        profilePicture: fromUser.profilePicture,
        online: Array.from(users.values()).some(u => u.id === fromUserId)
      });

      // Refresh current user's friends list
      socket.emit('friendsList', await (async () => {
        try {
          const populated = await User.findById(user.id).populate('friends', 'username avatar profilePicture');
          return (populated?.friends || []).map(f => buildFriendPayload(f, findOnlineUserById(f._id.toString())));
        } catch {
          return [];
        }
      })());
      
      // If fromUser is online, notify them and update their in-memory list
      const fromUserEntry = Array.from(users.entries()).find(([_, u]) => u.id === fromUserId);
      if (fromUserEntry) {
        const [fromSocketId, fromUserData] = fromUserEntry;
        if (!fromUserData.friends) fromUserData.friends = new Set();
        fromUserData.friends.add(user.id);
        
        io.to(fromSocketId).emit('friendAdded', {
          id: user.id,
          username: user.username,
          avatar: user.avatar,
          profilePicture: user.profilePicture,
          online: true
        });

        // Refresh sender's friends list
        io.to(fromSocketId).emit('friendsList', await (async () => {
          try {
            const populated = await User.findById(fromUserId).populate('friends', 'username avatar profilePicture');
            return (populated?.friends || []).map(f => buildFriendPayload(f, findOnlineUserById(f._id.toString())));
          } catch {
            return [];
          }
        })());
      }
    } catch (error) {
      console.error('Error accepting friend request:', error);
    }
  });

  socket.on('rejectFriendRequest', async ({ fromUserId } = {}, ack) => {
    const user = users.get(socket.id);
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }
    if (!useDatabase) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Database not available' });
      return;
    }

    const fromId = String(fromUserId || '').trim();
    if (!fromId) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Missing fromUserId' });
      return;
    }

    try {
      const currentUser = await User.findById(user.id);
      if (!currentUser) {
        if (typeof ack === 'function') ack({ ok: false, message: 'User not found' });
        return;
      }

      currentUser.friendRequests = (currentUser.friendRequests || []).filter(
        r => r?.from?.toString?.() !== fromId
      );
      await currentUser.save();

      if (typeof ack === 'function') ack({ ok: true });
    } catch (e) {
      console.error('Error rejecting friend request:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to reject' });
    }
  });

  // Unfriend
  socket.on('unfriendUser', async ({ targetUserId }) => {
    const user = users.get(socket.id);
    if (!user) return;

    try {
      const currentUser = await User.findById(user.id);
      const targetUser = await User.findById(targetUserId);
      if (!currentUser || !targetUser) return;

      currentUser.friends = (currentUser.friends || []).filter(f => f.toString() !== targetUserId);
      targetUser.friends = (targetUser.friends || []).filter(f => f.toString() !== user.id);

      await currentUser.save();
      await targetUser.save();

      // Update in-memory
      user.friends?.delete?.(targetUserId);

      socket.emit('friendRemoved', { friendId: targetUserId });

      const targetSocketId = findSocketIdByUserId(targetUserId);
      if (targetSocketId) {
        const targetOnline = users.get(targetSocketId);
        targetOnline?.friends?.delete?.(user.id);
        io.to(targetSocketId).emit('friendRemoved', { friendId: user.id });
      }

      // Refresh both lists
      socket.emit('friendsList', await (async () => {
        const populated = await User.findById(user.id).populate('friends', 'username avatar profilePicture');
        return (populated?.friends || []).map(f => buildFriendPayload(f, findOnlineUserById(f._id.toString())));
      })());

      if (targetSocketId) {
        io.to(targetSocketId).emit('friendsList', await (async () => {
          const populated = await User.findById(targetUserId).populate('friends', 'username avatar profilePicture');
          return (populated?.friends || []).map(f => buildFriendPayload(f, findOnlineUserById(f._id.toString())));
        })());
      }
    } catch (e) {
      console.error('Error unfriending:', e);
    }
  });

  // Block user (also unfriends)
  socket.on('blockUser', async ({ targetUserId }) => {
    const user = users.get(socket.id);
    if (!user) return;
    if (user.id === targetUserId) return;

    try {
      const currentUser = await User.findById(user.id);
      const targetUser = await User.findById(targetUserId);
      if (!currentUser || !targetUser) return;

      if (!currentUser.blockedUsers?.some(b => b.toString() === targetUserId)) {
        currentUser.blockedUsers = currentUser.blockedUsers || [];
        currentUser.blockedUsers.push(targetUserId);
      }

      // Remove friendship both ways
      currentUser.friends = (currentUser.friends || []).filter(f => f.toString() !== targetUserId);
      targetUser.friends = (targetUser.friends || []).filter(f => f.toString() !== user.id);

      // Remove pending requests both ways
      currentUser.friendRequests = (currentUser.friendRequests || []).filter(r => r.from.toString() !== targetUserId);
      targetUser.friendRequests = (targetUser.friendRequests || []).filter(r => r.from.toString() !== user.id);

      await currentUser.save();
      await targetUser.save();

      user.friends?.delete?.(targetUserId);

      socket.emit('userBlocked', { userId: targetUserId });
      socket.emit('friendRemoved', { friendId: targetUserId });

      const targetSocketId = findSocketIdByUserId(targetUserId);
      if (targetSocketId) {
        const targetOnline = users.get(targetSocketId);
        targetOnline?.friends?.delete?.(user.id);
        io.to(targetSocketId).emit('friendRemoved', { friendId: user.id });
      }

      // Refresh list for blocker
      socket.emit('friendsList', await (async () => {
        const populated = await User.findById(user.id).populate('friends', 'username avatar profilePicture');
        return (populated?.friends || []).map(f => buildFriendPayload(f, findOnlineUserById(f._id.toString())));
      })());
    } catch (e) {
      console.error('Error blocking user:', e);
    }
  });

  socket.on('inviteToRoom', ({ friendId, roomId }) => {
    const user = users.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!user || !room) return;

    const friendSocketId = findSocketIdByUserId(friendId);
    if (!friendSocketId) return;

    io.to(friendSocketId).emit('roomInvite', {
      fromUsername: user.username,
      roomId,
      roomName: room.name
    });
  });

  socket.on('getOnlineFriends', async () => {
    const user = users.get(socket.id);
    if (!user) return;

    // DB-backed friends list (includes offline friends)
    if (useDatabase) {
      try {
        const populated = await User.findById(user.id).populate('friends', 'username avatar profilePicture');
        const list = (populated?.friends || []).map(f => {
          const onlineEntry = findOnlineUserById(f._id.toString());
          return buildFriendPayload(f, onlineEntry);
        });
        socket.emit('friendsList', list);
        return;
      } catch (e) {
        console.error('getOnlineFriends error:', e);
      }
    }

    // Fallback: in-memory only
    const list = Array.from(user.friends)
      .map(friendUserId => {
        const onlineEntry = findOnlineUserById(friendUserId);
        return buildFriendPayload(onlineEntry, onlineEntry);
      })
      .filter(f => f?.id);

    socket.emit('friendsList', list);
  });

  // Direct Messages
  socket.on('sendDirectMessage', async ({ toUserId, message, image } = {}, ack) => {
    const user = users.get(socket.id);
    if (!user) return;

    if (!useDatabase) {
      socket.emit('directMessageError', { message: 'Database not available' });
      return;
    }

    // Validate message
    const trimmed = String(message || '').trim();
    const hasImage = !!(image && image.url);
    if (!trimmed && !hasImage) return;

    // Recipient may be offline; we still persist the message.
    const recipientEntry = Array.from(users.entries()).find(([_, u]) => u.id === toUserId);
    const recipientSocketId = recipientEntry?.[0] || null;

    // Block checks (both directions)
    try {
      const senderDoc = await User.findById(user.id).select('blockedUsers');
      const recipientDoc = await User.findById(toUserId).select('blockedUsers');
      if (senderDoc?.blockedUsers?.some(b => b.toString() === toUserId)) {
        socket.emit('directMessageError', { message: 'You have blocked this user' });
        return;
      }
      if (recipientDoc?.blockedUsers?.some(b => b.toString() === user.id)) {
        socket.emit('directMessageError', { message: 'You cannot message this user' });
        return;
      }
    } catch (e) {
      console.error('DM block check error:', e);
    }

    const dmDoc = await DirectMessage.create({
      fromUserId: user.id,
      toUserId,
      message: trimmed || ' ',
      image: hasImage ? {
        fileId: String(image.fileId || ''),
        url: String(image.url || ''),
        contentType: String(image.contentType || ''),
        name: String(image.name || '')
      } : undefined,
      timestamp: new Date()
    }).catch(e => {
      console.error('Error saving direct message:', e);
      return null;
    });

    const payload = {
      id: dmDoc?._id?.toString() || undefined,
      from: user.username,
      fromId: user.id,
      fromAvatar: user.avatar,
      fromProfilePicture: user.profilePicture || '',
      toUserId,
      message: trimmed,
      image: hasImage ? {
        fileId: String(image.fileId || ''),
        url: String(image.url || ''),
        contentType: String(image.contentType || ''),
        name: String(image.name || '')
      } : null,
      timestamp: Date.now()
    };

    if (recipientSocketId) {
      io.to(recipientSocketId).emit('directMessage', payload);
    }

    // Echo back to sender with an id so the UI can dedupe.
    io.to(socket.id).emit('directMessageSent', payload);

    if (typeof ack === 'function') ack({ ok: true, id: payload.id });
  });

  socket.on('getDirectMessages', async ({ withUserId, limit, before } = {}, ack) => {
    const user = users.get(socket.id);
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }

    const otherUserId = String(withUserId || '').trim();
    if (!otherUserId) {
      if (typeof ack === 'function') ack({ ok: false, message: 'withUserId is required' });
      return;
    }

    if (!useDatabase) {
      if (typeof ack === 'function') ack({ ok: true, messages: [] });
      return;
    }

    const requestedLimit = Number(limit);
    const safeLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 500)) : 100;

    const baseMatch = {
      $or: [
        { fromUserId: user.id, toUserId: otherUserId },
        { fromUserId: otherUserId, toUserId: user.id }
      ]
    };

    const beforeMs = before != null ? Number(before) : null;
    const query = Number.isFinite(beforeMs)
      ? { $and: [baseMatch, { timestamp: { $lt: new Date(beforeMs) } }] }
      : baseMatch;

    try {
      const docs = await DirectMessage.find(query)
        .sort({ timestamp: -1 })
        .limit(safeLimit)
        .lean();

      const messages = docs
        .reverse()
        .map(d => ({
          id: d._id.toString(),
          fromUserId: d.fromUserId,
          toUserId: d.toUserId,
          message: d.message,
          image: d.image?.url ? {
            fileId: d.image.fileId,
            url: d.image.url,
            contentType: d.image.contentType,
            name: d.image.name
          } : null,
          timestamp: new Date(d.timestamp).getTime()
        }));

      if (typeof ack === 'function') ack({ ok: true, messages });
    } catch (e) {
      console.error('Error fetching direct messages:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to fetch messages' });
    }
  });

  // News Feed
  socket.on('postToNewsFeed', async ({ content, images } = {}) => {
    const user = users.get(socket.id);
    if (!user) return;

    if (!useDatabase) {
      socket.emit('error', { message: 'Database not available' });
      return;
    }

    const trimmed = String(content || '').trim();
    const imgList = Array.isArray(images) ? images : [];
    const safeImages = imgList
      .filter(i => i && i.url && i.fileId)
      .slice(0, 4)
      .map(i => ({
        fileId: String(i.fileId),
        url: String(i.url),
        contentType: String(i.contentType || 'image/*'),
        name: String(i.name || '')
      }));

    if (!trimmed && safeImages.length === 0) return;

    try {
      const saved = await FeedPost.create({
        authorId: user.id,
        author: user.username,
        authorAvatar: user.avatar,
        authorProfilePicture: user.profilePicture,
        content: trimmed || ' ',
        images: safeImages,
        comments: [],
        reactions: { fireUserIds: [] },
        timestamp: new Date()
      });

      io.emit('newsFeedPost', {
        id: saved._id.toString(),
        author: saved.author,
        authorId: saved.authorId,
        authorAvatar: saved.authorAvatar,
        authorProfilePicture: saved.authorProfilePicture,
        content: (saved.content || '').trim(),
        images: saved.images || [],
        comments: saved.comments || [],
        fireCount: (saved.reactions?.fireUserIds || []).length,
        fireUserIds: saved.reactions?.fireUserIds || [],
        timestamp: new Date(saved.timestamp).getTime()
      });
    } catch (e) {
      console.error('Error saving feed post:', e);
      socket.emit('error', { message: 'Failed to post' });
    }
  });

  socket.on('toggleFeedReaction', async ({ postId, type } = {}, ack) => {
    const user = users.get(socket.id);
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }
    if (!useDatabase) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Database not available' });
      return;
    }
    if (String(type || '').toLowerCase() !== 'fire') {
      if (typeof ack === 'function') ack({ ok: false, message: 'Unsupported reaction' });
      return;
    }

    try {
      const doc = await FeedPost.findById(postId);
      if (!doc) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Post not found' });
        return;
      }

      const set = new Set(doc.reactions?.fireUserIds || []);
      const already = set.has(user.id);
      if (already) set.delete(user.id);
      else set.add(user.id);

      doc.reactions = doc.reactions || {};
      doc.reactions.fireUserIds = Array.from(set);
      await doc.save();

      const updated = {
        id: doc._id.toString(),
        author: doc.author,
        authorId: doc.authorId,
        authorAvatar: doc.authorAvatar,
        authorProfilePicture: doc.authorProfilePicture,
        content: (doc.content || '').trim(),
        images: doc.images || [],
        comments: doc.comments || [],
        fireCount: (doc.reactions?.fireUserIds || []).length,
        fireUserIds: doc.reactions?.fireUserIds || [],
        timestamp: new Date(doc.timestamp).getTime()
      };

      io.emit('feedPostUpdated', updated);
      if (typeof ack === 'function') ack({ ok: true, reacted: !already, fireCount: updated.fireCount });
    } catch (e) {
      console.error('toggleFeedReaction error:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to react' });
    }
  });

  socket.on('addFeedComment', async ({ postId, text } = {}, ack) => {
    const user = users.get(socket.id);
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }
    if (!useDatabase) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Database not available' });
      return;
    }

    const trimmed = String(text || '').trim();
    if (!trimmed) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Empty comment' });
      return;
    }

    try {
      const doc = await FeedPost.findById(postId);
      if (!doc) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Post not found' });
        return;
      }

      const mentionNames = extractMentionUsernames(trimmed);
      const mentioned = await resolveMentionedUsersByUsername(mentionNames);
      const mentionUserIds = mentioned.map(m => m.id).filter(id => id && id !== user.id);

      doc.comments.push({
        parentCommentId: null,
        replyToUserId: '',
        replyToUsername: '',
        userId: user.id,
        username: user.username,
        userAvatar: user.avatar,
        userProfilePicture: user.profilePicture || '',
        text: trimmed,
        mentionUserIds,
        timestamp: new Date()
      });

      // Keep comments bounded for performance
      if (doc.comments.length > 200) doc.comments = doc.comments.slice(doc.comments.length - 200);
      await doc.save();

      const updated = {
        id: doc._id.toString(),
        author: doc.author,
        authorId: doc.authorId,
        authorAvatar: doc.authorAvatar,
        authorProfilePicture: doc.authorProfilePicture,
        content: (doc.content || '').trim(),
        images: doc.images || [],
        comments: doc.comments || [],
        fireCount: (doc.reactions?.fireUserIds || []).length,
        fireUserIds: doc.reactions?.fireUserIds || [],
        timestamp: new Date(doc.timestamp).getTime()
      };

      io.emit('feedPostUpdated', updated);

      // Notify post author (someone commented on their post)
      if (doc.authorId && String(doc.authorId) !== String(user.id)) {
        emitFeedNotificationToUserId(String(doc.authorId), {
          id: uuidv4(),
          type: 'postComment',
          postId: doc._id.toString(),
          fromUserId: user.id,
          fromUsername: user.username,
          fromAvatar: user.avatar,
          fromProfilePicture: user.profilePicture || '',
          message: `${user.username} commented on your post`,
          timestamp: Date.now()
        });
      }

      // Notify mentioned users
      for (const m of mentioned) {
        if (!m?.id) continue;
        if (String(m.id) === String(user.id)) continue;
        emitFeedNotificationToUserId(String(m.id), {
          id: uuidv4(),
          type: 'mention',
          postId: doc._id.toString(),
          fromUserId: user.id,
          fromUsername: user.username,
          fromAvatar: user.avatar,
          fromProfilePicture: user.profilePicture || '',
          message: `${user.username} mentioned you in a comment`,
          timestamp: Date.now()
        });
      }

      if (typeof ack === 'function') ack({ ok: true });
    } catch (e) {
      console.error('addFeedComment error:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to comment' });
    }
  });

  socket.on('replyToFeedComment', async ({ postId, parentCommentId, text } = {}, ack) => {
    const user = users.get(socket.id);
    if (!user) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }
    if (!useDatabase) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Database not available' });
      return;
    }

    const trimmed = String(text || '').trim();
    if (!trimmed) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Empty reply' });
      return;
    }

    try {
      const doc = await FeedPost.findById(postId);
      if (!doc) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Post not found' });
        return;
      }

      const parent = (Array.isArray(doc.comments) ? doc.comments : []).find(c => String(c?._id) === String(parentCommentId));
      if (!parent) {
        if (typeof ack === 'function') ack({ ok: false, message: 'Comment not found' });
        return;
      }

      const mentionNames = extractMentionUsernames(trimmed);
      const mentioned = await resolveMentionedUsersByUsername(mentionNames);
      const mentionUserIds = mentioned.map(m => m.id).filter(id => id && id !== user.id);

      doc.comments.push({
        parentCommentId: parent._id,
        replyToUserId: String(parent.userId || ''),
        replyToUsername: String(parent.username || ''),
        userId: user.id,
        username: user.username,
        userAvatar: user.avatar,
        userProfilePicture: user.profilePicture || '',
        text: trimmed,
        mentionUserIds,
        timestamp: new Date()
      });

      if (doc.comments.length > 200) doc.comments = doc.comments.slice(doc.comments.length - 200);
      await doc.save();

      const updated = {
        id: doc._id.toString(),
        author: doc.author,
        authorId: doc.authorId,
        authorAvatar: doc.authorAvatar,
        authorProfilePicture: doc.authorProfilePicture,
        content: (doc.content || '').trim(),
        images: doc.images || [],
        comments: doc.comments || [],
        fireCount: (doc.reactions?.fireUserIds || []).length,
        fireUserIds: doc.reactions?.fireUserIds || [],
        timestamp: new Date(doc.timestamp).getTime()
      };

      io.emit('feedPostUpdated', updated);

      // Notify the parent comment author (someone replied to their comment)
      if (parent.userId && String(parent.userId) !== String(user.id)) {
        emitFeedNotificationToUserId(String(parent.userId), {
          id: uuidv4(),
          type: 'commentReply',
          postId: doc._id.toString(),
          fromUserId: user.id,
          fromUsername: user.username,
          fromAvatar: user.avatar,
          fromProfilePicture: user.profilePicture || '',
          message: `${user.username} replied to your comment`,
          timestamp: Date.now()
        });
      }

      // Notify post author too (unless already the replier)
      if (doc.authorId && String(doc.authorId) !== String(user.id)) {
        emitFeedNotificationToUserId(String(doc.authorId), {
          id: uuidv4(),
          type: 'postComment',
          postId: doc._id.toString(),
          fromUserId: user.id,
          fromUsername: user.username,
          fromAvatar: user.avatar,
          fromProfilePicture: user.profilePicture || '',
          message: `${user.username} replied in your post`,
          timestamp: Date.now()
        });
      }

      // Notify mentioned users
      for (const m of mentioned) {
        if (!m?.id) continue;
        if (String(m.id) === String(user.id)) continue;
        emitFeedNotificationToUserId(String(m.id), {
          id: uuidv4(),
          type: 'mention',
          postId: doc._id.toString(),
          fromUserId: user.id,
          fromUsername: user.username,
          fromAvatar: user.avatar,
          fromProfilePicture: user.profilePicture || '',
          message: `${user.username} mentioned you in a reply`,
          timestamp: Date.now()
        });
      }

      if (typeof ack === 'function') ack({ ok: true });
    } catch (e) {
      console.error('replyToFeedComment error:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to reply' });
    }
  });

  socket.on('getUserTimeline', async ({ userId } = {}, ack) => {
    const requester = users.get(socket.id);
    if (!requester) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Not registered' });
      return;
    }
    if (!useDatabase) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Database not available' });
      return;
    }

    const targetId = String(userId || '').trim();
    if (!targetId) {
      if (typeof ack === 'function') ack({ ok: false, message: 'Missing userId' });
      return;
    }

    try {
      const targetUser = await User.findById(targetId).select('-socketId');
      if (!targetUser) {
        if (typeof ack === 'function') ack({ ok: false, message: 'User not found' });
        return;
      }

      const requesterId = String(requester.id);
      const isSelf = requesterId === String(targetUser._id);

      let canViewTimeline = isSelf;
      if (!canViewTimeline) {
        const requesterDoc = await User.findById(requesterId).select('friends blockedUsers').lean();
        const requesterFriends = (requesterDoc?.friends || []).map(f => f.toString());
        const requesterBlocked = (requesterDoc?.blockedUsers || []).map(f => f.toString());
        const targetBlocked = (targetUser?.blockedUsers || []).map(f => f.toString());
        const isBlockedEitherWay = requesterBlocked.includes(targetId) || targetBlocked.includes(requesterId);
        canViewTimeline = !isBlockedEitherWay && requesterFriends.includes(targetId);
      }

      const posts = canViewTimeline
        ? await FeedPost.find({ authorId: targetId }).sort({ timestamp: -1 }).limit(50).lean()
        : [];

      let friends = [];
      if (canViewTimeline) {
        try {
          const friendIds = (targetUser?.friends || []).map(f => f.toString()).slice(0, 60);
          if (friendIds.length) {
            const friendDocs = await User.find({ _id: { $in: friendIds } })
              .select('username avatar profilePicture')
              .lean();
            const byId = new Map(friendDocs.map(d => [d._id.toString(), d]));
            friends = friendIds
              .map(id => byId.get(id))
              .filter(Boolean)
              .map(d => ({
                id: d._id.toString(),
                username: d.username,
                avatar: d.avatar,
                profilePicture: d.profilePicture || ''
              }));
          }
        } catch (e) {
          console.error('getUserTimeline friends lookup error:', e);
          friends = [];
        }
      }

      if (typeof ack === 'function') {
        ack({
          ok: true,
          canViewTimeline,
          user: targetUser,
          friends,
          posts: posts.map(p => ({
            id: p._id.toString(),
            author: p.author,
            authorId: p.authorId,
            authorAvatar: p.authorAvatar,
            authorProfilePicture: p.authorProfilePicture,
            content: (p.content || '').trim(),
            images: p.images || [],
            comments: p.comments || [],
            fireCount: (p.reactions?.fireUserIds || []).length,
            fireUserIds: p.reactions?.fireUserIds || [],
            timestamp: new Date(p.timestamp).getTime()
          }))
        });
      }
    } catch (e) {
      console.error('getUserTimeline error:', e);
      if (typeof ack === 'function') ack({ ok: false, message: 'Failed to load timeline' });
    }
  });

  socket.on('getNewsFeed', async () => {
    if (!useDatabase) {
      socket.emit('newsFeedUpdate', []);
      return;
    }

    try {
      const posts = await FeedPost.find({})
        .sort({ timestamp: -1 })
        .limit(50)
        .lean();
      socket.emit('newsFeedUpdate', posts.map(p => ({
        id: p._id.toString(),
        author: p.author,
        authorId: p.authorId,
        authorAvatar: p.authorAvatar,
        authorProfilePicture: p.authorProfilePicture,
        content: (p.content || '').trim(),
        images: p.images || [],
        comments: p.comments || [],
        fireCount: (p.reactions?.fireUserIds || []).length,
        fireUserIds: p.reactions?.fireUserIds || [],
        timestamp: new Date(p.timestamp).getTime()
      })));
    } catch (e) {
      console.error('Error loading news feed:', e);
      socket.emit('newsFeedUpdate', []);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    leaveVoiceBySocket(socket.id);
    handleLeaveRoom(socket.id);
    
    // Notify friends
    const user = users.get(socket.id);
    if (user) {
      user.friends.forEach(friendId => {
        const friendSocketId = findSocketIdByUserId(friendId);
        if (friendSocketId) {
          io.to(friendSocketId).emit('friendOffline', { friendId: user.id });
          io.to(friendSocketId).emit('friendRoomUpdate', { friendId: user.id, roomId: null, roomName: null });
        }
      });
    }
    
    users.delete(socket.id);
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Helper Functions
function handleLeaveRoom(userId) {
  const user = users.get(userId);
  if (!user || !user.currentRoom) return;

  // If the user is in voice for this room, remove them.
  const voiceEntry = voiceBySocket.get(userId);
  if (voiceEntry && String(voiceEntry.channelId) === String(user.currentRoom)) {
    leaveVoiceBySocket(userId);
  }

  const room = rooms.get(user.currentRoom);
  if (!room) return;

  const isEmpty = room.removeMember(userId);
  io.to(user.currentRoom).emit('userLeft', { 
    userId: user.id, 
    username: user.username 
  });

  if (useDatabase) {
    RoomModel.findByIdAndUpdate(user.currentRoom, {
      $pull: { members: user.id },
      $set: { lastActivity: new Date() }
    }).catch(e => console.error('Error updating DB room members (leave):', e));
  }

  if (isEmpty) {
    scheduleEmptyRoomDeletion(room);
  }

  user.currentRoom = null;

  // Notify friends about room change
  user.friends.forEach(friendUserId => {
    const friendSocketId = findSocketIdByUserId(friendUserId);
    if (friendSocketId) {
      io.to(friendSocketId).emit('friendRoomUpdate', { friendId: user.id, roomId: null, roomName: null });
    }
  });

  broadcastRoomList();
}

function getRoomData(room) {
  debugLog('getRoomData - room.members Set:', Array.from(room.members));
  debugLog('getRoomData - users Map keys:', Array.from(users.keys()));
  
  const membersArray = Array.from(room.members).map(id => {
    const user = users.get(id);
    debugLog(`  Looking up member ${id}: found =`, user ? user.username : 'NOT FOUND');
    return user ? { 
      id: user.id, 
      username: user.username, 
      avatar: user.avatar,
      profilePicture: user.profilePicture || ''
    } : null;
  }).filter(Boolean);
  
  debugLog('getRoomData - final members array:', membersArray);
  
  return {
    id: room.id,
    name: room.name,
    isPrivate: room.isPrivate,
    host: room.host,
    members: membersArray,
    messages: room.messages,
    youtube: room.youtube,
    drawings: room.drawings
  };
}

function broadcastRoomList() {
  if (!useDatabase) {
    const publicRooms = Array.from(rooms.values())
      .filter(room => !room.isPrivate)
      .map(room => {
        const hostUser = Array.from(users.values()).find(u => u.id === room.host);
        return {
          id: room.id,
          name: room.name,
          memberCount: room.members.size,
          host: hostUser?.username || 'Unknown'
        };
      });
    io.emit('roomList', publicRooms);
    return;
  }

  RoomModel.find({ isPrivate: false })
    .sort({ lastActivity: -1 })
    .limit(200)
    .lean()
    .then(async (docs) => {
      const hostIds = Array.from(new Set(docs.map(d => d.host).filter(Boolean)));
      const usersById = new Map();
      try {
        const hostUsers = await User.find({ _id: { $in: hostIds } }).select('username').lean();
        for (const u of hostUsers) usersById.set(u._id.toString(), u);
      } catch {
        // ignore
      }

      io.emit('roomList', docs.map(d => ({
        id: d._id.toString(),
        name: d.name,
        memberCount: Array.isArray(d.members) ? d.members.length : 0,
        host: usersById.get(String(d.host))?.username || 'Unknown'
      })));
    })
    .catch((err) => {
      console.error('broadcastRoomList DB error:', err);
      io.emit('roomList', []);
    });
}

const DEFAULT_PORT = 5000;
const PORT = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;

function printPortInUseHelp(port) {
  console.error(`\n❌ Port ${port} is already in use.`);
  console.error('On Windows PowerShell, you can find/stop it with:');
  console.error(`  Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess`);
  console.error('  Stop-Process -Id <PID> -Force\n');
  console.error(`Or run this server on another port (PowerShell):  $env:PORT=${port + 1}; npm run server`);
}

function startServer({ persistenceEnabled }) {
  // Attach once to avoid crashing with an unhandled 'error' event.
  if (!server.__hasErrorHandler) {
    server.on('error', err => {
      if (err?.code === 'EADDRINUSE') {
        printPortInUseHelp(PORT);
        // In dev, allow opt-in automatic fallback to next port.
        if (process.env.PORT_AUTO_INCREMENT === 'true') {
          const fallbackPort = PORT + 1;
          console.log(`\n🔁 Retrying on port ${fallbackPort} (PORT_AUTO_INCREMENT=true)`);
          server.listen(fallbackPort, () => {
            console.log(`🚀 Hangout Bar server running on port ${fallbackPort}`);
            if (persistenceEnabled) console.log('🗄️  Persistence: MongoDB Atlas (enabled)');
            else console.log('⚠️  Persistence: disabled (memory-only)');
          });
          return;
        }
      } else {
        console.error('Server error:', err);
      }

      // Exit so nodemon can restart if you change config.
      process.exit(1);
    });
    server.__hasErrorHandler = true;
  }

  server.listen(PORT, () => {
    console.log(`🚀 Hangout Bar server running on port ${PORT}`);
    if (persistenceEnabled) console.log('🗄️  Persistence: MongoDB Atlas (enabled)');
    else console.log('⚠️  Persistence: disabled (memory-only)');
  });
}

async function bootstrap() {
  try {
    useDatabase = await connectDB();

    if (useDatabase) {
      try {
        uploadsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
      } catch (e) {
        console.error('Error creating uploads bucket:', e);
      }

      try {
        // After a restart, no one is connected, so DB-side "members" must be reset.
        // Otherwise rooms can be treated as non-empty forever and never get swept.
        await RoomModel.updateMany({}, { $set: { members: [] } }).catch(() => {});
      } catch (e) {
        console.error('Error hydrating rooms from MongoDB:', e);
      }

      // Restart-safe cleanup: delete any rooms empty for > 5 minutes
      setInterval(() => {
        sweepEmptyRoomsFromDB().catch(() => {});
      }, EMPTY_ROOM_SWEEP_INTERVAL_MS);

      // Also run once on startup
      sweepEmptyRoomsFromDB().catch(() => {});
    }

    startServer({ persistenceEnabled: useDatabase });
  } catch (e) {
    console.error('Bootstrap error:', e);
    const allowInMemory = String(process.env.ALLOW_IN_MEMORY || '').toLowerCase() === 'true';
    if (allowInMemory) {
      startServer({ persistenceEnabled: false });
      return;
    }
    process.exit(1);
  }
}

bootstrap();
