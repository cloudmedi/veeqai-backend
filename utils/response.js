/**
 * STANDARDIZED API RESPONSE UTILITY
 * Consistent response format across all endpoints
 */
class ResponseUtil {
  
  /**
   * Success response
   * @param {object} res - Express response object
   * @param {any} data - Response data
   * @param {string} message - Success message
   * @param {number} status - HTTP status code
   */
  static success(res, data = null, message = 'Success', status = 200) {
    return res.status(status).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Error response
   * @param {object} res - Express response object
   * @param {string} message - Error message
   * @param {number} status - HTTP status code
   * @param {string} code - Error code
   * @param {any} details - Additional error details
   */
  static error(res, message = 'An error occurred', status = 500, code = 'INTERNAL_ERROR', details = null) {
    const response = {
      success: false,
      error: {
        message,
        code,
        status,
        timestamp: new Date().toISOString()
      }
    };

    if (details && process.env.NODE_ENV === 'development') {
      response.error.details = details;
    }

    console.error(`❌ [API ERROR] ${status} ${code}: ${message}`, details);
    
    return res.status(status).json(response);
  }

  /**
   * Unauthorized error response (401)
   * @param {object} res - Express response object
   * @param {string} message - Error message
   */
  static unauthorized(res, message = 'Unauthorized') {
    return this.error(res, message, 401, 'UNAUTHORIZED');
  }

  /**
   * Forbidden error response (403)
   * @param {object} res - Express response object
   * @param {string} message - Error message
   */
  static forbidden(res, message = 'Forbidden') {
    return this.error(res, message, 403, 'FORBIDDEN');
  }

  /**
   * Validation error response
   * @param {object} res - Express response object
   * @param {array} errors - Validation errors array
   */
  static validationError(res, errors) {
    return ResponseUtil.error(
      res, 
      'Validation failed', 
      400, 
      'VALIDATION_ERROR',
      { fields: errors }
    );
  }

  /**
   * Not found response
   * @param {object} res - Express response object
   * @param {string} resource - Resource name
   */
  static notFound(res, resource = 'Resource') {
    return ResponseUtil.error(
      res,
      `${resource} not found`,
      404,
      'NOT_FOUND'
    );
  }

  /**
   * Bad request response (400)
   * @param {object} res - Express response object
   * @param {string} message - Error message
   * @param {object} details - Additional details
   */
  static badRequest(res, message = 'Bad request', details = null) {
    return this.error(res, message, 400, 'BAD_REQUEST', details);
  }

  /**
   * Server error response (500)
   * @param {object} res - Express response object
   * @param {string} message - Error message
   * @param {object} details - Additional details
   */
  static serverError(res, message = 'Internal server error', details = null) {
    return this.error(res, message, 500, 'SERVER_ERROR', details);
  }

  /**
   * Unauthorized response
   * @param {object} res - Express response object
   * @param {string} message - Custom message
   */
  static unauthorized(res, message = 'Authentication required') {
    return ResponseUtil.error(
      res,
      message,
      401,
      'UNAUTHORIZED'
    );
  }

  /**
   * Forbidden response
   * @param {object} res - Express response object
   * @param {string} message - Custom message
   */
  static forbidden(res, message = 'Access denied') {
    return ResponseUtil.error(
      res,
      message,
      403,
      'FORBIDDEN'
    );
  }

  /**
   * Paginated response
   * @param {object} res - Express response object
   * @param {array} items - Items array
   * @param {object} pagination - Pagination info
   * @param {string} message - Success message
   */
  static paginated(res, items, pagination, message = 'Success') {
    return ResponseUtil.success(res, {
      items,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        pages: Math.ceil(pagination.total / pagination.limit),
        hasNext: pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrev: pagination.page > 1
      }
    }, message);
  }
}

// Export class and convenience functions
module.exports = ResponseUtil;

// Convenience exports for backward compatibility
module.exports.successResponse = (res, data, message = 'Success', status = 200) => {
  return ResponseUtil.success(res, data, message, status);
};

module.exports.errorResponse = (res, message = 'An error occurred', status = 500, code = 'INTERNAL_ERROR', details = null) => {
  return ResponseUtil.error(res, message, status, code, details);
};