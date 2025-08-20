const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const User = require('../models/User');

// Load environment variables
dotenv.config();

async function updateSubscriptionCredits() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai');
    console.log('✅ Connected to MongoDB');

    // First, ensure plans exist
    const plans = await Plan.find({});
    if (plans.length === 0) {
      console.log('⚠️  No plans found. Running seed-credit-plans first...');
      const { seedCreditPlans } = require('./seed-credit-plans');
      await seedCreditPlans();
    }

    // Get all plans for reference
    const planMap = {};
    const allPlans = await Plan.find({});
    allPlans.forEach(plan => {
      planMap[plan.name] = plan;
      planMap[plan._id.toString()] = plan;
    });

    console.log(`📋 Found ${Object.keys(planMap).length / 2} plans`);

    // Find all subscriptions
    const subscriptions = await Subscription.find({});
    console.log(`🔍 Found ${subscriptions.length} total subscriptions`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const subscription of subscriptions) {
      // Check if credits field is empty or not properly initialized
      const needsCreditsUpdate = !subscription.credits || 
                                 subscription.credits.monthly === undefined ||
                                 subscription.credits.monthly === null ||
                                 subscription.credits.monthly === 0;

      // Check if plan reference is invalid
      const needsPlanUpdate = !subscription.plan ||
                             subscription.plan === 'free' ||
                             typeof subscription.plan === 'string' ||
                             !mongoose.Types.ObjectId.isValid(subscription.plan);

      if (needsCreditsUpdate || needsPlanUpdate) {
        // Determine the plan
        let plan = null;
        
        // Try to find plan by ID first
        if (subscription.plan) {
          plan = planMap[subscription.plan.toString()];
        }
        
        // If not found, try by plan name
        if (!plan && subscription.planName) {
          const planNameLower = subscription.planName.toLowerCase().replace(' plan', '').replace('plan', '').trim();
          plan = planMap[planNameLower] || planMap['free']; // Default to free if not found
        }
        
        // Default to free plan if still not found
        if (!plan) {
          plan = planMap['free'];
        }

        if (plan) {
          console.log(`🔧 Processing subscription: ${subscription._id}`);
          console.log(`   📋 Needs credits update: ${needsCreditsUpdate}`);
          console.log(`   🔗 Needs plan update: ${needsPlanUpdate}`);
          console.log(`   📝 Current plan: ${subscription.plan}`);
          
          // Update credits if needed
          if (needsCreditsUpdate) {
            const existingCredits = subscription.credits || {};
            subscription.credits = {
              monthly: plan.credits.monthly,
              used: existingCredits.used || 0,
              rollover: existingCredits.rollover || 0,
              periodStart: existingCredits.periodStart || new Date(),
              usageByService: {
                tts: existingCredits.usageByService?.tts || 0,
                music: existingCredits.usageByService?.music || 0,
                voiceClone: existingCredits.usageByService?.voiceClone || 0,
                voiceIsolator: existingCredits.usageByService?.voiceIsolator || 0
              },
              history: existingCredits.history || []
            };
            console.log(`   ✅ Updated credits: ${plan.credits.monthly}`);
          }

          // Update plan reference if needed
          if (needsPlanUpdate) {
            console.log(`   🔧 Fixing plan reference: ${subscription.plan} -> ${plan._id}`);
            subscription.plan = plan._id;
            subscription.planName = plan.displayName || plan.name;
            console.log(`   ✅ Updated plan reference`);
          }

          await subscription.save();
          updatedCount++;
          
          const user = await User.findById(subscription.user);
          console.log(`✅ Updated subscription for user: ${user?.email || subscription.user}:`)
          console.log(`   📋 Plan: ${plan.displayName} (${plan.credits.monthly} credits)`)
          console.log(`   🔗 Plan ID: ${plan._id}`);
        } else {
          console.log(`⚠️  Could not find plan for subscription: ${subscription._id}`);
          skippedCount++;
        }
      } else {
        // Check if plan is still valid even if credits exist
        const isValidPlan = subscription.plan && 
                           mongoose.Types.ObjectId.isValid(subscription.plan) &&
                           typeof subscription.plan !== 'string';
        
        if (!isValidPlan) {
          console.log(`⚠️  Subscription has credits but invalid plan: ${subscription.plan} (User: ${subscription.user})`);
          // Continue to fix plan even if credits exist
          // Find plan logic here...
          const freePlan = planMap['free'];
          if (freePlan) {
            console.log(`🔧 Fixing plan reference for existing credits subscription: ${subscription.plan} -> ${freePlan._id}`);
            subscription.plan = freePlan._id;
            subscription.planName = freePlan.displayName || freePlan.name;
            await subscription.save();
            updatedCount++;
            
            const user = await User.findById(subscription.user);
            console.log(`✅ Fixed plan for user: ${user?.email || subscription.user}`);
          } else {
            console.log(`❌ Could not find free plan to fix subscription`);
            skippedCount++;
          }
        } else {
          console.log(`⏭️  Subscription already has credits and valid plan: ${subscription.credits.monthly} (User: ${subscription.user})`);
          skippedCount++;
        }
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Updated: ${updatedCount} subscriptions`);
    console.log(`   ⏭️  Skipped: ${skippedCount} subscriptions`);
    console.log(`   📋 Total: ${subscriptions.length} subscriptions`);

    // Show credit distribution
    const updatedSubs = await Subscription.find({}).populate('plan');
    const creditDistribution = {};
    
    updatedSubs.forEach(sub => {
      const credits = sub.credits?.monthly || 0;
      creditDistribution[credits] = (creditDistribution[credits] || 0) + 1;
    });

    console.log('\n💰 Credit Distribution:');
    Object.entries(creditDistribution)
      .sort(([a], [b]) => Number(a) - Number(b))
      .forEach(([credits, count]) => {
        console.log(`   ${credits} credits: ${count} users`);
      });

  } catch (error) {
    console.error('❌ Migration error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the migration
console.log('🚀 Starting subscription credits migration...\n');
updateSubscriptionCredits();