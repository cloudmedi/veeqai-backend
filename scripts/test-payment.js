require('dotenv').config();
const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const API_BASE_URL = 'http://localhost:5000';

// Test card numbers for Iyzico Sandbox
const TEST_CARDS = {
  success: {
    number: '5528790000000008',
    holder: 'John Doe',
    month: '12',
    year: '2030',
    cvv: '123'
  },
  fail: {
    number: '4111111111111129',
    holder: 'John Doe',
    month: '12',
    year: '2030',
    cvv: '123'
  }
};

console.log('🧪 İyzico Payment Test Script');
console.log('================================');
console.log('📍 API URL:', API_BASE_URL);
console.log('🔧 Environment:', process.env.NODE_ENV || 'development');
console.log('💳 İyzico Mode:', process.env.IYZICO_BASE_URL?.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION');
console.log('');

async function testHealthCheck() {
  console.log('🔍 Testing health endpoint...');
  try {
    const response = await axios.get(`${API_BASE_URL}/api/payment/health`);
    console.log('✅ Health Check:', response.data.data.overall);
    console.log('   - İyzico:', response.data.data.iyzico.status);
    console.log('   - Webhook:', response.data.data.webhook.status);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function getPlans() {
  console.log('\n📋 Fetching available plans...');
  try {
    const response = await axios.get(`${API_BASE_URL}/api/payment/plans`);
    const plans = response.data.data.plans;
    
    console.log(`Found ${plans.length} plans:`);
    plans.forEach((plan, index) => {
      console.log(`  ${index + 1}. ${plan.displayName} - $${plan.pricing.monthly.amount}/month`);
    });
    
    return plans;
  } catch (error) {
    console.error('❌ Failed to fetch plans:', error.message);
    return [];
  }
}

async function initiatePayment(token, planId) {
  console.log('\n💳 Initiating payment...');
  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/payment/initiate`,
      {
        planId,
        billingInfo: {
          contactName: 'Test User',
          city: 'Istanbul',
          country: 'Turkey',
          address: 'Test Address 123',
          zipCode: '34000'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Payment initiated successfully!');
    console.log('   - Conversation ID:', response.data.data.conversationId);
    console.log('   - Payment URL:', response.data.data.paymentPageUrl);
    console.log('   - Token:', response.data.data.token);
    
    return response.data.data;
  } catch (error) {
    console.error('❌ Payment initiation failed:', error.response?.data || error.message);
    return null;
  }
}

async function loginTestUser() {
  console.log('\n🔐 Logging in test user...');
  try {
    const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
      email: 'test@example.com',
      password: 'password123'
    });
    
    console.log('✅ Login successful!');
    return response.data.data.token;
  } catch (error) {
    console.log('⚠️ Test user not found, creating new user...');
    
    // Register new test user
    try {
      const registerResponse = await axios.post(`${API_BASE_URL}/api/auth/register`, {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123'
      });
      
      console.log('✅ Test user created and logged in!');
      return registerResponse.data.data.token;
    } catch (registerError) {
      console.error('❌ Failed to create test user:', registerError.response?.data || registerError.message);
      return null;
    }
  }
}

async function runTest() {
  console.log('\n🚀 Starting Payment Integration Test\n');
  
  // Step 1: Health Check
  const isHealthy = await testHealthCheck();
  if (!isHealthy) {
    console.log('\n❌ System is not healthy. Please check the configuration.');
    process.exit(1);
  }
  
  // Step 2: Get Plans
  const plans = await getPlans();
  if (plans.length === 0) {
    console.log('\n❌ No plans available. Please seed the database.');
    process.exit(1);
  }
  
  // Step 3: Login
  const token = await loginTestUser();
  if (!token) {
    console.log('\n❌ Authentication failed.');
    process.exit(1);
  }
  
  // Step 4: Select a plan
  const selectedPlan = plans.find(p => p.pricing.monthly.amount > 0) || plans[0];
  console.log(`\n📌 Selected plan: ${selectedPlan.displayName}`);
  
  // Step 5: Initiate Payment
  const paymentData = await initiatePayment(token, selectedPlan.id);
  if (!paymentData) {
    console.log('\n❌ Payment initiation failed.');
    process.exit(1);
  }
  
  console.log('\n========================================');
  console.log('✅ TEST COMPLETED SUCCESSFULLY!');
  console.log('========================================');
  console.log('\n📱 Next Steps:');
  console.log('1. Open the payment URL in your browser:');
  console.log(`   ${paymentData.paymentPageUrl}`);
  console.log('\n2. Use these test card details:');
  console.log('   - Card Number:', TEST_CARDS.success.number);
  console.log('   - Holder Name:', TEST_CARDS.success.holder);
  console.log('   - Expiry:', `${TEST_CARDS.success.month}/${TEST_CARDS.success.year}`);
  console.log('   - CVV:', TEST_CARDS.success.cvv);
  console.log('\n3. Complete the payment and check the callback');
  console.log('========================================\n');
  
  rl.close();
}

// Run the test
runTest().catch(error => {
  console.error('❌ Test failed:', error);
  rl.close();
  process.exit(1);
});