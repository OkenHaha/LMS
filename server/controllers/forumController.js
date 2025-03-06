const Forum = require('../models/Forum');
const Course = require('../models/Course');
const User = require('../models/User');
const Enrollment = require('../models/Enrollment');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const { uploadToS3 } = require('../utils/fileUpload');
const { sendNotification } = require('../utils/notifications');

// @desc    Create forum thread
// @route   POST /api/courses/:courseId/forums
// @access  Private
exports.createForumThread = asyncHandler(async (req, res, next) => {
  const course = await Course.findById(req.params.courseId);

  if (!course) {
    return next(
      new ErrorResponse(`Course not found with id of ${req.params.courseId}`, 404)
    );
  }

  // Check if user is enrolled or is teacher
  const isEnrolled = await Enrollment.findOne({
    courseId: course._id,
    userId: req.user.id,
    status: 'active'
  });

  const isTeacher = course.teacherId.toString() === req.user.id;

  if (!isEnrolled && !isTeacher && req.user.role !== 'admin') {
    return next(
      new ErrorResponse('You must be enrolled in this course to create forum threads', 401)
    );
  }

  const forum = await Forum.create({
    courseId: course._id,
    title: req.body.title,
    description: req.body.description,
    category: req.body.category,
    posts: [{
      userId: req.user.id,
      content: req.body.content,
      isAnnouncement: isTeacher && req.body.isAnnouncement
    }]
  });

  // If it's an announcement, notify all enrolled students
  if (isTeacher && req.body.isAnnouncement) {
    const enrollments = await Enrollment.find({
      courseId: course._id,
      status: 'active'
    }).populate('userId');

    enrollments.forEach(enrollment => {
      sendNotification({
        userId: enrollment.userId._id,
        type: 'announcement',
        title: `New Announcement in ${course.title}`,
        message: req.body.title,
        link: `/courses/${course._id}/forums/${forum._id}`
      });
    });
  }

  res.status(201).json({
    success: true,
    data: forum
  });
});

// @desc    Get all forum threads for a course
// @route   GET /api/courses/:courseId/forums
// @access  Private
exports.getForumThreads = asyncHandler(async (req, res, next) => {
  const { courseId } = req.params;
  
  // Build query
  let query = Forum.find({ courseId });

  // Filter by category
  if (req.query.category) {
    query = query.find({ category: req.query.category });
  }

  // Search functionality
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    query = query.or([
      { title: searchRegex },
      { description: searchRegex },
      { 'posts.content': searchRegex }
    ]);
  }

  // Sort
  if (req.query.sort) {
    const sortBy = req.query.sort.split(',').join(' ');
    query = query.sort(sortBy);
  } else {
    query = query.sort('-posts.lastActivity');
  }

  // Populate user details
  query = query.populate({
    path: 'posts.userId',
    select: 'name profilePicture role'
  });

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const total = await Forum.countDocuments({ courseId });

  query = query.skip(startIndex).limit(limit);

  // Execute query
  const forums = await query;

  // Pagination result
  const pagination = {};

  if (endIndex < total) {
    pagination.next = { page: page + 1, limit };
  }

  if (startIndex > 0) {
    pagination.prev = { page: page - 1, limit };
  }

  res.status(200).json({
    success: true,
    count: forums.length,
    pagination,
    data: forums
  });
});

// @desc    Get single forum thread
// @route   GET /api/forums/:id
// @access  Private
exports.getForumThread = asyncHandler(async (req, res, next) => {
  const forum = await Forum.findById(req.params.id)
    .populate({
      path: 'posts.userId',
      select: 'name profilePicture role'
    })
    .populate({
      path: 'posts.replies.userId',
      select: 'name profilePicture role'
    });

  if (!forum) {
    return next(
      new ErrorResponse(`Forum thread not found with id of ${req.params.id}`, 404)
    );
  }

  res.status(200).json({
    success: true,
    data: forum
  });
});

// @desc    Add post to forum thread
// @route   POST /api/forums/:id/posts
// @access  Private
exports.addForumPost = asyncHandler(async (req, res, next) => {
  let forum = await Forum.findById(req.params.id);

  if (!forum) {
    return next(
      new ErrorResponse(`Forum thread not found with id of ${req.params.id}`, 404)
    );
  }

  // Handle file uploads if any
  let attachments = [];
  if (req.files) {
    const files = Array.isArray(req.files.files) ? req.files.files : [req.files.files];
    
    for (const file of files) {
      const result = await uploadToS3(file);
      attachments.push({
        fileUrl: result.Location,
        fileName: file.name,
        fileType: file.mimetype.split('/')[0],
        fileSize: file.size
      });
    }
  }

  const post = {
    userId: req.user.id,
    content: req.body.content,
    attachments
  };

  forum.posts.push(post);
  forum = await forum.save();

  // Notify thread creator and participants
  const uniqueUsers = new Set(forum.posts.map(post => post.userId.toString()));
  uniqueUsers.delete(req.user.id); // Don't notify the poster

  uniqueUsers.forEach(userId => {
    sendNotification({
      userId,
      type: 'forum_reply',
      title: 'New Reply in Forum Thread',
      message: `${req.user.name} replied to a thread you're participating in`,
      link: `/forums/${forum._id}`
    });
  });

  res.status(200).json({
    success: true,
    data: forum
  });
});

// @desc    Add reply to forum post
// @route   POST /api/forums/:id/posts/:postId/replies
// @access  Private
exports.addForumReply = asyncHandler(async (req, res, next) => {
  let forum = await Forum.findById(req.params.id);

  if (!forum) {
    return next(
      new ErrorResponse(`Forum thread not found with id of ${req.params.id}`, 404)
    );
  }

  const post = forum.posts.id(req.params.postId);
  if (!post) {
    return next(new ErrorResponse('Post not found', 404));
  }

  const reply = {
    userId: req.user.id,
    content: req.body.content
  };

  post.replies.push(reply);
  forum = await forum.save();

  // Notify post creator
  if (post.userId.toString() !== req.user.id) {
    sendNotification({
      userId: post.userId,
      type: 'forum_reply',
      title: 'New Reply to Your Post',
      message: `${req.user.name} replied to your post`,
      link: `/forums/${forum._id}`
    });
  }

  res.status(200).json({
    success: true,
    data: forum
  });
});

// @desc    Like/Unlike forum post
// @route   PUT /api/forums/:id/posts/:postId/like
// @access  Private
exports.toggleLike = asyncHandler(async (req, res, next) => {
  let forum = await Forum.findById(req.params.id);

  if (!forum) {
    return next(
      new ErrorResponse(`Forum thread not found with id of ${req.params.id}`, 404)
    );
  }

  const post = forum.posts.id(req.params.postId);
  if (!post) {
    return next(new ErrorResponse('Post not found', 404));
  }

  const likeIndex = post.likes.indexOf(req.user.id);
  if (likeIndex === -1) {
    post.likes.push(req.user.id);
  } else {
    post.likes.splice(likeIndex, 1);
  }

  forum = await forum.save();

  res.status(200).json({
    success: true,
    data: forum
  });
});

// @desc    Report forum post
// @route   POST /api/forums/:id/posts/:postId/report
// @access  Private
exports.reportPost = asyncHandler(async (req, res, next) => {
  let forum = await Forum.findById(req.params.id);

  if (!forum) {
    return next(
      new ErrorResponse(`Forum thread not found with id of ${req.params.id}`, 404)
    );
  }

  const post = forum.posts.id(req.params.postId);
  if (!post) {
    return next(new ErrorResponse('Post not found', 404));
  }

  // Check if user has already reported
  const existingReport = post.reports.find(
    report => report.userId.toString() === req.user.id
  );

  if (existingReport) {
    return next(new ErrorResponse('You have already reported this post', 400));
  }

  post.reports.push({
    userId: req.user.id,
    reason: req.body.reason
  });

  // If post gets multiple reports, notify moderators
  if (post.reports.length >= 3) {
    const course = await Course.findById(forum.courseId);
    sendNotification({
      userId: course.teacherId,
      type: 'post_reported',
      title: 'Post Reported Multiple Times',
      message: `A post in your course forum has been reported multiple times`,
      link: `/forums/${forum._id}`
    });
  }

  forum = await forum.save();

  res.status(200).json({
    success: true,
    data: forum
  });
});

// @desc    Get forum statistics
// @route   GET /api/courses/:courseId/forums/stats
// @access  Private (Teacher/Admin only)
exports.getForumStats = asyncHandler(async (req, res, next) => {
  const stats = await Forum.aggregate([
    { $match: { courseId: mongoose.Types.ObjectId(req.params.courseId) } },
    {
      $group: {
        _id: null,
        totalThreads: { $sum: 1 },
        totalPosts: { $sum: { $size: '$posts' } },
        totalReplies: {
          $sum: {
            $reduce: {
              input: '$posts',
              initialValue: 0,
              in: { $add: ['$$value', { $size: '$$this.replies' }] }
            }
          }
        },
        averageRepliesPerThread: {
          $avg: { $size: '$posts' }
        }
      }
    }
  ]);

  // Get most active users
  const activeUsers = await Forum.aggregate([
    { $match: { courseId: mongoose.Types.ObjectId(req.params.courseId) } },
    { $unwind: '$posts' },
    {
      $group: {
        _id: '$posts.userId',
        postCount: { $sum: 1 }
      }
    },
    { $sort: { postCount: -1 } },
    { $limit: 5 }
  ]);

  // Populate user details
  const populatedActiveUsers = await User.populate(activeUsers, {
    path: '_id',
    select: 'name profilePicture'
  });

  res.status(200).json({
    success: true,
    data: {
      ...stats[0],
      activeUsers: populatedActiveUsers
    }
  });
});

module.exports = exports;