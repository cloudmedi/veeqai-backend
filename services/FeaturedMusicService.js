const Music = require('../models/Music');
const cloudflareService = require('./cloudflare');
const logger = require('./logger');

/**
 * Enterprise Featured Music Management Service
 * Handles featured music operations with real-time updates
 */
class FeaturedMusicService {
  constructor() {
    // CDN path for artworks
    this.artworkPath = 'VeeqAI/Artwork/';
    
    // Category definitions
    this.categories = {
      mood: ['chill', 'upbeat', 'relaxing', 'energetic', 'peaceful', 'dramatic'],
      genre: ['electronic', 'acoustic', 'orchestral', 'jazz', 'ambient', 'cinematic'],
      usecase: ['podcast', 'commercial', 'background', 'presentation', 'meditation', 'workout']
    };
  }

  /**
   * Set music as featured
   */
  async setFeatured(musicId, adminUserId, options = {}) {
    try {
      const { category, subcategory, order = 0 } = options;
      
      console.log(`📌 [FEATURED] Setting music ${musicId} as featured by admin ${adminUserId}`);
      
      // Validate category and subcategory
      if (!this.categories[category] || !this.categories[category].includes(subcategory)) {
        throw new Error(`Invalid category/subcategory: ${category}/${subcategory}`);
      }
      
      // Check if music exists
      const music = await Music.findById(musicId);
      if (!music) {
        throw new Error(`Music not found: ${musicId}`);
      }
      
      // Update music as featured
      const updatedMusic = await Music.findByIdAndUpdate(
        musicId,
        {
          'featured.isActive': true,
          'featured.category': category,
          'featured.subcategory': subcategory,
          'featured.order': order,
          'featured.featuredBy': adminUserId,
          'featured.featuredAt': new Date()
        },
        { new: true }
      );
      
      console.log(`✅ [FEATURED] Music ${musicId} set as featured in ${category}/${subcategory}`);
      
      // Broadcast update via WebSocket
      await this.broadcastFeaturedUpdate('featured_music_added', {
        musicId,
        category,
        subcategory,
        music: updatedMusic
      });
      
      return updatedMusic;
    } catch (error) {
      logger.error(`Failed to set music as featured:`, error);
      throw error;
    }
  }

  /**
   * Remove music from featured
   */
  async unsetFeatured(musicId, adminUserId) {
    try {
      console.log(`📌 [FEATURED] Removing music ${musicId} from featured by admin ${adminUserId}`);
      
      const music = await Music.findById(musicId);
      if (!music || !music.featured?.isActive) {
        throw new Error(`Music not featured or not found: ${musicId}`);
      }
      
      const category = music.featured.category;
      const subcategory = music.featured.subcategory;
      
      // Remove from featured
      const updatedMusic = await Music.findByIdAndUpdate(
        musicId,
        {
          'featured.isActive': false,
          'featured.category': null,
          'featured.subcategory': null,
          'featured.order': 0,
          'featured.featuredBy': null,
          'featured.featuredAt': null
        },
        { new: true }
      );
      
      console.log(`✅ [FEATURED] Music ${musicId} removed from featured`);
      
      // Broadcast update via WebSocket
      await this.broadcastFeaturedUpdate('featured_music_removed', {
        musicId,
        category,
        subcategory
      });
      
      return updatedMusic;
    } catch (error) {
      logger.error(`Failed to unset featured music:`, error);
      throw error;
    }
  }

  /**
   * Upload artwork for featured music
   */
  async uploadArtwork(musicId, fileBuffer, fileName, mimeType) {
    try {
      console.log(`🎨 [ARTWORK] Uploading artwork for music ${musicId}`);
      
      // Check if music is featured
      const music = await Music.findById(musicId);
      if (!music || !music.featured?.isActive) {
        throw new Error(`Music not featured: ${musicId}`);
      }
      
      // Generate unique filename
      const fileExtension = fileName.split('.').pop();
      const uniqueFileName = `${musicId}_${Date.now()}.${fileExtension}`;
      const cdnPath = `${this.artworkPath}${uniqueFileName}`;
      
      // Upload to CDN
      const cdnUrl = await cloudflareService.uploadBuffer(
        fileBuffer,
        cdnPath,
        mimeType
      );
      
      // Update music with artwork info
      const updatedMusic = await Music.findByIdAndUpdate(
        musicId,
        {
          'featured.artwork.cdnUrl': cdnUrl,
          'featured.artwork.fileName': uniqueFileName,
          'featured.artwork.uploadedAt': new Date()
        },
        { new: true }
      );
      
      console.log(`✅ [ARTWORK] Artwork uploaded for music ${musicId}: ${cdnUrl}`);
      
      // Broadcast update
      await this.broadcastFeaturedUpdate('featured_artwork_updated', {
        musicId,
        artworkUrl: cdnUrl,
        category: music.featured.category,
        subcategory: music.featured.subcategory
      });
      
      return { cdnUrl, music: updatedMusic };
    } catch (error) {
      logger.error(`Failed to upload artwork:`, error);
      throw error;
    }
  }

  /**
   * Get featured music by category
   */
  async getFeaturedByCategory(category, subcategory = null, limit = 6) {
    try {
      const query = {
        'featured.isActive': true,
        'featured.category': category
      };
      
      if (subcategory) {
        query['featured.subcategory'] = subcategory;
      }
      
      const featuredMusic = await Music.find(query)
        .sort({ 'featured.order': 1, 'featured.featuredAt': -1 })
        .limit(limit)
        .select('title prompt audioUrl cdnUrl artworkUrl duration featured createdAt');
      
      console.log(`📋 [FEATURED] Found ${featuredMusic.length} featured music for ${category}${subcategory ? '/' + subcategory : ''}`);
      
      return featuredMusic;
    } catch (error) {
      logger.error(`Failed to get featured music:`, error);
      throw error;
    }
  }

  /**
   * Get all featured music for admin
   */
  async getAllFeatured() {
    try {
      const featuredMusic = await Music.find({
        'featured.isActive': true
      })
      .sort({ 'featured.category': 1, 'featured.subcategory': 1, 'featured.order': 1 })
      .populate('featuredBy', 'name email')
      .select('title prompt audioUrl cdnUrl artworkUrl duration featured createdAt userId');
      
      return featuredMusic;
    } catch (error) {
      logger.error(`Failed to get all featured music:`, error);
      throw error;
    }
  }

  /**
   * Update featured music order
   */
  async updateOrder(musicId, newOrder) {
    try {
      const updatedMusic = await Music.findByIdAndUpdate(
        musicId,
        { 'featured.order': newOrder },
        { new: true }
      );
      
      if (!updatedMusic) {
        throw new Error(`Music not found: ${musicId}`);
      }
      
      // Broadcast update
      await this.broadcastFeaturedUpdate('featured_order_changed', {
        musicId,
        newOrder,
        category: updatedMusic.featured.category,
        subcategory: updatedMusic.featured.subcategory
      });
      
      return updatedMusic;
    } catch (error) {
      logger.error(`Failed to update featured order:`, error);
      throw error;
    }
  }

  /**
   * Track engagement
   */
  async trackEngagement(musicId, action) {
    try {
      const validActions = ['view', 'play', 'download'];
      if (!validActions.includes(action)) {
        throw new Error(`Invalid action: ${action}`);
      }
      
      const updateField = `featured.engagement.${action}s`;
      const updateQuery = {
        $inc: { [updateField]: 1 },
        $set: { 'featured.engagement.lastViewed': new Date() }
      };
      
      await Music.findByIdAndUpdate(musicId, updateQuery);
      
      console.log(`📊 [ENGAGEMENT] Tracked ${action} for music ${musicId}`);
    } catch (error) {
      logger.error(`Failed to track engagement:`, error);
      throw error;
    }
  }

  /**
   * Get available categories
   */
  getCategories() {
    return this.categories;
  }

  /**
   * Broadcast featured updates via WebSocket
   */
  async broadcastFeaturedUpdate(event, data) {
    try {
      // Get EventBus for WebSocket broadcasting
      const EventBus = require('./events/EventBus');
      
      // Broadcast to all connected clients via EventBus
      EventBus.publish('websocket.broadcast', {
        type: event,
        targetRoom: 'users',
        timestamp: new Date().toISOString(),
        ...data
      });
      
      console.log(`📡 [WEBSOCKET] Broadcasted ${event} to all clients`);
    } catch (error) {
      console.error(`Failed to broadcast featured update:`, error);
    }
  }

  /**
   * Get engagement analytics
   */
  async getEngagementAnalytics(category = null, subcategory = null) {
    try {
      const query = { 'featured.isActive': true };
      
      if (category) query['featured.category'] = category;
      if (subcategory) query['featured.subcategory'] = subcategory;
      
      const analytics = await Music.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              category: '$featured.category',
              subcategory: '$featured.subcategory'
            },
            totalViews: { $sum: '$featured.engagement.views' },
            totalPlays: { $sum: '$featured.engagement.plays' },
            totalDownloads: { $sum: '$featured.engagement.downloads' },
            avgViews: { $avg: '$featured.engagement.views' },
            avgPlays: { $avg: '$featured.engagement.plays' },
            count: { $sum: 1 }
          }
        },
        { $sort: { totalViews: -1 } }
      ]);
      
      return analytics;
    } catch (error) {
      logger.error(`Failed to get engagement analytics:`, error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new FeaturedMusicService();