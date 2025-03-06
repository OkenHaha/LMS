const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const Payment = require('../models/Payment');
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const { generateCertificate } = require('../utils/certificateGenerator');
const { sendEmail } = require('../utils/sendEmail');

// @desc    Create new enrollment
// @route   POST /api/enrollments
// @access  Private (Students only)
exports.createEnrollment = asyncHandler(async (req, res, next) => {
  const { courseId } = req.body;

  // Check if course exists
  const course = await Course.findById(courseId);
  if (!course) {
    return next(new ErrorResponse(`Course not found with id of ${courseId}`, 404));
  }

  // Check if user is already enrolled
  const existingEnrollment = await Enrollment.findOne({
    userId: req.user.id,
    courseId
  });

  if (existingEnrollment) {
    return next(new ErrorResponse('Already enrolled in this course', 400));
  }

  // Create enrollment with initial progress tracking
  const enrollment = await Enrollment.create({
    userId: req.user.id,
    courseId,
    progress: course.syllabus.map(section => ({
      sectionId: section._id,
      completed: false,
      completedMaterials: []
    }))
  });

  // Increment course enrollment count
  course.enrollmentCount += 1;
  await course.save();

  // Send enrollment confirmation email
  try {
    await sendEmail({
      email: req.user.email,
      subject: `Welcome to ${course.title}`,
      template: 'enrollmentConfirmation',
      data: {
        userName: req.user.name,
        courseName: course.title,
        courseUrl: `${process.env.FRONTEND_URL}/courses/${course._id}`
      }
    });
  } catch (err) {
    console.log('Email sending failed', err);
  }

  res.status(201).json({
    success: true,
    data: enrollment
  });
});

// @desc    Get all enrollments
// @route   GET /api/enrollments
// @access  Private (Admin/Teacher)
exports.getEnrollments = asyncHandler(async (req, res, next) => {
  let query;

  // If user is teacher, only get enrollments for their courses
  if (req.user.role === 'teacher') {
    const courses = await Course.find({ teacherId: req.user.id });
    const courseIds = courses.map(course => course._id);
    query = Enrollment.find({ courseId: { $in: courseIds } });
  } else {
    query = Enrollment.find();
  }

  // Add query parameters
  if (req.query.status) {
    query = query.find({ status: req.query.status });
  }

  if (req.query.course) {
    query = query.find({ courseId: req.query.course });
  }

  // Populate with user and course data
  query = query.populate({
    path: 'userId',
    select: 'name email'
  }).populate({
    path: 'courseId',
    select: 'title price'
  });

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const total = await Enrollment.countDocuments(query);

  query = query.skip(startIndex).limit(limit);

  // Execute query
  const enrollments = await query;

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
    count: enrollments.length,
    pagination,
    data: enrollments
  });
});

// @desc    Get single enrollment
// @route   GET /api/enrollments/:id
// @access  Private
exports.getEnrollment = asyncHandler(async (req, res, next) => {
  const enrollment = await Enrollment.findById(req.params.id)
    .populate({
      path: 'userId',
      select: 'name email'
    })
    .populate({
      path: 'courseId',
      select: 'title syllabus'
    });

  if (!enrollment) {
    return next(
      new ErrorResponse(`Enrollment not found with id of ${req.params.id}`, 404)
    );
  }

  // Make sure user has access to enrollment
  if (
    enrollment.userId._id.toString() !== req.user.id &&
    req.user.role !== 'admin' &&
    !await isTeacherOfCourse(req.user.id, enrollment.courseId._id)
  ) {
    return next(new ErrorResponse('Not authorized to access this enrollment', 401));
  }

  res.status(200).json({
    success: true,
    data: enrollment
  });
});

// @desc    Update enrollment progress
// @route   PUT /api/enrollments/:id/progress
// @access  Private (Student only)
exports.updateProgress = asyncHandler(async (req, res, next) => {
  const { sectionId, materialId, completed } = req.body;

  let enrollment = await Enrollment.findById(req.params.id);

  if (!enrollment) {
    return next(
      new ErrorResponse(`Enrollment not found with id of ${req.params.id}`, 404)
    );
  }

  // Verify user owns this enrollment
  if (enrollment.userId.toString() !== req.user.id) {
    return next(new ErrorResponse('Not authorized to update this enrollment', 401));
  }

  // Update section progress
  const section = enrollment.progress.find(p => p.sectionId.toString() === sectionId);
  if (!section) {
    return next(new ErrorResponse('Section not found', 404));
  }

  if (materialId) {
    // Update specific material progress
    if (completed) {
      if (!section.completedMaterials.includes(materialId)) {
        section.completedMaterials.push(materialId);
      }
    } else {
      section.completedMaterials = section.completedMaterials.filter(
        id => id !== materialId
      );
    }
  }

  // Check if section is completed
  const course = await Course.findById(enrollment.courseId);
  const courseSection = course.syllabus.id(sectionId);
  section.completed = 
    section.completedMaterials.length === courseSection.materials.length;

  // Update completion percentage
  enrollment.completionPercentage = 
    (enrollment.progress.filter(p => p.completed).length / 
    enrollment.progress.length) * 100;

  // Check if course is completed
  if (enrollment.completionPercentage === 100 && enrollment.status !== 'completed') {
    enrollment.status = 'completed';
    enrollment.completedAt = Date.now();

    // Generate certificate
    const certificate = await generateCertificate({
      studentName: req.user.name,
      courseName: course.title,
      completionDate: new Date().toISOString().split('T')[0],
      teacherName: (await User.findById(course.teacherId)).name
    });

    enrollment.certificateDetails = {
      issueDate: Date.now(),
      certificateId: `CERT-${enrollment._id}`,
      certificateUrl: certificate.url
    };

    // Send completion email
    try {
      await sendEmail({
        email: req.user.email,
        subject: `Congratulations on completing ${course.title}!`,
        template: 'courseCompletion',
        data: {
          userName: req.user.name,
          courseName: course.title,
          certificateUrl: certificate.url
        }
      });
    } catch (err) {
      console.log('Completion email sending failed', err);
    }
  }

  enrollment = await enrollment.save();

  res.status(200).json({
    success: true,
    data: enrollment
  });
});

// @desc    Get enrollment statistics
// @route   GET /api/enrollments/stats
// @access  Private (Admin/Teacher)
exports.getEnrollmentStats = asyncHandler(async (req, res, next) => {
  let query = {};

  // If teacher, only get stats for their courses
  if (req.user.role === 'teacher') {
    const courses = await Course.find({ teacherId: req.user.id });
    query.courseId = { $in: courses.map(course => course._id) };
  }

  const stats = await Enrollment.aggregate([
    { $match: query },
    {
      $group: {
        _id: null,
        totalEnrollments: { $sum: 1 },
        activeEnrollments: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        completedEnrollments: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        averageCompletion: { $avg: '$completionPercentage' }
      }
    }
  ]);

  // Get revenue statistics
  const revenue = await Payment.aggregate([
    { $match: { status: 'completed', ...query } },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$amount' },
        averageRevenue: { $avg: '$amount' }
      }
    }
  ]);

  res.status(200).json({
    success: true,
    data: {
      ...stats[0],
      revenue: revenue[0] || { totalRevenue: 0, averageRevenue: 0 }
    }
  });
});

// @desc    Cancel enrollment
// @route   PUT /api/enrollments/:id/cancel
// @access  Private
exports.cancelEnrollment = asyncHandler(async (req, res, next) => {
  const enrollment = await Enrollment.findById(req.params.id);

  if (!enrollment) {
    return next(
      new ErrorResponse(`Enrollment not found with id of ${req.params.id}`, 404)
    );
  }

  // Check authorization
  if (
    enrollment.userId.toString() !== req.user.id &&
    req.user.role !== 'admin'
  ) {
    return next(new ErrorResponse('Not authorized to cancel this enrollment', 401));
  }

  // Check if cancellation is allowed (e.g., within 30 days)
  const enrollmentDate = new Date(enrollment.createdAt);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (enrollmentDate < thirtyDaysAgo) {
    return next(
      new ErrorResponse('Enrollment cannot be cancelled after 30 days', 400)
    );
  }

  enrollment.status = 'cancelled';
  await enrollment.save();

  // Decrement course enrollment count
  const course = await Course.findById(enrollment.courseId);
  course.enrollmentCount -= 1;
  await course.save();

  // Process refund if applicable
  const payment = await Payment.findOne({
    userId: enrollment.userId,
    courseId: enrollment.courseId
  });

  if (payment) {
    await payment.processRefund(payment.amount, 'Enrollment cancelled');
  }

  res.status(200).json({
    success: true,
    data: enrollment
  });
});

// Helper function to check if user is teacher of course
const isTeacherOfCourse = async (userId, courseId) => {
  const course = await Course.findById(courseId);
  return course && course.teacherId.toString() === userId;
};

module.exports = exports;