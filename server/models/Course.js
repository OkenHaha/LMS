const mongoose = require('mongoose');

const MaterialSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  fileUrl: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['pdf', 'video', 'audio', 'text', 'link', 'other'],
    required: true
  },
  version: {
    type: Number,
    default: 1
  },
  uploadDate: {
    type: Date,
    default: Date.now
  }
});

const QuestionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true
  },
  options: {
    type: [String],
    required: true
  },
  correctAnswer: {
    type: Number,
    required: true
  },
  points: {
    type: Number,
    default: 1
  }
});

const QuizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  questions: [QuestionSchema],
  timeLimit: {
    type: Number,  // in minutes
    default: 30
  },
  passingScore: {
    type: Number,
    default: 70
  }
});

const SectionSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  materials: [MaterialSchema]
});

const RatingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  review: {
    type: String,
    trim: true
  },
  date: {
    type: Date,
    default: Date.now
  }
});

const ExternalContentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  url: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['youtube', 'drive', 'dropbox', 'other'],
    required: true
  },
  description: {
    type: String,
    trim: true
  }
});

const CourseSchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  prerequisites: {
    type: [String],
    default: []
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    required: true
  },
  tags: {
    type: [String],
    default: []
  },
  syllabus: [SectionSchema],
  quizzes: [QuizSchema],
  externalContent: [ExternalContentSchema],
  status: {
    type: String,
    enum: ['draft', 'pending', 'published', 'archived'],
    default: 'draft'
  },
  ratings: [RatingSchema],
  avgRating: {
    type: Number,
    default: 0
  },
  enrollmentCount: {
    type: Number,
    default: 0
  },
  version: {
    type: Number,
    default: 1
  },
  thumbnail: {
    type: String
  }
}, {
  timestamps: true
});

// Method to calculate average rating
CourseSchema.methods.calculateAverageRating = function() {
  if (this.ratings.length === 0) {
    this.avgRating = 0;
    return this.avgRating;
  }
  
  const sum = this.ratings.reduce((total, rating) => total + rating.rating, 0);
  this.avgRating = Math.round((sum / this.ratings.length) * 10) / 10;
  return this.avgRating;
};

// Calculate average rating before saving
CourseSchema.pre('save', function(next) {
  this.calculateAverageRating();
  next();
});

module.exports = mongoose.model('Course', CourseSchema);