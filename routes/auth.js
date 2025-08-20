const express = require('express');
const router = express.Router();
const JWTService = require('../utils/jwt');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const AuthMiddleware = require('../middleware/auth-unified');
const { multiRateLimit } = require('../middleware/rateLimit');
const monitoring = require('../services/monitoring');

// DEPRECATED - Use JWTService instead
const generateToken = (userId, email, role) => {
  console.log('⚠️ Using deprecated generateToken. Upgrade to JWTService!');
  return JWTService.generateAccessToken(userId, email, role);
};

// Rate limiting configurations (relaxed for development)
const loginRateLimit = multiRateLimit({
  windowSeconds: 600, // 10 minutes
  ipLimit: 50, // Increased for development
  userLimit: 20, // Increased for development
  ipUserLimit: 15, // Increased for development
  getUserId: (req) => req.body.email // Use email as user identifier for login
});

const registerRateLimit = multiRateLimit({
  windowSeconds: 3600, // 1 hour  
  ipLimit: 3,
  userLimit: 1,
  ipUserLimit: 1,
  getUserId: (req) => req.body.email
});

// Register
router.post('/register', registerRateLimit, [
  body('name').isLength({ min: 3 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ 
        error: 'User already exists with this email' 
      });
    }

    // Create new user
    const user = new User({
      name,
      email,
      password
    });

    await user.save();

    // Initialize session version for new user
    await JWTService.initializeSession(user._id);

    // Get the Free plan details
    const freePlan = await Plan.findOne({ name: 'free' });
    
    // Create Free subscription for new user with credits from plan
    const subscription = new Subscription({
      user: user._id,
      plan: freePlan ? freePlan._id : 'free',
      planName: 'Free Plan',
      pricing: {
        amount: 0,
        currency: 'USD',
        interval: 'monthly'
      },
      credits: {
        monthly: freePlan ? freePlan.credits.monthly : 5000, // Default to 5000 if plan not found
        used: 0,
        rollover: 0,
        periodStart: new Date()
      },
      status: 'active',
      metadata: {
        source: 'website'
      }
    });

    await subscription.save();

    const accessToken = await JWTService.generateAccessToken(user._id, user.email, user.role);
    const refreshToken = JWTService.generateRefreshToken(user._id);

    res.status(201).json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        credits: subscription.getAvailableCredits(), // Get credits from subscription
        subscription: subscription.planName,
        voiceSlots: user.voiceSlots || 0
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Error creating user' });
  }
});

// Login
router.post('/login', loginRateLimit, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      monitoring.trackLogin(false, 'password');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      monitoring.trackLogin(false, 'password');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = Date.now();
    await user.save();

    // Initialize session version if not exists (for existing users)
    await JWTService.initializeSession(user._id);

    const accessToken = await JWTService.generateAccessToken(user._id, user.email, user.role);
    const refreshToken = JWTService.generateRefreshToken(user._id);

    // Track successful login
    monitoring.trackLogin(true, 'password');

    // Get user's subscription to fetch credits
    const subscription = await Subscription.findOne({ 
      user: user._id, 
      status: { $in: ['active', 'trialing'] } 
    });
    
    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role, // Add role field for consistency
        credits: subscription ? subscription.getAvailableCredits() : 0, // Get credits from subscription
        subscription: subscription ? subscription.planName : 'Free',
        voiceSlots: user.voiceSlots || 0
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    monitoring.trackError('login_error', 'error');
    res.status(500).json({ error: 'Error logging in' });
  }
});

// Validate token and get current user (for frontend auth validation)
const { verifyAccess } = require('../middleware/verifyAccess');
router.get('/validate', verifyAccess, async (req, res) => {
  try {
    // Fetch fresh user data
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    // Get user's subscription to fetch credits
    const subscription = await Subscription.findOne({ 
      user: user._id, 
      status: { $in: ['active', 'trialing'] } 
    });
    
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role, // Add role field for admin validation
        credits: subscription ? subscription.getAvailableCredits() : 0, // Get credits from subscription
        subscription: subscription ? subscription.planName : 'Free',
        voiceSlots: user.voiceSlots || 0
      }
    });
  } catch (error) {
    console.error('Validate error:', error);
    res.status(401).json({ error: 'unauthorized' });
  }
});

// Get current user
router.get('/me', AuthMiddleware.authenticate, async (req, res) => {
  // Get user's subscription to fetch credits
  const subscription = await Subscription.findOne({ 
    user: req.user._id, 
    status: { $in: ['active', 'trialing'] } 
  });
  
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role, // Add role field for consistency
      credits: subscription ? subscription.getAvailableCredits() : 0, // Get credits from subscription
      subscription: subscription ? subscription.planName : 'Free',
      voiceSlots: req.user.voiceSlots || 0
    }
  });
});

// Update user credits (for testing)
router.post('/add-credits', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { amount } = req.body;
    
    // Get user's subscription to add credits
    const subscription = await Subscription.findOne({ 
      user: req.user._id, 
      status: { $in: ['active', 'trialing'] } 
    });
    
    if (!subscription) {
      return res.status(400).json({ error: 'No active subscription found' });
    }
    
    // Add credits to subscription
    subscription.addCredits(amount, 'manual_addition', { addedBy: 'api' });
    await subscription.save();
    
    res.json({ 
      message: 'Credits added',
      credits: subscription.getAvailableCredits() 
    });
  } catch (error) {
    res.status(500).json({ error: 'Error adding credits' });
  }
});

// Update profile
router.put('/update-profile', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { name, email } = req.body;
    const userId = req.user._id;

    // Check if email is already taken by another user
    if (email && email !== req.user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        ...(name && { name }),
        ...(email && { email })
      },
      { new: true }
    );

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        credits: updatedUser.credits,
        subscription: updatedUser.subscription,
        voiceSlots: updatedUser.voiceSlots
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Error updating profile' });
  }
});

// Change password
router.put('/change-password', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    // Verify current password
    const user = await User.findById(userId);
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Error changing password' });
  }
});

// Refresh token endpoint
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    // Verify refresh token
    const decoded = JWTService.verifyToken(refreshToken, 'refresh');
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Get user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new access token
    const newAccessToken = await JWTService.generateAccessToken(user._id, user.email, user.role);
    
    // Get user's subscription to fetch credits
    const subscription = await Subscription.findOne({ 
      user: user._id, 
      status: { $in: ['active', 'trialing'] } 
    });
    
    res.json({
      accessToken: newAccessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role, // Add role field for consistency
        credits: subscription ? subscription.getAvailableCredits() : 0, // Get credits from subscription
        subscription: subscription ? subscription.planName : 'Free',
        voiceSlots: user.voiceSlots || 0
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout (revoke all sessions)
router.post('/logout', verifyAccess, async (req, res) => {
  try {
    await JWTService.revokeAllSessions(req.userId);
    monitoring.trackSessionRevocation();
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    monitoring.trackError('logout_error', 'error');
    res.status(500).json({ error: 'Error logging out' });
  }
});

// Get public plans (for pricing page)
router.get('/plans', async (req, res) => {
  try {
    const plans = await Plan.find({ status: 'active' })
      .sort({ 'display.order': 1 })
      .select('-createdAt -updatedAt -__v');

    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

module.exports = router;