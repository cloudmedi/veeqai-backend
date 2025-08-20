const mongoose = require('mongoose');

const musicSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  prompt: {
    type: String,
    required: true
  },
  model: {
    type: String,
    required: true,
    default: 'google-lyria-2'
  },
  audioUrl: {
    type: String,
    required: false // Not required during generation
  },
  cdnUrl: {
    type: String
  },
  artworkUrl: {
    type: String // Album cover CDN URL or CSS gradient
  },
  artworkData: {
    baseColor: String,
    gradient: String,
    textColor: String,
    darkerColor: String,
    lighterColor: String,
    source: {
      type: String,
      enum: ['preset', 'generated', 'fallback'],
      default: 'generated'
    },
    style: {
      background: String,
      color: String
    },
    timestamp: Date
  },
  alternativeUrl: {
    type: String // Alternative version CDN URL
  },
  duration: {
    type: Number // in seconds
  },
  genre: {
    type: String
  },
  mood: {
    type: String
  },
  tempo: {
    type: String
  },
  status: {
    type: String,
    enum: ['generating', 'processing', 'completed', 'failed'],
    default: 'generating'
  },
  modelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AIModel'
  },
  modelName: {
    type: String
  },
  provider: {
    type: String
  },
  providerJobId: {
    type: String
  },
  estimatedTime: {
    type: Number
  },
  progress: {
    type: Number,
    default: 0
  },
  error: {
    type: String // Error message for failed generations
  },
  style: {
    type: String
  },
  lyrics: {
    type: String
  },
  plays: {
    type: Number,
    default: 0
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isPublic: {
    type: Boolean,
    default: false
  },
  fileUrl: {
    type: String
  },
  reservedCredits: {
    amount: Number,
    userId: String,
    service: String,
    reserved: Boolean,
    consumedAt: Date
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },
  featured: {
    isActive: { 
      type: Boolean, 
      default: false 
    },
    category: { 
      type: String, 
      enum: ['mood', 'genre', 'usecase']
    },
    subcategory: { 
      type: String // "chill", "upbeat", "podcast", "commercial" vs
    },
    order: { 
      type: Number, 
      default: 0 
    },
    tags: [{ 
      type: String,
      trim: true
    }],
    featuredBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    featuredAt: { 
      type: Date 
    },
    artwork: {
      cdnUrl: String,
      fileName: String,
      uploadedAt: Date
    },
    engagement: {
      views: { type: Number, default: 0 },
      plays: { type: Number, default: 0 },
      downloads: { type: Number, default: 0 },
      lastViewed: Date
    }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Music', musicSchema);