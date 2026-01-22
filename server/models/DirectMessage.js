const mongoose = require('mongoose');

const DirectMessageSchema = new mongoose.Schema({
  fromUserId: {
    type: String,
    required: true,
    index: true
  },
  toUserId: {
    type: String,
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true,
    maxlength: 2000
  },
  image: {
    fileId: { type: String },
    url: { type: String },
    contentType: { type: String },
    name: { type: String }
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('DirectMessage', DirectMessageSchema);
