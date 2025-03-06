const mongoose = require('mongoose');

// Schema for replies to posts
const ReplySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
});

// Schema for forum posts
const PostSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  attachments: [{
    type: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  replies: [ReplySchema]
});

// Main forum schema
const ForumSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  posts: [PostSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  pinnedPosts: [{
    type: mongoose.Schema.Types.ObjectId
  }],
  moderators: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
});

// Update the updatedAt timestamp before each save
ForumSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to add a post to the forum
ForumSchema.methods.addPost = function(postData) {
  this.posts.push(postData);
  this.updatedAt = Date.now();
  return this.save();
};

// Method to add a reply to a post
ForumSchema.methods.addReply = function(postId, replyData) {
  const post = this.posts.id(postId);
  if (!post) return null;
  
  post.replies.push(replyData);
  post.updatedAt = Date.now();
  this.updatedAt = Date.now();
  return this.save();
};

// Method to like/unlike a post
ForumSchema.methods.togglePostLike = function(postId, userId) {
  const post = this.posts.id(postId);
  if (!post) return null;
  
  const likeIndex = post.likes.indexOf(userId);
  if (likeIndex > -1) {
    // Unlike if already liked
    post.likes.splice(likeIndex, 1);
  } else {
    // Like if not already liked
    post.likes.push(userId);
  }
  
  this.updatedAt = Date.now();
  return this.save();
};

// Method to like/unlike a reply
ForumSchema.methods.toggleReplyLike = function(postId, replyId, userId) {
  const post = this.posts.id(postId);
  if (!post) return null;
  
  const reply = post.replies.id(replyId);
  if (!reply) return null;
  
  const likeIndex = reply.likes.indexOf(userId);
  if (likeIndex > -1) {
    // Unlike if already liked
    reply.likes.splice(likeIndex, 1);
  } else {
    // Like if not already liked
    reply.likes.push(userId);
  }
  
  this.updatedAt = Date.now();
  return this.save();
};

// Method to pin/unpin a post
ForumSchema.methods.togglePinnedPost = function(postId) {
  const pinnedIndex = this.pinnedPosts.indexOf(postId);
  if (pinnedIndex > -1) {
    // Unpin if already pinned
    this.pinnedPosts.splice(pinnedIndex, 1);
  } else {
    // Pin if not already pinned
    this.pinnedPosts.push(postId);
  }
  
  return this.save();
};

// Virtual for getting pinned posts
ForumSchema.virtual('getPinnedPosts').get(function() {
  const pinnedPosts = [];
  for (const pinnedId of this.pinnedPosts) {
    const post = this.posts.id(pinnedId);
    if (post) pinnedPosts.push(post);
  }
  return pinnedPosts;
});

// Method to get post count
ForumSchema.virtual('postCount').get(function() {
  return this.posts.length;
});

// Method to get total reply count
ForumSchema.virtual('replyCount').get(function() {
  return this.posts.reduce((total, post) => total + post.replies.length, 0);
});

module.exports = mongoose.model('Forum', ForumSchema);

// const mongoose = require('mongoose');

// const AttachmentSchema = new mongoose.Schema({
//   fileUrl: {
//     type: String,
//     required: true
//   },
//   fileName: {
//     type: String,
//     required: true
//   },
//   fileType: {
//     type: String,
//     enum: ['image', 'document', 'video', 'audio', 'other'],
//     required: true
//   },
//   fileSize: {
//     type: Number, // in bytes
//     required: true
//   },
//   uploadedAt: {
//     type: Date,
//     default: Date.now
//   }
// });

// const ReplySchema = new mongoose.Schema({
//   userId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },
//   content: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   attachments: [AttachmentSchema],
//   likes: [{
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   }],
//   isEdited: {
//     type: Boolean,
//     default: false
//   },
//   editHistory: [{
//     content: String,
//     editedAt: Date
//   }],
//   isAnswer: {
//     type: Boolean,
//     default: false
//   },
//   reports: [{
//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'User'
//     },
//     reason: String,
//     date: {
//       type: Date,
//       default: Date.now
//     },
//     status: {
//       type: String,
//       enum: ['pending', 'reviewed', 'resolved'],
//       default: 'pending'
//     }
//   }]
// }, {
//   timestamps: true
// });

// const PostSchema = new mongoose.Schema({
//   userId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User',
//     required: true
//   },
//   content: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   attachments: [AttachmentSchema],
//   likes: [{
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   }],
//   replies: [ReplySchema],
//   isEdited: {
//     type: Boolean,
//     default: false
//   },
//   editHistory: [{
//     content: String,
//     editedAt: Date
//   }],
//   isPinned: {
//     type: Boolean,
//     default: false
//   },
//   isAnnouncement: {
//     type: Boolean,
//     default: false
//   },
//   tags: [{
//     type: String,
//     trim: true
//   }],
//   reports: [{
//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'User'
//     },
//     reason: String,
//     date: {
//       type: Date,
//       default: Date.now
//     },
//     status: {
//       type: String,
//       enum: ['pending', 'reviewed', 'resolved'],
//       default: 'pending'
//     }
//   }],
//   lastActivity: {
//     type: Date,
//     default: Date.now
//   }
// }, {
//   timestamps: true
// });

// const ForumSchema = new mongoose.Schema({
//   courseId: {
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'Course',
//     required: true
//   },
//   title: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   description: {
//     type: String,
//     required: true,
//     trim: true
//   },
//   category: {
//     type: String,
//     enum: ['general', 'announcements', 'questions', 'discussions', 'resources'],
//     default: 'general'
//   },
//   moderators: [{
//     type: mongoose.Schema.Types.ObjectId,
//     ref: 'User'
//   }],
//   posts: [PostSchema],
//   isActive: {
//     type: Boolean,
//     default: true
//   },
//   settings: {
//     allowAnonymousPosts: {
//       type: Boolean,
//       default: false
//     },
//     requireModeratorApproval: {
//       type: Boolean,
//       default: false
//     },
//     allowAttachments: {
//       type: Boolean,
//       default: true
//     },
//     maxAttachmentSize: {
//       type: Number,
//       default: 5242880 // 5MB in bytes
//     },
//     allowedFileTypes: [{
//       type: String,
//       enum: ['image', 'document', 'video', 'audio', 'other']
//     }]
//   },
//   statistics: {
//     totalPosts: {
//       type: Number,
//       default: 0
//     },
//     totalReplies: {
//       type: Number,
//       default: 0
//     },
//     activeUsers: {
//       type: Number,
//       default: 0
//     },
//     lastPostDate: Date
//   }
// }, {
//   timestamps: true
// });

// // Indexes for efficient queries
// ForumSchema.index({ courseId: 1 });
// ForumSchema.index({ 'posts.userId': 1 });
// ForumSchema.index({ 'posts.lastActivity': -1 });
// ForumSchema.index({ 'posts.tags': 1 });

// // Update forum statistics
// ForumSchema.methods.updateStatistics = async function() {
//   const stats = {
//     totalPosts: this.posts.length,
//     totalReplies: this.posts.reduce((total, post) => total + post.replies.length, 0),
//     activeUsers: new Set([
//       ...this.posts.map(post => post.userId.toString()),
//       ...this.posts.flatMap(post => 
//         post.replies.map(reply => reply.userId.toString())
//       )
//     ]).size,
//     lastPostDate: this.posts.length > 0 ? 
//       this.posts.reduce((latest, post) => 
//         post.lastActivity > latest ? post.lastActivity : latest,
//         this.posts[0].lastActivity
//       ) : null
//   };

//   this.statistics = stats;
//   return this.save();
// };

// // Add post
// ForumSchema.methods.addPost = async function(postData) {
//   this.posts.push(postData);
//   await this.updateStatistics();
//   return this.save();
// };

// // Add reply to post
// ForumSchema.methods.addReply = async function(postId, replyData) {
//   const post = this.posts.id(postId);
//   if (!post) throw new Error('Post not found');
  
//   post.replies.push(replyData);
//   post.lastActivity = new Date();
//   await this.updateStatistics();
//   return this.save();
// };

// // Search posts
// ForumSchema.methods.searchPosts = function(query) {
//   return this.posts.filter(post => 
//     post.content.toLowerCase().includes(query.toLowerCase()) ||
//     post.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()))
//   );
// };

// // Get active discussions
// ForumSchema.methods.getActiveDiscussions = function(days = 7) {
//   const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
//   return this.posts
//     .filter(post => post.lastActivity >= cutoffDate)
//     .sort((a, b) => b.lastActivity - a.lastActivity);
// };

// // Pre-save middleware
// ForumSchema.pre('save', function(next) {
//   if (this.isModified('posts')) {
//     this.posts.forEach(post => {
//       post.lastActivity = new Date(Math.max(
//         post.updatedAt,
//         ...post.replies.map(reply => reply.updatedAt)
//       ));
//     });
//   }
//   next();
// });

// // Virtual for unanswered questions
// ForumSchema.virtual('unansweredQuestions').get(function() {
//   return this.posts.filter(post => 
//     post.category === 'questions' &&
//     !post.replies.some(reply => reply.isAnswer)
//   );
// });

// // Ensure virtuals are included in JSON output
// ForumSchema.set('toJSON', { virtuals: true });
// ForumSchema.set('toObject', { virtuals: true });

// module.exports = mongoose.model('Forum', ForumSchema);