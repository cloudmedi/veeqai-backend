const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function fixTestUser() {
  try {
    await mongoose.connect(process.env.MONGO_URL || 'mongodb://mongo:nBCgxCFXthphjlkMmVjChyBLEHjPSfLO@interchange.proxy.rlwy.net:57752');
    console.log('Connected to MongoDB');

    // Manually hash password with exact same settings as User model
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('test123', salt);
    
    // Update test user
    const result = await User.updateOne(
      { email: 'test@test.com' },
      { 
        $set: { 
          password: hashedPassword,
          isVerified: true,
          emailVerified: true
        }
      }
    );
    
    console.log('Update result:', result);
    
    // Verify
    const user = await User.findOne({ email: 'test@test.com' });
    console.log('User password hash:', user.password);
    
    const match = await bcrypt.compare('test123', user.password);
    console.log('Password match:', match);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixTestUser();