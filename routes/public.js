const express = require('express');
const router = express.Router();
const ResponseUtil = require('../utils/response');
const FeaturedMusicService = require('../services/FeaturedMusicService');

// Get featured music for main app discovery page - NO AUTHENTICATION REQUIRED
router.get('/discover', async (req, res) => {
  try {
    const { category, subcategory, limit = 6 } = req.query;
    
    if (!category) {
      return ResponseUtil.badRequest(res, 'Category parameter is required');
    }
    
    const featuredMusic = await FeaturedMusicService.getFeaturedByCategory(
      category, 
      subcategory, 
      parseInt(limit)
    );
    
    return ResponseUtil.success(res, featuredMusic, 'Featured music retrieved successfully');
  } catch (error) {
    console.error('❌ [FEATURED] Error:', error);
    return ResponseUtil.error(res, 'Failed to fetch featured music', 500, 'FEATURED_ERROR');
  }
});

// Get available categories for frontend - NO AUTHENTICATION REQUIRED
router.get('/categories', async (req, res) => {
  try {
    const categories = FeaturedMusicService.getCategories();
    return ResponseUtil.success(res, categories, 'Categories retrieved successfully');
  } catch (error) {
    console.error('❌ [CATEGORIES] Error:', error);
    return ResponseUtil.error(res, 'Failed to fetch categories', 500, 'CATEGORIES_ERROR');
  }
});

module.exports = router;