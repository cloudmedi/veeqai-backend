const mongoose = require('mongoose');

const usageSchema = new mongoose.Schema({
  // User Reference
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // API Key Reference (if used)
  apiKey: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ApiKey',
    index: true
  },
  
  // Request Information
  request: {
    id: {
      type: String,
      required: true,
      unique: true
    },
    method: String,
    endpoint: String,
    ip: String,
    userAgent: String,
    origin: String,
    referer: String
  },
  
  // Service Type
  service: {
    type: String,
    enum: ['tts', 'music', 'voice-clone', 'voice-design', 'voice-isolator'],
    required: true,
    index: true
  },
  
  // Model Used
  model: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIModel',
    required: true
  },
  modelName: String, // Denormalized for quick access
  
  // Operation Details
  operation: {
    type: String,
    enum: ['generate', 'clone', 'convert', 'analyze', 'train'],
    required: true
  },
  
  // Input/Output
  input: {
    text: String,
    characters: Number,
    duration: Number, // For audio inputs
    fileSize: Number,
    format: String
  },
  
  output: {
    duration: Number, // For audio outputs
    fileSize: Number,
    format: String,
    url: String, // Storage URL
    expiresAt: Date
  },
  
  // Parameters Used
  parameters: {
    voice: String,
    language: String,
    speed: Number,
    pitch: Number,
    emotion: String,
    style: String,
    quality: String
  },
  
  // Cost & Billing (Credit-based)
  billing: {
    // Provider cost (what we pay to external services)
    providerCost: {
      amount: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'USD'
      }
    },
    
    // Credits charged to user
    credits: {
      type: Number,
      required: true,
      default: 0
    },
    
    // Credit calculation details
    creditCalculation: {
      service: String,
      baseRate: Number,
      multiplier: {
        type: Number,
        default: 1
      },
      parameters: Object // Service-specific params used for calculation
    },
    
    // User's plan at time of usage
    plan: {
      id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Plan'
      },
      name: String,
      tier: String
    },
    
    // Billing timestamps
    creditedAt: {
      type: Date,
      default: Date.now
    },
    billedAt: Date,
    
    // Billing status
    status: {
      type: String,
      enum: ['pending', 'credited', 'billed', 'failed'],
      default: 'pending'
    }
  },
  
  // Performance Metrics
  performance: {
    processingTime: Number, // in ms
    queueTime: Number,
    totalTime: Number,
    success: {
      type: Boolean,
      default: true
    },
    error: {
      code: String,
      message: String,
      details: Object
    },
    retries: {
      type: Number,
      default: 0
    }
  },
  
  // Provider Information
  provider: {
    name: String,
    requestId: String,
    cost: Number, // Provider's actual cost
    response: Object
  },
  
  // Metadata
  metadata: {
    sessionId: String,
    clientId: String,
    version: String,
    environment: String,
    tags: [String],
    custom: Object
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  
  // Timestamps
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  
  // Location (for analytics)
  location: {
    country: String,
    region: String,
    city: String,
    timezone: String
  }
}, {
  timestamps: true
});

// Indexes for analytics
usageSchema.index({ user: 1, createdAt: -1 });
usageSchema.index({ service: 1, createdAt: -1 });
usageSchema.index({ model: 1, createdAt: -1 });
usageSchema.index({ status: 1, createdAt: -1 });
usageSchema.index({ 'request.id': 1 });
usageSchema.index({ createdAt: -1 });

// Compound indexes for common queries
usageSchema.index({ user: 1, service: 1, createdAt: -1 });
usageSchema.index({ user: 1, status: 1, createdAt: -1 });

// Calculate total time
usageSchema.pre('save', function(next) {
  if (this.performance.processingTime && this.performance.queueTime) {
    this.performance.totalTime = 
      this.performance.processingTime + this.performance.queueTime;
  }
  
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }
  
  next();
});

// Static method to get user stats (updated for credits)
usageSchema.statics.getUserStats = async function(userId, period = '30d') {
  const dateFilter = this.getDateFilter(period);
  
  const stats = await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: dateFilter },
        'billing.status': { $in: ['credited', 'billed'] }
      }
    },
    {
      $group: {
        _id: '$service',
        count: { $sum: 1 },
        totalCredits: { $sum: '$billing.credits' },
        totalProviderCost: { $sum: '$billing.providerCost.amount' },
        totalCharacters: { $sum: '$input.characters' },
        totalDuration: { $sum: '$output.duration' },
        successRate: {
          $avg: { $cond: ['$performance.success', 1, 0] }
        },
        avgProcessingTime: { $avg: '$performance.processingTime' },
        avgCreditsPerRequest: { $avg: '$billing.credits' }
      }
    }
  ]);
  
  return stats;
};

// Get date filter for period
usageSchema.statics.getDateFilter = function(period) {
  const now = new Date();
  const filters = {
    '24h': new Date(now - 24 * 60 * 60 * 1000),
    '7d': new Date(now - 7 * 24 * 60 * 60 * 1000),
    '30d': new Date(now - 30 * 24 * 60 * 60 * 1000),
    '90d': new Date(now - 90 * 24 * 60 * 60 * 1000),
    '1y': new Date(now - 365 * 24 * 60 * 60 * 1000)
  };
  
  return filters[period] || filters['30d'];
};

// Get usage by date range
usageSchema.statics.getUsageByDateRange = async function(userId, startDate, endDate) {
  return await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        }
      }
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          service: '$service'
        },
        count: { $sum: 1 },
        cost: { $sum: '$billing.cost' },
        characters: { $sum: '$input.characters' }
      }
    },
    {
      $sort: { '_id.date': 1 }
    }
  ]);
};

// Calculate monthly credit usage
usageSchema.statics.getMonthlyBilling = async function(userId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  
  const result = await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startOfMonth },
        status: 'completed',
        'billing.status': { $in: ['credited', 'billed'] }
      }
    },
    {
      $group: {
        _id: null,
        totalCredits: { $sum: '$billing.credits' },
        totalProviderCost: { $sum: '$billing.providerCost.amount' },
        totalRequests: { $sum: 1 },
        byService: {
          $push: {
            service: '$service',
            credits: '$billing.credits',
            date: '$createdAt'
          }
        }
      }
    }
  ]);
  
  return result[0] || { 
    totalCredits: 0, 
    totalProviderCost: 0, 
    totalRequests: 0,
    byService: []
  };
};

// Create usage record with credit calculation
usageSchema.statics.createUsageRecord = async function(data) {
  const {
    userId,
    service,
    operation,
    model,
    input,
    output,
    parameters,
    performance,
    provider,
    metadata,
    credits,
    creditCalculation,
    plan
  } = data;

  const usage = new this({
    user: userId,
    service,
    operation,
    model: model._id,
    modelName: model.name,
    input,
    output,
    parameters,
    performance,
    provider,
    metadata,
    billing: {
      credits,
      creditCalculation,
      plan: {
        id: plan._id,
        name: plan.displayName,
        tier: plan.name
      },
      status: 'credited'
    },
    status: 'completed',
    completedAt: new Date(),
    request: {
      id: metadata.requestId || require('crypto').randomUUID(),
      method: metadata.method,
      endpoint: metadata.endpoint,
      ip: metadata.ip,
      userAgent: metadata.userAgent
    }
  });

  return await usage.save();
};

module.exports = mongoose.model('Usage', usageSchema);