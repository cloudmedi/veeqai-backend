const mongoose = require('mongoose');
const AIModel = require('../models/AIModel');
require('dotenv').config();

async function clearMockModels() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Sahte model isimlerini listele
    const mockModels = [
      'musicgen-large',
      'musicgen-medium', 
      'riffusion',
      'bark-tts'
    ];

    console.log('Clearing mock models...');

    for (const modelName of mockModels) {
      const result = await AIModel.deleteMany({ name: modelName });
      if (result.deletedCount > 0) {
        console.log(`✅ Deleted ${result.deletedCount} model(s) with name: ${modelName}`);
      } else {
        console.log(`⚠️  No model found with name: ${modelName}`);
      }
    }

    // Tüm modelleri göster
    const remainingModels = await AIModel.find({});
    console.log(`\n📊 Remaining models: ${remainingModels.length}`);
    
    remainingModels.forEach(model => {
      console.log(`   - ${model.name} (${model.displayName}) - ${model.provider.name}`);
    });

    console.log('\n🎉 Mock model cleanup completed!');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the cleanup
clearMockModels();