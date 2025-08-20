// MongoDB script to add credits to users
// Run with: node scripts/add-credits.js

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai';

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// User model
const User = require('../models/User');

async function addCreditsToAllUsers() {
  try {
    // Find all users
    const users = await User.find({});
    console.log(`Found ${users.length} users`);
    
    // Add 5000 credits to each user
    for (const user of users) {
      user.credits = (user.credits || 0) + 5000;
      await user.save();
      console.log(`✅ Added 5000 credits to ${user.email}. New balance: ${user.credits}`);
    }
    
    console.log('✅ Successfully added credits to all users');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding credits:', error);
    process.exit(1);
  }
}

// Run the script
addCreditsToAllUsers();