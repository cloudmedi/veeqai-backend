const mongoose = require('mongoose');

const voiceModelSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  audioFile: {
    type: String,
    required: true
  },
  previewUrl: {
    type: String
  },
  artwork: {
    type: String,
    default: null
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'neutral'],
    default: 'neutral'
  },
  age: {
    type: String,
    enum: ['child', 'young', 'adult', 'senior'],
    default: 'adult'
  },
  language: {
    type: String,
    default: 'tr'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  // Multi-Mood System Fields
  baseVoiceName: {
    type: String,
    trim: true
  },
  mood: {
    type: String,
    enum: [
      'commercial',     // Reklam, tanıtım
      'corporate',      // Kurumsal sunumlar  
      'professional',   // İş sunumları
      'news',           // Haber spikeri
      'documentary',    // Belgesel anlatım
      'educational',    // Eğitim içerikleri
      'storytelling',   // Hikaye anlatımı
      'energetic',      // Enerjik, dinamik
      'calm',           // Sakin, huzurlu
      'friendly',       // Samimi, arkadaşça
      null
    ],
    default: null
  },
  isPartOfGroup: {
    type: Boolean,
    default: false
  },
  groupId: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('VoiceModel', voiceModelSchema);