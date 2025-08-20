const mongoose = require('mongoose');

const speechSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  text: {
    type: String,
    required: true
  },
  voiceId: {
    type: String,
    required: true
  },
  voiceName: {
    type: String
  },
  model: {
    type: String,
    required: true,
    default: 'speech-2.5-hd'
  },
  audioUrl: {
    type: String,
    required: true
  },
  cdnUrl: {
    type: String
  },
  duration: {
    type: Number // in seconds
  },
  language: {
    type: String,
    default: 'en'
  },
  speed: {
    type: Number,
    default: 1.0
  },
  pitch: {
    type: Number,
    default: 1.0
  },
  status: {
    type: String,
    enum: ['generating', 'completed', 'failed'],
    default: 'generating'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Speech', speechSchema);