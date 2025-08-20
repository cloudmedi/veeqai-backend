const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Subscription = require('./models/Subscription');
const Plan = require('./models/Plan');
const User = require('./models/User');

dotenv.config();

async function debugSubscriptions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai');
    console.log('✅ Connected to MongoDB');

    const userId = '689ae9015fc9d05e5dad5e83'; // Problem user

    console.log('\n🔍 DEBUGGING SUBSCRIPTION ISSUE');
    console.log('=====================================');

    // 1. Check user exists
    const user = await User.findById(userId);
    console.log('1. User exists:', !!user, user?.email);

    // 2. Check plans exist
    const plans = await Plan.find({});
    console.log('\n2. Available plans:');
    plans.forEach(plan => {
      console.log(`   - ${plan.name} (${plan.displayName}) - ID: ${plan._id}`);
    });

    // 3. Check raw subscription data (WITHOUT populate)
    const rawSubscriptions = await Subscription.find({ user: userId });
    console.log('\n3. Raw subscriptions for user:');
    rawSubscriptions.forEach((sub, index) => {
      console.log(`   Subscription ${index + 1}:`);
      console.log(`   - ID: ${sub._id}`);
      console.log(`   - Plan field: ${sub.plan} (type: ${typeof sub.plan})`);
      console.log(`   - Plan name: ${sub.planName}`);
      console.log(`   - Status: ${sub.status}`);
      console.log(`   - Credits: ${sub.credits?.monthly || 'undefined'}`);
      console.log(`   - Created: ${sub.createdAt}`);
      console.log('   ---');
    });

    // 4. Try to populate each subscription individually
    console.log('\n4. Testing populate for each subscription:');
    for (let i = 0; i < rawSubscriptions.length; i++) {
      const sub = rawSubscriptions[i];
      try {
        const populatedSub = await Subscription.findById(sub._id).populate('plan');
        console.log(`   Subscription ${i + 1}: populate ${populatedSub.plan ? 'SUCCESS' : 'FAILED'}`);
        if (populatedSub.plan) {
          console.log(`     - Plan: ${populatedSub.plan.name} (${populatedSub.plan._id})`);
        } else {
          console.log(`     - Plan field value: ${sub.plan}`);
          // Check if this plan ID exists in Plans collection
          if (sub.plan) {
            const planExists = await Plan.findById(sub.plan);
            console.log(`     - Plan exists in DB: ${!!planExists}`);
          }
        }
      } catch (error) {
        console.log(`   Subscription ${i + 1}: populate ERROR -`, error.message);
      }
    }

    // 5. Check if the plan ObjectId references exist
    console.log('\n5. Checking plan ObjectId validity:');
    for (const sub of rawSubscriptions) {
      if (sub.plan) {
        try {
          const isValidObjectId = mongoose.Types.ObjectId.isValid(sub.plan);
          console.log(`   Plan ${sub.plan}: Valid ObjectId = ${isValidObjectId}`);
          
          if (isValidObjectId) {
            const planExists = await Plan.findById(sub.plan);
            console.log(`   Plan ${sub.plan}: Exists in DB = ${!!planExists}`);
          }
        } catch (error) {
          console.log(`   Plan ${sub.plan}: Check failed -`, error.message);
        }
      }
    }

    // 6. Show the exact query CreditService is using
    console.log('\n6. Testing CreditService query:');
    try {
      const subscription = await Subscription.findOne({
        user: userId,
        status: 'active'
      }).populate('plan');
      
      console.log('   CreditService query result:');
      console.log(`   - Found subscription: ${!!subscription}`);
      console.log(`   - Has plan: ${!!subscription?.plan}`);
      console.log(`   - Plan details:`, subscription?.plan);
    } catch (error) {
      console.log('   CreditService query ERROR:', error.message);
    }

    console.log('\n=====================================');
    console.log('Debug completed!');

  } catch (error) {
    console.error('❌ Debug error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

debugSubscriptions();