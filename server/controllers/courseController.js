const Course = require('../models/Course');
const User = require('../models/User');
const Enrollment = require('../models/Enrollment');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const { uploadToS3, deleteFromS3 } = require('../utils/fileUpload');

// @desc    Create new course
// @route   POST /api/courses
// @access  Private (Teachers only)
exports.createCourse = asyncHandler(async (req, res, next) => {
  // Add user to req.body
  req.body.teacherId = req.user.id;

  // Check for published course
  const publishedCourse = await Course.findOne({ 
    teacherId: req.user.id,
    title: req.body.title 
  });

  // If the user is not an admin, they can only create a limited number of courses
  if (publishedCourse && req.user.role !== 'admin') {
    return next(
      new ErrorResponse(
        `You have already published a course with title ${req.body.title}`,
        400
      )
    );
  }

  const course = await Course.create(req.body);

  res.status(201).json({
    success: true,
    data: course
  });
});

// @desc    Get all courses
// @route   GET /api/courses
// @access  Public
exports.getCourses = asyncHandler(async (req, res, next) => {
  // Copy req.query
  const reqQuery = { ...req.query };

  // Fields to exclude
  const removeFields = ['select', 'sort', 'page', 'limit', 'search'];
  removeFields.forEach(param => delete reqQuery[param]);

  // Create query string
  let queryStr = JSON.stringify(reqQuery);

  // Create operators ($gt, $gte, etc)
  queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);

  // Finding resource
  let query = Course.find(JSON.parse(queryStr))
    .populate({
      path: 'teacherId',
      select: 'name profilePicture'
    });

  // Search functionality
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    query = query.or([
      { title: searchRegex },
      { description: searchRegex },
      { tags: searchRegex }
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
  const total = await Course.countDocuments(JSON.parse(queryStr));

  query = query.skip(startIndex).limit(limit);

  // Executing query
  const courses = await query;

  // Pagination result
  const pagination = {};

  if (endIndex < total) {
    pagination.next = {
      page: page + 1,
      limit
    };
  }

  if (startIndex > 0) {
    pagination.prev = {
      page: page - 1,
      limit
    };
  }

  res.status(200).json({
    success: true,
    count: courses.length,
    pagination,
    data: courses
  });
});

// @desc    Get single course
// @route   GET /api/courses/:id
// @access  Public
exports.getCourse = asyncHandler(async (req, res, next) => {
  const course = await Course.findById(req.params.id)
    .populate({
      path: 'teacherId',
      select: 'name profilePicture'
    })
    .populate({
      path: 'ratings.userId',
      select: 'name profilePicture'
    });

  if (!course) {
    return next(
      new ErrorResponse(`Course not found with id of ${req.params.id}`, 404)
    );
  }

  res.status(200).json({
    success: true,
    data: course
  });
});

// @desc    Update course
// @route   PUT /api/courses/:id
// @access  Private (Teacher/Admin only)
exports.updateCourse = asyncHandler(async (req, res, next) => {
  let course = await Course.findById(req.params.id);

  if (!course) {
    return next(
      new ErrorResponse(`Course not found with id of ${req.params.id}`, 404)
    );
  }

  // Make sure user is course teacher or admin
  if (course.teacherId.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(
      new ErrorResponse(
        `User ${req.user.id} is not authorized to update this course`,
        401
      )
    );
  }

  // Increment version if content is modified
  if (req.body.syllabus || req.body.description) {
    req.body.version = course.version + 1;
  }

  course = await Course.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true
  });

  res.status(200).json({
    success: true,
    data: course
  });
});

// @desc    Delete course
// @route   DELETE /api/courses/:id
// @access  Private (Teacher/Admin only)
exports.deleteCourse = asyncHandler(async (req, res, next) => {
  const course = await Course.findById(req.params.id);

  if (!course) {
    return next(
      new ErrorResponse(`Course not found with id of ${req.params.id}`, 404)
    );
  }

  // Make sure user is course teacher or admin
  if (course.teacherId.toString() !== req.user.id && req.user.role !== 'admin') {
    return next(
      new ErrorResponse(
        `User ${req.user.id} is not authorized to delete this course`,
        401
      )
    );
  }

  // Delete course materials from S3
  for (const section of course.syllabus) {
    for (const material of section.materials) {
      await deleteFromS3(material.fileUrl);
    }
  }

  // Delete enrollments
  await Enrollment.deleteMany({ courseId: course._id });

  await course.remove();

  res.status(200).json({
    success: true,
    data: {}
  });
});

// @desc    Upload course material
// @route   PUT /api/courses/:id/material
// @access  Private (Teacher only)
exports.uploadMaterial = asyncHandler(async (req, res, next) => {
  const course = await Course.findById(req.params.id);

  if (!course) {
    return next(
      new ErrorResponse(`Course not found with id of ${req.params.id}`, 404)
    );
  }

  // Make sure user is course teacher
  if (course.teacherId.toString() !== req.user.id) {
    return next(
      new ErrorResponse(
        `User ${req.user.id} is not authorized to upload to this course`,
        401
      )
    );
  }

  if (!req.files) {
    return next(new ErrorResponse(`Please upload a file`, 400));
  }

  const file = req.files.file;

  // Make sure the file is a valid type
  const fileTypes = ['pdf', 'doc', 'docx', 'mp4', 'mp3'];
  const fileExt = file.name.split('.').pop();
  
  if (!fileTypes.includes(fileExt)) {
    return next(new ErrorResponse(`Please upload a valid file type`, 400));
  }

  // Upload to S3
  const result = await uploadToS3(file);

  // Add to course materials
  const { sectionId } = req.body;
  const section = course.syllabus.id(sectionId);
  
  if (!section) {
    return next(new ErrorResponse(`Section not found`, 404));
  }

  section.materials.push({
    title: file.name,
    fileUrl: result.Location,
    type: fileExt,
    version: 1
  });

  await course.save();

  res.status(200).json({
    success: true,
    data: course
  });
});

// @desc    Add course rating
// @route   POST /api/courses/:id/ratings
// @access  Private (Enrolled students only)
exports.addCourseRating = asyncHandler(async (req, res, next) => {
  const course = await Course.findById(req.params.id);

  if (!course) {
    return next(
      new ErrorResponse(`Course not found with id of ${req.params.id}`, 404)
    );
  }

  // Check if user is enrolled
  const enrollment = await Enrollment.findOne({
    courseId: course._id,
    userId: req.user.id,
    status: 'active'
  });

  if (!enrollment) {
    return next(
      new ErrorResponse(`You must be enrolled to rate this course`, 401)
    );
  }

  // Check if user has already rated
  const existingRating = course.ratings.find(
    rating => rating.userId.toString() === req.user.id
  );

  if (existingRating) {
    return next(
      new ErrorResponse(`You have already rated this course`, 400)
    );
  }

  course.ratings.push({
    userId: req.user.id,
    rating: req.body.rating,
    review: req.body.review
  });

  await course.save();

  res.status(200).json({
    success: true,
    data: course
  });
});

// @desc    Get course statistics
// @route   GET /api/courses/:id/stats
// @access  Private (Teacher only)
exports.getCourseStats = asyncHandler(async (req, res, next) => {
  const course = await Course.findById(req.params.id);

  if (!course) {
    return next(
      new ErrorResponse(`Course not found with id of ${req.params.id}`, 404)
    );
  }

  // Make sure user is course teacher
  if (course.teacherId.toString() !== req.user.id) {
    return next(
      new ErrorResponse(
        `User ${req.user.id} is not authorized to view these statistics`,
        401
      )
    );
  }

  const enrollments = await Enrollment.find({ courseId: course._id });

  const stats = {
    totalEnrollments: course.enrollmentCount,
    averageRating: course.avgRating,
    totalRevenue: enrollments.length * course.price,
    completionRate: (
      enrollments.filter(e => e.status === 'completed').length /
      enrollments.length
    ) * 100,
    activeStudents: enrollments.filter(e => e.status === 'active').length
  };

  res.status(200).json({
    success: true,
    data: stats
  });
});

module.exports = exports;