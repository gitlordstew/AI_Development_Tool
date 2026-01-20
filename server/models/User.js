const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  socketId: {
    type: String,
    unique: true,
    sparse: true
  },
  username: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30,
    unique: true
  },
  password: {
    type: String // Only for registered accounts
  },
  isGuest: {
    type: Boolean,
    default: false
  },
  avatar: {
    type: String,
    default: '👤'
  },
  profilePicture: {
    type: String, // URL or base64
    default: null
  },
  bio: {
    type: String,
    maxlength: 200,
    default: ''
  },
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  friendRequests: [{
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', UserSchema);
