const jwt = require('jsonwebtoken');
const JWTService = require('../utils/jwt');

const verifyAccess = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    
    // Use JWTService to verify token
    const payload = JWTService.verifyToken(token, 'access');
    
    if (!payload) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!payload.sub) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // Check session version using JWTService (handles both Redis and memory cache)
    if (payload.sv !== undefined) {
      const currentSV = await JWTService.getSessionVersion(payload.sub);
      
      if (payload.sv !== currentSV) {
        // Session revoked - log for monitoring
        console.log(`Session revoked - userId: ${payload.sub}, token sv: ${payload.sv}, current sv: ${currentSV}`);
        return res.status(401).json({ error: 'unauthorized' });
      }
    }

    // Set user data on request
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    req.userId = payload.sub;
    req.tokenPayload = payload;
    
    next();
  } catch (err) {
    console.error('verifyAccess error:', err);
    res.status(401).json({ error: 'unauthorized' });
  }
};

module.exports = { verifyAccess };