const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const JWTService = require('../utils/jwt');
const ResponseUtil = require('../utils/response');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const AIModel = require('../models/AIModel');
const Plan = require('../models/Plan');
const Music = require('../models/Music');
const ProviderFactory = require('../services/ProviderFactory');
const AuthMiddleware = require('../middleware/auth-unified');
const logger = require('../services/logger');
const FeaturedMusicService = require('../services/FeaturedMusicService');
const cloudflareService = require('../services/cloudflare');
const multer = require('multer');
const AdminActivityLogger = require('../middleware/adminActivityLogger');

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Admin authentication
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('🔐 [ADMIN LOGIN] Attempt:', email);

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      console.log('❌ [ADMIN LOGIN] User not found:', email);
      return ResponseUtil.unauthorized(res, 'Invalid credentials');
    }

    console.log('✅ [ADMIN LOGIN] User found:', user.email, 'Role:', user.role);

    if (user.role !== 'superadmin') {
      console.log('❌ [ADMIN LOGIN] Not superadmin role:', user.role);
      return ResponseUtil.forbidden(res, 'Access denied. Super admin required.');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log('🔑 [ADMIN LOGIN] Password match:', isMatch);
    if (!isMatch) {
      return ResponseUtil.unauthorized(res, 'Invalid credentials');
    }

    // Initialize session version if not exists (for existing users)
    await JWTService.initializeSession(user._id);

    const accessToken = await JWTService.generateAccessToken(user._id, user.email, user.role);
    const refreshToken = JWTService.generateRefreshToken(user._id);

    // Admin panel için accessToken ve refreshToken döndür
    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('❌ [ADMIN LOGIN] Error:', error);
    return ResponseUtil.error(res, 'Admin login failed', 500, 'ADMIN_LOGIN_ERROR');
  }
});

// Admin refresh token endpoint
router.post('/auth/refresh', async (req, res) => {
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

    // Verify super admin role
    if (user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied. Super admin required.' });
    }

    // Generate new access token
    const newAccessToken = await JWTService.generateAccessToken(user._id, user.email, user.role);
    
    res.json({
      accessToken: newAccessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('❌ [ADMIN REFRESH] Error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Legacy endpoint for backwards compatibility
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied. Super admin required.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = await JWTService.generateAccessToken(user._id, user.email, user.role);

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Register super admin (protected - only when no super admin exists)
router.post('/auth/register', async (req, res) => {
  try {
    // Check if any super admin already exists
    const existingSuperAdmin = await User.findOne({ role: 'superadmin' });
    if (existingSuperAdmin) {
      return res.status(403).json({ error: 'Super admin already exists' });
    }

    const { email, password, name } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = new User({
      email,
      password: hashedPassword,
      name,
      role: 'superadmin',
      isEmailVerified: true
    });

    await user.save();

    // Create admin subscription (not Free)
    const subscription = new Subscription({
      userId: user._id,
      plan: 'admin',
      status: 'active',
      credits: 999999,
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
    });

    await subscription.save();

    const token = await JWTService.generateAccessToken(user._id, user.email, user.role);

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Admin register error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
router.get('/users', AuthMiddleware.requireSuperAdmin, AdminActivityLogger.logActivity, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const users = await User.find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments({ isDeleted: { $ne: true } });

    // Get subscription info for each user
    const userIds = users.map(user => user._id);
    const subscriptions = await Subscription.find({ user: { $in: userIds } });
    const subscriptionMap = {};
    subscriptions.forEach(sub => {
      subscriptionMap[sub.user.toString()] = sub;
    });

    const usersWithStats = users.map(user => {
      const subscription = subscriptionMap[user._id.toString()];
      return {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        subscription: subscription ? {
          plan: subscription.planName,
          status: subscription.status
        } : null,
        credits: subscription ? subscription.getAvailableCredits() : 0,
        totalGenerated: user.totalGenerated || 0,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      };
    });

    res.json({
      users: usersWithStats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user (suspend/activate)
router.patch('/users/:id', AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot modify super admin' });
    }

    user.status = status;
    await user.save();

    res.json({ message: 'User status updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user (soft delete)
router.delete('/users/:id', AuthMiddleware.requireSuperAdmin, AdminActivityLogger.logActivity, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot delete super admin' });
    }

    // Soft delete - mark as deleted and set status to inactive
    user.isDeleted = true;
    user.status = 'inactive';
    user.deletedAt = new Date();
    await user.save();

    // Cancel subscription if exists
    const subscription = await Subscription.findOne({ userId: id });
    if (subscription) {
      subscription.status = 'cancelled';
      subscription.endDate = new Date();
      await subscription.save();
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset user password
router.patch('/users/:id/reset-password', AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot reset super admin password' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user usage analytics
router.get('/users/:id/usage', AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).populate('subscription');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // TODO: Implement usage analytics from Music model
    const analytics = {
      user: {
        name: user.name,
        email: user.email,
        totalGenerated: user.totalGenerated || 0,
        credits: user.credits || 0,
        subscription: user.subscription
      },
      usage: {
        thisMonth: 0,
        lastMonth: 0,
        total: user.totalGenerated || 0
      }
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error fetching user usage:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// AI Models endpoints

// Get all AI models
router.get('/models', AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { type, status, provider, page = 1, limit = 10 } = req.query;
    
    const filter = {};
    if (type && type !== 'all') filter.type = type;
    if (status && status !== 'all') filter.status = status;
    if (provider && provider !== 'all') filter['provider.name'] = provider;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const models = await AIModel.find(filter)
      .sort({ 'display.order': 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    const total = await AIModel.countDocuments(filter);

    res.json({
      models,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new AI model
router.post('/models', AuthMiddleware.requireSuperAdmin, AdminActivityLogger.logActivity, async (req, res) => {
  try {
    const modelData = {
      ...req.body,
      createdBy: req.user._id,
      updatedBy: req.user._id
    };

    const model = new AIModel(modelData);
    await model.save();

    res.status(201).json(model);
  } catch (error) {
    console.error('Error creating model:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => ({
        path: err.path,
        message: err.message
      }));
      return res.status(400).json({ errors });
    }
    
    res.status(500).json({ error: 'Server error' });
  }
});

// Update AI model
router.patch('/models/:id', AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const model = await AIModel.findById(id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const updateData = {
      ...req.body,
      updatedBy: req.user._id,
      updatedAt: new Date()
    };

    // Get old model data for change detection
    const oldModel = await AIModel.findById(id);
    
    const updatedModel = await AIModel.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true, runValidators: true }
    );

    // Real-time broadcasting for important changes
    const statusChanged = oldModel.status !== updatedModel.status;
    const pricingChanged = JSON.stringify(oldModel.pricing) !== JSON.stringify(updatedModel.pricing);
    
    if (statusChanged) {
      // Broadcast model status change
      await EventBus.publishModelEvent('status.changed', {
        id: updatedModel._id,
        status: updatedModel.status,
        oldStatus: oldModel.status,
        displayName: updatedModel.displayName,
        type: updatedModel.type
      }, {
        updatedBy: {
          id: req.user._id,
          name: req.user.name,
          email: req.user.email
        }
      });
      
      // Queue cache refresh job
      await JobQueue.syncModel(updatedModel._id, 'cache_refresh');
      
      // Log audit trail
      await JobQueue.logAudit({
        action: 'model_status_change',
        resource: `model:${updatedModel._id}`,
        userId: req.user._id,
        details: {
          modelName: updatedModel.displayName,
          oldStatus: oldModel.status,
          newStatus: updatedModel.status
        }
      });
    }
    
    if (pricingChanged) {
      // Broadcast pricing update
      await EventBus.publishModelEvent('pricing.changed', {
        id: updatedModel._id,
        pricing: updatedModel.pricing,
        oldPricing: oldModel.pricing,
        displayName: updatedModel.displayName
      }, {
        updatedBy: {
          id: req.user._id,
          name: req.user.name
        }
      });
    }

    res.json(updatedModel);
  } catch (error) {
    console.error('Error updating model:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete AI model
router.delete('/models/:id', AuthMiddleware.requireSuperAdmin, AdminActivityLogger.logActivity, async (req, res) => {
  try {
    const { id } = req.params;
    
    const model = await AIModel.findById(id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    await AIModel.findByIdAndDelete(id);
    
    res.json({ message: 'Model deleted successfully' });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Test AI model
router.post('/models/:id/test', AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { prompt, duration = 30, style = '', lyrics = '' } = req.body;
    
    const model = await AIModel.findById(id);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }

    if (model.status !== 'active') {
      return res.status(400).json({ error: 'Model is not active' });
    }

    // Mock test response for now
    // TODO: Implement real model testing with ProviderFactory
    const mockResponse = {
      success: true,
      audioUrl: `https://example.com/test-audio-${Date.now()}.mp3`, // Mock URL
      duration: duration,
      cost: model.pricing?.baseCost || 0,
      processingTime: Math.random() * 20 + 10, // Random 10-30s
      generatedAt: new Date().toISOString()
    };

    res.json(mockResponse);
  } catch (error) {
    console.error('Error testing model:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get Replicate models for dropdown
router.get('/replicate-models', AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    // Backend'deki aktif Replicate modelleri - sadece Google Lyria-2
    const replicateModels = [
      {
        id: 'google/lyria-2',
        name: 'Google Lyria-2',
        description: 'High quality 48kHz stereo music generation with advanced AI capabilities.',
        type: 'music'
      }
    ];

    res.json({ models: replicateModels });
  } catch (error) {
    console.error('Error fetching Replicate models:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===============================
// PLAN MANAGEMENT ENDPOINTS
// ===============================

// Get all plans
router.get('/plans', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    let plans = await Plan.find({})
      .sort({ 'display.order': 1 })
      .populate('availableModels', 'name displayName');

    // If no plans exist, automatically seed default plans
    if (plans.length === 0) {
      const { creditPlans } = require('../scripts/seed-credit-plans');
      await Plan.insertMany(creditPlans);
      logger.info('✅ Default plans auto-seeded on first access');
      
      // Fetch again after seeding
      plans = await Plan.find({})
        .sort({ 'display.order': 1 })
        .populate('availableModels', 'name displayName');
    }

    return ResponseUtil.success(res, plans, 'Plans retrieved successfully');
  } catch (error) {
    logger.error('Failed to fetch plans:', error);
    return ResponseUtil.serverError(res, 'Failed to fetch plans');
  }
});

// Get single plan
router.get('/plans/:id', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const plan = await Plan.findById(req.params.id)
      .populate('availableModels', 'name displayName');

    if (!plan) {
      return ResponseUtil.notFound(res, 'Plan not found');
    }

    return ResponseUtil.success(res, plan, 'Plan retrieved successfully');
  } catch (error) {
    logger.error('Failed to fetch plan:', error);
    return ResponseUtil.serverError(res, 'Failed to fetch plan');
  }
});

// Create new plan
router.post('/plans', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const planData = req.body;
    
    // Generate slug if not provided
    if (!planData.slug && planData.name) {
      planData.slug = planData.name.toLowerCase().replace(/\s+/g, '-');
    }

    const plan = new Plan(planData);
    await plan.save();

    // Publish plan created event
    await EventBus.publishPlanEvent('created', plan, { updatedBy: req.user });

    return ResponseUtil.success(res, plan, 'Plan created successfully');
  } catch (error) {
    if (error.code === 11000) {
      return ResponseUtil.badRequest(res, 'Plan name or slug already exists');
    }
    logger.error('Failed to create plan:', error);
    return ResponseUtil.serverError(res, 'Failed to create plan');
  }
});

// Update plan
router.patch('/plans/:id', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const planId = req.params.id;
    const updateData = req.body;

    const plan = await Plan.findById(planId);
    if (!plan) {
      return ResponseUtil.notFound(res, 'Plan not found');
    }

    // Store old data for comparison
    const oldPlan = plan.toObject();

    // Update plan
    Object.assign(plan, updateData);
    await plan.save();

    // Determine what changed for event
    const changeType = updateData.pricing ? 'pricing' : 'general';
    const priceChanged = oldPlan.pricing?.monthly?.amount !== plan.pricing?.monthly?.amount;

    // Publish plan updated event
    await EventBus.publishPlanEvent('updated', plan, { 
      updatedBy: req.user,
      changeType,
      priceChanged,
      oldPlan
    });

    return ResponseUtil.success(res, plan, 'Plan updated successfully');
  } catch (error) {
    if (error.code === 11000) {
      return ResponseUtil.badRequest(res, 'Plan name or slug already exists');
    }
    logger.error('Failed to update plan:', error);
    return ResponseUtil.serverError(res, 'Failed to update plan');
  }
});

// Delete plan
router.delete('/plans/:id', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const planId = req.params.id;

    const plan = await Plan.findById(planId);
    if (!plan) {
      return ResponseUtil.notFound(res, 'Plan not found');
    }

    // Check if plan is in use
    const subscriptionsCount = await Subscription.countDocuments({ plan: planId });
    if (subscriptionsCount > 0) {
      return ResponseUtil.badRequest(res, `Cannot delete plan with ${subscriptionsCount} active subscriptions`);
    }

    await plan.deleteOne();

    // Publish plan deleted event
    await EventBus.publishPlanEvent('deleted', plan, { updatedBy: req.user });

    return ResponseUtil.success(res, null, 'Plan deleted successfully');
  } catch (error) {
    logger.error('Failed to delete plan:', error);
    return ResponseUtil.serverError(res, 'Failed to delete plan');
  }
});

// Seed default plans
router.post('/plans/seed', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { seedCreditPlans } = require('../scripts/seed-credit-plans');
    await seedCreditPlans();

    return ResponseUtil.success(res, null, 'Default plans seeded successfully');
  } catch (error) {
    logger.error('Failed to seed plans:', error);
    return ResponseUtil.serverError(res, 'Failed to seed plans');
  }
});

// Get plan analytics
router.get('/plans/analytics', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const analytics = await Plan.aggregate([
      {
        $lookup: {
          from: 'subscriptions',
          localField: '_id',
          foreignField: 'plan',
          as: 'subscriptions'
        }
      },
      {
        $project: {
          name: 1,
          displayName: 1,
          'pricing.monthly.amount': 1,
          'credits.monthly': 1,
          status: 1,
          subscriptionCount: { $size: '$subscriptions' },
          activeSubscriptions: {
            $size: {
              $filter: {
                input: '$subscriptions',
                as: 'sub',
                cond: { $eq: ['$$sub.status', 'active'] }
              }
            }
          }
        }
      },
      {
        $sort: { 'display.order': 1 }
      }
    ]);

    return ResponseUtil.success(res, analytics, 'Plan analytics retrieved successfully');
  } catch (error) {
    logger.error('Failed to get plan analytics:', error);
    return ResponseUtil.serverError(res, 'Failed to get plan analytics');
  }
});

// ===============================
// FEATURED MUSIC ENDPOINTS
// ===============================

// Get all featured music for admin
router.get('/featured', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const featuredMusic = await FeaturedMusicService.getAllFeatured();
    return ResponseUtil.success(res, featuredMusic, 'Featured music retrieved successfully');
  } catch (error) {
    logger.error('Failed to get featured music:', error);
    return ResponseUtil.serverError(res, 'Failed to get featured music');
  }
});

// Admin generates music (no credit limits)
router.post('/music/generate', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { prompt, modelId, duration = 30, style = '', lyrics = "" } = req.body;
    
    if (!prompt || !modelId) {
      return ResponseUtil.error(res, 'Prompt and model are required', 400);
    }
    
    // Get AI Model from database (same as user flow)
    const aiModel = await AIModel.findById(modelId);
    if (!aiModel) {
      return ResponseUtil.notFound(res, 'AI Model');
    }
    if (aiModel.status !== 'active') {
      return ResponseUtil.error(res, 'AI Model is not active', 400, 'MODEL_INACTIVE');
    }
    
    // Get provider (same as user flow)
    const provider = ProviderFactory.getProvider(aiModel);
    
    // Generate music (same as user flow)
    const generationParams = {
      prompt,
      duration,
      style,
      lyrics: aiModel.type === 'tts' ? lyrics : undefined
    };
    
    const result = await provider.generateMusic(generationParams);
    
    // Create music record (same as user flow)
    const music = new Music({
      userId: req.user._id,
      title: prompt.substring(0, 50),
      prompt,
      duration,
      style,
      lyrics,
      modelId: aiModel._id,
      modelName: aiModel.displayName,
      provider: aiModel.provider.name,
      providerJobId: result.jobId,
      status: 'processing',
      estimatedTime: result.estimatedTime || 30,
      progress: 0
    });
    
    await music.save();
    
    logger.info('🎵 [ADMIN] Music generation started:', {
      adminId: req.user._id,
      musicId: music._id,
      jobId: result.jobId
    });
    
    // MusicProcessor will handle polling and CDN upload automatically
    
    return ResponseUtil.success(res, music, 'Admin music generation started');
  } catch (error) {
    logger.error('Admin music generation failed:', error);
    return ResponseUtil.serverError(res, 'Failed to generate music');
  }
});

// Proxy audio for admin panel CORS
router.get('/audio-proxy/:musicId', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { musicId } = req.params;
    const music = await Music.findById(musicId);
    
    if (!music || (!music.cdnUrl && !music.audioUrl)) {
      return res.status(404).json({ error: 'Audio not found' });
    }
    
    const audioUrl = music.cdnUrl || music.audioUrl;
    console.log('🎵 [ADMIN-PROXY] Proxying audio:', audioUrl);
    
    // Fetch audio and stream it
    const response = await fetch(audioUrl);
    if (!response.ok) {
      return res.status(404).json({ error: 'Audio file not accessible' });
    }
    
    // Set appropriate headers
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': response.headers.get('content-length'),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    });
    
    // Stream the audio
    response.body.pipe(res);
    
  } catch (error) {
    console.error('❌ [ADMIN-PROXY] Error:', error);
    res.status(500).json({ error: 'Proxy error' });
  }
});

// Get admin's own music
router.get('/music/my-music', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, AdminActivityLogger.logActivity, async (req, res) => {
  try {
    const music = await Music.find({ 
      userId: req.user._id
    })
    .sort({ createdAt: -1 })
    .select('title prompt audioUrl cdnUrl artworkUrl artworkData duration featured status createdAt progress estimatedTime');
    
    return ResponseUtil.success(res, music, 'Admin music retrieved successfully');
  } catch (error) {
    logger.error('Failed to get admin music:', error);
    return ResponseUtil.serverError(res, 'Failed to get admin music');
  }
});

// Delete admin's own music
router.delete('/music/:id', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, AdminActivityLogger.logActivity, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Verify ownership - admin can only delete their own music
    const music = await Music.findOne({ _id: id, userId: req.user._id });
    if (!music) {
      return ResponseUtil.error(res, 'Music not found or unauthorized', 404);
    }
    
    // Delete from CDN if exists
    if (music.cdnUrl) {
      await cloudflareService.deleteFile(music.cdnUrl);
      logger.info('🗑️ [CDN] Music file deleted from CDN:', music.cdnUrl);
    }
    
    // Delete artwork from CDN if exists
    if (music.featured?.artwork?.cdnUrl) {
      await cloudflareService.deleteFile(music.featured.artwork.cdnUrl);
      logger.info('🗑️ [CDN] Artwork deleted from CDN:', music.featured.artwork.cdnUrl);
    }
    
    await Music.deleteOne({ _id: id });
    logger.info('🗑️ [ADMIN] Music deleted:', { musicId: id, adminId: req.user._id });
    
    return ResponseUtil.success(res, null, 'Music deleted successfully');
  } catch (error) {
    logger.error('Failed to delete admin music:', error);
    return ResponseUtil.serverError(res, 'Failed to delete music');
  }
});

// Get music models for admin generation
router.get('/music/models', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const models = await AIModel.find({ 
      type: 'music',
      status: 'active'
    })
    .select('name displayName provider pricing capabilities')
    .sort({ 'display.order': 1 });
    
    return ResponseUtil.success(res, models, 'Music models retrieved');
  } catch (error) {
    logger.error('Failed to get music models:', error);
    return ResponseUtil.serverError(res, 'Failed to get music models');
  }
});

// Get ALL users' music for moderation
router.get('/music/mine', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    // Super admin can see ALL completed music from all users to manage featured content
    const music = await Music.find({ 
      status: 'completed'
    })
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .select('title prompt audioUrl cdnUrl artworkUrl artworkData duration featured status createdAt userId');
    
    return ResponseUtil.success(res, music, 'All completed music retrieved successfully');
  } catch (error) {
    logger.error('Failed to get all music for admin:', error);
    return ResponseUtil.serverError(res, 'Failed to get music');
  }
});

// Set music as featured
router.post('/music/:id/feature', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { category, subcategory, order = 0 } = req.body;
    
    if (!category || !subcategory) {
      return ResponseUtil.badRequest(res, 'Category and subcategory are required');
    }
    
    // Admin can feature any completed music
    const music = await Music.findOne({ _id: id });
    if (!music) {
      return ResponseUtil.notFound(res, 'Music not found');
    }
    
    if (music.status !== 'completed') {
      return ResponseUtil.badRequest(res, 'Only completed music can be featured');
    }
    
    const featuredMusic = await FeaturedMusicService.setFeatured(id, req.user._id, {
      category,
      subcategory,
      order
    });
    
    return ResponseUtil.success(res, featuredMusic, 'Music set as featured successfully');
  } catch (error) {
    logger.error('Failed to set music as featured:', error);
    return ResponseUtil.serverError(res, error.message || 'Failed to set music as featured');
  }
});

// Remove music from featured
router.delete('/music/:id/feature', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Admin can unfeature any music
    const music = await Music.findOne({ _id: id });
    if (!music) {
      return ResponseUtil.notFound(res, 'Music not found');
    }
    
    const updatedMusic = await FeaturedMusicService.unsetFeatured(id, req.user._id);
    
    return ResponseUtil.success(res, updatedMusic, 'Music removed from featured successfully');
  } catch (error) {
    logger.error('Failed to remove music from featured:', error);
    return ResponseUtil.serverError(res, error.message || 'Failed to remove music from featured');
  }
});

// Upload artwork for featured music
router.post('/music/:id/artwork', 
  AuthMiddleware.authenticate, 
  AuthMiddleware.requireSuperAdmin,
  upload.single('artwork'),
  async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!req.file) {
        return ResponseUtil.badRequest(res, 'Artwork file is required');
      }
      
      // Check if music belongs to admin and is featured
      const music = await Music.findOne({ 
        _id: id, 
        userId: req.user._id,
        'featured.isActive': true 
      });
      
      if (!music) {
        return ResponseUtil.notFound(res, 'Featured music not found or not owned by admin');
      }
      
      const result = await FeaturedMusicService.uploadArtwork(
        id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      
      return ResponseUtil.success(res, result, 'Artwork uploaded successfully');
    } catch (error) {
      logger.error('Failed to upload artwork:', error);
      return ResponseUtil.serverError(res, error.message || 'Failed to upload artwork');
    }
  }
);

// Update featured music order
router.put('/featured/reorder', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { updates } = req.body; // [{ musicId, order }, ...]
    
    if (!Array.isArray(updates)) {
      return ResponseUtil.badRequest(res, 'Updates must be an array');
    }
    
    const results = [];
    for (const update of updates) {
      const { musicId, order } = update;
      const updatedMusic = await FeaturedMusicService.updateOrder(musicId, order);
      results.push(updatedMusic);
    }
    
    return ResponseUtil.success(res, results, 'Featured music order updated successfully');
  } catch (error) {
    logger.error('Failed to update featured order:', error);
    return ResponseUtil.serverError(res, 'Failed to update featured order');
  }
});

// Get available categories
router.get('/featured/categories', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const categories = FeaturedMusicService.getCategories();
    return ResponseUtil.success(res, categories, 'Categories retrieved successfully');
  } catch (error) {
    logger.error('Failed to get categories:', error);
    return ResponseUtil.serverError(res, 'Failed to get categories');
  }
});

// Get engagement analytics
router.get('/featured/analytics', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { category, subcategory } = req.query;
    const analytics = await FeaturedMusicService.getEngagementAnalytics(category, subcategory);
    return ResponseUtil.success(res, analytics, 'Analytics retrieved successfully');
  } catch (error) {
    logger.error('Failed to get analytics:', error);
    return ResponseUtil.serverError(res, 'Failed to get analytics');
  }
});

// ===============================
// FEATURED MUSIC EDIT ENDPOINTS
// ===============================

// Update featured music (tags, etc.)
router.put('/featured/:id', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tags, artwork } = req.body;

    // Check if music exists and is featured
    const music = await Music.findOne({ 
      _id: id,
      'featured.isActive': true 
    });

    if (!music) {
      return ResponseUtil.notFound(res, 'Featured music not found');
    }

    // Prepare update object
    const updateData = {};
    
    if (tags && Array.isArray(tags)) {
      updateData['featured.tags'] = tags.filter(tag => tag && tag.trim());
    }
    
    if (artwork) {
      updateData['featured.artwork'] = artwork;
    }

    // Update featured music
    const updatedMusic = await Music.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true }
    );

    // Broadcast featured music update via WebSocket
    const EventBus = require('../services/events/EventBus');
    EventBus.publish('websocket.broadcast', {
      type: 'featured_music_updated',
      targetRoom: 'users',
      musicId: id,
      music: {
        _id: updatedMusic._id,
        title: updatedMusic.title,
        featured: updatedMusic.featured
      }
    });

    logger.info(`📝 [FEATURED] Updated featured music ${id} with tags: ${tags?.join(', ')}`);

    return ResponseUtil.success(res, updatedMusic, 'Featured music updated successfully');

  } catch (error) {
    logger.error('Failed to update featured music:', error);
    return ResponseUtil.serverError(res, 'Failed to update featured music');
  }
});

// ===============================
// DASHBOARD ANALYTICS ENDPOINT
// ===============================

// Get dashboard analytics
router.get('/analytics/dashboard', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Basic counts
    const [
      totalUsers,
      activeUsers,
      totalMusic,
      totalModels,
      activeModels,
      totalSubscriptions,
      recentMusic,
      recentUsers
    ] = await Promise.all([
      User.countDocuments({ status: { $ne: 'deleted' } }),
      User.countDocuments({ status: 'active' }),
      Music.countDocuments(),
      AIModel.countDocuments(),
      AIModel.countDocuments({ status: 'active' }),
      Subscription.countDocuments(),
      Music.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } })
    ]);

    // Music generation stats
    const musicStats = await Music.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // User role distribution
    const userRoles = await User.aggregate([
      {
        $match: { status: { $ne: 'deleted' } }
      },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    // Recent activity (last 7 days) - fill missing days
    const dailyStatsRaw = await Music.aggregate([
      {
        $match: {
          createdAt: { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Create full 7-day array
    const dailyStats = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const existing = dailyStatsRaw.find(d => d._id === dateStr);
      dailyStats.push({
        _id: dateStr,
        count: existing ? existing.count : 0
      });
    }

    // Plan distribution
    const planStats = await Subscription.aggregate([
      {
        $lookup: {
          from: 'plans',
          localField: 'plan',
          foreignField: '_id',
          as: 'planInfo'
        }
      },
      {
        $group: {
          _id: {
            $ifNull: [
              { $arrayElemAt: ['$planInfo.displayName', 0] },
              { $arrayElemAt: ['$planInfo.name', 0] },
              '$plan'
            ]
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Top models by usage
    const topModels = await AIModel.find({ status: 'active' })
      .sort({ 'stats.totalUsage': -1 })
      .limit(5)
      .select('displayName stats.totalUsage stats.successRate');

    const analytics = {
      overview: {
        totalUsers,
        activeUsers,
        totalMusic,
        totalModels,
        activeModels,
        totalSubscriptions,
        newUsersThisWeek: recentUsers,
        newMusicThisMonth: recentMusic
      },
      musicStats: musicStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      userRoles: userRoles.reduce((acc, role) => {
        acc[role._id] = role.count;
        return acc;
      }, {}),
      dailyActivity: dailyStats,
      planDistribution: planStats.reduce((acc, plan) => {
        acc[plan._id] = plan.count;
        return acc;
      }, {}),
      topModels: topModels.map(model => ({
        name: model.displayName.replace('Google ', '').replace('-', ' '),
        usage: model.stats.totalUsage || 0,
        successRate: Math.round(model.stats.successRate || 100)
      }))
    };

    return ResponseUtil.success(res, analytics, 'Dashboard analytics retrieved successfully');
  } catch (error) {
    logger.error('Failed to get dashboard analytics:', error);
    return ResponseUtil.serverError(res, 'Failed to get dashboard analytics');
  }
});

// Get detailed analytics
router.get('/analytics/detailed', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const now = new Date();
    
    let daysAgo;
    switch (period) {
      case '7d': daysAgo = 7; break;
      case '30d': daysAgo = 30; break;
      case '90d': daysAgo = 90; break;
      default: daysAgo = 30;
    }
    
    const startDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    // User growth over time
    const userGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate },
          status: { $ne: 'deleted' }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          newUsers: { $sum: 1 }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Music generation trends
    const musicTrends = await Music.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            status: '$status'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Model performance stats
    const modelPerformance = await AIModel.aggregate([
      {
        $match: { status: 'active' }
      },
      {
        $project: {
          displayName: 1,
          'stats.totalUsage': 1,
          'stats.successRate': 1,
          'stats.averageProcessingTime': 1,
          'performance.averageLatency': 1
        }
      },
      { $sort: { 'stats.totalUsage': -1 } }
    ]);

    // User role analytics
    const roleAnalytics = await User.aggregate([
      {
        $match: { status: { $ne: 'deleted' } }
      },
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 },
          activeCount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
            }
          }
        }
      }
    ]);

    // Subscription analytics
    const subscriptionAnalytics = await Subscription.aggregate([
      {
        $lookup: {
          from: 'plans',
          localField: 'plan',
          foreignField: '_id',
          as: 'planInfo'
        }
      },
      {
        $group: {
          _id: {
            plan: {
              $ifNull: [
                { $arrayElemAt: ['$planInfo.displayName', 0] },
                { $arrayElemAt: ['$planInfo.name', 0] },
                '$plan'
              ]
            },
            status: '$status'
          },
          count: { $sum: 1 },
          totalCredits: { $sum: '$credits' }
        }
      }
    ]);

    // Top users by activity
    const topUsers = await Music.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$userId',
          musicCount: { $sum: 1 },
          completedCount: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $project: {
          userName: { $arrayElemAt: ['$user.name', 0] },
          userEmail: { $arrayElemAt: ['$user.email', 0] },
          musicCount: 1,
          completedCount: 1,
          successRate: {
            $multiply: [
              { $divide: ['$completedCount', '$musicCount'] },
              100
            ]
          }
        }
      },
      { $sort: { musicCount: -1 } },
      { $limit: 10 }
    ]);

    const analytics = {
      period,
      userGrowth,
      musicTrends,
      modelPerformance,
      roleAnalytics,
      subscriptionAnalytics,
      topUsers
    };

    return ResponseUtil.success(res, analytics, 'Detailed analytics retrieved successfully');
  } catch (error) {
    logger.error('Failed to get detailed analytics:', error);
    return ResponseUtil.serverError(res, 'Failed to get detailed analytics');
  }
});

// ===============================
// USER CREDIT MANAGEMENT
// ===============================

// Get user credits
router.get('/users/:id/credits', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return ResponseUtil.notFound(res, 'User not found');
    }

    return ResponseUtil.success(res, {
      userId: user._id,
      email: user.email,
      credits: user.credits || 0
    }, 'User credits retrieved successfully');
  } catch (error) {
    logger.error('Failed to get user credits:', error);
    return ResponseUtil.serverError(res, 'Failed to get user credits');
  }
});

// Add credits to user
router.post('/users/:id/credits/add', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    
    if (!amount || amount <= 0) {
      return ResponseUtil.badRequest(res, 'Valid amount is required');
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return ResponseUtil.notFound(res, 'User not found');
    }

    // Find user's subscription
    let subscription = await Subscription.findOne({ 
      user: req.params.id,
      status: { $in: ['active', 'trialing'] }
    });

    if (!subscription) {
      // Create a basic subscription if user doesn't have one
      const freePlan = await Plan.findOne({ slug: 'free' });
      subscription = new Subscription({
        user: req.params.id,
        plan: freePlan?._id,
        planName: 'Free',
        status: 'active',
        credits: {
          monthly: 0,
          used: 0,
          rollover: 0
        }
      });
      await subscription.save();
    }

    const previousCredits = subscription.getAvailableCredits();
    
    // Add credits to subscription using the addCredits method
    subscription.addCredits(amount, reason || 'Admin manual addition', {
      addedBy: req.user.email,
      timestamp: new Date()
    });
    
    await subscription.save();

    // Log admin activity
    logger.info(`Admin ${req.user.email} added ${amount} credits to user ${user.email}. Previous: ${previousCredits}, New: ${subscription.getAvailableCredits()}. Reason: ${reason || 'No reason provided'}`);

    return ResponseUtil.success(res, {
      userId: user._id,
      email: user.email,
      previousCredits,
      newCredits: subscription.getAvailableCredits(),
      addedAmount: amount,
      reason: reason || null
    }, `Successfully added ${amount} credits to user`);
  } catch (error) {
    logger.error('Failed to add credits to user:', error);
    return ResponseUtil.serverError(res, 'Failed to add credits');
  }
});

// Set user credits (override)
router.post('/users/:id/credits/set', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    
    if (amount < 0) {
      return ResponseUtil.badRequest(res, 'Credit amount cannot be negative');
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return ResponseUtil.notFound(res, 'User not found');
    }

    // Find user's subscription
    let subscription = await Subscription.findOne({ 
      user: req.params.id,
      status: { $in: ['active', 'trialing'] }
    });

    if (!subscription) {
      // Create a basic subscription if user doesn't have one
      const freePlan = await Plan.findOne({ slug: 'free' });
      subscription = new Subscription({
        user: req.params.id,
        plan: freePlan?._id,
        planName: 'Free',
        status: 'active',
        credits: {
          monthly: 0,
          used: 0,
          rollover: 0
        }
      });
      await subscription.save();
    }

    const previousCredits = subscription.getAvailableCredits();
    
    // Set credits directly (override current amount)
    subscription.credits.monthly = amount;
    subscription.credits.used = 0; // Reset usage when setting credits
    
    // Add history entry
    subscription.credits.history.push({
      date: new Date(),
      service: 'admin',
      amount: amount - previousCredits,
      operation: 'added',
      metadata: { 
        reason: reason || 'Admin manual override',
        setBy: req.user.email,
        previousAmount: previousCredits,
        newAmount: amount
      }
    });
    
    await subscription.save();

    // Log admin activity
    logger.info(`Admin ${req.user.email} set user ${user.email} credits to ${amount}. Previous: ${previousCredits}. Reason: ${reason || 'No reason provided'}`);

    return ResponseUtil.success(res, {
      userId: user._id,
      email: user.email,
      previousCredits,
      newCredits: subscription.getAvailableCredits(),
      reason: reason || null
    }, `Successfully set user credits to ${amount}`);
  } catch (error) {
    logger.error('Failed to set user credits:', error);
    return ResponseUtil.serverError(res, 'Failed to set credits');
  }
});

// Bulk add credits to all users
router.post('/users/credits/bulk-add', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const { amount, reason } = req.body;
    
    if (!amount || amount <= 0) {
      return ResponseUtil.badRequest(res, 'Valid amount is required');
    }

    const users = await User.find({});
    let updatedCount = 0;

    for (const user of users) {
      const previousCredits = user.credits || 0;
      user.credits = previousCredits + amount;
      await user.save();
      updatedCount++;
    }

    // Log admin activity
    logger.info(`Admin ${req.user.email} added ${amount} credits to ${updatedCount} users. Reason: ${reason || 'No reason provided'}`);

    return ResponseUtil.success(res, {
      updatedUsers: updatedCount,
      addedAmount: amount,
      reason: reason || null
    }, `Successfully added ${amount} credits to ${updatedCount} users`);
  } catch (error) {
    logger.error('Failed to bulk add credits:', error);
    return ResponseUtil.serverError(res, 'Failed to bulk add credits');
  }
});

module.exports = router;