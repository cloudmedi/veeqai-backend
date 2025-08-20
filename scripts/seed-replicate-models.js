const mongoose = require('mongoose');
const AIModel = require('../models/AIModel');
const User = require('../models/User');
require('dotenv').config();

// Replicate'deki aktif music modelleri - sadece Google Lyria-2
const replicateModels = [
  {
    name: 'google-lyria-2',
    displayName: 'Google Lyria-2',
    description: 'High quality 48kHz stereo music generation with advanced AI capabilities.',
    type: 'music',
    category: 'premium',
    provider: {
      name: 'replicate',
      modelId: 'google/lyria-2',
      apiEndpoint: 'https://api.replicate.com'
    },
    config: {
      defaultParameters: {
        quality: '48khz_stereo',
        negative_prompt: 'low quality, distorted, noise, static'
      },
      inputFormats: ['text'],
      outputFormats: ['audio/wav'],
      maxInputLength: 200,
      maxOutputDuration: 180
    },
    capabilities: {
      languages: [
        { code: 'en', name: 'English', quality: 'native' }
      ],
      styles: ['pop', 'classical', 'jazz', 'rock', 'electronic', 'ambient', 'cinematic'],
      emotions: ['happy', 'sad', 'energetic', 'calm', 'dramatic', 'uplifting'],
      features: {
        voiceCloning: false,
        emotionControl: true,
        speedControl: false,
        pitchControl: true,
        multiSpeaker: false,
        ssml: false,
        highQuality: true
      }
    },
    pricing: {
      model: 'per-generation',
      baseCost: 0.008,
      markup: 2.0,
      userPrice: 0.016,
      currency: 'USD'
    },
    performance: {
      averageLatency: 30000,
      reliability: 96,
      quality: 5
    },
    stats: {
      totalUsage: 0,
      monthlyUsage: 0,
      successRate: 96
    },
    status: 'active',
    availability: {
      plans: ['pro', 'enterprise'],
      regions: ['us', 'eu'],
      restrictions: []
    },
    display: {
      order: 1,
      featured: true,
      badge: 'HIGH QUALITY',
      icon: '🎵',
      color: '#10B981',
      tags: ['music', 'ai', 'high-quality', 'stereo']
    }
  }
];

async function seedModels() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear existing models (optional)
    const existingCount = await AIModel.countDocuments();
    console.log(`Found ${existingCount} existing models`);

    // Find existing admin user
    const adminUser = await User.findOne({ role: 'superadmin' });
    if (!adminUser) {
      console.error('❌ No superadmin user found. Create a superadmin user first.');
      return;
    }
    console.log(`Found admin user: ${adminUser.email}`);

    // Insert models
    for (const modelData of replicateModels) {
      const existingModel = await AIModel.findOne({ name: modelData.name });
      
      if (!existingModel) {
        const model = new AIModel({
          ...modelData,
          createdBy: adminUser._id,
          updatedBy: adminUser._id
        });
        
        await model.save();
        console.log(`✅ Added: ${model.displayName}`);
      } else {
        console.log(`⚠️  Skipped: ${modelData.displayName} (already exists)`);
      }
    }

    console.log('\n🎉 Model seeding completed!');
    
    // Show summary
    const totalModels = await AIModel.countDocuments();
    const activeModels = await AIModel.countDocuments({ status: 'active' });
    
    console.log(`📊 Summary:`);
    console.log(`   Total models: ${totalModels}`);
    console.log(`   Active models: ${activeModels}`);
    console.log(`   Providers: ${replicateModels.map(m => m.provider.name).join(', ')}`);
    
  } catch (error) {
    console.error('❌ Seeding failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the seeding
seedModels();