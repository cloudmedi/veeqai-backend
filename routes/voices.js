const express = require('express');
const router = express.Router();
const multer = require('multer');
const VoiceModel = require('../models/VoiceModel');
const Speech = require('../models/Speech');
const AuthMiddleware = require('../middleware/auth-unified');
const cloudflareService = require('../services/cloudflare');
const Replicate = require('replicate');

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Multer configuration for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Mood fields for multi-mood upload
    const moodFields = ['commercial', 'corporate', 'professional', 'news', 'documentary', 'educational', 'storytelling', 'energetic', 'calm', 'friendly'];
    
    if (file.fieldname === 'audioFile' && file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else if (file.fieldname === 'artworkFile' && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (moodFields.includes(file.fieldname) && file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio and image files are allowed'), false);
    }
  }
});

// Get all active voices (public)
router.get('/list', async (req, res) => {
  try {
    const voices = await VoiceModel.find({ isActive: true })
      .select('name description gender age language previewUrl artwork')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      voices: voices
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

// Get voices grouped by base name (for Voice Library)
router.get('/list-grouped', async (req, res) => {
  try {
    const voices = await VoiceModel.find({ isActive: true })
      .select('name description gender age language previewUrl artwork baseVoiceName mood isPartOfGroup groupId')
      .sort({ createdAt: -1 });
    
    // Group voices by baseVoiceName
    const grouped = {};
    
    voices.forEach(voice => {
      if (voice.isPartOfGroup) {
        const baseName = voice.baseVoiceName;
        if (!grouped[baseName]) {
          grouped[baseName] = {
            name: baseName,
            description: voice.description,
            gender: voice.gender,
            age: voice.age,
            language: voice.language,
            artwork: voice.artwork,
            isGroup: true,
            moods: [],
            groupId: voice.groupId
          };
        }
        grouped[baseName].moods.push({
          mood: voice.mood,
          _id: voice._id,
          audioFile: voice.audioFile
        });
      } else {
        // Single voice
        grouped[voice.name] = {
          ...voice.toObject(),
          isGroup: false,
          moods: []
        };
      }
    });
    
    // Convert to array
    const groupedArray = Object.values(grouped);
    
    res.json({
      success: true,
      voices: groupedArray
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch grouped voices' });
  }
});

// Get available moods for a specific voice
router.get('/moods/:baseVoiceName', async (req, res) => {
  try {
    const voices = await VoiceModel.find({ 
      baseVoiceName: req.params.baseVoiceName,
      isActive: true,
      isPartOfGroup: true 
    }).select('mood _id');
    
    const moods = voices.map(v => ({
      mood: v.mood,
      voiceId: v._id
    }));
    
    res.json({
      success: true,
      moods
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch voice moods' });
  }
});

// Get voice preview
router.get('/preview/:id', async (req, res) => {
  try {
    const voice = await VoiceModel.findById(req.params.id);
    if (!voice) {
      return res.status(404).json({ error: 'Voice not found' });
    }
    
    res.json({
      success: true,
      name: voice.name,
      previewUrl: voice.previewUrl || voice.audioFile
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get preview' });
  }
});

// Generate TTS
router.post('/generate-tts', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const { text, voiceId, mood } = req.body;
    
    if (!text || !voiceId) {
      return res.status(400).json({ error: 'Text and voiceId required' });
    }
    
    let voice;
    
    // Check if voiceId is ObjectId or group name
    try {
      // First try as ObjectId for single voices
      voice = await VoiceModel.findById(voiceId);
    } catch (err) {
      // Not an ObjectId, try as baseVoiceName for groups
      voice = null;
    }
    
    if (!voice) {
      // Try finding by baseVoiceName and mood for multi-mood groups
      if (mood) {
        voice = await VoiceModel.findOne({ 
          baseVoiceName: voiceId, 
          mood: mood,
          isActive: true 
        });
      } else {
        // Try finding first available mood for this group (sorted for consistency)
        voice = await VoiceModel.findOne({ 
          baseVoiceName: voiceId,
          isActive: true 
        }).sort({ mood: 1, createdAt: 1 });
      }
    }
    
    if (!voice) {
      return res.status(404).json({ error: 'Voice not found' });
    }
    
    // Generate with Resemble-AI Chatterbox
    const output = await replicate.run(
      "resemble-ai/chatterbox",
      {
        input: {
          prompt: text,
          audio_prompt: voice.audioFile,
          seed: 0,
          cfg_weight: 0.5,
          temperature: 0.8,
          exaggeration: 0.5
        }
      }
    );
    
    // Upload to CDN
    const timestamp = Date.now();
    const fileName = `tts_${req.user._id}_${timestamp}.mp3`;
    const cdnUrl = await cloudflareService.uploadAudio(output, fileName, 'VeeqAI/Text_to_Speech');
    
    // Save to database
    const speech = new Speech({
      userId: req.user._id,
      text: text,
      voiceId: voice.name,
      voiceName: voice.name,
      audioUrl: cdnUrl,
      model: 'chatterbox',
      status: 'completed'
    });
    await speech.save();
    
    // Update voice usage
    voice.usageCount += 1;
    await voice.save();
    
    res.json({
      success: true,
      audioUrl: cdnUrl,
      speechId: speech._id
    });
  } catch (error) {
    console.error('TTS Generation Error:', error);
    res.status(500).json({ error: 'TTS generation failed: ' + error.message });
  }
});

// Admin: Upload and clone voice (Single Mode)
router.post('/admin/upload', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, upload.fields([
  { name: 'audioFile', maxCount: 1 },
  { name: 'artworkFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, description, gender, age } = req.body;
    const audioFile = req.files?.audioFile?.[0];
    const artworkFile = req.files?.artworkFile?.[0];
    
    if (!name || !audioFile) {
      return res.status(400).json({ error: 'Name and audio file required' });
    }
    
    // Upload original audio file to CDN
    const timestamp = Date.now();
    const originalFileName = `${name}_${timestamp}_original.${audioFile.originalname.split('.').pop()}`;
    const originalPath = `VeeqAI/Voice_Clone/${originalFileName}`;
    const cdnOriginal = await cloudflareService.uploadFromBuffer(audioFile.buffer, originalPath);
    
    // Upload artwork if provided
    let artworkUrl = null;
    if (artworkFile) {
      const artworkFileName = `${name}_${timestamp}_artwork.${artworkFile.originalname.split('.').pop()}`;
      const artworkPath = `VeeqAI/Artwork/${artworkFileName}`;
      artworkUrl = await cloudflareService.uploadFromBuffer(artworkFile.buffer, artworkPath);
    }
    
    // Create voice model
    const voiceModel = new VoiceModel({
      name,
      description: description || `${name} sesi`,
      audioFile: cdnOriginal,
      previewUrl: cdnOriginal,
      artwork: artworkUrl,
      gender: gender || 'neutral',
      age: age || 'adult',
      language: 'tr',
      isActive: true
    });
    
    await voiceModel.save();
    
    res.json({
      success: true,
      voice: voiceModel
    });
  } catch (error) {
    console.error('Voice upload error:', error);
    res.status(500).json({ error: 'Voice upload failed: ' + error.message });
  }
});

// Admin: Upload Multi-Mood Voice Group
router.post('/admin/upload-group', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, upload.fields([
  { name: 'commercial', maxCount: 1 },
  { name: 'corporate', maxCount: 1 },
  { name: 'professional', maxCount: 1 },
  { name: 'news', maxCount: 1 },
  { name: 'documentary', maxCount: 1 },
  { name: 'educational', maxCount: 1 },
  { name: 'storytelling', maxCount: 1 },
  { name: 'energetic', maxCount: 1 },
  { name: 'calm', maxCount: 1 },
  { name: 'friendly', maxCount: 1 },
  { name: 'artworkFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const { baseVoiceName, description, gender, age } = req.body;
    const artworkFile = req.files?.artworkFile?.[0];
    
    if (!baseVoiceName) {
      return res.status(400).json({ error: 'Base voice name required' });
    }
    
    // Check if any mood files uploaded
    const moodFiles = ['commercial', 'corporate', 'professional', 'news', 'documentary', 'educational', 'storytelling', 'energetic', 'calm', 'friendly'];
    const uploadedMoods = moodFiles.filter(mood => req.files?.[mood]?.[0]);
    
    if (uploadedMoods.length === 0) {
      return res.status(400).json({ error: 'At least one mood file required' });
    }
    
    // Upload artwork if provided
    let artworkUrl = null;
    if (artworkFile) {
      const timestamp = Date.now();
      const artworkFileName = `${baseVoiceName}_${timestamp}_artwork.${artworkFile.originalname.split('.').pop()}`;
      const artworkPath = `VeeqAI/Artwork/${artworkFileName}`;
      artworkUrl = await cloudflareService.uploadFromBuffer(artworkFile.buffer, artworkPath);
    }
    
    // Generate group ID
    const groupId = `${baseVoiceName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
    const createdVoices = [];
    
    // Upload each mood file
    for (const mood of uploadedMoods) {
      const moodFile = req.files[mood][0];
      const timestamp = Date.now();
      const moodFileName = `${baseVoiceName}_${mood}_${timestamp}.${moodFile.originalname.split('.').pop()}`;
      const moodPath = `VeeqAI/Voice_Clone/${moodFileName}`;
      const cdnUrl = await cloudflareService.uploadFromBuffer(moodFile.buffer, moodPath);
      
      // Create voice model for this mood
      const voiceModel = new VoiceModel({
        name: baseVoiceName,
        description: description || `${baseVoiceName} - ${mood.charAt(0).toUpperCase() + mood.slice(1)} tonu`,
        audioFile: cdnUrl,
        previewUrl: cdnUrl,
        artwork: artworkUrl,
        gender: gender || 'neutral',
        age: age || 'adult',
        language: 'tr',
        isActive: true,
        baseVoiceName,
        mood,
        isPartOfGroup: true,
        groupId
      });
      
      await voiceModel.save();
      createdVoices.push(voiceModel);
    }
    
    res.json({
      success: true,
      message: `${uploadedMoods.length} mood variations created for ${baseVoiceName}`,
      voices: createdVoices,
      groupId
    });
  } catch (error) {
    console.error('Multi-mood upload error:', error);
    res.status(500).json({ error: 'Multi-mood upload failed: ' + error.message });
  }
});

// Admin: Get all voices
router.get('/admin/list', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const voices = await VoiceModel.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      voices: voices
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

// Admin: Toggle voice active status
router.put('/admin/:id/toggle', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    const voice = await VoiceModel.findById(req.params.id);
    if (!voice) {
      return res.status(404).json({ error: 'Voice not found' });
    }
    
    voice.isActive = !voice.isActive;
    await voice.save();
    
    res.json({
      success: true,
      voice: voice
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle voice' });
  }
});

// Admin: Update voice
router.put('/admin/:id', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, upload.single('artworkFile'), async (req, res) => {
  try {
    const { name, description, gender, age } = req.body;
    const artworkFile = req.file;
    
    const updateData = { name, description, gender, age };
    
    // Upload new artwork if provided
    if (artworkFile) {
      const timestamp = Date.now();
      const artworkFileName = `${name}_${timestamp}_artwork.${artworkFile.originalname.split('.').pop()}`;
      const artworkPath = `VeeqAI/Artwork/${artworkFileName}`;
      updateData.artwork = await cloudflareService.uploadFromBuffer(artworkFile.buffer, artworkPath);
    }
    
    const voice = await VoiceModel.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!voice) {
      return res.status(404).json({ error: 'Voice not found' });
    }
    
    res.json({
      success: true,
      voice: voice
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update voice' });
  }
});

// Admin: Delete voice
router.delete('/admin/:id', AuthMiddleware.authenticate, AuthMiddleware.requireSuperAdmin, async (req, res) => {
  try {
    await VoiceModel.findByIdAndDelete(req.params.id);
    res.json({
      success: true,
      message: 'Voice deleted'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete voice' });
  }
});

module.exports = router;