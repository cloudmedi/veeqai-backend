// Script to fix user credits
// Run with: node scripts/fix-user-credits.js

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

// Models
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');

async function fixUserCredits() {
  try {
    // Find the user
    const userEmail = 'cat@cat.com';
    const user = await User.findOne({ email: userEmail });
    
    if (!user) {
      console.log(`❌ User ${userEmail} not found`);
      process.exit(1);
    }
    
    console.log(`✅ Found user: ${user.name} (${user.email})`);
    
    // Check existing subscription
    let subscription = await Subscription.findOne({ 
      user: user._id,
      status: 'active'
    });
    
    if (subscription) {
      console.log(`✅ Found existing subscription`);
      console.log(`   - Plan: ${subscription.planName}`);
      console.log(`   - Monthly credits: ${subscription.credits?.monthly || 0}`);
      console.log(`   - Used credits: ${subscription.credits?.used || 0}`);
      console.log(`   - Available: ${(subscription.credits?.monthly || 0) - (subscription.credits?.used || 0)}`);
      
      // Add 5000 credits to monthly allocation
      subscription.credits.monthly = (subscription.credits.monthly || 0) + 5000;
      await subscription.save();
      
      console.log(`✅ Added 5000 credits to monthly allocation`);
      console.log(`   - New monthly credits: ${subscription.credits.monthly}`);
      console.log(`   - Available now: ${subscription.credits.monthly - subscription.credits.used}`);
      
    } else {
      console.log(`⚠️ No active subscription found for user`);
      
      // Get or create Free plan
      let freePlan = await Plan.findOne({ name: 'Free' });
      
      if (!freePlan) {
        console.log('Creating Free plan...');
        freePlan = new Plan({
          name: 'Free',
          displayName: 'Free Plan',
          slug: 'free',
          type: 'credit',
          status: 'active',
          pricing: {
            monthly: { amount: 0, currency: 'USD' }
          },
          credits: {
            monthly: 5000,
            rollover: false,
            maxRollover: 0
          },
          features: ['basic'],
          display: { order: 0 }
        });
        await freePlan.save();
      }
      
      // Create new subscription with 5000 credits
      subscription = new Subscription({
        user: user._id,
        plan: freePlan._id,
        planName: 'Free',
        status: 'active',
        credits: {
          monthly: 5000,
          used: 0,
          rollover: 0,
          periodStart: new Date()
        },
        startDate: new Date(),
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      });
      
      await subscription.save();
      console.log(`✅ Created new subscription with 5000 credits`);
    }
    
    console.log('\n✅ Credits fixed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fixing credits:', error);
    process.exit(1);
  }
}

// Run the script
fixUserCredits();