const jwt = require('jsonwebtoken');
const redis = require('redis');

let client = null;
let redisConnected = false;

try {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  console.log('Connecting to Redis (verifyAccess):', redisUrl.replace(/:[^:]*@/, ':***@'));
  
  client = redis.createClient({
    url: redisUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => retries > 3 ? false : Math.min(retries * 50, 500)
    }
  });
  
  client.on('error', (err) => {
    console.log('Redis Error (verifyAccess):', err.code, err.message);
    redisConnected = false;
  });
  
  client.on('connect', () => {
    console.log('✅ Redis connected for verifyAccess');
    redisConnected = true;
  });
  
  client.connect().then(() => {
    redisConnected = true;
  }).catch((err) => {
    console.log('❌ Redis connection failed (verifyAccess):', err.code, err.message);
    redisConnected = false;
  });
} catch (err) {
  console.log('❌ Redis initialization failed (verifyAccess):', err.message);
  redisConnected = false;
}

const verifyAccess = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    let payload;

    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!payload.sub || payload.sv === undefined) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // Skip session version check if Redis is not connected
    if (!redisConnected || !client) {
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
      return next();
    }
    
    const currentSV = await client.get(`session_version:${payload.sub}`) ?? '0';

    if (payload.sv !== currentSV) {
      // Session revoked - log for monitoring
      console.log(`Session revoked - userId: ${payload.sub}, token sv: ${payload.sv}, current sv: ${currentSV}`);
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.userId = payload.sub;
    req.tokenPayload = payload;
    next();
  } catch (err) {
    console.error('verifyAccess error:', err);
    res.status(401).json({ error: 'unauthorized' });
  }
};

module.exports = { verifyAccess };