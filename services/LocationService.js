const NodeCache = require('node-cache');
const logger = require('./logger');

class LocationService {
  constructor() {
    // Cache location data for 24 hours
    this.cache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });
    
    // Currency preferences by country
    this.countryToCurrency = {
      'TR': 'TRY', // Turkey
      'US': 'USD', // United States
      'DE': 'EUR', 'FR': 'EUR', 'IT': 'EUR', 'ES': 'EUR', 'NL': 'EUR',
      'BE': 'EUR', 'AT': 'EUR', 'PT': 'EUR', 'GR': 'EUR', 'FI': 'EUR',
      'IE': 'EUR', 'LU': 'EUR', 'SI': 'EUR', 'SK': 'EUR', 'EE': 'EUR',
      'LV': 'EUR', 'LT': 'EUR', 'CY': 'EUR', 'MT': 'EUR', // Eurozone
      'GB': 'USD', // UK - use USD for better payment support
      'CA': 'USD', 'AU': 'USD', 'NZ': 'USD', 'SG': 'USD', 'HK': 'USD',
      'AE': 'USD', 'SA': 'USD', 'KW': 'USD', 'QA': 'USD' // USD preference countries
    };

    // Turkish regions/cities for more precise detection
    this.turkishRegions = [
      'istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'gaziantep',
      'konya', 'kayseri', 'adana', 'mersin', 'trabzon', 'erzurum',
      'samsun', 'malatya', 'van', 'diyarbakir', 'denizli', 'sakarya'
    ];
  }

  /**
   * Get user's preferred currency based on location
   * @param {Object} request - Express request object
   * @returns {Promise<Object>} Location and currency info
   */
  async getUserCurrency(req) {
    try {
      const ip = this.extractIP(req);
      const cacheKey = `location_${ip}`;
      
      // Check cache first
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.debug(`🌍 [LOCATION] Using cached location for ${ip}:`, cached);
        return cached;
      }

      // Get location data
      const locationData = await this.getLocationFromIP(ip);
      
      // Determine currency
      const currency = this.determineCurrency(locationData, req);
      
      const result = {
        ip,
        country: locationData.country,
        countryCode: locationData.countryCode,
        city: locationData.city,
        currency,
        confidence: locationData.confidence || 'medium',
        source: locationData.source || 'ip'
      };

      // Cache the result
      this.cache.set(cacheKey, result);
      
      logger.info(`🌍 [LOCATION] User location detected:`, {
        ip: ip.replace(/\d+$/, 'xxx'), // Mask last IP octet for privacy
        country: result.country,
        currency: result.currency
      });

      return result;

    } catch (error) {
      logger.warn('⚠️ [LOCATION] Location detection failed:', error.message);
      
      // Fallback to default
      return {
        ip: 'unknown',
        country: 'Unknown',
        countryCode: 'US',
        currency: 'USD',
        confidence: 'low',
        source: 'fallback'
      };
    }
  }

  /**
   * Extract real IP address from request
   * @param {Object} req - Express request object
   * @returns {string} IP address
   */
  extractIP(req) {
    // Check various headers for real IP
    const forwardedFor = req.headers['x-forwarded-for'];
    const realIP = req.headers['x-real-ip'];
    const cloudflareIP = req.headers['cf-connecting-ip'];
    const remoteAddr = req.connection?.remoteAddress || req.socket?.remoteAddress;

    let ip = cloudflareIP || realIP || forwardedFor?.split(',')[0]?.trim() || remoteAddr;
    
    // Handle IPv6 mapped IPv4
    if (ip?.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }

    // Local development fallback
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.')) {
      return '185.125.190.39'; // Example Turkish IP for development
    }

    return ip;
  }

  /**
   * Get location information from IP address
   * @param {string} ip - IP address
   * @returns {Promise<Object>} Location data
   */
  async getLocationFromIP(ip) {
    try {
      // Try multiple free IP location services
      let locationData = 
        await this.fetchFromIpApi(ip) ||
        await this.fetchFromIpInfo(ip) ||
        await this.fetchFromFreeGeoIP(ip);

      if (!locationData) {
        throw new Error('All location services failed');
      }

      return locationData;

    } catch (error) {
      logger.warn(`⚠️ [LOCATION] IP location failed for ${ip}:`, error.message);
      
      // Return default location
      return {
        country: 'United States',
        countryCode: 'US',
        city: 'New York',
        confidence: 'low',
        source: 'fallback'
      };
    }
  }

  /**
   * Fetch location from ip-api.com (free, no key required)
   */
  async fetchFromIpApi(ip) {
    try {
      const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,timezone`, {
        timeout: 5000
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      
      if (data.status !== 'success') {
        return null;
      }

      return {
        country: data.country,
        countryCode: data.countryCode,
        city: data.city,
        timezone: data.timezone,
        confidence: 'high',
        source: 'ip-api'
      };

    } catch (error) {
      logger.debug('⚠️ [LOCATION] ip-api.com failed:', error.message);
      return null;
    }
  }

  /**
   * Fetch location from ipinfo.io (free tier)
   */
  async fetchFromIpInfo(ip) {
    try {
      const response = await fetch(`https://ipinfo.io/${ip}/json`, {
        timeout: 5000
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      return {
        country: data.country_name || data.country,
        countryCode: data.country,
        city: data.city,
        region: data.region,
        confidence: 'medium',
        source: 'ipinfo'
      };

    } catch (error) {
      logger.debug('⚠️ [LOCATION] ipinfo.io failed:', error.message);
      return null;
    }
  }

  /**
   * Fetch location from freegeoip.app (backup)
   */
  async fetchFromFreeGeoIP(ip) {
    try {
      const response = await fetch(`https://freegeoip.app/json/${ip}`, {
        timeout: 5000
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      return {
        country: data.country_name,
        countryCode: data.country_code,
        city: data.city,
        region: data.region_name,
        confidence: 'medium',
        source: 'freegeoip'
      };

    } catch (error) {
      logger.debug('⚠️ [LOCATION] freegeoip.app failed:', error.message);
      return null;
    }
  }

  /**
   * Determine preferred currency based on location and other factors
   * @param {Object} locationData - Location information
   * @param {Object} req - Express request object
   * @returns {string} Currency code
   */
  determineCurrency(locationData, req) {
    const countryCode = locationData.countryCode?.toUpperCase();
    
    // Check Accept-Language header for Turkish preference
    const acceptLanguage = req.headers['accept-language'] || '';
    const hasTurkish = acceptLanguage.toLowerCase().includes('tr');
    
    // Check city/region names for Turkish locations
    const city = locationData.city?.toLowerCase() || '';
    const region = locationData.region?.toLowerCase() || '';
    const isTurkishCity = this.turkishRegions.some(tr => 
      city.includes(tr) || region.includes(tr)
    );

    // Priority order for currency determination
    if (countryCode === 'TR' || hasTurkish || isTurkishCity) {
      return 'TRY';
    }

    // Check country-to-currency mapping
    if (countryCode && this.countryToCurrency[countryCode]) {
      return this.countryToCurrency[countryCode];
    }

    // Default to USD for unknown regions
    return 'USD';
  }

  /**
   * Get supported currencies for a location
   * @param {string} countryCode - ISO country code
   * @returns {Array} Array of supported currencies in order of preference
   */
  getSupportedCurrencies(countryCode) {
    const primary = this.countryToCurrency[countryCode?.toUpperCase()] || 'USD';
    
    if (primary === 'TRY') {
      return ['TRY', 'USD', 'EUR'];
    } else if (primary === 'EUR') {
      return ['EUR', 'USD', 'TRY'];
    } else {
      return ['USD', 'EUR', 'TRY'];
    }
  }

  /**
   * Check if user is likely from Turkey
   * @param {Object} req - Express request object
   * @returns {Promise<boolean>} Is user from Turkey
   */
  async isTurkishUser(req) {
    const location = await this.getUserCurrency(req);
    return location.currency === 'TRY';
  }

  /**
   * Clear location cache
   */
  clearCache() {
    this.cache.flushAll();
    logger.info('🧹 [LOCATION] Location cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      keys: this.cache.keys().length,
      stats: this.cache.getStats()
    };
  }
}

// Export singleton instance
module.exports = new LocationService();