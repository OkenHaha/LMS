const mongoose = require('mongoose');

const ProgressSchema = new mongoose.Schema({
  sectionId: {
    type: String,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  lastAccessed: {
    type: Date,
    default: Date.now
  }
});

const QuizResultSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  score: {
    type: Number,
    required: true
  },
  attempts: {
    type: Number,
    default: 1
  },
  lastAttempt: {
    type: Date,
    default: Date.now
  }
});

const EnrollmentSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  enrollmentDate: {
    type: Date,
    default: Date.now
  },
  expiryDate: {
    type: Date
  },
  progress: [ProgressSchema],
  quizResults: [QuizResultSchema],
  certificateIssued: {
    type: Boolean,
    default: false
  },
  certificateUrl: {
    type: String
  },
  certificateIssuedDate: {
    type: Date
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  referralCode: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'expired'],
    default: 'active'
  },
  completionPercentage: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Method to calculate progress percentage
EnrollmentSchema.methods.calculateProgress = async function() {
  // If no progress items exist yet, return 0
  if (!this.progress || this.progress.length === 0) {
    this.completionPercentage = 0;
    return 0;
  }
  
  // Find the course to get total number of sections
  try {
    const Course = mongoose.model('Course');
    const course = await Course.findById(this.courseId);
    
    if (!course || !course.syllabus) {
      return 0;
    }
    
    const totalSections = course.syllabus.length;
    if (totalSections === 0) return 0;
    
    const completedSections = this.progress.filter(p => p.completed).length;
    const percentage = Math.round((completedSections / totalSections) * 100);
    
    // Update the completion percentage
    this.completionPercentage = percentage;
    
    // Check if course is completed (all sections done)
    if (percentage === 100 && this.status !== 'completed') {
      this.status = 'completed';
    }
    
    return percentage;
  } catch (error) {
    console.error('Error calculating progress:', error);
    return this.completionPercentage;
  }
};

// Check if enrollment is expired
EnrollmentSchema.methods.isExpired = function() {
  if (!this.expiryDate) return false;
  return this.expiryDate < new Date();
};

// Update status based on expiry
EnrollmentSchema.pre('save', async function(next) {
  // Update status if expired
  if (this.isExpired() && this.status !== 'expired') {
    this.status = 'expired';
  }
  
  // Calculate progress percentage
  await this.calculateProgress();
  next();
});

// Ensure unique enrollment per user and course
EnrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });

module.exports = mongoose.model('Enrollment', EnrollmentSchema);
/*const mongoose = require('mongoose');

const ProgressSchema = new mongoose.Schema({
  sectionId: {
    type: String,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  lastAccessed: {
    type: Date,
    default: Date.now
  },
  timeSpent: {
    type: Number, // in minutes
    default: 0
  },
  completedMaterials: [{
    materialId: String,
    completedAt: Date
  }]
});

const QuizResultSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  score: {
    type: Number,
    required: true
  },
  attempts: {
    type: Number,
    default: 1
  },
  lastAttempt: {
    type: Date,
    default: Date.now
  },
  answers: [{
    questionId: String,
    selectedOption: Number,
    isCorrect: Boolean
  }],
  timeSpent: Number // in minutes
});

const EnrollmentSchema = new mongoose.Schema({
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  enrollmentDate: {
    type: Date,
    default: Date.now
  },
  expiryDate: {
    type: Date
  },
  progress: [ProgressSchema],
  quizResults: [QuizResultSchema],
  certificateIssued: {
    type: Boolean,
    default: false
  },
  certificateDetails: {
    issueDate: Date,
    certificateId: String,
    certificateUrl: String
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  referralCode: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'expired', 'suspended'],
    default: 'active'
  },
  completionPercentage: {
    type: Number,
    default: 0
  },
  lastAccessedAt: {
    type: Date,
    default: Date.now
  },
  notes: [{
    sectionId: String,
    content: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  bookmarks: [{
    materialId: String,
    timestamp: Number, // for videos
    note: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// Index for efficient queries
EnrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });
EnrollmentSchema.index({ status: 1, enrollmentDate: -1 });

// Calculate completion percentage
EnrollmentSchema.methods.calculateCompletionPercentage = function() {
  if (!this.progress.length) return 0;
  
  const completedSections = this.progress.filter(section => section.completed).length;
  this.completionPercentage = Math.round((completedSections / this.progress.length) * 100);
  return this.completionPercentage;
};

// Check if course is completed
EnrollmentSchema.methods.isCompleted = function() {
  return this.completionPercentage === 100;
};

// Update last accessed
EnrollmentSchema.methods.updateLastAccessed = function() {
  this.lastAccessedAt = new Date();
  return this.save();
};

// Check if enrollment is expired
EnrollmentSchema.methods.isExpired = function() {
  if (!this.expiryDate) return false;
  return this.expiryDate < new Date();
};

// Pre-save middleware
EnrollmentSchema.pre('save', function(next) {
  if (this.isModified('progress')) {
    this.calculateCompletionPercentage();
    
    // Auto-update status to completed if 100%
    if (this.completionPercentage === 100) {
      this.status = 'completed';
    }
  }
  
  // Check expiry
  if (this.expiryDate && this.expiryDate < new Date()) {
    this.status = 'expired';
  }
  
  next();
});

// Virtual for time since enrollment
EnrollmentSchema.virtual('enrollmentDuration').get(function() {
  return Math.round((Date.now() - this.enrollmentDate) / (1000 * 60 * 60 * 24)); // in days
});

// Ensure virtuals are included in JSON output
EnrollmentSchema.set('toJSON', { virtuals: true });
EnrollmentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Enrollment', EnrollmentSchema);*/