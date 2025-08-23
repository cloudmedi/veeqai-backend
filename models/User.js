const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  // Basic Info
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    required: function() {
      // Password not required for OAuth users
      return !this.oauth || (!this.oauth.google && !this.oauth.github && !this.oauth.microsoft);
    },
    minlength: 6
  },
  
  // Role & Permissions
  role: {
    type: String,
    enum: ['user', 'admin', 'superadmin'],
    default: 'user'
  },
  
  // Organization (for team accounts)
  organization: {
    name: String,
    taxId: String,
    address: String,
    country: String
  },
  
  // Account Status
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended', 'deleted'],
    default: 'active'
  },
  emailVerified: {
    type: Boolean,
    default: true
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  
  // Security
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: String,
  lastLogin: Date,
  lastLoginIp: String,
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date,
  
  // Password Reset
  passwordResetToken: String,
  passwordResetExpires: Date,
  
  // Refresh Tokens
  refreshTokens: [{
    token: String,
    createdAt: Date,
    expiresAt: Date,
    deviceInfo: String
  }],
  
  // OAuth
  oauth: {
    google: {
      id: String,
      email: String,
      name: String,
      picture: String
    },
    github: {
      id: String,
      username: String,
      email: String,
      avatar_url: String
    },
    microsoft: {
      id: String,
      email: String,
      name: String
    }
  },
  
  // Legacy OAuth fields (for backward compatibility)
  googleId: String,
  githubId: String,
  microsoftId: String,
  
  // Settings
  settings: {
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    emailNotifications: {
      type: Boolean,
      default: true
    },
    webhookUrl: String
  },

  
  // Metadata  
  lastActivityAt: Date,
  deletedAt: Date
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ email: 1, status: 1 });
userSchema.index({ role: 1 });
userSchema.index({ 'organization.name': 1 });
userSchema.index({ createdAt: -1 });

// Virtual for full URL
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password') || !this.password) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Generate email verification token
userSchema.methods.generateEmailVerificationToken = function() {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return token;
};

// Generate password reset token
userSchema.methods.generatePasswordResetToken = function() {
  const token = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
  this.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
  return token;
};


// Handle failed login attempts
userSchema.methods.incLoginAttempts = function() {
  // Reset attempts if lock has expired
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { failedLoginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  const updates = { $inc: { failedLoginAttempts: 1 } };
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours
  
  if (this.failedLoginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }
  
  return this.updateOne(updates);
};

// Reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { failedLoginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

module.exports = mongoose.model('User', userSchema);