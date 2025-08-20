const jwt = require('jsonwebtoken');
const redis = require('redis');

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.connect().catch(console.error);

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