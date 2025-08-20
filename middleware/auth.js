const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiKey = require('../models/ApiKey');
const Subscription = require('../models/Subscription');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Rate limiters for different tiers
const rateLimiters = {
  free: new RateLimiterMemory({
    points: 10,
    duration: 60, // per minute
  }),
  starter: new RateLimiterMemory({
    points: 60,
    duration: 60,
  }),
  pro: new RateLimiterMemory({
    points: 300,
    duration: 60,
  }),
  enterprise: new RateLimiterMemory({
    points: 1000,
    duration: 60,
  })
};

// JWT Authentication
const authenticateToken = async (req, res, next) => {
  try {
    console.log('🔐 Auth middleware started');
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({ error: 'Access token required' });
    }
    
    console.log('✅ Token found');
    
    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
      if (err) {
        console.log('❌ JWT verify error:', err.message);
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
        }
        return res.status(403).json({ error: 'Invalid token' });
      }
      
      const userId = decoded.id || decoded.userId;
      console.log('✅ JWT decoded, user ID:', userId);
      
      const user = await User.findById(userId).select('-password');
      if (!user) {
        console.log('❌ User not found:', decoded.id);
        return res.status(404).json({ error: 'User not found' });
      }
      
      console.log('✅ User found:', user.email);
      
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'Account is not active' });
      }
      
      // Get user's subscription
      const subscription = await Subscription.findOne({ 
        user: user._id, 
        status: { $in: ['active', 'trialing'] }
      });
      
      req.user = user;
      req.subscription = subscription;
      next();
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// API Key Authentication
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    // Verify API key
    const result = await ApiKey.verifyKey(apiKey);
    
    if (!result.valid) {
      return res.status(401).json({ error: result.error });
    }
    
    // Check IP restrictions
    const clientIp = req.ip || req.connection.remoteAddress;
    if (!result.apiKey.checkIP(clientIp)) {
      return res.status(403).json({ error: 'IP not allowed' });
    }
    
    // Check domain restrictions (for browser requests)
    const origin = req.headers.origin || req.headers.referer;
    if (origin && !result.apiKey.checkDomain(origin)) {
      return res.status(403).json({ error: 'Domain not allowed' });
    }
    
    // Get user's subscription
    const subscription = await Subscription.findOne({ 
      user: result.apiKey.user._id,
      status: { $in: ['active', 'trialing'] }
    });
    
    if (!subscription) {
      return res.status(403).json({ error: 'No active subscription' });
    }
    
    req.user = result.apiKey.user;
    req.apiKey = result.apiKey;
    req.subscription = subscription;
    
    // Apply rate limiting based on API key settings
    try {
      const rateLimiter = new RateLimiterMemory({
        points: result.apiKey.rateLimit.requests,
        duration: result.apiKey.rateLimit.interval === 'second' ? 1 : 
                 result.apiKey.rateLimit.interval === 'minute' ? 60 : 3600
      });
      
      await rateLimiter.consume(apiKey);
    } catch (rateLimitError) {
      res.set('Retry-After', String(Math.round(rateLimitError.msBeforeNext / 1000)) || 60);
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        retryAfter: Math.round(rateLimitError.msBeforeNext / 1000)
      });
    }
    
    // Update API key usage
    result.apiKey.usage.lastUsedAt = new Date();
    result.apiKey.usage.lastUsedIP = clientIp;
    result.apiKey.usage.lastUsedEndpoint = req.originalUrl;
    await result.apiKey.save();
    
    next();
  } catch (error) {
    console.error('API key auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Combined authentication (JWT or API Key)
const authenticate = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  if (apiKey) {
    return authenticateApiKey(req, res, next);
  } else {
    return authenticateToken(req, res, next);
  }
};

// Admin authentication
const authenticateAdmin = async (req, res, next) => {
  await authenticateToken(req, res, async () => {
    if (!req.user || !['admin', 'superadmin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
};

// Super admin authentication
const authenticateSuperAdmin = async (req, res, next) => {
  await authenticateToken(req, res, async () => {
    if (!req.user || req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Super admin access required' });
    }
    next();
  });
};

// Rate limiting middleware
const rateLimiter = async (req, res, next) => {
  try {
    if (!req.subscription) {
      return next();
    }
    
    const limiter = rateLimiters[req.subscription.plan] || rateLimiters.free;
    const key = req.user ? req.user._id.toString() : req.ip;
    
    await limiter.consume(key);
    next();
  } catch (rateLimitError) {
    res.set('Retry-After', String(Math.round(rateLimitError.msBeforeNext / 1000)) || 60);
    res.status(429).json({ 
      error: 'Too many requests',
      retryAfter: Math.round(rateLimitError.msBeforeNext / 1000)
    });
  }
};

// Check subscription limits
const checkSubscriptionLimit = (limitType) => {
  return async (req, res, next) => {
    try {
      if (!req.subscription) {
        return res.status(403).json({ error: 'No active subscription' });
      }
      
      const hasLimit = req.subscription.checkLimit(limitType);
      if (!hasLimit) {
        return res.status(403).json({ 
          error: 'Usage limit exceeded',
          limit: limitType,
          current: req.subscription.limits[`${limitType}Used`],
          max: req.subscription.limits[limitType]
        });
      }
      
      next();
    } catch (error) {
      console.error('Subscription check error:', error);
      res.status(500).json({ error: 'Failed to check subscription limits' });
    }
  };
};

// Refresh token
const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }
    
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(403).json({ error: 'Invalid refresh token' });
      }
      
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
      // Check if refresh token exists in user's tokens
      const tokenExists = user.refreshTokens.some(t => 
        t.token === refreshToken && t.expiresAt > new Date()
      );
      
      if (!tokenExists) {
        return res.status(403).json({ error: 'Refresh token not found or expired' });
      }
      
      // Generate new access token
      const accessToken = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );
      
      res.json({ accessToken });
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
};

// Backward compatibility
const auth = authenticate;

module.exports = {
  auth,
  authenticateToken,
  authenticateApiKey,
  authenticate,
  authenticateAdmin,
  authenticateSuperAdmin,
  rateLimiter,
  checkSubscriptionLimit,
  refreshToken
};