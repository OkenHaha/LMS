const mongoose = require('mongoose');

const ReferralTransactionSchema = new mongoose.Schema({
  referredUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  enrollmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Enrollment'
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  },
  date: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
  },
  commission: {
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'USD'
    },
    percentage: {
      type: Number,
      required: true
    },
    paidAt: Date,
    paymentId: String
  },
  purchaseAmount: {
    type: Number,
    required: true
  }
});

const RewardSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['discount', 'free_course', 'cash_bonus', 'credits'],
    required: true
  },
  value: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['available', 'used', 'expired'],
    default: 'available'
  },
  expiryDate: Date,
  usedAt: Date,
  courseId: { // if reward is for specific course
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course'
  },
  transactionId: { // reference to the transaction that generated this reward
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReferralTransaction'
  }
});

const ReferralSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  referralCode: {
    type: String,
    unique: true,
    required: true
  },
  referrals: [ReferralTransactionSchema],
  rewards: [RewardSchema],
  statistics: {
    totalReferrals: {
      type: Number,
      default: 0
    },
    successfulReferrals: {
      type: Number,
      default: 0
    },
    pendingReferrals: {
      type: Number,
      default: 0
    },
    totalCommissionEarned: {
      type: Number,
      default: 0
    },
    totalDiscountsEarned: {
      type: Number,
      default: 0
    },
    totalFreeCoursesEarned: {
      type: Number,
      default: 0
    }
  },
  settings: {
    commissionRate: {
      type: Number,
      default: 10 // percentage
    },
    minimumPayout: {
      type: Number,
      default: 50
    },
    payoutMethod: {
      type: String,
      enum: ['bank_transfer', 'paypal', 'platform_credits'],
      default: 'platform_credits'
    },
    payoutDetails: {
      bankAccount: String,
      paypalEmail: String
    }
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'inactive'],
    default: 'active'
  },
  tier: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum'],
    default: 'bronze'
  },
  milestones: [{
    type: {
      type: String,
      enum: ['referral_count', 'commission_earned', 'successful_conversions']
    },
    target: Number,
    achieved: Boolean,
    achievedAt: Date,
    reward: RewardSchema
  }]
}, {
  timestamps: true
});

// Indexes for efficient queries
ReferralSchema.index({ userId: 1 });
ReferralSchema.index({ referralCode: 1 }, { unique: true });
ReferralSchema.index({ 'referrals.referredUserId': 1 });

// Generate unique referral code
ReferralSchema.statics.generateReferralCode = async function(userId) {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = '';
    for (let i = 0; i < 8; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    
    // Check if code exists
    const existing = await this.findOne({ referralCode: code });
    if (!existing) {
      isUnique = true;
    }
  }

  return code;
};

// Calculate earnings for a date range
ReferralSchema.methods.calculateEarnings = function(startDate, endDate) {
  return this.referrals
    .filter(ref => 
      ref.status === 'completed' &&
      ref.date >= startDate &&
      ref.date <= endDate
    )
    .reduce((total, ref) => total + ref.commission.amount, 0);
};

// Update referral statistics
ReferralSchema.methods.updateStatistics = async function() {
  const stats = this.referrals.reduce((acc, ref) => {
    if (ref.status === 'completed') {
      acc.successfulReferrals++;
      acc.totalCommissionEarned += ref.commission.amount;
    } else if (ref.status === 'pending') {
      acc.pendingReferrals++;
    }
    return acc;
  }, {
    successfulReferrals: 0,
    pendingReferrals: 0,
    totalCommissionEarned: 0
  });

  this.statistics = {
    ...this.statistics,
    ...stats,
    totalReferrals: this.referrals.length
  };

  return this.save();
};

// Check and update tier
ReferralSchema.methods.updateTier = function() {
  const { successfulReferrals, totalCommissionEarned } = this.statistics;

  if (totalCommissionEarned >= 5000 && successfulReferrals >= 50) {
    this.tier = 'platinum';
  } else if (totalCommissionEarned >= 2000 && successfulReferrals >= 25) {
    this.tier = 'gold';
  } else if (totalCommissionEarned >= 500 && successfulReferrals >= 10) {
    this.tier = 'silver';
  } else {
    this.tier = 'bronze';
  }
};

// Check and award milestones
ReferralSchema.methods.checkMilestones = async function() {
  const milestoneChecks = {
    referral_count: this.statistics.successfulReferrals,
    commission_earned: this.statistics.totalCommissionEarned,
    successful_conversions: this.statistics.successfulReferrals
  };

  this.milestones.forEach(milestone => {
    if (!milestone.achieved && milestoneChecks[milestone.type] >= milestone.target) {
      milestone.achieved = true;
      milestone.achievedAt = new Date();
    }
  });

  return this.save();
};

// Pre-save middleware
ReferralSchema.pre('save', async function(next) {
  if (this.isNew) {
    this.referralCode = await this.constructor.generateReferralCode(this.userId);
  }
  
  this.updateTier();
  next();
});

// Virtual for active rewards
ReferralSchema.virtual('activeRewards').get(function() {
  return this.rewards.filter(reward => 
    reward.status === 'available' && 
    (!reward.expiryDate || reward.expiryDate > new Date())
  );
});

// Ensure virtuals are included in JSON output
ReferralSchema.set('toJSON', { virtuals: true });
ReferralSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Referral', ReferralSchema);