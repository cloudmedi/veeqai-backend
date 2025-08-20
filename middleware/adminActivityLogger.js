const logger = require('../services/logger');
const monitoring = require('../services/monitoring');

/**
 * Admin Activity Logging Middleware
 * Tracks all admin actions for security auditing
 */
class AdminActivityLogger {
  
  /**
   * Log admin activity middleware
   */
  static logActivity(req, res, next) {
    const originalSend = res.send;
    const startTime = Date.now();
    
    // Capture response
    res.send = function(data) {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      
      // Log admin activity
      AdminActivityLogger.logAdminAction({
        userId: req.user?.id,
        userEmail: req.user?.email,
        userRole: req.user?.role,
        action: `${req.method} ${req.originalUrl}`,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent'),
        statusCode,
        duration,
        requestBody: AdminActivityLogger.sanitizeRequestBody(req.body),
        timestamp: new Date().toISOString(),
        success: statusCode < 400
      });
      
      // Track metrics
      monitoring.trackApiCall(req.originalUrl, req.method, statusCode);
      monitoring.trackResponseTime(req.originalUrl, req.method, duration / 1000);
      
      // Call original send
      originalSend.call(this, data);
    };
    
    next();
  }
  
  /**
   * Log admin action to file and monitoring
   */
  static logAdminAction(activity) {
    const logEntry = {
      timestamp: activity.timestamp,
      level: 'admin_activity',
      userId: activity.userId,
      userEmail: activity.userEmail,
      userRole: activity.userRole,
      action: activity.action,
      method: activity.method,
      path: activity.path,
      ip: activity.ip,
      userAgent: activity.userAgent,
      statusCode: activity.statusCode,
      duration: activity.duration,
      success: activity.success,
      requestBody: activity.requestBody
    };
    
    // Log to file
    logger.info('Admin Activity', logEntry);
    
    // Log critical actions
    if (AdminActivityLogger.isCriticalAction(activity.path, activity.method)) {
      logger.warn('Critical Admin Action', {
        ...logEntry,
        critical: true
      });
      
      // Track security metrics
      monitoring.trackSuspiciousActivity('critical_admin_action');
    }
    
    // Log failed actions
    if (!activity.success) {
      logger.error('Failed Admin Action', logEntry);
      monitoring.trackError('admin_action_failed', 'warning');
    }
  }
  
  /**
   * Sanitize request body for logging (remove sensitive data)
   */
  static sanitizeRequestBody(body) {
    if (!body || typeof body !== 'object') return body;
    
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
  
  /**
   * Check if action is critical and needs special attention
   */
  static isCriticalAction(path, method) {
    const criticalPatterns = [
      { path: /\/admin\/users\/.*\/delete/, method: 'DELETE' },
      { path: /\/admin\/users\/.*\/role/, method: 'PUT' },
      { path: /\/admin\/models\/.*\/delete/, method: 'DELETE' },
      { path: /\/admin\/plans\/.*\/delete/, method: 'DELETE' },
      { path: /\/admin\/settings/, method: 'PUT' },
      { path: /\/admin\/music\/.*\/delete/, method: 'DELETE' },
      { path: /\/admin\/analytics/, method: 'GET' } // Sensitive data access
    ];
    
    return criticalPatterns.some(pattern => 
      pattern.path.test(path) && pattern.method === method
    );
  }
  
  /**
   * Get admin activity logs (for dashboard)
   */
  static async getRecentActivity(limit = 100) {
    try {
      // In production, this would query a proper logging database
      // For now, return structured data for the dashboard
      return {
        success: true,
        activities: [], // Would be populated from log database
        totalCount: 0
      };
    } catch (error) {
      logger.error('Error fetching admin activity logs:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Generate security report
   */
  static async generateSecurityReport(startDate, endDate) {
    try {
      // This would generate a comprehensive security report
      // from the logged admin activities
      return {
        success: true,
        report: {
          period: { startDate, endDate },
          totalActions: 0,
          criticalActions: 0,
          failedActions: 0,
          uniqueUsers: 0,
          topActions: [],
          securityEvents: []
        }
      };
    } catch (error) {
      logger.error('Error generating security report:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = AdminActivityLogger;