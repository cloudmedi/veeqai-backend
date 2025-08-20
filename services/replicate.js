const Replicate = require('replicate');
const axios = require('axios');

class ReplicateService {
  constructor() {
    this.replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });
  }

  async generateMusic(prompt, model = 'ace-step', duration = 60, lyrics = "") {
    try {
      console.log('Generating music with model:', model, 'Prompt:', prompt);
      
      if (model === 'google-lyria-2') {
        // Google Lyria-2 model - high quality 48kHz stereo
        const output = await this.replicate.run(
          "google/lyria-2",
          {
            input: {
              prompt: prompt,
              seed: Math.floor(Math.random() * 1000000), // Random seed
              negative_prompt: "low quality, distorted, noise, static" // Exclude unwanted elements
            }
          }
        );
        return this.handleLyriaOutput(output);
      } else if (model === 'ace-studio' || model === 'ace-step') {
        // ACE Studio model - lucataco/ace-step
        const output = await this.replicate.run(
          "lucataco/ace-step:280fc4f9ee507577f880a167f639c02622421d8fecf492454320311217b688f1",
          {
            input: {
              seed: -1,
              tags: prompt, // Use prompt as tags
              lyrics: lyrics || "", // Use user lyrics or empty for auto-generation
              duration: duration, // User selected duration
              scheduler: "heun", // Changed from euler to heun for better quality
              guidance_type: "apg",
              guidance_scale: 22, // Increased from 15 to 22 for higher quality
              number_of_steps: 120, // Increased from 60 to 120 for more detail
              granularity_scale: 12, // Slightly increased for finer control
              guidance_interval: 0.6, // Increased for better guidance
              min_guidance_scale: 4, // Increased minimum
              tag_guidance_scale: 0.5, // Enabled tag guidance for better prompt adherence
              lyric_guidance_scale: 1.2, // Increased for better lyrics integration
              guidance_interval_decay: 0.05 // Small decay for stability
            }
          }
        );
        return this.handleACEOutput(output);
      } else {
        throw new Error(`Unsupported model: ${model}`);
      }

    } catch (error) {
      console.error('Music generation error:', error);
      throw new Error(`Music generation failed: ${error.message}`);
    }
  }

  // Handle ACE Studio output
  handleACEOutput(output) {
    console.log('ACE Studio output type:', typeof output);
    console.log('ACE Studio output:', output);

    if (output && typeof output.url === 'function') {
      const audioUrl = output.url();
      console.log('Audio URL from output.url():', audioUrl);
      return audioUrl;
    } else if (output && typeof output === 'string') {
      return output;
    } else if (Array.isArray(output) && output.length > 0) {
      return output[0];
    } else if (output && output.audio) {
      return output.audio;
    } else if (output && output.url) {
      return output.url;
    }

    console.log('Unexpected ACE output structure:', JSON.stringify(output, null, 2));
    throw new Error('No audio URL in ACE Studio response');
  }


  // Handle Google Lyria-2 output
  handleLyriaOutput(output) {
    console.log('Lyria-2 output type:', typeof output);
    console.log('Lyria-2 output:', output);

    // Handle ReadableStream from Lyria-2 (same as other models)
    if (output && typeof output.url === 'function') {
      const audioUrl = output.url();
      console.log('Audio URL from output.url():', audioUrl);
      return audioUrl;
    } else if (output && typeof output === 'string') {
      return output; // Direct URI
    } else if (output && output.url) {
      return output.url;
    } else if (output && output.audio) {
      return output.audio;
    } else if (Array.isArray(output) && output.length > 0) {
      return output[0];
    }

    console.log('Unexpected Lyria-2 output structure:', JSON.stringify(output, null, 2));
    throw new Error('No audio URL in Lyria-2 response');
  }



  // Helper method to download audio from URL
  async downloadAudio(url) {
    try {
      const response = await axios.get(url, {
        responseType: 'arraybuffer'
      });
      return Buffer.from(response.data);
    } catch (error) {
      console.error('Error downloading audio:', error);
      throw new Error('Failed to download audio');
    }
  }
}

module.exports = new ReplicateService();