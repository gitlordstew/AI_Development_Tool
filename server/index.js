const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
require('dotenv').config();

// Database
const connectDB = require('./config/database');
const Message = require('./models/Message');
const RoomModel = require('./models/Room');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Connect to database (optional)
let useDatabase = false;
connectDB().then(connected => {
  useDatabase = connected;
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
  });
}

// In-memory storage (fallback when no database)
const users = new Map();
const rooms = new Map();

// Room class
class Room {
  constructor(id, name, isPrivate, host) {
    this.id = id;
    this.name = name;
    this.isPrivate = isPrivate;
    this.host = host;
    this.members = new Set([host]);
    this.messages = [];
    this.youtube = { videoId: null, playing: false, timestamp: 0, lastUpdate: Date.now() };
    this.drawings = [];
    this.createdAt = Date.now();
  }

  addMember(userId) {
    this.members.add(userId);
  }

  removeMember(userId) {
    this.members.delete(userId);
    if (this.members.size === 0) return true; // Room is empty
    if (userId === this.host && this.members.size > 0) {
      this.host = Array.from(this.members)[0]; // Transfer host
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

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', users: users.size, rooms: rooms.size });
});

app.get('/api/rooms', (req, res) => {
  const publicRooms = Array.from(rooms.values())
    .filter(room => !room.isPrivate)
    .map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.size,
      host: users.get(room.host)?.username || 'Unknown'
    }));
  res.json(publicRooms);
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
    const { username, password, avatar, profilePicture } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    if (useDatabase) {
      let user = await User.findOne({ username, isGuest: false });
      if (user) {
        return res.status(400).json({ success: false, error: 'Username already taken' });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      user = await User.create({
        username,
        password: hashedPassword,
        avatar: avatar || '👤',
        profilePicture: profilePicture || '',
        isGuest: false
      });
      
      res.json({ 
        success: true, 
        user: {
          id: user._id,
          username: user.username,
          avatar: user.avatar,
          profilePicture: user.profilePicture,
          bio: user.bio,
          isGuest: false
        }, 
        token: user._id.toString() 
      });
    } else {
      res.json({ success: true, user: { username, avatar, profilePicture, isGuest: false }});
    }
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
      const user = await User.findById(req.params.userId).select('-socketId');
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
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { avatar, profilePicture, bio, lastActive: Date.now() },
        { new: true }
      ).select('-socketId');
      res.json(user);
    } else {
      res.json({ error: 'Database not available' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User Registration
  socket.on('register', async ({ username, avatar, userId }) => {
    try {
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
        currentRoom: null,
        friends: dbUser ? new Set(dbUser.friends.map(f => f.toString())) : new Set()
      };
      
      users.set(socket.id, user);
      socket.emit('registered', { userId: user.id, user });
      console.log(`User registered: ${user.username}`);
    } catch (error) {
      console.error('Error registering user:', error);
      socket.emit('error', { message: 'Registration failed' });
    }
  });

  // Create Room
  socket.on('createRoom', ({ name, isPrivate }) => {
    const user = users.get(socket.id);
    if (!user) return socket.emit('error', { message: 'Not registered' });

    const roomId = uuidv4();
    const room = new Room(roomId, name, isPrivate, user.id); // Use user.id instead of socket.id
    rooms.set(roomId, room);
    
    socket.join(roomId);
    user.currentRoom = roomId;
    
    socket.emit('roomCreated', { roomId, room: getRoomData(room) });
    broadcastRoomList();
    console.log(`Room created: ${name} by ${user.username}`);
  });

  // Join Room
  socket.on('joinRoom', ({ roomId }) => {
    const user = users.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!user) return socket.emit('error', { message: 'Not registered' });
    if (!room) return socket.emit('error', { message: 'Room not found' });

    // Leave current room if any
    if (user.currentRoom) {
      socket.leave(user.currentRoom);
      const oldRoom = rooms.get(user.currentRoom);
      if (oldRoom) {
        oldRoom.removeMember(socket.id);
        io.to(user.currentRoom).emit('userLeft', { userId: socket.id, username: user.username });
      }
    }

    socket.join(roomId);
    room.addMember(socket.id);
    user.currentRoom = roomId;

    socket.emit('joinedRoom', { room: getRoomData(room) });
    io.to(roomId).emit('userJoined', { 
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      profilePicture: user.profilePicture || ''
    });
    
    broadcastRoomList();
    console.log(`${user.username} joined room: ${room.name}`);
  });

  // Leave Room
  socket.on('leaveRoom', () => {
    handleLeaveRoom(socket.id);
  });

  // Send Message
  socket.on('sendMessage', async ({ message }) => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    const msg = room.addMessage(socket.id, user.username, message);
    
    // Save to database if available
    if (useDatabase) {
      try {
        await Message.create({
          userId: socket.id,
          username: user.username,
          message,
          roomId: room.id,
          timestamp: msg.timestamp
        });
      } catch (error) {
        console.error('Error saving message to database:', error);
      }
    }
    
    io.to(user.currentRoom).emit('newMessage', msg);
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

    room.drawings.push(drawData);
    if (room.drawings.length > 5000) room.drawings.shift();
    
    socket.to(user.currentRoom).emit('drawing', drawData);
  });

  socket.on('clearCanvas', () => {
    const user = users.get(socket.id);
    if (!user || !user.currentRoom) return;

    const room = rooms.get(user.currentRoom);
    if (!room) return;

    room.drawings = [];
    io.to(user.currentRoom).emit('canvasCleared');
  });

  // Friend System
  socket.on('sendFriendRequest', ({ targetUserId }) => {
    const user = users.get(socket.id);
    const targetUser = users.get(targetUserId);
    
    if (!user || !targetUser) return;

    io.to(targetUserId).emit('friendRequest', {
      fromId: socket.id,
      fromUsername: user.username,
      fromAvatar: user.avatar
    });
  });

  socket.on('acceptFriendRequest', ({ fromUserId }) => {
    const user = users.get(socket.id);
    const fromUser = users.get(fromUserId);
    
    if (!user || !fromUser) return;

    user.friends.add(fromUserId);
    fromUser.friends.add(socket.id);

    socket.emit('friendAdded', {
      id: fromUserId,
      username: fromUser.username,
      avatar: fromUser.avatar,
      online: true
    });

    io.to(fromUserId).emit('friendAdded', {
      id: socket.id,
      username: user.username,
      avatar: user.avatar,
      online: true
    });
  });

  socket.on('inviteToRoom', ({ friendId, roomId }) => {
    const user = users.get(socket.id);
    const room = rooms.get(roomId);
    
    if (!user || !room) return;

    io.to(friendId).emit('roomInvite', {
      fromUsername: user.username,
      roomId,
      roomName: room.name
    });
  });

  socket.on('getOnlineFriends', () => {
    const user = users.get(socket.id);
    if (!user) return;

    const onlineFriends = Array.from(user.friends)
      .map(friendId => {
        const friend = users.get(friendId);
        return friend ? {
          id: friend.id,
          username: friend.username,
          avatar: friend.avatar,
          online: true,
          inRoom: !!friend.currentRoom
        } : null;
      })
      .filter(Boolean);

    socket.emit('friendsList', onlineFriends);
  });

  // Disconnect
  socket.on('disconnect', () => {
    handleLeaveRoom(socket.id);
    
    // Notify friends
    const user = users.get(socket.id);
    if (user) {
      user.friends.forEach(friendId => {
        io.to(friendId).emit('friendOffline', { userId: socket.id });
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

  const room = rooms.get(user.currentRoom);
  if (!room) return;

  const isEmpty = room.removeMember(userId);
  io.to(user.currentRoom).emit('userLeft', { userId, username: user.username });

  if (isEmpty) {
    rooms.delete(user.currentRoom);
    console.log(`Room deleted: ${room.name}`);
  }

  user.currentRoom = null;
  broadcastRoomList();
}

function getRoomData(room) {
  return {
    id: room.id,
    name: room.name,
    isPrivate: room.isPrivate,
    host: room.host,
    members: Array.from(room.members).map(id => {
      const user = users.get(id);
      return user ? { 
        id: user.id, 
        username: user.username, 
        avatar: user.avatar,
        profilePicture: user.profilePicture || ''
      } : null;
    }).filter(Boolean),
    messages: room.messages,
    youtube: room.youtube,
    drawings: room.drawings
  };
}

function broadcastRoomList() {
  const publicRooms = Array.from(rooms.values())
    .filter(room => !room.isPrivate)
    .map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.size,
      host: users.get(room.host)?.username || 'Unknown'
    }));
  
  io.emit('roomList', publicRooms);
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Hangout Bar server running on port ${PORT}`);
});
