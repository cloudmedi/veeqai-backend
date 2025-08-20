const BaseProvider = require('./BaseProvider');
const Replicate = require('replicate');

class ReplicateProvider extends BaseProvider {
  constructor(modelConfig) {
    super(modelConfig);
    this.replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN
    });
  }
  
  async generateMusic(params) {
    try {
      const { prompt, duration = 30, style = '' } = params;
      
      // Use the provider.modelId from the database (e.g., "google/lyria-2")
      const modelId = this.modelConfig.provider.modelId;
      
      // Build input based on model requirements
      let input = {
        prompt: style ? `${style}, ${prompt}` : prompt,
        duration: duration
      };

      // Model-specific parameters
      if (modelId.includes('google/lyria-2')) {
        input.tags = style || 'music'; // Google Lyria requires tags
      }

      // Add any additional config parameters
      if (this.modelConfig.config && this.modelConfig.config.defaultParameters) {
        input = { ...input, ...this.modelConfig.config.defaultParameters };
      }
      
      const prediction = await this.replicate.predictions.create({
        model: modelId, // Use the full model ID from database
        input: input
      });
      
      return {
        jobId: prediction.id,
        status: 'processing',
        provider: 'replicate',
        estimatedTime: this.estimateTime(duration),
        modelUsed: modelId
      };
      
    } catch (error) {
      console.error('Replicate generation error:', error);
      throw new Error(`Replicate generation failed: ${error.message}`);
    }
  }
  
  async checkStatus(jobId) {
    try {
      const prediction = await this.replicate.predictions.get(jobId);
      
      return {
        status: prediction.status, // 'starting', 'processing', 'succeeded', 'failed'
        progress: this.getProgress(prediction),
        error: prediction.error,
        output: prediction.output,
        audioUrl: prediction.output, // Add explicit audioUrl
        logs: prediction.logs
      };
      
    } catch (error) {
      console.error('Replicate status check error:', error);
      return {
        status: 'failed',
        error: error.message
      };
    }
  }
  
  async getResult(jobId) {
    try {
      const prediction = await this.replicate.predictions.get(jobId);
      
      if (prediction.status === 'succeeded' && prediction.output) {
        return {
          status: 'completed',
          audioUrl: prediction.output,
          metadata: {
            duration: prediction.metrics?.total_time || 0,
            model: this.modelConfig.provider.modelId,
            provider: 'replicate'
          }
        };
      } else if (prediction.status === 'failed') {
        throw new Error(prediction.error || 'Generation failed');
      } else {
        return {
          status: 'processing',
          progress: this.getProgress(prediction)
        };
      }
      
    } catch (error) {
      console.error('Replicate result error:', error);
      throw error;
    }
  }
  
  async cancelGeneration(jobId) {
    try {
      await this.replicate.predictions.cancel(jobId);
      return { status: 'cancelled' };
    } catch (error) {
      console.error('Replicate cancel error:', error);
      throw error;
    }
  }
  
  // Helper methods
  estimateTime(duration) {
    // Rough estimate based on Replicate performance
    return Math.max(20, duration * 0.5); // At least 20 seconds
  }
  
  getProgress(prediction) {
    if (prediction.status === 'starting') return 10;
    if (prediction.status === 'processing') return 50;
    if (prediction.status === 'succeeded') return 100;
    if (prediction.status === 'failed') return 0;
    return 0;
  }
}

module.exports = ReplicateProvider;