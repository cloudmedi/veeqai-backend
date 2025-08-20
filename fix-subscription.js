const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Subscription = require('./models/Subscription');
const Plan = require('./models/Plan');

dotenv.config();

async function fixSubscription() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai');
    console.log('✅ Connected to MongoDB');

    const userId = '689ae9015fc9d05e5dad5e83';
    const brokenSubscriptionId = '68a0884ece269c6553573539';

    console.log('\n🔧 FIXING BROKEN SUBSCRIPTION');
    console.log('=====================================');

    // Get the free plan
    const freePlan = await Plan.findOne({ name: 'free' });
    if (!freePlan) {
      throw new Error('Free plan not found');
    }

    console.log(`✅ Found free plan: ${freePlan._id}`);

    // Fix the broken subscription
    const result = await Subscription.updateOne(
      { _id: brokenSubscriptionId },
      { 
        plan: freePlan._id,
        planName: freePlan.displayName
      }
    );

    console.log(`✅ Updated subscription:`, result);

    // Test the fix
    const subscription = await Subscription.findById(brokenSubscriptionId).populate('plan');
    console.log(`✅ Test populate after fix:`, {
      hasSubscription: !!subscription,
      hasPlan: !!subscription?.plan,
      planName: subscription?.plan?.name
    });

    // Test CreditService query
    const testQuery = await Subscription.findOne({
      user: userId,
      status: 'active'
    }).populate('plan');

    console.log(`✅ CreditService query test:`, {
      found: !!testQuery,
      hasPlan: !!testQuery?.plan,
      planName: testQuery?.plan?.name,
      credits: testQuery?.credits?.monthly
    });

    console.log('\n✅ SUBSCRIPTION FIXED!');

  } catch (error) {
    console.error('❌ Fix error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

fixSubscription();