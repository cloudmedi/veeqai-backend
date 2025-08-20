const JWTService = require('../utils/jwt');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const monitoring = require('../services/monitoring');

/**
 * UNIFIED AUTHENTICATION MIDDLEWARE
 * Centralized auth logic with proper error handling
 */
class AuthMiddleware {
  
  /**
   * Main authentication middleware
   */
  static async authenticate(req, res, next) {
    try {
      console.log(`🔐 [AUTH] ${req.method} ${req.path} - Authentication started`);
      
      // Extract token
      const token = JWTService.extractToken(req.headers.authorization);
      if (!token) {
        console.log('❌ [AUTH] No token provided');
        return res.status(401).json({ 
          error: 'Access token required',
          code: 'TOKEN_MISSING'
        });
      }

      // Verify token
      const decoded = JWTService.verifyToken(token, 'access');
      if (!decoded) {
        console.log('❌ [AUTH] Invalid token');
        return res.status(401).json({ 
          error: 'Invalid or expired token',
          code: 'TOKEN_INVALID'
        });
      }

      console.log(`✅ [AUTH] Token valid for user: ${decoded.sub}`);

      // Check session version (if Redis is available)
      if (decoded.sv !== undefined) {
        const currentVersion = await JWTService.getSessionVersion(decoded.sub);
        if (decoded.sv !== currentVersion) {
          console.log(`❌ [AUTH] Session revoked - User: ${decoded.sub}, Token SV: ${decoded.sv}, Current SV: ${currentVersion}`);
          monitoring.trackSessionVersionMismatch();
          return res.status(401).json({ 
            error: 'Session has been revoked',
            code: 'SESSION_REVOKED'
          });
        }
      }

      // Find user
      const user = await User.findById(decoded.sub).select('-password');
      if (!user) {
        console.log(`❌ [AUTH] User not found: ${decoded.sub}`);
        return res.status(404).json({ 
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Check user status
      if (user.status !== 'active') {
        console.log(`❌ [AUTH] User inactive: ${user.email} (${user.status})`);
        return res.status(403).json({ 
          error: 'Account is not active',
          code: 'ACCOUNT_INACTIVE'
        });
      }

      // Get subscription
      const subscription = await Subscription.findOne({ 
        user: user._id, 
        status: { $in: ['active', 'trialing'] }
      });

      // Attach to request
      req.user = user;
      req.subscription = subscription;
      req.token = decoded;

      console.log(`✅ [AUTH] Authentication successful: ${user.email} (${user.role})`);
      next();

    } catch (error) {
      console.error('❌ [AUTH] Authentication error:', error);
      res.status(500).json({ 
        error: 'Authentication failed',
        code: 'AUTH_ERROR'
      });
    }
  }

  /**
   * Admin role middleware
   */
  static async requireAdmin(req, res, next) {
    await AuthMiddleware.authenticate(req, res, () => {
      if (!req.user || !['admin', 'superadmin'].includes(req.user.role)) {
        console.log(`❌ [AUTH] Admin access denied: ${req.user?.email} (${req.user?.role})`);
        return res.status(403).json({ 
          error: 'Admin access required',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }
      console.log(`✅ [AUTH] Admin access granted: ${req.user.email}`);
      next();
    });
  }

  /**
   * Super admin role middleware
   */
  static async requireSuperAdmin(req, res, next) {
    await AuthMiddleware.authenticate(req, res, () => {
      if (!req.user || req.user.role !== 'superadmin') {
        console.log(`❌ [AUTH] Super admin access denied: ${req.user?.email} (${req.user?.role})`);
        return res.status(403).json({ 
          error: 'Super admin access required',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }
      console.log(`✅ [AUTH] Super admin access granted: ${req.user.email}`);
      next();
    });
  }

  /**
   * Optional authentication (for public/private content)
   */
  static async optionalAuth(req, res, next) {
    const token = JWTService.extractToken(req.headers.authorization);
    
    if (!token) {
      // No token - continue as anonymous
      req.user = null;
      req.subscription = null;
      return next();
    }

    try {
      const decoded = JWTService.verifyToken(token, 'access');
      if (decoded) {
        const user = await User.findById(decoded.sub).select('-password');
        if (user && user.status === 'active') {
          req.user = user;
          req.subscription = await Subscription.findOne({ 
            user: user._id, 
            status: { $in: ['active', 'trialing'] }
          });
        }
      }
    } catch (error) {
      console.log('⚠️ [AUTH] Optional auth failed, continuing as anonymous');
    }

    next();
  }
}

module.exports = AuthMiddleware;