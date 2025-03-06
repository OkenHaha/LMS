const mongoose = require('mongoose');

const RefundSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processed', 'rejected'],
    default: 'pending'
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  processedAt: Date,
  refundTransactionId: String
});

const PaymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  courseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Course',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'USD'
  },
  commission: {
    type: Number,
    required: true, // Platform commission (e.g., 20% of amount)
    min: 0
  },
  teacherPayout: {
    type: Number,
    required: true, // Amount after commission (e.g., 80% of amount)
    min: 0
  },
  transactionId: {
    type: String,
    unique: true
  },
  paymentMethod: {
    type: String,
    enum: ['credit_card', 'debit_card', 'paypal', 'bank_transfer', 'crypto'],
    required: true
  },
  paymentDetails: {
    cardLast4: String,
    cardBrand: String,
    paypalEmail: String,
    bankReference: String
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending'
  },
  refunds: [RefundSchema],
  totalRefunded: {
    type: Number,
    default: 0
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    country: String
  },
  billingAddress: {
    street: String,
    city: String,
    state: String,
    postalCode: String,
    country: String
  },
  invoiceUrl: String,
  receiptUrl: String,
  paymentIntentId: String, // For Stripe integration
  paymentSessionId: String,
  errorDetails: {
    code: String,
    message: String,
    timestamp: Date
  },
  disputeDetails: {
    hasDispute: {
      type: Boolean,
      default: false
    },
    disputeId: String,
    disputeStatus: String,
    disputeDate: Date,
    resolvedDate: Date
  },
  taxDetails: {
    taxRate: Number,
    taxAmount: Number,
    taxId: String
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
PaymentSchema.index({ userId: 1, createdAt: -1 });
PaymentSchema.index({ courseId: 1, status: 1 });
PaymentSchema.index({ transactionId: 1 }, { unique: true });

// Calculate total amount including tax
PaymentSchema.methods.getTotalAmount = function() {
  const taxAmount = this.taxDetails?.taxAmount || 0;
  return this.amount + taxAmount;
};

// Check if payment is refundable
PaymentSchema.methods.isRefundable = function() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return (
    this.status === 'completed' &&
    this.createdAt > thirtyDaysAgo &&
    this.totalRefunded < this.amount
  );
};

// Process refund
PaymentSchema.methods.processRefund = async function(refundAmount, reason) {
  if (!this.isRefundable()) {
    throw new Error('Payment is not refundable');
  }

  if (refundAmount > (this.amount - this.totalRefunded)) {
    throw new Error('Refund amount exceeds available amount');
  }

  const refund = {
    amount: refundAmount,
    reason: reason,
    processedAt: new Date()
  };

  this.refunds.push(refund);
  this.totalRefunded += refundAmount;

  if (this.totalRefunded === this.amount) {
    this.status = 'refunded';
  } else {
    this.status = 'partially_refunded';
  }

  return this.save();
};

// Generate invoice number
PaymentSchema.methods.generateInvoiceNumber = function() {
  return `INV-${this.createdAt.getFullYear()}${String(this.createdAt.getMonth() + 1).padStart(2, '0')}${this._id.toString().slice(-6)}`;
};

// Pre-save middleware
PaymentSchema.pre('save', function(next) {
  if (this.isNew) {
    // Calculate commission and teacher payout
    this.commission = this.amount * 0.20; // 20% platform fee
    this.teacherPayout = this.amount * 0.80; // 80% teacher payout
  }
  next();
});

// Virtual for payment age
PaymentSchema.virtual('paymentAge').get(function() {
  return Math.round((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24)); // in days
});

// Virtual for refund status
PaymentSchema.virtual('refundStatus').get(function() {
  if (this.totalRefunded === 0) return 'none';
  if (this.totalRefunded === this.amount) return 'full';
  return 'partial';
});

// Ensure virtuals are included in JSON output
PaymentSchema.set('toJSON', { virtuals: true });
PaymentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Payment', PaymentSchema);