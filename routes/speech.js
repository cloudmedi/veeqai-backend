const express = require('express');
const router = express.Router();
const AuthMiddleware = require('../middleware/auth-unified');
const ResponseUtil = require('../utils/response');
const Speech = require('../models/Speech');
const User = require('../models/User');
const replicateService = require('../services/replicate');
const cloudflareService = require('../services/cloudflare');
const { body, validationResult } = require('express-validator');

// Generate speech
router.post('/generate', AuthMiddleware.authenticate, [
  body('text').notEmpty().trim().isLength({ max: 5000 }),
  body('voiceId').notEmpty(),
  body('voiceName').notEmpty(),
  body('model').optional().isIn(['speech-2.5-hd', 'speech-2.5', 'speech-1.0'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { text, voiceId, voiceName, model = 'speech-2.5-hd', language = 'en' } = req.body;
    const creditsNeeded = 5;

    // Check user credits
    if (req.user.credits < creditsNeeded) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        creditsNeeded,
        creditsAvailable: req.user.credits
      });
    }

    // Check voice slots
    if (req.user.voiceSlots.used >= req.user.voiceSlots.total) {
      return res.status(402).json({ 
        error: 'Voice slot limit reached',
        slotsUsed: req.user.voiceSlots.used,
        slotsTotal: req.user.voiceSlots.total
      });
    }

    // Generate speech with Replicate (or another TTS service)
    const audioUrl = await replicateService.generateSpeech(text, voiceId, model);

    // Upload to Cloudflare CDN
    const cdnUrl = await cloudflareService.uploadAudio(audioUrl, `speech-${Date.now()}.mp3`);

    // Create speech record
    const speech = new Speech({
      userId: req.user._id,
      text,
      voiceId,
      voiceName,
      fileUrl: cdnUrl,
      duration: Math.ceil(text.length / 150) * 60, // Rough estimate
      language,
      model,
      credits: creditsNeeded
    });

    await speech.save();

    // Deduct credits and update voice slots
    req.user.credits -= creditsNeeded;
    req.user.voiceSlots.used += 1;
    await req.user.save();

    res.json({
      speech: {
        id: speech._id,
        text: speech.text,
        voiceName: speech.voiceName,
        fileUrl: speech.fileUrl,
        duration: speech.duration,
        createdAt: speech.createdAt
      },
      creditsRemaining: req.user.credits,
      voiceSlotsRemaining: req.user.voiceSlots.total - req.user.voiceSlots.used
    });
  } catch (error) {
    console.error('Speech generation error:', error);
    res.status(500).json({ error: 'Error generating speech' });
  }
});

// Get user's speeches
router.get('/my-speeches', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const speeches = await Speech.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Speech.countDocuments({ userId: req.user._id });

    res.json({
      speeches,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching speeches' });
  }
});

// Get single speech
router.get('/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const speech = await Speech.findById(req.params.id);
    
    if (!speech) {
      return res.status(404).json({ error: 'Speech not found' });
    }

    // Check if user owns this speech or it's public
    if (speech.userId.toString() !== req.user._id.toString() && !speech.isPublic) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(speech);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching speech' });
  }
});

// Delete speech
router.delete('/:id', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const speech = await Speech.findById(req.params.id);
    
    if (!speech) {
      return res.status(404).json({ error: 'Speech not found' });
    }

    // Check ownership
    if (speech.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete from CDN
    await cloudflareService.deleteFile(speech.fileUrl);

    // Delete from database
    await speech.deleteOne();

    // Update voice slots
    req.user.voiceSlots.used = Math.max(0, req.user.voiceSlots.used - 1);
    await req.user.save();

    res.json({ 
      message: 'Speech deleted successfully',
      voiceSlotsRemaining: req.user.voiceSlots.total - req.user.voiceSlots.used
    });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting speech' });
  }
});

// Get available voices
router.get('/voices/list', async (req, res) => {
  try {
    // This would typically come from a database or API
    const voices = [
      { id: 'voice-1', name: 'Trustworthy Man', language: 'en', type: 'male' },
      { id: 'voice-2', name: 'Captivating Storyteller', language: 'en', type: 'male' },
      { id: 'voice-3', name: 'Graceful Lady', language: 'en', type: 'female' },
      { id: 'voice-4', name: 'Whispering Girl', language: 'en', type: 'female' },
      // Add more voices as needed
    ];

    res.json(voices);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching voices' });
  }
});

module.exports = router;