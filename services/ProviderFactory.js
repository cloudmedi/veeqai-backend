const ReplicateProvider = require('./providers/ReplicateProvider');
const CustomProvider = require('./providers/CustomProvider');

class ProviderFactory {
  static providers = new Map();
  
  static init() {
    // Register all available providers
    this.registerProvider('replicate', ReplicateProvider);
    this.registerProvider('custom', CustomProvider);
    // Add more providers as needed
    // this.registerProvider('openai', OpenAIProvider);
    // this.registerProvider('local', LocalProvider);
  }
  
  static registerProvider(name, ProviderClass) {
    this.providers.set(name, ProviderClass);
    console.log(`Provider registered: ${name}`);
  }
  
  static getProvider(modelConfig) {
    const providerName = modelConfig.provider.name;
    const ProviderClass = this.providers.get(providerName);
    
    if (!ProviderClass) {
      throw new Error(`Provider '${providerName}' not found. Available providers: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    
    return new ProviderClass(modelConfig);
  }
  
  static getAvailableProviders() {
    return Array.from(this.providers.keys());
  }
  
  static isProviderSupported(providerName) {
    return this.providers.has(providerName);
  }
}

// Initialize providers on module load
ProviderFactory.init();

module.exports = ProviderFactory;