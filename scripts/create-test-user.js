const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function createTestUser() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:nBCgxCFXthphjlkMmVjChyBLEHjPSfLO@interchange.proxy.rlwy.net:57752');
    console.log('Connected to MongoDB');

    // Create test user
    const hashedPassword = await bcrypt.hash('test123', 12);
    
    // Check if user exists
    let testUser = await User.findOne({ email: 'test@test.com' });
    
    if (testUser) {
      // Update existing user's password
      testUser.password = hashedPassword;
      testUser.isVerified = true;
      testUser.emailVerified = true;
      await testUser.save();
      console.log('Updated existing user password');
    } else {
      // Create new user
      testUser = await User.create({
        name: 'Test User',
        email: 'test@test.com',
        password: hashedPassword,
        isVerified: true,
        role: 'user'
      });
      console.log('Created new user');
    }

    console.log('Test user created:', testUser.email);
    console.log('Password: test123');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

createTestUser();