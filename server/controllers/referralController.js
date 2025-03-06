const Referral = require('../models/Referral');
const User = require('../models/User');
const Course = require('../models/Course');
const Payment = require('../models/Payment');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const { sendEmail } = require('../utils/sendEmail');

// @desc    Generate referral code for user
// @route   POST /api/referrals/generate
// @access  Private
exports.generateReferralCode = asyncHandler(async (req, res, next) => {
  let referral = await Referral.findOne({ userId: req.user.id });

  if (referral) {
    return next(new ErrorResponse('Referral code already exists for this user', 400));
  }

  referral = await Referral.create({
    userId: req.user.id,
    referralCode: await Referral.generateReferralCode(req.user.id)
  });

  res.status(201).json({
    success: true,
    data: referral
  });
});

// @desc    Get user's referral details
// @route   GET /api/referrals/my-referrals
// @access  Private
exports.getMyReferrals = asyncHandler(async (req, res, next) => {
  const referral = await Referral.findOne({ userId: req.user.id })
    .populate({
      path: 'referrals.referredUserId',
      select: 'name email createdAt'
    })
    .populate({
      path: 'referrals.enrollmentId',
      select: 'courseId status',
      populate: {
        path: 'courseId',
        select: 'title price'
      }
    });

  if (!referral) {
    return next(new ErrorResponse('No referral found for this user', 404));
  }

  res.status(200).json({
    success: true,
    data: referral
  });
});

// @desc    Apply referral code
// @route   POST /api/referrals/apply
// @access  Public
exports.applyReferralCode = asyncHandler(async (req, res, next) => {
  const { referralCode, courseId } = req.body;

  const referral = await Referral.findOne({ referralCode });

  if (!referral) {
    return next(new ErrorResponse('Invalid referral code', 404));
  }

  // Check if user is trying to use their own referral code
  if (referral.userId.toString() === req.user.id) {
    return next(new ErrorResponse('Cannot use your own referral code', 400));
  }

  // Check if user has already used a referral code
  const existingReferral = await Referral.findOne({
    'referrals.referredUserId': req.user.id
  });

  if (existingReferral) {
    return next(new ErrorResponse('You have already used a referral code', 400));
  }

  // Get course details for commission calculation
  const course = await Course.findById(courseId);
  if (!course) {
    return next(new ErrorResponse('Course not found', 404));
  }

  // Calculate commission based on course price and referral tier
  const commissionRate = referral.settings.commissionRate / 100;
  const commission = course.price * commissionRate;

  // Add referral record
  referral.referrals.push({
    referredUserId: req.user.id,
    courseId,
    commission: {
      amount: commission,
      percentage: referral.settings.commissionRate
    },
    status: 'pending'
  });

  await referral.save();

  res.status(200).json({
    success: true,
    data: {
      discountAmount: commission,
      finalPrice: course.price - commission
    }
  });
});

// @desc    Process referral reward
// @route   POST /api/referrals/process-reward
// @access  Private
exports.processReferralReward = asyncHandler(async (req, res, next) => {
  const { referralId, enrollmentId } = req.body;

  const referral = await Referral.findById(referralId);
  if (!referral) {
    return next(new ErrorResponse('Referral not found', 404));
  }

  const referralTransaction = referral.referrals.find(
    r => r._id.toString() === enrollmentId
  );

  if (!referralTransaction) {
    return next(new ErrorResponse('Referral transaction not found', 404));
  }

  if (referralTransaction.status !== 'pending') {
    return next(new ErrorResponse('Referral already processed', 400));
  }

  // Update referral statistics
  referral.statistics.successfulReferrals += 1;
  referral.statistics.totalCommissionEarned += referralTransaction.commission.amount;

  // Check and award milestones
  await referral.checkMilestones();

  // Update referral status
  referralTransaction.status = 'completed';
  referralTransaction.processedAt = Date.now();

  await referral.save();

  // Send notification email
  try {
    await sendEmail({
      email: req.user.email,
      subject: 'Referral Reward Processed',
      template: 'referralReward',
      data: {
        userName: req.user.name,
        amount: referralTransaction.commission.amount,
        referralCode: referral.referralCode
      }
    });
  } catch (err) {
    console.log('Email sending failed', err);
  }

  res.status(200).json({
    success: true,
    data: referral
  });
});

// @desc    Get referral statistics
// @route   GET /api/referrals/stats
// @access  Private
exports.getReferralStats = asyncHandler(async (req, res, next) => {
  const referral = await Referral.findOne({ userId: req.user.id });

  if (!referral) {
    return next(new ErrorResponse('No referral found for this user', 404));
  }

  // Calculate monthly stats
  const monthlyStats = await Referral.aggregate([
    {
      $match: { userId: req.user._id }
    },
    { $unwind: '$referrals' },
    {
      $group: {
        _id: {
          month: { $month: '$referrals.date' },
          year: { $year: '$referrals.date' }
        },
        count: { $sum: 1 },
        commission: { $sum: '$referrals.commission.amount' }
      }
    },
    { $sort: { '_id.year': -1, '_id.month': -1 } }
  ]);

  // Get top referred courses
  const topCourses = await Referral.aggregate([
    {
      $match: { userId: req.user._id }
    },
    { $unwind: '$referrals' },
    {
      $group: {
        _id: '$referrals.courseId',
        count: { $sum: 1 },
        totalCommission: { $sum: '$referrals.commission.amount' }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]);

  // Populate course details
  const populatedTopCourses = await Course.populate(topCourses, {
    path: '_id',
    select: 'title price'
  });

  res.status(200).json({
    success: true,
    data: {
      overall: referral.statistics,
      monthly: monthlyStats,
      topCourses: populatedTopCourses
    }
  });
});

// @desc    Update referral settings
// @route   PUT /api/referrals/settings
// @access  Private
exports.updateReferralSettings = asyncHandler(async (req, res, next) => {
  const referral = await Referral.findOne({ userId: req.user.id });

  if (!referral) {
    return next(new ErrorResponse('No referral found for this user', 404));
  }

  // Update settings
  referral.settings = {
    ...referral.settings,
    ...req.body
  };

  await referral.save();

  res.status(200).json({
    success: true,
    data: referral
  });
});

// @desc    Get available rewards
// @route   GET /api/referrals/rewards
// @access  Private
exports.getAvailableRewards = asyncHandler(async (req, res, next) => {
  const referral = await Referral.findOne({ userId: req.user.id });

  if (!referral) {
    return next(new ErrorResponse('No referral found for this user', 404));
  }

  const availableRewards = referral.rewards.filter(
    reward => reward.status === 'available'
  );

  res.status(200).json({
    success: true,
    data: availableRewards
  });
});

// @desc    Redeem reward
// @route   POST /api/referrals/rewards/redeem
// @access  Private
exports.redeemReward = asyncHandler(async (req, res, next) => {
  const { rewardId } = req.body;

  const referral = await Referral.findOne({ userId: req.user.id });

  if (!referral) {
    return next(new ErrorResponse('No referral found for this user', 404));
  }

  const reward = referral.rewards.id(rewardId);

  if (!reward) {
    return next(new ErrorResponse('Reward not found', 404));
  }

  if (reward.status !== 'available') {
    return next(new ErrorResponse('Reward is not available', 400));
  }

  // Process reward redemption based on type
  switch (reward.type) {
    case 'discount':
      // Generate discount code
      reward.redemptionDetails = {
        code: `DISC-${Math.random().toString(36).substring(7)}`,
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };
      break;

    case 'free_course':
      // Grant access to course
      if (reward.courseId) {
        await Enrollment.create({
          userId: req.user.id,
          courseId: reward.courseId,
          status: 'active',
          paymentId: null // Free enrollment
        });
      }
      break;

    case 'cash_bonus':
      // Process cash bonus
      // Implementation depends on payment system
      break;
  }

  reward.status = 'used';
  reward.usedAt = Date.now();

  await referral.save();

  res.status(200).json({
    success: true,
    data: reward
  });
});

module.exports = exports;