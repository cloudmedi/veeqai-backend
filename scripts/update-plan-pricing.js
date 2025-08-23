require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const exchangeRateService = require('../services/ExchangeRateService');

async function updatePlanPricing() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected');

    console.log('💱 Getting current exchange rates...');
    const usdToTry = await exchangeRateService.getRate('USD', 'TRY');
    const usdToEur = await exchangeRateService.getRate('USD', 'EUR');
    
    console.log(`💰 Current rates: 1 USD = ${usdToTry} TRY, 1 USD = ${usdToEur} EUR`);

    console.log('📋 Fetching all plans...');
    const plans = await Plan.find({});
    
    for (const plan of plans) {
      console.log(`\n🔧 Updating plan: ${plan.name} (${plan.displayName})`);
      
      // Get current USD pricing (legacy format)
      const currentUsdPrice = plan.pricing.monthly.amount;
      
      if (!currentUsdPrice) {
        console.log(`⚠️  No monthly pricing found for ${plan.name}, skipping...`);
        continue;
      }

      // Calculate TRY and EUR prices
      const tryPrice = Math.round(currentUsdPrice * usdToTry);
      const eurPrice = Math.round(currentUsdPrice * usdToEur * 100) / 100; // 2 decimal places

      // Update pricing structure
      plan.pricing.monthly.USD = {
        amount: currentUsdPrice,
        stripePriceId: plan.pricing.monthly.stripePriceId
      };

      plan.pricing.monthly.TRY = {
        amount: tryPrice,
        iyzicoPlanId: plan.pricing.monthly.iyzicoPlanId,
        allowInstallments: true,
        maxInstallments: 12
      };

      plan.pricing.monthly.EUR = {
        amount: eurPrice,
        stripePriceId: null // Will be set later if needed
      };

      // Update yearly pricing if exists
      if (plan.pricing.yearly && plan.pricing.yearly.amount) {
        const currentYearlyUsd = plan.pricing.yearly.amount;
        const tryYearlyPrice = Math.round(currentYearlyUsd * usdToTry);
        const eurYearlyPrice = Math.round(currentYearlyUsd * usdToEur * 100) / 100;

        plan.pricing.yearly.USD = {
          amount: currentYearlyUsd,
          stripePriceId: plan.pricing.yearly.stripePriceId,
          discount: plan.pricing.yearly.discount
        };

        plan.pricing.yearly.TRY = {
          amount: tryYearlyPrice,
          iyzicoPlanId: null,
          discount: plan.pricing.yearly.discount,
          allowInstallments: true,
          maxInstallments: 12
        };

        plan.pricing.yearly.EUR = {
          amount: eurYearlyPrice,
          stripePriceId: null,
          discount: plan.pricing.yearly.discount
        };

        console.log(`  💳 Yearly: $${currentYearlyUsd} → ₺${tryYearlyPrice} / €${eurYearlyPrice}`);
      }

      // Save the plan
      await plan.save();
      console.log(`  💳 Monthly: $${currentUsdPrice} → ₺${tryPrice} / €${eurPrice}`);
      console.log(`  ✅ Plan updated successfully`);
    }

    console.log('\n🎉 All plans updated successfully!');
    console.log('\n📊 Summary:');
    console.log(`  - Updated ${plans.length} plans`);
    console.log(`  - Exchange rates: 1 USD = ${usdToTry} TRY, ${usdToEur} EUR`);
    console.log(`  - TRY payments will support installments`);
    console.log(`  - USD/EUR payments will be single payment`);

  } catch (error) {
    console.error('❌ Error updating plan pricing:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 MongoDB disconnected');
    process.exit(0);
  }
}

// Run the script
if (require.main === module) {
  updatePlanPricing();
}

module.exports = updatePlanPricing;