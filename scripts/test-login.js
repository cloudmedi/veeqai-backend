const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function testLogin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:nBCgxCFXthphjlkMmVjChyBLEHjPSfLO@interchange.proxy.rlwy.net:57752');
    console.log('Connected to MongoDB');

    // Find test user
    const user = await User.findOne({ email: 'test@test.com' });
    if (!user) {
      console.log('User not found!');
      process.exit(1);
    }
    
    console.log('User found:', user.email);
    console.log('User password hash:', user.password);
    console.log('User isVerified:', user.isVerified);
    
    // Test password
    const isMatch = await bcrypt.compare('test123', user.password);
    console.log('Password match with bcrypt.compare:', isMatch);
    
    // Test with user method
    const isMatch2 = await user.comparePassword('test123');
    console.log('Password match with comparePassword:', isMatch2);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testLogin();