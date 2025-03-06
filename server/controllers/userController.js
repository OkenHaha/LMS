const User = require('../models/User');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const { uploadToS3, deleteFromS3 } = require('../utils/fileUpload');
const { sendEmail } = require('../utils/sendEmail');

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Admin only)
exports.getUsers = asyncHandler(async (req, res, next) => {
  // Copy req.query
  const reqQuery = { ...req.query };

  // Fields to exclude
  const removeFields = ['select', 'sort', 'page', 'limit', 'search'];
  removeFields.forEach(param => delete reqQuery[param]);

  // Create query string
  let queryStr = JSON.stringify(reqQuery);
  queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);

  // Building query
  let query = User.find(JSON.parse(queryStr));

  // Search functionality
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    query = query.or([
      { name: searchRegex },
      { email: searchRegex }
    ]);
  }

  // Select Fields
  if (req.query.select) {
    const fields = req.query.select.split(',').join(' ');
    query = query.select(fields);
  }

  // Sort
  if (req.query.sort) {
    const sortBy = req.query.sort.split(',').join(' ');
    query = query.sort(sortBy);
  } else {
    query = query.sort('-createdAt');
  }

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const total = await User.countDocuments(JSON.parse(queryStr));

  query = query.skip(startIndex).limit(limit);

  // Executing query
  const users = await query;

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
    count: users.length,
    pagination,
    data: users
  });
});

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private (Admin only)
exports.getUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Create user
// @route   POST /api/users
// @access  Private (Admin only)
exports.createUser = asyncHandler(async (req, res, next) => {
  const user = await User.create(req.body);

  // Send welcome email
  try {
    await sendEmail({
      email: user.email,
      subject: 'Welcome to LMS Platform',
      template: 'welcome',
      data: {
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    console.log('Welcome email failed to send', err);
  }

  res.status(201).json({
    success: true,
    data: user
  });
});

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Admin only)
exports.updateUser = asyncHandler(async (req, res, next) => {
  let user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // If updating role, handle special cases
  if (req.body.role && user.role !== req.body.role) {
    await handleRoleChange(user, req.body.role);
  }

  user = await User.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });

  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
exports.deleteUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Handle user content before deletion
  await handleUserDeletion(user);

  await user.remove();

  res.status(200).json({
    success: true,
    data: {}
  });
});

// @desc    Upload profile picture
// @route   PUT /api/users/:id/photo
// @access  Private
exports.uploadProfilePicture = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Make sure user is owner or admin
  if (user._id.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new ErrorResponse(`Not authorized to update this user`, 401));
  }

  if (!req.files) {
    return next(new ErrorResponse(`Please upload a file`, 400));
  }

  const file = req.files.file;

  // Make sure the image is a photo
  if (!file.mimetype.startsWith('image')) {
    return next(new ErrorResponse(`Please upload an image file`, 400));
  }

  // Check filesize
  if (file.size > process.env.MAX_FILE_UPLOAD) {
    return next(
      new ErrorResponse(
        `Please upload an image less than ${process.env.MAX_FILE_UPLOAD}`,
        400
      )
    );
  }

  // Delete old profile picture if exists
  if (user.profilePicture) {
    await deleteFromS3(user.profilePicture);
  }

  // Upload new picture to S3
  const result = await uploadToS3(file);
  
  user.profilePicture = result.Location;
  await user.save();

  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Update user preferences
// @route   PUT /api/users/:id/preferences
// @access  Private
exports.updatePreferences = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Make sure user is owner
  if (user._id.toString() !== req.user.id) {
    return next(new ErrorResponse(`Not authorized to update preferences`, 401));
  }

  user.preferences = {
    ...user.preferences,
    ...req.body
  };

  await user.save();

  res.status(200).json({
    success: true,
    data: user
  });
});

// @desc    Get user statistics
// @route   GET /api/users/:id/stats
// @access  Private
exports.getUserStats = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  // Make sure user is owner or admin
  if (user._id.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(new ErrorResponse(`Not authorized to view these statistics`, 401));
  }

  let stats = {};

  if (user.role === 'student') {
    // Get student statistics
    stats = await getStudentStats(user._id);
  } else if (user.role === 'teacher') {
    // Get teacher statistics
    stats = await getTeacherStats(user._id);
  }

  res.status(200).json({
    success: true,
    data: stats
  });
});

// @desc    Upload ID verification document
// @route   PUT /api/users/:id/verify
// @access  Private
exports.uploadVerificationDocument = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
  }

  if (!req.files) {
    return next(new ErrorResponse(`Please upload a file`, 400));
  }

  const file = req.files.file;

  // Check file type
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
  if (!allowedTypes.includes(file.mimetype)) {
    return next(new ErrorResponse(`Please upload a valid document`, 400));
  }

  // Upload to S3
  const result = await uploadToS3(file);

  user.idProof = {
    documentUrl: result.Location,
    status: 'pending',
    submitDate: Date.now()
  };

  await user.save();

  // Notify admins about new verification request
  // Implementation depends on your notification system

  res.status(200).json({
    success: true,
    data: user
  });
});

// Helper Functions

// Handle role change implications
const handleRoleChange = async (user, newRole) => {
  if (user.role === 'teacher' && newRole !== 'teacher') {
    // Handle teacher's courses
    const courses = await Course.find({ teacherId: user._id });
    for (const course of courses) {
      course.status = 'archived';
      await course.save();
    }
  }
};

// Handle user deletion cleanup
const handleUserDeletion = async (user) => {
  // Delete profile picture
  if (user.profilePicture) {
    await deleteFromS3(user.profilePicture);
  }

  // Delete ID proof document
  if (user.idProof && user.idProof.documentUrl) {
    await deleteFromS3(user.idProof.documentUrl);
  }

  if (user.role === 'teacher') {
    // Archive teacher's courses
    await Course.updateMany(
      { teacherId: user._id },
      { status: 'archived' }
    );
  }

  // Handle enrollments
  await Enrollment.updateMany(
    { userId: user._id },
    { status: 'cancelled' }
  );
};

// Get student statistics
const getStudentStats = async (userId) => {
  const enrollments = await Enrollment.find({ userId });
  
  return {
    totalCourses: enrollments.length,
    completedCourses: enrollments.filter(e => e.status === 'completed').length,
    inProgressCourses: enrollments.filter(e => e.status === 'active').length,
    averageProgress: enrollments.reduce((acc, curr) => acc + curr.completionPercentage, 0) / enrollments.length || 0,
    // Add more relevant statistics
  };
};

// Get teacher statistics
const getTeacherStats = async (userId) => {
  const courses = await Course.find({ teacherId: userId });
  const courseIds = courses.map(course => course._id);
  const enrollments = await Enrollment.find({ courseId: { $in: courseIds } });

  return {
    totalCourses: courses.length,
    publishedCourses: courses.filter(c => c.status === 'published').length,
    totalStudents: enrollments.length,
    averageRating: courses.reduce((acc, curr) => acc + curr.avgRating, 0) / courses.length || 0,
    totalRevenue: enrollments.length * courses.reduce((acc, curr) => acc + curr.price, 0),
    // Add more relevant statistics
  };
};

module.exports = exports;