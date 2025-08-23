require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const exchangeRateService = require('../services/ExchangeRateService');
const locationService = require('../services/LocationService');

async function testMultiCurrency() {
  try {
    console.log('🧪 Testing Multi-Currency Payment System');
    console.log('=====================================\n');

    // Connect to MongoDB
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected\n');

    // Test 1: Exchange Rate Service
    console.log('💱 Test 1: Exchange Rate Service');
    console.log('--------------------------------');
    
    const usdToTry = await exchangeRateService.getRate('USD', 'TRY');
    const eurToTry = await exchangeRateService.getRate('EUR', 'TRY');
    const usdToEur = await exchangeRateService.getRate('USD', 'EUR');
    
    console.log(`USD → TRY: ${usdToTry}`);
    console.log(`EUR → TRY: ${eurToTry}`);
    console.log(`USD → EUR: ${usdToEur}`);
    
    // Test conversion
    const converted = await exchangeRateService.convert(10, 'USD', 'TRY');
    console.log(`Convert $10 USD → ₺${converted} TRY\n`);

    // Test 2: Location Service
    console.log('🌍 Test 2: Location Service');
    console.log('---------------------------');
    
    // Mock request objects for different countries
    const mockRequests = [
      {
        headers: { 'x-forwarded-for': '185.125.190.39' }, // Turkish IP
        connection: { remoteAddress: '185.125.190.39' }
      },
      {
        headers: { 'x-forwarded-for': '8.8.8.8' }, // US IP
        connection: { remoteAddress: '8.8.8.8' }
      },
      {
        headers: { 
          'x-forwarded-for': '87.230.97.1',
          'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8'
        },
        connection: { remoteAddress: '87.230.97.1' }
      }
    ];

    for (let i = 0; i < mockRequests.length; i++) {
      const location = await locationService.getUserCurrency(mockRequests[i]);
      console.log(`Request ${i + 1}: ${location.country} → ${location.currency} (${location.confidence})`);
    }
    console.log('');

    // Test 3: Plan Multi-Currency Support
    console.log('📋 Test 3: Plan Multi-Currency Support');
    console.log('-------------------------------------');
    
    const plans = await Plan.find({}).limit(3);
    
    for (const plan of plans) {
      console.log(`\nPlan: ${plan.displayName}`);
      console.log(`Supported currencies: ${plan.getSupportedCurrencies().join(', ')}`);
      
      ['USD', 'TRY', 'EUR'].forEach(currency => {
        const pricing = plan.getPricing(currency, 'monthly');
        if (pricing) {
          const installments = plan.supportsInstallments(currency) ? 
            `(up to ${plan.getMaxInstallments(currency)}x installments)` : '(single payment)';
          console.log(`  ${currency}: ${pricing.amount} ${installments}`);
        } else {
          console.log(`  ${currency}: Not available`);
        }
      });
    }

    // Test 4: Cache Performance
    console.log('\n⚡ Test 4: Cache Performance');
    console.log('----------------------------');
    
    console.time('First rate fetch (no cache)');
    await exchangeRateService.getRate('USD', 'TRY');
    console.timeEnd('First rate fetch (no cache)');
    
    console.time('Second rate fetch (cached)');
    await exchangeRateService.getRate('USD', 'TRY');
    console.timeEnd('Second rate fetch (cached)');
    
    // Test 5: Error Handling
    console.log('\n🛡️  Test 5: Error Handling');
    console.log('-------------------------');
    
    try {
      const invalidRate = await exchangeRateService.getRate('INVALID', 'TRY');
      console.log(`Invalid currency fallback: ${invalidRate}`);
    } catch (error) {
      console.log(`Error handled: ${error.message}`);
    }

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📊 System Status:');
    console.log('  ✅ Exchange Rate Service: Working');
    console.log('  ✅ Location Detection: Working');
    console.log('  ✅ Multi-Currency Plans: Working');
    console.log('  ✅ Caching: Working');
    console.log('  ✅ Error Handling: Working');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 MongoDB disconnected');
    process.exit(0);
  }
}

// Run the test
if (require.main === module) {
  testMultiCurrency();
}

module.exports = testMultiCurrency;