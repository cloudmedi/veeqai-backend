const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Subscription = require('../models/Subscription');

// Load environment variables
dotenv.config();

async function addFreeSubscriptions() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai');
    console.log('Connected to MongoDB');

    // Find all regular users (not superadmin or admin)
    const allUsers = await User.find({ role: 'user' });
    console.log(`Found ${allUsers.length} regular users`);

    let createdCount = 0;
    
    for (const user of allUsers) {
      // Check if user already has a subscription
      const existingSubscription = await Subscription.findOne({ 
        user: user._id,
        status: { $in: ['active', 'trialing'] }
      });

      if (!existingSubscription) {
        // Get the Free plan details
        const Plan = require('../models/Plan');
        const freePlan = await Plan.findOne({ name: 'free' });
        
        // Create Free subscription with credits
        const subscription = new Subscription({
          user: user._id,
          plan: freePlan ? freePlan._id : 'free',
          planName: 'Free Plan',
          pricing: {
            amount: 0,
            currency: 'USD',
            interval: 'monthly'
          },
          credits: {
            monthly: freePlan ? freePlan.credits.monthly : 5000, // Default to 5000 if plan not found
            used: 0,
            rollover: 0,
            periodStart: new Date()
          },
          status: 'active',
          metadata: {
            source: 'migration'
          }
        });

        await subscription.save();
        createdCount++;
        console.log(`Created Free subscription for user: ${user.email}`);
      } else {
        console.log(`User ${user.email} already has subscription: ${existingSubscription.plan}`);
      }
    }

    console.log(`\nMigration completed! Created ${createdCount} Free subscriptions.`);
    
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the migration
addFreeSubscriptions();