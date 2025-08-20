const Music = require('../models/Music');
const AIModel = require('../models/AIModel');
const ProviderFactory = require('./ProviderFactory');
const cloudflareService = require('./cloudflare');
const logger = require('./logger');
const monitoring = require('./monitoring');
const ArtworkGenerationService = require('./ArtworkGenerationService');

/**
 * Background service to process pending music generations
 * Checks Replicate status and updates database accordingly
 */
class MusicProcessor {
  constructor() {
    this.isProcessing = false;
    this.intervalId = null;
  }

  /**
   * Start the background processor
   */
  start() {
    if (this.intervalId) {
      console.log('🎵 [PROCESSOR] Already running');
      return;
    }

    console.log('🎵 [PROCESSOR] Starting music processor...');
    this.intervalId = setInterval(() => {
      this.processPendingMusic();
    }, 10000); // Check every 10 seconds

    // Initial run
    this.processPendingMusic();
  }

  /**
   * Stop the background processor
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🎵 [PROCESSOR] Stopped');
    }
  }

  /**
   * Process all pending music generations
   */
  async processPendingMusic() {
    if (this.isProcessing) {
      return; // Prevent overlapping runs
    }

    try {
      this.isProcessing = true;

      // Find all processing music records
      const pendingMusic = await Music.find({
        status: { $in: ['generating', 'processing'] },
        providerJobId: { $exists: true, $ne: null }
      }).limit(50); // Process max 50 at a time

      if (pendingMusic.length === 0) {
        return;
      }

      console.log(`🎵 [PROCESSOR] Processing ${pendingMusic.length} pending music generations`);

      for (const music of pendingMusic) {
        await this.processIndividualMusic(music);
        // Small delay between requests to avoid rate limiting
        await this.delay(500);
      }

    } catch (error) {
      logger.error('Music processor error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process individual music record
   */
  async processIndividualMusic(music) {
    try {
      console.log(`🎵 [PROCESSOR] Checking music ${music._id} (Job: ${music.providerJobId})`);

      // Get the AI model
      const aiModel = await AIModel.findById(music.modelId);
      if (!aiModel) {
        console.error(`🎵 [PROCESSOR] AI Model not found for music ${music._id}`);
        await this.markAsFailed(music, 'AI Model not found');
        return;
      }

      // Get provider
      const provider = ProviderFactory.getProvider(aiModel);

      // Check status from provider
      const result = await provider.checkStatus(music.providerJobId);
      
      console.log(`🎵 [PROCESSOR] Status for ${music._id}: ${result.status}`);

      switch (result.status) {
        case 'succeeded':
        case 'completed':
          await this.handleCompleted(music, result);
          monitoring.trackMusicGeneration('completed', aiModel.name);
          break;

        case 'failed':
          await this.markAsFailed(music, result.error || 'Generation failed');
          monitoring.trackMusicGeneration('failed', aiModel.name);
          break;

        case 'processing':
        case 'starting':
          // Update progress if available
          if (result.progress !== undefined) {
            music.progress = result.progress;
            await music.save();
          }
          break;

        default:
          console.log(`🎵 [PROCESSOR] Unknown status: ${result.status} for music ${music._id}`);
      }

    } catch (error) {
      logger.error(`Error processing music ${music._id}:`, error);
      
      // If this is a provider error (like 404), mark as failed
      if (error.message.includes('404') || error.message.includes('not found')) {
        await this.markAsFailed(music, 'Provider job not found');
      }
    }
  }

  /**
   * Handle completed music generation
   */
  async handleCompleted(music, result) {
    try {
      console.log(`🎵 [PROCESSOR] Completing music ${music._id}`);

      if (!result.output && !result.audioUrl) {
        await this.markAsFailed(music, 'No audio output received');
        return;
      }

      const audioUrl = result.output || result.audioUrl;
      
      // Update music record with direct URL first
      music.audioUrl = audioUrl;
      music.status = 'completed';
      music.progress = 100;
      
      // 🎨 GENERATE ARTWORK FROM PROMPT AND UPLOAD TO CDN
      try {
        console.log(`🎨 [PROCESSOR] Generating artwork for music ${music._id}`);
        const artworkData = await ArtworkGenerationService.generateArtworkFromPrompt(
          music.prompt,
          music.genre,
          music.mood,
          music._id // Pass musicId for CDN upload
        );
        
        // Store artwork data in music record
        music.artworkUrl = artworkData.cdnUrl || artworkData.gradient; // CDN URL preferred, CSS gradient fallback
        music.artworkData = artworkData; // Full color data for frontend
        
        console.log(`✅ [PROCESSOR] Artwork generated: ${artworkData.baseColor} for music ${music._id}${artworkData.cdnUrl ? `, CDN: ${artworkData.cdnUrl}` : ''}`);
      } catch (artworkError) {
        logger.error(`Failed to generate artwork for music ${music._id}:`, artworkError);
        // Set fallback artwork
        music.artworkUrl = 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A855F7 100%)';
      }
      
      await music.save();

      console.log(`✅ [PROCESSOR] Music ${music._id} completed with URL: ${audioUrl}`);

      // BASİT KREDİ TÜKETİMİ - Müzik tamamlandığında kredi düş
      try {
        const CreditService = require('./CreditService');
        await CreditService.consumeCredits(
          music.userId,
          'music',
          300, // Fixed 300 credits for music
          {
            musicId: music._id,
            completedAt: new Date(),
            audioUrl: audioUrl
          }
        );
        
        console.log(`💳 [PROCESSOR] Credits consumed for completed music ${music._id}: 300 credits`);
      } catch (creditError) {
        logger.error(`Failed to consume credits for music ${music._id}:`, creditError);
      }

      // Try to upload to CDN in background (don't block completion)
      this.uploadToCDN(music, audioUrl).catch(error => {
        logger.error(`CDN upload failed for music ${music._id}:`, error);
      });

    } catch (error) {
      logger.error(`Error completing music ${music._id}:`, error);
      await this.markAsFailed(music, error.message);
    }
  }

  /**
   * Upload audio to CDN
   */
  async uploadToCDN(music, audioUrl) {
    try {
      console.log(`📡 [CDN] Uploading music ${music._id} to CDN...`);

      // Download from Replicate and upload to Cloudflare
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to download audio: ${response.status}`);
      }

      const audioBuffer = await response.arrayBuffer();
      const fileName = `${music._id}_${Date.now()}.mp3`;
      const fullPath = `VeeqAI/Music/${fileName}`;

      const cdnUrl = await cloudflareService.uploadBuffer(
        Buffer.from(audioBuffer),
        fullPath,
        'audio/mpeg'
      );

      // Update music record with CDN URL
      music.cdnUrl = cdnUrl;
      await music.save();

      console.log(`✅ [CDN] Music ${music._id} uploaded to CDN: ${cdnUrl}`);

    } catch (error) {
      logger.error(`CDN upload error for music ${music._id}:`, error);
      // Don't fail the music generation if CDN upload fails
    }
  }

  /**
   * Mark music as failed
   */
  async markAsFailed(music, errorMessage) {
    try {
      music.status = 'failed';
      music.progress = 0;
      music.error = errorMessage; // Add error directly to music object
      if (!music.metadata) music.metadata = {};
      music.metadata.error = errorMessage;
      await music.save();

      // Başarısız durumda kredi düşürme

      console.log(`❌ [PROCESSOR] Music ${music._id} marked as failed: ${errorMessage}`);
    } catch (error) {
      logger.error(`Error marking music as failed ${music._id}:`, error);
    }
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
module.exports = new MusicProcessor();