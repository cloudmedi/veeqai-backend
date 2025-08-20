const mongoose = require('mongoose');
const crypto = require('crypto');
// const { nanoid } = require('nanoid'); // ESM module conflict
const nanoid = () => crypto.randomBytes(16).toString('hex'); // Fallback

const apiKeySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Key Information
  name: {
    type: String,
    required: true,
    trim: true
  },
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  prefix: {
    type: String,
    required: true,
    default: 'vq'
  },
  hashedKey: {
    type: String,
    required: true
  },
  lastFourChars: {
    type: String,
    required: true
  },
  
  // Permissions & Scopes
  scopes: [{
    type: String,
    enum: [
      'tts:read',
      'tts:write',
      'music:read',
      'music:write',
      'voice:read',
      'voice:write',
      'usage:read',
      'billing:read',
      'admin:all'
    ]
  }],
  
  // Rate Limiting
  rateLimit: {
    requests: {
      type: Number,
      default: 60
    },
    interval: {
      type: String,
      enum: ['second', 'minute', 'hour'],
      default: 'minute'
    }
  },
  
  // IP Restrictions
  allowedIPs: [{
    type: String,
    validate: {
      validator: function(ip) {
        // Basic IP validation
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || 
               /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/.test(ip);
      },
      message: 'Invalid IP address format'
    }
  }],
  allowedDomains: [String],
  
  // Status
  status: {
    type: String,
    enum: ['active', 'revoked', 'expired'],
    default: 'active',
    index: true
  },
  
  // Usage Statistics
  usage: {
    totalRequests: {
      type: Number,
      default: 0
    },
    lastUsedAt: Date,
    lastUsedIP: String,
    lastUsedEndpoint: String,
    
    // Monthly breakdown
    monthlyUsage: [{
      month: String, // YYYY-MM format
      requests: Number,
      ttsCharacters: Number,
      musicGenerations: Number
    }]
  },
  
  // Expiration
  expiresAt: Date,
  
  // Metadata
  environment: {
    type: String,
    enum: ['development', 'staging', 'production'],
    default: 'production'
  },
  notes: String,
  revokedAt: Date,
  revokedReason: String,
  
  // Webhook for this API key
  webhookUrl: String,
  webhookSecret: String
}, {
  timestamps: true
});

// Indexes
apiKeySchema.index({ key: 1, status: 1 });
apiKeySchema.index({ hashedKey: 1 });
apiKeySchema.index({ user: 1, status: 1 });
apiKeySchema.index({ expiresAt: 1 });

// Generate API Key
apiKeySchema.statics.generateKey = function(prefix = 'vq') {
  const timestamp = Date.now().toString(36);
  const randomPart = nanoid(32);
  return `${prefix}_${timestamp}${randomPart}`;
};

// Hash API Key
apiKeySchema.statics.hashKey = function(key) {
  return crypto
    .createHash('sha256')
    .update(key)
    .digest('hex');
};

// Create new API Key
apiKeySchema.statics.createKey = async function(userId, options = {}) {
  const {
    name = 'Default API Key',
    scopes = ['tts:read', 'tts:write'],
    expiresIn = null,
    allowedIPs = [],
    allowedDomains = [],
    rateLimit = { requests: 60, interval: 'minute' },
    environment = 'production'
  } = options;
  
  const key = this.generateKey();
  const hashedKey = this.hashKey(key);
  const lastFourChars = key.slice(-4);
  
  let expiresAt = null;
  if (expiresIn) {
    expiresAt = new Date(Date.now() + expiresIn);
  }
  
  const apiKey = new this({
    user: userId,
    name,
    key: key, // Store the full key only on creation
    hashedKey,
    lastFourChars,
    scopes,
    allowedIPs,
    allowedDomains,
    rateLimit,
    expiresAt,
    environment
  });
  
  await apiKey.save();
  
  // Return the key only once (won't be stored in plain text)
  return {
    id: apiKey._id,
    key: key,
    name: apiKey.name,
    createdAt: apiKey.createdAt
  };
};

// Verify API Key
apiKeySchema.statics.verifyKey = async function(key) {
  const hashedKey = this.hashKey(key);
  
  const apiKey = await this.findOne({
    hashedKey,
    status: 'active'
  }).populate('user');
  
  if (!apiKey) {
    return { valid: false, error: 'Invalid API key' };
  }
  
  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    apiKey.status = 'expired';
    await apiKey.save();
    return { valid: false, error: 'API key expired' };
  }
  
  // Update usage
  apiKey.usage.lastUsedAt = new Date();
  apiKey.usage.totalRequests += 1;
  await apiKey.save();
  
  return { valid: true, apiKey };
};

// Check IP restriction
apiKeySchema.methods.checkIP = function(ip) {
  if (this.allowedIPs.length === 0) return true;
  return this.allowedIPs.includes(ip);
};

// Check domain restriction
apiKeySchema.methods.checkDomain = function(domain) {
  if (this.allowedDomains.length === 0) return true;
  return this.allowedDomains.some(allowed => 
    domain.endsWith(allowed)
  );
};

// Revoke key
apiKeySchema.methods.revoke = async function(reason = '') {
  this.status = 'revoked';
  this.revokedAt = new Date();
  this.revokedReason = reason;
  return await this.save();
};

// Update monthly usage
apiKeySchema.methods.updateMonthlyUsage = async function(usage) {
  const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
  
  const existingMonth = this.usage.monthlyUsage.find(m => m.month === monthKey);
  
  if (existingMonth) {
    existingMonth.requests += usage.requests || 0;
    existingMonth.ttsCharacters += usage.ttsCharacters || 0;
    existingMonth.musicGenerations += usage.musicGenerations || 0;
  } else {
    this.usage.monthlyUsage.push({
      month: monthKey,
      requests: usage.requests || 0,
      ttsCharacters: usage.ttsCharacters || 0,
      musicGenerations: usage.musicGenerations || 0
    });
  }
  
  return await this.save();
};

module.exports = mongoose.model('ApiKey', apiKeySchema);