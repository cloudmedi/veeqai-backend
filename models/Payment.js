const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  // User and Plan Information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan',
    required: true
  },
  
  // Iyzico Identifiers
  conversationId: {
    type: String,
    required: true,
    unique: true
  },
  paymentId: {
    type: String,
    index: true
  },
  
  // Payment Details
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'TRY',
    enum: ['TRY', 'USD', 'EUR']
  },
  billingInterval: {
    type: String,
    enum: ['monthly', 'yearly'],
    default: 'monthly'
  },
  
  // Multi-Currency Support
  planPricing: {
    amount: Number,
    currency: String,
    converted: Boolean,
    originalAmount: Number,
    originalCurrency: String
  },
  
  // User Location Info
  userLocation: {
    country: String,
    countryCode: String,
    city: String,
    currency: String,
    ip: String,
    confidence: String,
    source: String
  },
  
  // Payment Status
  status: {
    type: String,
    required: true,
    default: 'pending',
    enum: ['pending', 'processing', 'success', 'failed', 'cancelled', 'refunded'],
    index: true
  },
  
  // Payment Method Details
  paymentMethod: {
    type: String,
    enum: ['credit_card', 'debit_card', 'bank_transfer']
  },
  cardFamily: String,
  cardAssociation: String,
  cardToken: String,
  
  // Billing Information
  billingInfo: {
    contactName: String,
    city: String,
    country: String,
    address: String,
    zipCode: String,
    registrationAddress: String,
    ip: String
  },
  
  // Raw Iyzico Data
  iyzicoData: {
    type: mongoose.Schema.Types.Mixed
  },
  
  // Error Information
  errorCode: String,
  errorMessage: String,
  errorGroup: String,
  
  // URLs
  successUrl: String,
  failureUrl: String,
  callbackUrl: String,
  
  // Processing Information
  processedAt: Date,
  refundedAt: Date,
  refundAmount: Number,
  
  // Subscription Link
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subscription'
  }
}, {
  timestamps: true
});

// Indexes
paymentSchema.index({ userId: 1, status: 1 });
paymentSchema.index({ conversationId: 1 });
paymentSchema.index({ paymentId: 1 });
paymentSchema.index({ createdAt: -1 });

// Virtual for payment URL
paymentSchema.virtual('paymentUrl').get(function() {
  return this.iyzicoData?.paymentPageUrl;
});

// Methods
paymentSchema.methods.updateStatus = function(status, iyzicoData = null) {
  this.status = status;
  if (iyzicoData) {
    this.iyzicoData = { ...this.iyzicoData, ...iyzicoData };
  }
  if (status === 'success') {
    this.processedAt = new Date();
  }
  return this.save();
};

paymentSchema.methods.markAsRefunded = function(refundAmount, iyzicoData = null) {
  this.status = 'refunded';
  this.refundAmount = refundAmount;
  this.refundedAt = new Date();
  if (iyzicoData) {
    this.iyzicoData = { ...this.iyzicoData, refund: iyzicoData };
  }
  return this.save();
};

// Static Methods
paymentSchema.statics.findByConversationId = function(conversationId) {
  return this.findOne({ conversationId });
};

paymentSchema.statics.findUserPayments = function(userId, status = null) {
  const query = { userId };
  if (status) query.status = status;
  return this.find(query).populate('planId').sort({ createdAt: -1 });
};

paymentSchema.statics.getPaymentStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    }
  ]);
};

module.exports = mongoose.model('Payment', paymentSchema);