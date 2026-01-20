const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  isPrivate: {
    type: Boolean,
    default: false
  },
  host: {
    type: String,
    required: true
  },
  members: [{
    type: String
  }],
  youtube: {
    videoId: String,
    playing: Boolean,
    timestamp: Number,
    lastUpdate: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Room', RoomSchema);
