const jwt = require('jsonwebtoken');
const redis = require('redis');
const NodeCache = require('node-cache');

// Create memory cache instance for local development
const memoryCache = new NodeCache({ 
  stdTTL: 86400, // 24 hours default TTL
  checkperiod: 600 // Check for expired keys every 10 minutes
});

// Redis client for production (Railway)
let client = null;
let redisConnected = false;

// Only try to connect to Redis if REDIS_URL is provided (Railway environment)
if (process.env.REDIS_URL) {
  client = redis.createClient({
    url: process.env.REDIS_URL
  });
  
  client.connect().then(() => {
    redisConnected = true;
    console.log('✅ Redis connected (Production mode)');
  }).catch(error => {
    console.warn('⚠️ Redis connection failed, falling back to memory cache:', error.message);
    redisConnected = false;
  });
} else {
  console.log('💾 Using memory cache (Development mode - Redis not required)');
}

/**
 * UNIFIED JWT TOKEN SERVICE
 * Standardized token generation and validation with session versioning
 */
class JWTService {
  /**
   * Generate access token with session versioning
   * @param {string} userId - User ID
   * @param {string} email - User email  
   * @param {string} role - User role
   * @returns {Promise<string>} JWT token
   */
  static async generateAccessToken(userId, email, role = 'user') {
    // Get current session version for this user
    let sv = '0';
    if (redisConnected && client) {
      try {
        sv = await client.get(`session_version:${userId}`) ?? '0';
      } catch (error) {
        console.warn('⚠️ Redis error, using memory cache:', error.message);
        sv = memoryCache.get(`session_version:${userId}`) || '0';
      }
    } else {
      // Use memory cache in development
      sv = memoryCache.get(`session_version:${userId}`) || '0';
    }
    
    const payload = {
      sub: userId,        // Standard JWT 'sub' claim
      email,
      role,
      type: 'access',
      sv: sv,            // Session version for revocation
      jti: require('crypto').randomUUID(),  // Unique token ID
      iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(payload, process.env.JWT_SECRET, { 
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',  // Extended for better UX
      issuer: 'veeqai'
    });
  }

  /**
   * Generate refresh token
   * @param {string} userId - User ID
   * @returns {string} Refresh token
   */
  static generateRefreshToken(userId) {
    const payload = {
      id: userId,
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000)
    };

    return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { 
      expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
      issuer: 'veeqai'
    });
  }

  /**
   * Verify and decode token
   * @param {string} token - JWT token
   * @param {string} type - 'access' or 'refresh'
   * @returns {object} Decoded payload or null
   */
  static verifyToken(token, type = 'access') {
    try {
      const secret = type === 'refresh' ? process.env.JWT_REFRESH_SECRET : process.env.JWT_SECRET;
      
      const decoded = jwt.verify(token, secret);
      
      // Validate token type (backwards compatible - old tokens may not have type field)
      if (decoded.type && decoded.type !== type) {
        throw new Error(`Invalid token type. Expected: ${type}, Got: ${decoded.type}`);
      }

      // Validate issuer
      if (decoded.iss !== 'veeqai') {
        throw new Error('Invalid token issuer');
      }

      return decoded;
    } catch (error) {
      console.error(`JWT verification failed:`, error.message);
      return null;
    }
  }

  /**
   * Extract token from Authorization header
   * @param {string} authHeader - Authorization header
   * @returns {string|null} Token or null
   */
  static extractToken(authHeader) {
    if (!authHeader) return null;
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }
    
    return parts[1];
  }

  /**
   * Check if token is expired
   * @param {object} decoded - Decoded JWT payload
   * @returns {boolean} True if expired
   */
  static isExpired(decoded) {
    if (!decoded.exp) return false;
    return Date.now() >= decoded.exp * 1000;
  }


  /**
   * Initialize session version for new user (default: 0)
   * @param {string} userId - User ID
   */
  static async initializeSession(userId) {
    if (redisConnected && client) {
      try {
        // Always reset to 0 on login for consistency
        await client.set(`session_version:${userId}`, '0');
      } catch (error) {
        console.warn('⚠️ Redis error, using memory cache:', error.message);
        memoryCache.set(`session_version:${userId}`, '0');
      }
    } else {
      // Use memory cache in development - always reset to 0
      memoryCache.set(`session_version:${userId}`, '0');
    }
  }

  /**
   * Revoke all sessions for a user by incrementing session version
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  static async revokeAllSessions(userId) {
    try {
      let currentVersion = '0';
      let newVersion = '1';
      
      if (redisConnected && client) {
        try {
          currentVersion = await client.get(`session_version:${userId}`) || '0';
          newVersion = (parseInt(currentVersion) + 1).toString();
          await client.set(`session_version:${userId}`, newVersion);
        } catch (error) {
          console.warn('⚠️ Redis error, using memory cache:', error.message);
          currentVersion = memoryCache.get(`session_version:${userId}`) || '0';
          newVersion = (parseInt(currentVersion) + 1).toString();
          memoryCache.set(`session_version:${userId}`, newVersion);
        }
      } else {
        // Use memory cache in development
        currentVersion = memoryCache.get(`session_version:${userId}`) || '0';
        newVersion = (parseInt(currentVersion) + 1).toString();
        memoryCache.set(`session_version:${userId}`, newVersion);
      }
      
      console.log(`✅ All sessions revoked for user ${userId}, new version: ${newVersion}`);
      return true;
    } catch (error) {
      console.error('❌ Error revoking sessions:', error);
      return false;
    }
  }

  /**
   * Get current session version for user
   * @param {string} userId - User ID
   * @returns {Promise<string>} Session version
   */
  static async getSessionVersion(userId) {
    try {
      if (redisConnected && client) {
        try {
          return await client.get(`session_version:${userId}`) || '0';
        } catch (error) {
          console.warn('⚠️ Redis error, using memory cache:', error.message);
          return memoryCache.get(`session_version:${userId}`) || '0';
        }
      } else {
        // Use memory cache in development
        return memoryCache.get(`session_version:${userId}`) || '0';
      }
    } catch (error) {
      console.warn('⚠️ Error getting session version:', error.message);
      return '0';
    }
  }
}

module.exports = JWTService;