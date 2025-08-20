const redis = require('redis');

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.connect().catch(console.error);

// Lua script for sliding window rate limiting with multiple keys
const multiRateLimitScript = `
-- KEYS: 1=ipKey 2=userKey 3=ipUserKey  
-- ARGV: 1=nowMs 2=windowMs 3=ipLimit 4=userLimit 5=ipUserLimit 6=ttlSec

local function checkLimit(key, limit, ttlSec)
  redis.call('ZREMRANGEBYSCORE', key, 0, tonumber(ARGV[1]) - tonumber(ARGV[2]))
  redis.call('ZADD', key, ARGV[1], ARGV[1])
  local count = redis.call('ZCARD', key)
  
  -- Set TTL only when key is first created
  if count == 1 then
    redis.call('EXPIRE', key, ttlSec)
  end
  
  return count, tonumber(limit)
end

local ipCount, ipLimit = checkLimit(KEYS[1], ARGV[3], tonumber(ARGV[6]))
local userCount, userLimit = 0, tonumber(ARGV[4])
local ipUserCount, ipUserLimit = 0, tonumber(ARGV[5])

-- Only check user and ipUser limits if we have keys for them
if KEYS[2] and KEYS[2] ~= '' then
  userCount, userLimit = checkLimit(KEYS[2], ARGV[4], tonumber(ARGV[6]))
end

if KEYS[3] and KEYS[3] ~= '' then
  ipUserCount, ipUserLimit = checkLimit(KEYS[3], ARGV[5], tonumber(ARGV[6]))
end

local blocked = (ipCount > ipLimit) or (userCount > userLimit) or (ipUserCount > ipUserLimit)
local remaining = math.min(ipLimit - ipCount, userLimit - userCount, ipUserLimit - ipUserCount)

return { blocked and 1 or 0, remaining }
`;

/**
 * Multi-layer rate limiting middleware
 * @param {Object} config - Rate limit configuration
 * @param {number} config.windowSeconds - Time window in seconds
 * @param {number} config.ipLimit - Max requests per IP
 * @param {number} config.userLimit - Max requests per user
 * @param {number} config.ipUserLimit - Max requests per IP+user combo
 * @param {Function} config.getUserId - Function to extract user ID from request
 * @returns {Function} Express middleware
 */
const multiRateLimit = (config) => {
  const {
    windowSeconds = 60,
    ipLimit = 10,
    userLimit = 5,
    ipUserLimit = 3,
    getUserId = null
  } = config;

  return async (req, res, next) => {
    try {
      const ip = req.ip || req.connection.remoteAddress;
      const userId = getUserId ? getUserId(req) : null;
      const now = Date.now();
      const windowMs = windowSeconds * 1000;
      const ttlSec = Math.ceil(windowSeconds * 1.5); // Buffer for cleanup

      // Build keys
      const ipKey = `rl:ip:${ip}`;
      const userKey = userId ? `rl:user:${userId}` : '';
      const ipUserKey = userId ? `rl:ipu:${ip}:${userId}` : '';

      const result = await client.eval(multiRateLimitScript, {
        keys: [ipKey, userKey, ipUserKey],
        arguments: [
          now.toString(),
          windowMs.toString(),
          ipLimit.toString(),
          userLimit.toString(),
          ipUserLimit.toString(),
          ttlSec.toString()
        ]
      });

      const [blocked, remaining] = result;

      if (blocked) {
        // Log rate limit violation
        console.log(`Rate limit exceeded - IP: ${ip}, User: ${userId || 'anonymous'}, Endpoint: ${req.path}`);
        
        return res.status(429).json({
          error: 'too_many_requests',
          message: 'Rate limit exceeded'
        });
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
      res.setHeader('X-RateLimit-Window', windowSeconds);

      next();
    } catch (err) {
      console.error('Rate limit error:', err);
      // Fail open - don't block requests on rate limit system failure
      next();
    }
  };
};

module.exports = { multiRateLimit };