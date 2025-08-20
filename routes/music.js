const express = require('express');
const router = express.Router();

const AuthMiddleware = require('../middleware/auth-unified');
const CreditLimitMiddleware = require('../middleware/credit-limit');
const ResponseUtil = require('../utils/response');

const Music = require('../models/Music');
const AIModel = require('../models/AIModel');
const User = require('../models/User');
const Usage = require('../models/Usage');
const ProviderFactory = require('../services/ProviderFactory');
const cloudflareService = require('../services/cloudflare');
const CreditService = require('../services/CreditService');
const FeaturedMusicService = require('../services/FeaturedMusicService');
const ArtworkGenerationService = require('../services/ArtworkGenerationService');
const { body, validationResult } = require('express-validator');

// Get active AI models for frontend
router.get('/models', 
  AuthMiddleware.authenticate,
  CreditLimitMiddleware.addCreditHeaders(),
  async (req, res) => {
    try {
      const models = await AIModel.find({ 
        status: 'active',
        type: { $in: ['music', 'tts'] }
      })
      .select('_id name displayName description type provider pricing capabilities')
      .sort({ 'display.order': 1, displayName: 1 });

      return ResponseUtil.success(res, models, 'Active models retrieved successfully');
      
    } catch (error) {
      return ResponseUtil.error(res, 'Failed to fetch models', 500, 'MODELS_FETCH_ERROR');
    }
  });

// Generate music with credit control
router.post('/generate', 
  AuthMiddleware.authenticate,
  [
    body('prompt').notEmpty().trim().escape(),
    body('modelId').notEmpty().withMessage('Model ID is required'),
    body('duration').optional().isInt({ min: 10, max: 240 }).toInt()
  ],
  CreditLimitMiddleware.validateOperationLimits('music'),
  CreditLimitMiddleware.checkConcurrentLimit('music'),
  CreditLimitMiddleware.requireCredits('music', (req) => ({
    duration: req.body.duration || 30
  })),
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return ResponseUtil.validationError(res, errors.array());
    }

    const { prompt, modelId, duration = 30, style = '', lyrics = "" } = req.body;
    
    console.log('🎵 [DEBUG] Request body:', { modelId, prompt: prompt?.substring(0, 30) });

    // 1. Get AI Model from database
    const aiModel = await AIModel.findById(modelId);
    
    if (aiModel) {
      console.log('🎵 [DEBUG] AI Model found:', {
        name: aiModel.name,
        displayName: aiModel.displayName,
        modelId: aiModel.provider?.modelId
      });
    } else {
      console.log('🎵 [DEBUG] AI Model NOT found for ID:', modelId);
    }
    if (!aiModel) {
      return ResponseUtil.notFound(res, 'AI Model');
    }

    if (aiModel.status !== 'active') {
      return ResponseUtil.error(res, 'AI Model is not active', 400, 'MODEL_INACTIVE');
    }

    // 2. Get appropriate provider for this model
    const provider = ProviderFactory.getProvider(aiModel);

    // 3. Generate music using provider
    const generationParams = {
      prompt,
      duration,
      style,
      lyrics: aiModel.type === 'tts' ? lyrics : undefined
    };

    const result = await provider.generateMusic(generationParams);

    // 4. Generate artwork for the music
    console.log('🎨 [GENERATE] Generating artwork for music...');
    const artworkData = await ArtworkGenerationService.generateArtworkFromPrompt(
      prompt, 
      null, // genre 
      null, // mood
      null  // musicId - will be set after saving
    );

    // 4. Create music record with initial status
    const music = new Music({
      userId: req.user._id,
      title: prompt.substring(0, 50), // Initial title
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
      progress: 0,
      artworkData: artworkData,
      artworkUrl: artworkData?.style?.background || artworkData?.gradient
    });

    await music.save();

    // 5. Upload SVG artwork to CDN with musicId
    try {
      console.log('🎨 [GENERATE] Uploading SVG artwork to CDN...');
      const updatedArtwork = await ArtworkGenerationService.generateArtworkFromPrompt(
        prompt, 
        null, // genre 
        null, // mood
        music._id.toString()  // Now we have musicId
      );
      
      if (updatedArtwork.cdnUrl) {
        music.artworkData = updatedArtwork;
        music.artworkUrl = updatedArtwork.cdnUrl;
        await music.save();
        console.log('✅ [GENERATE] SVG artwork uploaded to CDN:', updatedArtwork.cdnUrl);
      }
    } catch (artworkError) {
      console.error('❌ [GENERATE] Artwork upload failed:', artworkError);
      // Continue without CDN artwork
    }

    // 6. Update AI Model usage statistics
    await aiModel.updateUsage(true);

    // 7. Credits will be deducted when music completes successfully (in MusicProcessor)
    // This ensures failed generations don't consume credits

    // 8. Create usage record
    await Usage.createUsageRecord({
      userId: req.user.id,
      service: 'music',
      operation: 'generate',
      model: aiModel,
      input: {
        text: prompt,
        characters: prompt.length,
        duration: duration
      },
      output: {
        duration: duration,
        format: 'audio/mpeg',
        url: music.audioUrl
      },
      parameters: {
        style,
        lyrics: lyrics?.substring(0, 100)
      },
      performance: {
        processingTime: result.estimatedTime * 1000,
        success: true
      },
      provider: {
        name: aiModel.provider.name,
        requestId: result.jobId
      },
      metadata: {
        requestId: music._id.toString(),
        endpoint: '/api/music/generate',
        method: 'POST'
      },
      credits: req.creditInfo.cost,
      creditCalculation: {
        service: 'music',
        baseRate: req.creditInfo.cost,
        parameters: { duration }
      },
      plan: await CreditService.getPlanFromCache(req.creditInfo.plan.id)
    });

    return ResponseUtil.success(res, {
      _id: music._id,
      title: music.title,
      prompt: music.prompt,
      audioUrl: music.audioUrl,
      cdnUrl: music.cdnUrl,
      artworkUrl: music.artworkUrl,
      artworkData: music.artworkData,
      alternativeUrl: music.alternativeUrl,
      duration: music.duration,
      status: music.status,
      createdAt: music.createdAt,
      credits: {
        reserved: req.creditInfo.cost,
        status: 'pending_completion'
      }
    }, 'Music generation started successfully');
  } catch (error) {
    console.error('❌ [GENERATE] Error:', error);
    return ResponseUtil.error(res, 'Failed to generate music', 500, 'GENERATION_ERROR', error.message);
  }
});

// Get user's music (both endpoints for compatibility)
router.get('/', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const music = await Music.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20);

    return ResponseUtil.success(res, music, 'User music retrieved successfully');
  } catch (error) {
    console.error('❌ [FETCH] Error:', error);
    return ResponseUtil.error(res, 'Failed to fetch music', 500, 'FETCH_ERROR');
  }
});

router.get('/my-music', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const music = await Music.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Music.countDocuments({ userId: req.user._id });

    return ResponseUtil.paginated(res, music, { page, limit, total }, 'User music retrieved successfully');
  } catch (error) {
    console.error('❌ [MY-MUSIC] Error:', error);
    return ResponseUtil.error(res, 'Failed to fetch user music', 500, 'FETCH_ERROR');
  }
});


// Get single music
router.get('/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const music = await Music.findById(req.params.id);
    
    if (!music) {
      return ResponseUtil.notFound(res, 'Music');
    }

    // Check if user owns this music or it's public
    if (music.userId.toString() !== req.user._id.toString() && !music.isPublic) {
      return ResponseUtil.forbidden(res, 'You do not have access to this music');
    }

    // Increment plays
    music.plays += 1;
    await music.save();

    return ResponseUtil.success(res, music, 'Music retrieved successfully');
  } catch (error) {
    console.error('❌ [GET-MUSIC] Error:', error);
    return ResponseUtil.error(res, 'Failed to fetch music', 500, 'FETCH_ERROR');
  }
});

// Delete music
router.delete('/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const music = await Music.findById(req.params.id);
    
    if (!music) {
      return ResponseUtil.notFound(res, 'Music');
    }

    // Check ownership
    if (music.userId.toString() !== req.user._id.toString()) {
      return ResponseUtil.forbidden(res, 'You can only delete your own music');
    }

    // Delete from CDN
    await cloudflareService.deleteFile(music.fileUrl);

    // Delete from database
    await music.deleteOne();

    return ResponseUtil.success(res, null, 'Music deleted successfully');
  } catch (error) {
    console.error('❌ [DELETE] Error:', error);
    return ResponseUtil.error(res, 'Failed to delete music', 500, 'DELETE_ERROR');
  }
});

// Like/unlike music
router.post('/:id/like', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const music = await Music.findById(req.params.id);
    
    if (!music) {
      return ResponseUtil.notFound(res, 'Music');
    }

    const userIndex = music.likes.indexOf(req.user._id);
    
    if (userIndex > -1) {
      // Unlike
      music.likes.splice(userIndex, 1);
    } else {
      // Like
      music.likes.push(req.user._id);
    }

    await music.save();

    return ResponseUtil.success(res, { 
      liked: userIndex === -1,
      likes: music.likes.length 
    }, userIndex === -1 ? 'Music liked' : 'Music unliked');
  } catch (error) {
    console.error('❌ [LIKE] Error:', error);
    return ResponseUtil.error(res, 'Failed to update like status', 500, 'LIKE_ERROR');
  }
});

// Get user's credit information
router.get('/credits/info', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const creditInfo = await CreditService.getUserCreditInfo(req.user.id);
    return ResponseUtil.success(res, creditInfo, 'Credit information retrieved successfully');
  } catch (error) {
    return ResponseUtil.error(res, 'Failed to fetch credit information', 500, 'CREDIT_INFO_ERROR');
  }
});

// Calculate credit cost for operation
router.post('/credits/calculate', AuthMiddleware.authenticate, [
  body('service').isIn(['tts', 'music', 'voice-clone-creation', 'voice-clone-usage', 'voice-isolator']),
  body('duration').optional().isInt({ min: 1, max: 600 }),
  body('characterCount').optional().isInt({ min: 1, max: 10000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return ResponseUtil.validationError(res, errors.array());
    }

    const { service, duration, characterCount } = req.body;
    const params = { duration, characterCount };

    const creditInfo = await CreditService.getUserCreditInfo(req.user.id);
    const cost = await CreditService.calculateCreditCost(creditInfo.plan.id, service, params);
    const hasEnough = creditInfo.available >= cost;

    return ResponseUtil.success(res, {
      service,
      parameters: params,
      cost,
      available: creditInfo.available,
      hasEnoughCredits: hasEnough,
      shortfall: hasEnough ? 0 : cost - creditInfo.available
    }, 'Credit cost calculated successfully');
  } catch (error) {
    return ResponseUtil.error(res, 'Failed to calculate credit cost', 500, 'CREDIT_CALC_ERROR');
  }
});

// ===============================
// FEATURED MUSIC PUBLIC ENDPOINTS
// ===============================

// Get featured music for main app discovery page
router.get('/discover', async (req, res) => {
  try {
    const { category, subcategory, limit = 6 } = req.query;
    
    if (!category) {
      return ResponseUtil.badRequest(res, 'Category parameter is required');
    }
    
    const featuredMusic = await FeaturedMusicService.getFeaturedByCategory(
      category, 
      subcategory, 
      parseInt(limit)
    );
    
    return ResponseUtil.success(res, featuredMusic, 'Featured music retrieved successfully');
  } catch (error) {
    console.error('❌ [FEATURED] Error:', error);
    return ResponseUtil.error(res, 'Failed to fetch featured music', 500, 'FEATURED_ERROR');
  }
});

// Get available categories for frontend
router.get('/featured/categories', async (req, res) => {
  try {
    const categories = FeaturedMusicService.getCategories();
    return ResponseUtil.success(res, categories, 'Categories retrieved successfully');
  } catch (error) {
    console.error('❌ [CATEGORIES] Error:', error);
    return ResponseUtil.error(res, 'Failed to fetch categories', 500, 'CATEGORIES_ERROR');
  }
});

// Track engagement (view, play, download)
router.post('/featured/:id/engage', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'view', 'play', 'download'
    
    if (!action || !['view', 'play', 'download'].includes(action)) {
      return ResponseUtil.badRequest(res, 'Valid action is required: view, play, or download');
    }
    
    await FeaturedMusicService.trackEngagement(id, action);
    
    return ResponseUtil.success(res, null, `${action} tracked successfully`);
  } catch (error) {
    console.error('❌ [ENGAGEMENT] Error:', error);
    return ResponseUtil.error(res, 'Failed to track engagement', 500, 'ENGAGEMENT_ERROR');
  }
});

module.exports = router;