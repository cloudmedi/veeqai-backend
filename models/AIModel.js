const mongoose = require('mongoose');

const aiModelSchema = new mongoose.Schema({
  // Basic Information
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  
  // Model Type
  type: {
    type: String,
    enum: ['tts', 'music', 'voice-clone', 'voice-design', 'voice-isolator'],
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: ['standard', 'premium', 'experimental'],
    default: 'standard'
  },
  
  // Provider Information
  provider: {
    name: {
      type: String,
      enum: ['replicate', 'openai', 'elevenlabs', 'custom'],
      required: true
    },
    modelId: String, // Provider's model ID
    apiEndpoint: String,
    apiVersion: String
  },
  
  // Configuration
  config: {
    // Replicate specific
    replicateVersion: String,
    
    // Common parameters
    defaultParameters: {
      temperature: Number,
      maxLength: Number,
      topP: Number,
      topK: Number,
      repetitionPenalty: Number
    },
    
    // Input/Output specs
    inputFormats: [String], // ['text', 'audio', 'image']
    outputFormats: [String], // ['audio/mp3', 'audio/wav']
    
    // Limits
    maxInputLength: Number,
    maxOutputDuration: Number, // in seconds
    minInputLength: Number
  },
  
  // Capabilities
  capabilities: {
    languages: [{
      code: String, // 'en', 'tr', 'es'
      name: String,
      quality: {
        type: String,
        enum: ['native', 'good', 'basic'],
        default: 'good'
      }
    }],
    voices: [{
      id: String,
      name: String,
      gender: String,
      age: String,
      accent: String,
      preview: String // URL to preview audio
    }],
    styles: [String], // ['conversational', 'narration', 'news']
    emotions: [String], // ['neutral', 'happy', 'sad', 'angry']
    features: {
      voiceCloning: Boolean,
      emotionControl: Boolean,
      speedControl: Boolean,
      pitchControl: Boolean,
      multiSpeaker: Boolean,
      ssml: Boolean
    }
  },
  
  // Pricing
  pricing: {
    model: {
      type: String,
      enum: ['per-character', 'per-second', 'per-generation', 'per-request'],
      required: true
    },
    
    // Cost calculation
    baseCost: Number, // Provider cost
    markup: {
      type: Number,
      default: 1.5 // 50% markup
    },
    userPrice: Number, // Final price for users
    
    // Plan-specific pricing
    planPricing: [{
      plan: {
        type: String,
        enum: ['free', 'starter', 'pro', 'enterprise']
      },
      discount: Number, // Percentage discount
      price: Number
    }],
    
    // Currency
    currency: {
      type: String,
      default: 'USD'
    }
  },
  
  // Usage & Performance
  performance: {
    averageLatency: Number, // in ms
    reliability: Number, // 0-100 percentage
    quality: {
      type: Number,
      min: 1,
      max: 5,
      default: 3
    }
  },
  
  // Statistics
  stats: {
    totalUsage: {
      type: Number,
      default: 0
    },
    monthlyUsage: {
      type: Number,
      default: 0
    },
    successRate: {
      type: Number,
      default: 100
    },
    averageProcessingTime: Number,
    lastUsedAt: Date
  },
  
  // Availability
  status: {
    type: String,
    enum: ['active', 'inactive', 'maintenance', 'deprecated'],
    default: 'active',
    index: true
  },
  availability: {
    plans: [{
      type: String,
      enum: ['free', 'starter', 'pro', 'enterprise']
    }],
    regions: [String], // ['us', 'eu', 'asia']
    restrictions: [String] // ['no-commercial', 'rate-limited']
  },
  
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
    badge: String, // 'NEW', 'POPULAR', 'BETA'
    icon: String,
    color: String,
    tags: [String]
  },
  
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Version Control
  version: {
    type: String,
    default: '1.0.0'
  },
  changelog: [{
    version: String,
    date: Date,
    changes: String
  }],
  
  // Notes
  internalNotes: String,
  publicNotes: String
}, {
  timestamps: true
});

// Indexes
aiModelSchema.index({ type: 1, status: 1 });
aiModelSchema.index({ 'provider.name': 1 });
aiModelSchema.index({ 'display.featured': 1 });
aiModelSchema.index({ 'availability.plans': 1 });

// Calculate user price based on markup
aiModelSchema.pre('save', function(next) {
  if (this.pricing.baseCost && this.pricing.markup) {
    this.pricing.userPrice = this.pricing.baseCost * this.pricing.markup;
  }
  next();
});

// Check if available for plan
aiModelSchema.methods.isAvailableForPlan = function(plan) {
  return this.availability.plans.includes(plan);
};

// Get price for plan
aiModelSchema.methods.getPriceForPlan = function(plan) {
  const planPrice = this.pricing.planPricing.find(p => p.plan === plan);
  if (planPrice) {
    return planPrice.price;
  }
  return this.pricing.userPrice;
};

// Update usage statistics
aiModelSchema.methods.updateUsage = async function(success = true, processingTime = 0) {
  this.stats.totalUsage += 1;
  this.stats.monthlyUsage += 1;
  this.stats.lastUsedAt = new Date();
  
  if (processingTime > 0) {
    const currentAvg = this.stats.averageProcessingTime || 0;
    const totalRequests = this.stats.totalUsage;
    this.stats.averageProcessingTime = 
      (currentAvg * (totalRequests - 1) + processingTime) / totalRequests;
  }
  
  if (!success) {
    const successCount = (this.stats.successRate / 100) * (this.stats.totalUsage - 1);
    this.stats.successRate = (successCount / this.stats.totalUsage) * 100;
  }
  
  return await this.save();
};

// Reset monthly usage
aiModelSchema.methods.resetMonthlyUsage = async function() {
  this.stats.monthlyUsage = 0;
  return await this.save();
};

module.exports = mongoose.model('AIModel', aiModelSchema);