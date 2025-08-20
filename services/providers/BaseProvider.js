class BaseProvider {
  constructor(modelConfig) {
    this.modelConfig = modelConfig; // Store full config
    this.name = modelConfig.provider.name
    this.modelId = modelConfig.provider.modelId
    this.apiEndpoint = modelConfig.provider.apiEndpoint
    this.config = modelConfig.config || {}
  }
  
  async generateMusic(params) {
    throw new Error('Must implement generateMusic method')
  }
  
  async checkStatus(jobId) {
    throw new Error('Must implement checkStatus method')
  }
  
  async getResult(jobId) {
    throw new Error('Must implement getResult method')
  }
  
  // Optional methods
  async cancelGeneration(jobId) {
    throw new Error('Cancel not supported for this provider')
  }
  
  async getUsageStats() {
    return {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      averageLatency: 0
    }
  }
}

module.exports = BaseProvider