const BaseProvider = require('./BaseProvider');
// Using built-in fetch (Node.js 18+)

class CustomProvider extends BaseProvider {
  constructor(modelConfig) {
    super(modelConfig);
    this.apiKey = process.env.CUSTOM_API_KEY;
    this.timeout = this.config.timeout || 300000; // 5 minutes default
  }
  
  async generateMusic(params) {
    try {
      const { prompt, duration = 30, style = '' } = params;
      
      const response = await fetch(`${this.apiEndpoint}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.config.customHeaders
        },
        body: JSON.stringify({
          prompt: style ? `${style}, ${prompt}` : prompt,
          duration,
          model: this.modelId,
          ...this.config.defaultParameters
        }),
        timeout: this.timeout
      });
      
      if (!response.ok) {
        throw new Error(`Custom API error: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      return {
        jobId: result.job_id || result.id || Date.now().toString(),
        status: 'processing',
        provider: 'custom',
        estimatedTime: result.estimated_time || duration * 2,
        modelUsed: this.modelId
      };
      
    } catch (error) {
      console.error('Custom provider generation error:', error);
      throw new Error(`Custom generation failed: ${error.message}`);
    }
  }
  
  async checkStatus(jobId) {
    try {
      const response = await fetch(`${this.apiEndpoint}/status/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.config.customHeaders
        }
      });
      
      if (!response.ok) {
        throw new Error(`Status check failed: ${response.status}`);
      }
      
      const status = await response.json();
      
      return {
        status: status.status, // 'processing', 'completed', 'failed'
        progress: status.progress || 0,
        error: status.error,
        output: status.output,
        logs: status.logs
      };
      
    } catch (error) {
      console.error('Custom provider status error:', error);
      return {
        status: 'failed',
        error: error.message
      };
    }
  }
  
  async getResult(jobId) {
    try {
      const response = await fetch(`${this.apiEndpoint}/result/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.config.customHeaders
        }
      });
      
      if (!response.ok) {
        throw new Error(`Result fetch failed: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.status === 'completed' && result.audio_url) {
        return {
          status: 'completed',
          audioUrl: result.audio_url,
          metadata: {
            duration: result.duration || 0,
            model: this.modelId,
            provider: 'custom',
            quality: result.quality || 'unknown'
          }
        };
      } else if (result.status === 'failed') {
        throw new Error(result.error || 'Generation failed');
      } else {
        return {
          status: 'processing',
          progress: result.progress || 0
        };
      }
      
    } catch (error) {
      console.error('Custom provider result error:', error);
      throw error;
    }
  }
  
  async cancelGeneration(jobId) {
    try {
      const response = await fetch(`${this.apiEndpoint}/cancel/${jobId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.config.customHeaders
        }
      });
      
      return { status: 'cancelled' };
    } catch (error) {
      console.error('Custom provider cancel error:', error);
      throw error;
    }
  }
  
  async getUsageStats() {
    try {
      const response = await fetch(`${this.apiEndpoint}/stats`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...this.config.customHeaders
        }
      });
      
      if (response.ok) {
        return await response.json();
      }
      
      return super.getUsageStats(); // Fallback to default
    } catch (error) {
      console.error('Custom provider stats error:', error);
      return super.getUsageStats();
    }
  }
}

module.exports = CustomProvider;