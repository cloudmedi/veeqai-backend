const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Plan Details (Updated for Plan reference)
  plan: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan',
    required: true
  },
  planName: {
    type: String,
    required: true
  },
  
  // Pricing
  pricing: {
    amount: {
      type: Number,
      default: 0
    },
    currency: {
      type: String,
      default: 'USD'
    },
    interval: {
      type: String,
      enum: ['monthly', 'yearly', 'lifetime'],
      default: 'monthly'
    }
  },
  
  // Credit System (Unified)
  credits: {
    // Monthly credit allocation from plan
    monthly: {
      type: Number,
      default: 0
    },
    
    // Current period usage
    used: {
      type: Number,
      default: 0
    },
    
    // Rollover credits from previous months
    rollover: {
      type: Number,
      default: 0
    },
    
    // Current period start date
    periodStart: {
      type: Date,
      default: Date.now
    },
    
    // Credit usage breakdown by service
    usageByService: {
      tts: {
        type: Number,
        default: 0
      },
      music: {
        type: Number,
        default: 0
      },
      voiceClone: {
        type: Number,
        default: 0
      },
      voiceIsolator: {
        type: Number,
        default: 0
      }
    },
    
    // Credit history for analytics
    history: [{
      date: {
        type: Date,
        default: Date.now
      },
      service: String,
      amount: Number,
      operation: {
        type: String,
        enum: ['consumed', 'added', 'rollover', 'reset']
      },
      metadata: Object
    }]
  },

  // Legacy Limits (for backward compatibility)
  limits: {
    // Storage (in MB)
    storage: {
      type: Number,
      default: 1000
    },
    storageUsed: {
      type: Number,
      default: 0
    },
    
    // Team Members
    teamMembers: {
      type: Number,
      default: 1
    },
    teamMembersUsed: {
      type: Number,
      default: 1
    }
  },
  
  // Features
  features: {
    customVoices: {
      type: Boolean,
      default: false
    },
    priorityQueue: {
      type: Boolean,
      default: false
    },
    webhooks: {
      type: Boolean,
      default: false
    },
    analytics: {
      type: Boolean,
      default: false
    },
    whiteLabel: {
      type: Boolean,
      default: false
    },
    support: {
      type: String,
      enum: ['community', 'email', 'priority', 'dedicated'],
      default: 'community'
    }
  },
  
  // Billing Status
  status: {
    type: String,
    enum: ['trialing', 'active', 'past_due', 'canceled', 'paused'],
    default: 'active',
    index: true
  },
  
  // Trial Information
  trial: {
    isActive: {
      type: Boolean,
      default: false
    },
    startDate: Date,
    endDate: Date,
    daysRemaining: Number
  },
  
  // Subscription Dates
  currentPeriodStart: {
    type: Date,
    required: true,
    default: Date.now
  },
  currentPeriodEnd: {
    type: Date,
    required: true,
    default: () => new Date(+new Date() + 30*24*60*60*1000)
  },
  canceledAt: Date,
  cancelReason: String,
  pausedAt: Date,
  pauseReason: String,
  resumeAt: Date,
  
  // Payment Provider References
  stripeSubscriptionId: String,
  stripeCustomerId: String,
  stripePriceId: String,
  iyzicoSubscriptionId: String,
  iyzicoCustomerId: String,
  
  // Invoice Settings
  billingInfo: {
    companyName: String,
    taxId: String,
    address: String,
    city: String,
    state: String,
    country: String,
    postalCode: String
  },
  
  // Metadata
  metadata: {
    source: String, // 'website', 'api', 'admin'
    campaign: String,
    referral: String,
    notes: String
  },
  
  // Reset Period (for usage limits)
  usageResetDate: {
    type: Date,
    default: () => new Date(+new Date() + 30*24*60*60*1000)
  }
}, {
  timestamps: true
});

// Indexes
subscriptionSchema.index({ user: 1, status: 1 });
subscriptionSchema.index({ plan: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });
subscriptionSchema.index({ stripeSubscriptionId: 1 });

// Check if subscription is active
subscriptionSchema.methods.isActive = function() {
  return ['active', 'trialing'].includes(this.status) && 
         this.currentPeriodEnd > new Date();
};

// Check if limit exceeded
subscriptionSchema.methods.checkLimit = function(limitType) {
  const limit = this.limits[limitType];
  const used = this.limits[`${limitType}Used`];
  return used < limit;
};

// Increment usage
subscriptionSchema.methods.incrementUsage = async function(usageType, amount = 1) {
  const field = `limits.${usageType}Used`;
  const limit = this.limits[usageType];
  const currentUsed = this.limits[`${usageType}Used`];
  
  if (currentUsed + amount > limit) {
    throw new Error(`Usage limit exceeded for ${usageType}`);
  }
  
  this.limits[`${usageType}Used`] += amount;
  return await this.save();
};

// Credit Management Methods
subscriptionSchema.methods.consumeCredits = function(amount, service = 'general') {
  if (this.getAvailableCredits() < amount) {
    throw new Error(`Insufficient credits: ${amount} required, ${this.getAvailableCredits()} available`);
  }
  
  this.credits.used += amount;
  if (this.credits.usageByService[service] !== undefined) {
    this.credits.usageByService[service] += amount;
  }
  
  // Add to history
  this.credits.history.push({
    date: new Date(),
    service,
    amount: -amount,
    operation: 'consumed',
    metadata: { remainingCredits: this.getAvailableCredits() - amount }
  });
  
  return this;
};

subscriptionSchema.methods.addCredits = function(amount, reason = 'manual', metadata = {}) {
  this.credits.monthly += amount;
  
  // Add to history
  this.credits.history.push({
    date: new Date(),
    service: 'admin',
    amount,
    operation: 'added',
    metadata: { reason, ...metadata }
  });
  
  return this;
};

subscriptionSchema.methods.getAvailableCredits = function() {
  return Math.max(0, (this.credits.monthly + this.credits.rollover) - this.credits.used);
};

subscriptionSchema.methods.getTotalCredits = function() {
  return this.credits.monthly + this.credits.rollover;
};

subscriptionSchema.methods.getCreditUtilization = function() {
  const total = this.getTotalCredits();
  if (total === 0) return 0;
  return Math.round((this.credits.used / total) * 100);
};

// Reset monthly credits and handle rollover
subscriptionSchema.methods.resetMonthlyCredits = async function(newMonthlyAmount) {
  const Plan = require('./Plan');
  const plan = await Plan.findById(this.plan);
  
  // Handle rollover if enabled
  let rolloverAmount = 0;
  if (plan?.credits?.rollover?.enabled) {
    const unusedCredits = Math.max(0, this.credits.monthly - this.credits.used);
    if (unusedCredits > 0) {
      rolloverAmount = Math.min(unusedCredits, this.credits.monthly * 0.5); // Max 50% rollover
      this.credits.history.push({
        date: new Date(),
        service: 'system',
        amount: rolloverAmount,
        operation: 'rollover',
        metadata: { 
          previousPeriod: this.credits.periodStart,
          unusedCredits 
        }
      });
    }
  }
  
  // Reset for new period
  this.credits.monthly = newMonthlyAmount || this.credits.monthly;
  this.credits.used = 0;
  this.credits.rollover = rolloverAmount;
  this.credits.periodStart = new Date();
  
  // Reset usage by service
  Object.keys(this.credits.usageByService).forEach(service => {
    this.credits.usageByService[service] = 0;
  });
  
  // Add reset history entry
  this.credits.history.push({
    date: new Date(),
    service: 'system',
    amount: this.credits.monthly,
    operation: 'reset',
    metadata: { rolloverCredits: rolloverAmount }
  });
  
  return this;
};

// Legacy method for backward compatibility
subscriptionSchema.methods.resetUsage = async function() {
  // Use new credit reset method
  return await this.resetMonthlyCredits();
};

// Calculate days remaining
subscriptionSchema.methods.getDaysRemaining = function() {
  const now = new Date();
  const end = new Date(this.currentPeriodEnd);
  const diffTime = Math.abs(end - now);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

module.exports = mongoose.model('Subscription', subscriptionSchema);