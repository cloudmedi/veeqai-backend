const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const logger = require('../services/logger');

// Professional VeeqAI Credit Plans (More competitive than ElevenLabs)
const creditPlans = [
  {
    // FREE PLAN - Generous trial for new users
    name: 'free',
    displayName: 'Free',
    description: 'Try VeeqAI with 5K free credits',
    slug: 'free',
    pricing: {
      monthly: {
        amount: 0,
        currency: 'USD'
      },
      yearly: {
        amount: 0,
        currency: 'USD'
      }
    },
    trial: {
      enabled: false,
      days: 0,
      requireCard: false
    },
    credits: {
      monthly: 5000, // 5K credits - More generous than ElevenLabs' 10K characters
      rates: {
        tts: 1, // 1 character = 1 credit
        music: {
          per30Seconds: 200,
          per60Seconds: 400
        },
        voiceClone: {
          creation: 2000,
          usage: 1
        },
        voiceIsolator: {
          perMinute: 100
        }
      },
      rollover: {
        enabled: false,
        maxMonths: 0
      }
    },
    limits: {
      storage: 0.5, // 500MB
      fileRetention: 15, // 15 days
      apiKeys: 0,
      webhooks: 0,
      teamMembers: 1,
      concurrentGenerations: 1,
      maxMusicDuration: 30, // 30 seconds max
      maxTtsLength: 1000 // 1000 characters max per request
    },
    features: {
      textToSpeech: true,
      musicGeneration: true, // Free users can try music!
      voiceCloning: false,
      voiceDesign: false,
      voiceIsolator: false,
      customVoices: false,
      emotionControl: false,
      ssmlSupport: false,
      batchProcessing: false,
      apiAccess: false,
      webhooks: false,
      sdkAccess: false,
      priorityQueue: false,
      dedicatedEndpoint: false,
      cdn: false,
      analytics: false,
      usageReports: false,
      auditLogs: false,
      teamCollaboration: false,
      roleBasedAccess: false,
      sso: false,
      emailSupport: false,
      prioritySupport: false,
      dedicatedManager: false,
      sla: false,
      whiteLabel: false,
      customDomain: false,
      removeBranding: false
    },
    display: {
      order: 1,
      featured: false,
      popular: false,
      badge: '',
      color: '#10B981',
      icon: '🆓'
    },
    status: 'active',
    isPublic: true,
    target: 'individual'
  },

  {
    // STARTER PLAN - Better value than ElevenLabs Starter
    name: 'starter',
    displayName: 'Starter',
    description: 'For individuals and creators',
    slug: 'starter',
    pricing: {
      monthly: {
        amount: 9,
        currency: 'USD'
      },
      yearly: {
        amount: 90, // 2 months free
        currency: 'USD',
        discount: 17 // 17% discount
      }
    },
    trial: {
      enabled: true,
      days: 7,
      requireCard: true
    },
    credits: {
      monthly: 50000, // 50K credits vs ElevenLabs' 30K
      rates: {
        tts: 1,
        music: {
          per30Seconds: 200,
          per60Seconds: 400
        },
        voiceClone: {
          creation: 2000,
          usage: 1
        },
        voiceIsolator: {
          perMinute: 100
        }
      },
      rollover: {
        enabled: true,
        maxMonths: 2
      }
    },
    limits: {
      storage: 2, // 2GB
      fileRetention: 30, // 30 days
      apiKeys: 1,
      webhooks: 0,
      teamMembers: 1,
      concurrentGenerations: 2,
      maxMusicDuration: 60, // 60 seconds
      maxTtsLength: 5000
    },
    features: {
      textToSpeech: true,
      musicGeneration: true,
      voiceCloning: true, // 1 voice clone
      voiceDesign: false,
      voiceIsolator: true,
      customVoices: false,
      emotionControl: true,
      ssmlSupport: true,
      batchProcessing: false,
      apiAccess: true,
      webhooks: false,
      sdkAccess: false,
      priorityQueue: false,
      dedicatedEndpoint: false,
      cdn: true,
      analytics: true,
      usageReports: true,
      auditLogs: false,
      teamCollaboration: false,
      roleBasedAccess: false,
      sso: false,
      emailSupport: true,
      prioritySupport: false,
      dedicatedManager: false,
      sla: false,
      whiteLabel: false,
      customDomain: false,
      removeBranding: false
    },
    display: {
      order: 2,
      featured: false,
      popular: false,
      badge: '',
      color: '#3B82F6',
      icon: '🚀'
    },
    status: 'active',
    isPublic: true,
    target: 'individual'
  },

  {
    // CREATOR PLAN - Much better than ElevenLabs Creator
    name: 'creator',
    displayName: 'Creator',
    description: 'For creators and growing businesses',
    slug: 'creator',
    pricing: {
      monthly: {
        amount: 19,
        currency: 'USD'
      },
      yearly: {
        amount: 190, // 2 months free
        currency: 'USD',
        discount: 17
      }
    },
    trial: {
      enabled: true,
      days: 14,
      requireCard: true
    },
    credits: {
      monthly: 200000, // 200K credits vs ElevenLabs' 100K (2x more!)
      rates: {
        tts: 1,
        music: {
          per30Seconds: 200,
          per60Seconds: 400
        },
        voiceClone: {
          creation: 2000,
          usage: 1
        },
        voiceIsolator: {
          perMinute: 100
        }
      },
      rollover: {
        enabled: true,
        maxMonths: 2
      }
    },
    limits: {
      storage: 10, // 10GB
      fileRetention: 60, // 60 days
      apiKeys: 3,
      webhooks: 5,
      teamMembers: 3,
      concurrentGenerations: 5,
      maxMusicDuration: 120, // 2 minutes
      maxTtsLength: 10000
    },
    features: {
      textToSpeech: true,
      musicGeneration: true,
      voiceCloning: true, // Multiple voice clones
      voiceDesign: true,
      voiceIsolator: true,
      customVoices: true,
      emotionControl: true,
      ssmlSupport: true,
      batchProcessing: true,
      apiAccess: true,
      webhooks: true,
      sdkAccess: true,
      priorityQueue: true,
      dedicatedEndpoint: false,
      cdn: true,
      analytics: true,
      usageReports: true,
      auditLogs: true,
      teamCollaboration: true,
      roleBasedAccess: false,
      sso: false,
      emailSupport: true,
      prioritySupport: true,
      dedicatedManager: false,
      sla: false,
      whiteLabel: false,
      customDomain: false,
      removeBranding: false
    },
    display: {
      order: 3,
      featured: true,
      popular: true,
      badge: '',
      color: '#8B5CF6',
      icon: '⭐'
    },
    status: 'active',
    isPublic: true,
    target: 'individual'
  },

  {
    // PRO PLAN - Significantly cheaper than ElevenLabs Pro
    name: 'pro',
    displayName: 'Professional',
    description: 'For professionals and teams',
    slug: 'professional',
    pricing: {
      monthly: {
        amount: 49,
        currency: 'USD' // vs ElevenLabs' $99
      },
      yearly: {
        amount: 490, // 2 months free
        currency: 'USD',
        discount: 17
      }
    },
    trial: {
      enabled: true,
      days: 14,
      requireCard: true
    },
    credits: {
      monthly: 750000, // 750K credits vs ElevenLabs' 500K (50% more!)
      rates: {
        tts: 1,
        music: {
          per30Seconds: 200,
          per60Seconds: 400
        },
        voiceClone: {
          creation: 2000,
          usage: 1
        },
        voiceIsolator: {
          perMinute: 100
        }
      },
      rollover: {
        enabled: true,
        maxMonths: 2
      }
    },
    limits: {
      storage: 50, // 50GB
      fileRetention: 90, // 90 days
      apiKeys: 10,
      webhooks: 20,
      teamMembers: 10,
      concurrentGenerations: 10,
      maxMusicDuration: 300, // 5 minutes
      maxTtsLength: 25000
    },
    features: {
      textToSpeech: true,
      musicGeneration: true,
      voiceCloning: true, // Unlimited voice clones
      voiceDesign: true,
      voiceIsolator: true,
      customVoices: true,
      emotionControl: true,
      ssmlSupport: true,
      batchProcessing: true,
      apiAccess: true,
      webhooks: true,
      sdkAccess: true,
      priorityQueue: true,
      dedicatedEndpoint: true,
      cdn: true,
      analytics: true,
      usageReports: true,
      auditLogs: true,
      teamCollaboration: true,
      roleBasedAccess: true,
      sso: false,
      emailSupport: true,
      prioritySupport: true,
      dedicatedManager: true,
      sla: true,
      whiteLabel: false,
      customDomain: false,
      removeBranding: true
    },
    display: {
      order: 4,
      featured: false,
      popular: false,
      badge: '',
      color: '#F59E0B',
      icon: '💼'
    },
    status: 'active',
    isPublic: true,
    target: 'team'
  },

  {
    // ENTERPRISE PLAN
    name: 'enterprise',
    displayName: 'Enterprise',
    description: 'Custom solutions for large organizations',
    slug: 'enterprise',
    pricing: {
      monthly: {
        amount: 199,
        currency: 'USD'
      },
      yearly: {
        amount: 1990, // 2 months free
        currency: 'USD',
        discount: 17
      }
    },
    trial: {
      enabled: true,
      days: 30,
      requireCard: false
    },
    credits: {
      monthly: 3000000, // 3M credits
      rates: {
        tts: 1,
        music: {
          per30Seconds: 200,
          per60Seconds: 400
        },
        voiceClone: {
          creation: 2000,
          usage: 1
        },
        voiceIsolator: {
          perMinute: 100
        }
      },
      rollover: {
        enabled: true,
        maxMonths: 3
      }
    },
    limits: {
      storage: 500, // 500GB
      fileRetention: 365, // 1 year
      apiKeys: 50,
      webhooks: 100,
      teamMembers: 100,
      concurrentGenerations: 50,
      maxMusicDuration: 600, // 10 minutes
      maxTtsLength: 100000
    },
    features: {
      textToSpeech: true,
      musicGeneration: true,
      voiceCloning: true,
      voiceDesign: true,
      voiceIsolator: true,
      customVoices: true,
      emotionControl: true,
      ssmlSupport: true,
      batchProcessing: true,
      apiAccess: true,
      webhooks: true,
      sdkAccess: true,
      priorityQueue: true,
      dedicatedEndpoint: true,
      cdn: true,
      analytics: true,
      usageReports: true,
      auditLogs: true,
      teamCollaboration: true,
      roleBasedAccess: true,
      sso: true,
      emailSupport: true,
      prioritySupport: true,
      dedicatedManager: true,
      sla: true,
      whiteLabel: true,
      customDomain: true,
      removeBranding: true
    },
    display: {
      order: 5,
      featured: false,
      popular: false,
      badge: '',
      color: '#EF4444',
      icon: '🏢'
    },
    status: 'active',
    isPublic: true,
    target: 'enterprise'
  }
];

async function seedCreditPlans() {
  try {
    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/veeqai');
      logger.info('Connected to MongoDB');
    }

    // Clear existing plans
    await Plan.deleteMany({});
    logger.info('Cleared existing plans');

    // Insert new plans
    const insertedPlans = await Plan.insertMany(creditPlans);
    logger.info(`✅ Successfully seeded ${insertedPlans.length} credit plans:`);

    insertedPlans.forEach(plan => {
      logger.info(`  📋 ${plan.displayName} - ${plan.credits.monthly} credits/month - $${plan.pricing.monthly.amount}/month`);
    });

    // Display comparison with ElevenLabs
    logger.info('\n🎯 VeeqAI vs ElevenLabs Comparison:');
    logger.info('  FREE: 5K credits vs ElevenLabs 10K characters (includes music generation!)');
    logger.info('  STARTER: $9 (50K credits) vs ElevenLabs $5 (30K characters) - 67% more credits!');
    logger.info('  CREATOR: $19 (200K credits) vs ElevenLabs $11 (100K characters) - 100% more credits!');
    logger.info('  PRO: $49 (750K credits) vs ElevenLabs $99 (500K characters) - 50% cheaper + 50% more credits!');
    logger.info('  ENTERPRISE: $199 (3M credits) vs ElevenLabs $330+ (Scale plan)');

    logger.info('\n💡 Key Advantages:');
    logger.info('  ✅ Music generation included in all plans');
    logger.info('  ✅ Voice isolation feature');
    logger.info('  ✅ More generous credit allocations');
    logger.info('  ✅ Better pricing (especially Pro tier)');
    logger.info('  ✅ Credit rollover system');
    logger.info('  ✅ Team collaboration features');

    // Only disconnect if we connected in this function
    if (require.main === module) {
      await mongoose.disconnect();
      logger.info('✅ Database connection closed');
    }

  } catch (error) {
    logger.error('❌ Error seeding credit plans:', error);
    process.exit(1);
  }
}

// Run the seeder
if (require.main === module) {
  seedCreditPlans();
}

module.exports = { seedCreditPlans, creditPlans };