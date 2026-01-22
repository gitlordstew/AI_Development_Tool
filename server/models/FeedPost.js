const mongoose = require('mongoose');

const FeedCommentSchema = new mongoose.Schema({
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  replyToUserId: { type: String, default: '' },
  replyToUsername: { type: String, default: '' },
  userId: { type: String, required: true },
  username: { type: String, required: true },
  userAvatar: { type: String, default: '👤' },
  userProfilePicture: { type: String, default: '' },
  text: { type: String, required: true, maxlength: 1000 },
  mentionUserIds: { type: [String], default: [] },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

const FeedImageSchema = new mongoose.Schema({
  fileId: { type: String, required: true },
  url: { type: String, required: true },
  contentType: { type: String, default: 'image/*' },
  name: { type: String, default: '' }
}, { _id: false });

const FeedPostSchema = new mongoose.Schema({
  authorId: {
    type: String,
    required: true
  },
  author: {
    type: String,
    required: true
  },
  authorAvatar: {
    type: String,
    default: '👤'
  },
  authorProfilePicture: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    required: true,
    maxlength: 500
  },
  images: {
    type: [FeedImageSchema],
    default: []
  },
  comments: {
    type: [FeedCommentSchema],
    default: []
  },
  reactions: {
    fireUserIds: {
      type: [String],
      default: []
    }
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('FeedPost', FeedPostSchema);
