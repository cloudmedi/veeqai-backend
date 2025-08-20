const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  
  // Pricing
  pricing: {
    monthly: {
      amount: {
        type: Number,
        required: true
      },
      currency: {
        type: String,
        default: 'USD'
      },
      stripePriceId: String,
      iyzicoPlanId: String
    },
    yearly: {
      amount: Number,
      currency: {
        type: String,
        default: 'USD'
      },
      stripePriceId: String,
      iyzicoPlanId: String,
      discount: Number // Percentage discount for yearly
    },
    setup: {
      amount: {
        type: Number,
        default: 0
      },
      currency: {
        type: String,
        default: 'USD'
      }
    }
  },
  
  // Trial
  trial: {
    enabled: {
      type: Boolean,
      default: false
    },
    days: {
      type: Number,
      default: 14
    },
    requireCard: {
      type: Boolean,
      default: false
    }
  },
  
  // Credit System (Unified)
  credits: {
    // Monthly credit allowance
    monthly: {
      type: Number,
      required: true,
      default: 0
    },
    
    // Credit rates for different services
    rates: {
      // Text-to-Speech: 1 character = 1 credit
      tts: {
        type: Number,
        default: 1
      },
      
      // Music Generation: per 30 seconds
      music: {
        per30Seconds: {
          type: Number,
          default: 200
        },
        per60Seconds: {
          type: Number,
          default: 400
        }
      },
      
      // Voice Cloning: one-time cost per voice
      voiceClone: {
        creation: {
          type: Number,
          default: 2000
        },
        usage: {
          type: Number,
          default: 1 // Same as TTS rate
        }
      },
      
      // Voice Isolator: per minute of audio
      voiceIsolator: {
        perMinute: {
          type: Number,
          default: 100
        }
      }
    },
    
    // Credit rollover settings
    rollover: {
      enabled: {
        type: Boolean,
        default: false
      },
      maxMonths: {
        type: Number,
        default: 2
      }
    }
  },

  // Legacy Limits (for backward compatibility)
  limits: {
    // Storage
    storage: {
      type: Number, // in GB
      required: true,
      default: 1
    },
    fileRetention: {
      type: Number, // Days to keep generated files
      default: 30
    },
    
    // API
    apiKeys: {
      type: Number,
      default: 1
    },
    webhooks: {
      type: Number,
      default: 0
    },
    
    // Team
    teamMembers: {
      type: Number,
      default: 1
    },
    
    // Concurrent
    concurrentGenerations: {
      type: Number,
      default: 1
    },
    
    // Max single generation duration
    maxMusicDuration: {
      type: Number, // seconds
      default: 60
    },
    maxTtsLength: {
      type: Number, // characters
      default: 5000
    }
  },
  
  // Features
  features: {
    // Core Features
    textToSpeech: {
      type: Boolean,
      default: true
    },
    musicGeneration: {
      type: Boolean,
      default: false
    },
    voiceCloning: {
      type: Boolean,
      default: false
    },
    voiceDesign: {
      type: Boolean,
      default: false
    },
    voiceIsolator: {
      type: Boolean,
      default: false
    },
    
    // Advanced Features
    customVoices: {
      type: Boolean,
      default: false
    },
    emotionControl: {
      type: Boolean,
      default: false
    },
    ssmlSupport: {
      type: Boolean,
      default: false
    },
    batchProcessing: {
      type: Boolean,
      default: false
    },
    
    // API Features
    apiAccess: {
      type: Boolean,
      default: false
    },
    webhooks: {
      type: Boolean,
      default: false
    },
    sdkAccess: {
      type: Boolean,
      default: false
    },
    
    // Priority & Performance
    priorityQueue: {
      type: Boolean,
      default: false
    },
    dedicatedEndpoint: {
      type: Boolean,
      default: false
    },
    cdn: {
      type: Boolean,
      default: false
    },
    
    // Analytics & Reporting
    analytics: {
      type: Boolean,
      default: false
    },
    usageReports: {
      type: Boolean,
      default: false
    },
    auditLogs: {
      type: Boolean,
      default: false
    },
    
    // Team & Collaboration
    teamCollaboration: {
      type: Boolean,
      default: false
    },
    roleBasedAccess: {
      type: Boolean,
      default: false
    },
    sso: {
      type: Boolean,
      default: false
    },
    
    // Support
    emailSupport: {
      type: Boolean,
      default: false
    },
    prioritySupport: {
      type: Boolean,
      default: false
    },
    dedicatedManager: {
      type: Boolean,
      default: false
    },
    sla: {
      type: Boolean,
      default: false
    },
    
    // Branding
    whiteLabel: {
      type: Boolean,
      default: false
    },
    customDomain: {
      type: Boolean,
      default: false
    },
    removeBranding: {
      type: Boolean,
      default: false
    }
  },
  
  // Available Models
  availableModels: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIModel'
  }],
  
  // Display Settings
  display: {
    order: {
      type: Number,
      default: 0
    },
    featured: {
      type: Boolean,
      default: false
    },
    popular: {
      type: Boolean,
      default: false
    },
    badge: String, // 'MOST POPULAR', 'BEST VALUE'
    color: String, // Hex color for UI
    icon: String
  },
  
  // Status
  status: {
    type: String,
    enum: ['active', 'inactive', 'deprecated'],
    default: 'active'
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  
  // Target Audience
  target: {
    type: String,
    enum: ['individual', 'team', 'enterprise', 'all'],
    default: 'all'
  },
  
  // Metadata
  metadata: {
    stripeProductId: String,
    iyzicoProductId: String,
    notes: String
  }
}, {
  timestamps: true
});

// Indexes
planSchema.index({ slug: 1 });
planSchema.index({ status: 1, isPublic: 1 });
planSchema.index({ 'display.order': 1 });

// Generate slug from name
planSchema.pre('save', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name.toLowerCase().replace(/\s+/g, '-');
  }
  next();
});

// Check if feature is available
planSchema.methods.hasFeature = function(feature) {
  return this.features[feature] === true;
};

// Check if credit limit is exceeded
planSchema.methods.checkCreditLimit = function(currentCredits) {
  const monthlyLimit = this.credits.monthly;
  if (monthlyLimit === -1) return true; // Unlimited
  return currentCredits < monthlyLimit;
};

// Calculate credit cost for service
planSchema.methods.calculateCreditCost = function(service, params = {}) {
  const rates = this.credits.rates;
  
  console.log(`💰 [PLAN-DEBUG] Calculating credit cost:`, {
    planName: this.name,
    service,
    params,
    rates: rates.music
  });
  
  switch (service) {
    case 'tts':
      return (params.characterCount || 0) * rates.tts;
    
    case 'music':
      const duration = params.duration || 30;
      if (duration <= 30) {
        return rates.music.per30Seconds;
      } else if (duration <= 60) {
        return rates.music.per60Seconds;
      } else {
        // Calculate proportionally for longer durations
        return Math.ceil((duration / 30) * rates.music.per30Seconds);
      }
    
    case 'voice-clone-creation':
      return rates.voiceClone.creation;
    
    case 'voice-clone-usage':
      return (params.characterCount || 0) * rates.voiceClone.usage;
    
    case 'voice-isolator':
      const minutes = Math.ceil((params.duration || 60) / 60);
      return minutes * rates.voiceIsolator.perMinute;
    
    default:
      return 0;
  }
};

// Check if limit is exceeded (legacy support)
planSchema.methods.checkLimit = function(limitType, currentUsage) {
  const limit = this.limits[limitType];
  if (limit === -1) return true; // Unlimited
  return currentUsage < limit;
};

// Get price for interval
planSchema.methods.getPrice = function(interval = 'monthly') {
  return this.pricing[interval]?.amount || 0;
};

// Compare plans
planSchema.statics.comparePlans = async function(planIds) {
  const plans = await this.find({
    _id: { $in: planIds },
    status: 'active'
  }).sort('display.order');
  
  // Create comparison matrix
  const comparison = {
    plans: plans.map(p => ({
      id: p._id,
      name: p.displayName,
      price: p.pricing.monthly.amount
    })),
    limits: {},
    features: {}
  };
  
  // Aggregate all unique limits and features
  plans.forEach(plan => {
    Object.keys(plan.limits).forEach(limit => {
      if (!comparison.limits[limit]) {
        comparison.limits[limit] = [];
      }
      comparison.limits[limit].push(plan.limits[limit]);
    });
    
    Object.keys(plan.features).forEach(feature => {
      if (!comparison.features[feature]) {
        comparison.features[feature] = [];
      }
      comparison.features[feature].push(plan.features[feature]);
    });
  });
  
  return comparison;
};

module.exports = mongoose.model('Plan', planSchema);