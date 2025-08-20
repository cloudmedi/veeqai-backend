const prometheus = require('prom-client');

/**
 * Enterprise Monitoring Service
 * Tracks security metrics, performance, and business KPIs
 */
class MonitoringService {
  constructor() {
    // Create a Registry
    this.register = new prometheus.Registry();
    
    // Add default metrics (CPU, memory, etc.)
    prometheus.collectDefaultMetrics({ register: this.register });
    
    // Authentication Metrics
    this.loginAttempts = new prometheus.Counter({
      name: 'login_attempts_total',
      help: 'Total number of login attempts',
      labelNames: ['status', 'method'],
      registers: [this.register]
    });
    
    this.loginFailures = new prometheus.Counter({
      name: 'login_failures_total',
      help: 'Total number of failed login attempts',
      labelNames: ['reason'],
      registers: [this.register]
    });
    
    this.sessionRevocations = new prometheus.Counter({
      name: 'session_revocations_total',
      help: 'Total number of session revocations',
      registers: [this.register]
    });
    
    this.tokenValidationDuration = new prometheus.Histogram({
      name: 'token_validation_duration_seconds',
      help: 'Duration of token validation in seconds',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
      registers: [this.register]
    });
    
    // Rate Limiting Metrics
    this.rateLimitHits = new prometheus.Counter({
      name: 'rate_limit_hits_total',
      help: 'Total number of rate limit checks',
      labelNames: ['type', 'endpoint'],
      registers: [this.register]
    });
    
    this.rateLimitBlocks = new prometheus.Counter({
      name: 'rate_limit_blocks_total',
      help: 'Total number of requests blocked by rate limiting',
      labelNames: ['type', 'endpoint'],
      registers: [this.register]
    });
    
    // Security Metrics
    this.suspiciousLoginAttempts = new prometheus.Counter({
      name: 'suspicious_login_attempts_total',
      help: 'Total number of suspicious login attempts',
      labelNames: ['type'],
      registers: [this.register]
    });
    
    this.sessionVersionMismatches = new prometheus.Counter({
      name: 'session_version_mismatches_total',
      help: 'Total number of session version mismatches',
      registers: [this.register]
    });
    
    // Business Metrics
    this.musicGenerations = new prometheus.Counter({
      name: 'music_generations_total',
      help: 'Total number of music generations',
      labelNames: ['status', 'model'],
      registers: [this.register]
    });
    
    this.apiCalls = new prometheus.Counter({
      name: 'api_calls_total',
      help: 'Total number of API calls',
      labelNames: ['endpoint', 'method', 'status'],
      registers: [this.register]
    });
    
    this.creditUsage = new prometheus.Counter({
      name: 'credit_usage_total',
      help: 'Total credits consumed',
      labelNames: ['service', 'user_type'],
      registers: [this.register]
    });
    
    // Performance Metrics
    this.apiResponseTime = new prometheus.Histogram({
      name: 'api_response_time_seconds',
      help: 'API response time in seconds',
      labelNames: ['endpoint', 'method'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      registers: [this.register]
    });
    
    this.redisOperationDuration = new prometheus.Histogram({
      name: 'redis_operation_duration_seconds',
      help: 'Redis operation duration in seconds',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1],
      registers: [this.register]
    });
    
    // Error Metrics
    this.errors = new prometheus.Counter({
      name: 'application_errors_total',
      help: 'Total application errors',
      labelNames: ['type', 'severity'],
      registers: [this.register]
    });
  }
  
  /**
   * Track login attempt
   */
  trackLogin(success, method = 'password') {
    this.loginAttempts.inc({ status: success ? 'success' : 'failure', method });
    if (!success) {
      this.loginFailures.inc({ reason: method });
    }
  }
  
  /**
   * Track rate limit
   */
  trackRateLimit(blocked, type, endpoint) {
    this.rateLimitHits.inc({ type, endpoint });
    if (blocked) {
      this.rateLimitBlocks.inc({ type, endpoint });
    }
  }
  
  /**
   * Track API call
   */
  trackApiCall(endpoint, method, status) {
    this.apiCalls.inc({ endpoint, method, status: status.toString() });
  }
  
  /**
   * Track response time
   */
  trackResponseTime(endpoint, method, duration) {
    this.apiResponseTime.observe({ endpoint, method }, duration);
  }
  
  /**
   * Track music generation
   */
  trackMusicGeneration(status, model) {
    this.musicGenerations.inc({ status, model });
  }
  
  /**
   * Track credit usage
   */
  trackCreditUsage(amount, service, userType) {
    this.creditUsage.inc({ service, user_type: userType }, amount);
  }
  
  /**
   * Track error
   */
  trackError(type, severity = 'error') {
    this.errors.inc({ type, severity });
  }
  
  /**
   * Track session revocation
   */
  trackSessionRevocation() {
    this.sessionRevocations.inc();
  }
  
  /**
   * Track session version mismatch
   */
  trackSessionVersionMismatch() {
    this.sessionVersionMismatches.inc();
  }
  
  /**
   * Track suspicious activity
   */
  trackSuspiciousActivity(type) {
    this.suspiciousLoginAttempts.inc({ type });
  }
  
  /**
   * Get metrics for Prometheus
   */
  async getMetrics() {
    return this.register.metrics();
  }
  
  /**
   * Get metrics in JSON format
   */
  async getMetricsJson() {
    return this.register.getMetricsAsJSON();
  }
  
  /**
   * Express middleware to track response times
   */
  middleware() {
    return (req, res, next) => {
      const start = Date.now();
      
      // Track response
      res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const endpoint = req.route?.path || req.path;
        const method = req.method;
        const status = res.statusCode;
        
        this.trackApiCall(endpoint, method, status);
        this.trackResponseTime(endpoint, method, duration);
      });
      
      next();
    };
  }
}

// Singleton instance
const monitoring = new MonitoringService();

module.exports = monitoring;