const NodeCache = require('node-cache');
const logger = require('./logger');

class ExchangeRateService {
  constructor() {
    // Cache exchange rates for 1 hour
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    this.fallbackRates = {
      'USD_TO_TRY': 35.0,
      'EUR_TO_TRY': 38.0,
      'USD_TO_EUR': 0.92,
      'TRY_TO_USD': 0.029,
      'TRY_TO_EUR': 0.026,
      'EUR_TO_USD': 1.09
    };
  }

  /**
   * Get exchange rate from one currency to another
   * @param {string} from - Source currency (USD, EUR, TRY)
   * @param {string} to - Target currency (USD, EUR, TRY) 
   * @returns {Promise<number>} Exchange rate
   */
  async getRate(from, to) {
    if (from === to) {
      return 1.0;
    }

    const cacheKey = `${from}_TO_${to}`;
    const cachedRate = this.cache.get(cacheKey);
    
    if (cachedRate) {
      logger.debug(`💱 [EXCHANGE] Using cached rate ${from} → ${to}: ${cachedRate}`);
      return cachedRate;
    }

    try {
      let rate;
      
      // Try multiple APIs for better reliability
      rate = await this.fetchFromTCMB(from, to) ||
             await this.fetchFromExchangeRateAPI(from, to) ||
             await this.fetchFromFixer(from, to);
      
      if (rate) {
        this.cache.set(cacheKey, rate);
        logger.info(`💱 [EXCHANGE] Fresh rate ${from} → ${to}: ${rate}`);
        return rate;
      }

      // Fallback to static rates
      const fallbackRate = this.fallbackRates[cacheKey];
      if (fallbackRate) {
        logger.warn(`⚠️ [EXCHANGE] Using fallback rate ${from} → ${to}: ${fallbackRate}`);
        return fallbackRate;
      }

      throw new Error(`No exchange rate found for ${from} to ${to}`);

    } catch (error) {
      logger.error(`❌ [EXCHANGE] Error getting rate ${from} → ${to}:`, error.message);
      
      // Use fallback rate
      const fallbackRate = this.fallbackRates[cacheKey] || 1.0;
      logger.warn(`⚠️ [EXCHANGE] Using emergency fallback rate ${from} → ${to}: ${fallbackRate}`);
      return fallbackRate;
    }
  }

  /**
   * Convert amount from one currency to another
   * @param {number} amount - Amount to convert
   * @param {string} from - Source currency
   * @param {string} to - Target currency
   * @returns {Promise<number>} Converted amount
   */
  async convert(amount, from, to) {
    const rate = await this.getRate(from, to);
    const converted = Math.round(amount * rate * 100) / 100; // Round to 2 decimals
    
    logger.debug(`💰 [EXCHANGE] Convert ${amount} ${from} → ${converted} ${to} (rate: ${rate})`);
    return converted;
  }

  /**
   * Fetch rates from TCMB (Turkey Central Bank)
   */
  async fetchFromTCMB(from, to) {
    try {
      // TCMB only provides TRY rates
      if (from !== 'TRY' && to !== 'TRY') {
        return null;
      }

      const response = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', {
        timeout: 5000
      });
      
      if (!response.ok) {
        return null;
      }

      const xmlData = await response.text();
      
      // Parse XML to get USD and EUR rates
      const usdMatch = xmlData.match(/<Currency[^>]*Kod="USD"[^>]*>.*?<BanknoteSelling>([\d.,]+)<\/BanknoteSelling>/s);
      const eurMatch = xmlData.match(/<Currency[^>]*Kod="EUR"[^>]*>.*?<BanknoteSelling>([\d.,]+)<\/BanknoteSelling>/s);
      
      if (from === 'USD' && to === 'TRY' && usdMatch) {
        return parseFloat(usdMatch[1].replace(',', '.'));
      }
      
      if (from === 'EUR' && to === 'TRY' && eurMatch) {
        return parseFloat(eurMatch[1].replace(',', '.'));
      }
      
      if (from === 'TRY' && to === 'USD' && usdMatch) {
        return 1 / parseFloat(usdMatch[1].replace(',', '.'));
      }
      
      if (from === 'TRY' && to === 'EUR' && eurMatch) {
        return 1 / parseFloat(eurMatch[1].replace(',', '.'));
      }
      
      return null;
    } catch (error) {
      logger.warn('⚠️ [EXCHANGE] TCMB API failed:', error.message);
      return null;
    }
  }

  /**
   * Fetch rates from ExchangeRate-API (free tier)
   */
  async fetchFromExchangeRateAPI(from, to) {
    try {
      const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`, {
        timeout: 5000
      });
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.rates[to] || null;
    } catch (error) {
      logger.warn('⚠️ [EXCHANGE] ExchangeRate-API failed:', error.message);
      return null;
    }
  }

  /**
   * Fetch rates from Fixer.io (backup)
   */
  async fetchFromFixer(from, to) {
    try {
      // Note: Fixer requires API key for HTTPS, using fallback
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all current rates for a base currency
   * @param {string} base - Base currency (USD, EUR, TRY)
   * @returns {Promise<Object>} Rates object
   */
  async getAllRates(base = 'USD') {
    const currencies = ['USD', 'EUR', 'TRY'];
    const rates = {};

    for (const currency of currencies) {
      if (currency !== base) {
        rates[currency] = await this.getRate(base, currency);
      } else {
        rates[currency] = 1.0;
      }
    }

    return rates;
  }

  /**
   * Update fallback rates (for admin use)
   * @param {Object} newRates - New fallback rates
   */
  updateFallbackRates(newRates) {
    this.fallbackRates = { ...this.fallbackRates, ...newRates };
    logger.info('💱 [EXCHANGE] Fallback rates updated:', newRates);
  }

  /**
   * Clear rate cache
   */
  clearCache() {
    this.cache.flushAll();
    logger.info('🧹 [EXCHANGE] Rate cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      keys: this.cache.keys(),
      stats: this.cache.getStats()
    };
  }
}

// Export singleton instance
module.exports = new ExchangeRateService();