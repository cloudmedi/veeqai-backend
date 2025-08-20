const mongoose = require('mongoose');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Usage = require('../models/Usage');
const RedisManager = require('./redis/RedisManager');
const logger = require('./logger');
const EventBus = require('./events/EventBus');

/**
 * Enterprise-grade Credit Reservation and Consumption System
 * Ensures credits are only deducted after successful completion
 */
class EnterpriseCreditService {
  constructor() {
    this.cacheTTL = 300; // 5 minutes cache
    this.reservationTTL = 1800; // 30 minutes reservation timeout
  }

  /**
   * 1. REZERVASYON AŞAMASI - Credit Reservation
   * İşlem başladığında kredileri rezerve et ama düşürme
   */
  async reserveCredits(userId, service, amount, operationId) {
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        console.log(`💳 [RESERVE] Starting credit reservation for user ${userId}, amount: ${amount}`);
        
        // Kredi bilgilerini getir
        const creditInfo = await this.getUserCreditInfo(userId);
        
        // Yeteri kadar kredi var mı kontrol et
        if (creditInfo.available < amount) {
          throw new Error(`Insufficient credits: ${amount} required, ${creditInfo.available} available`);
        }
        
        // Redis'te rezervasyon oluştur
        const reservationKey = `credit:reservation:${operationId}`;
        const reservationData = {
          userId,
          service,
          amount,
          status: 'reserved',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + this.reservationTTL * 1000).toISOString()
        };
        
        await RedisManager.setCache(reservationKey, reservationData, this.reservationTTL);
        
        // Kullanıcının aktif rezervasyonlarını takip et
        const userReservationsKey = `credit:user_reservations:${userId}`;
        let userReservations = await RedisManager.getCache(userReservationsKey) || [];
        userReservations.push(operationId);
        await RedisManager.setCache(userReservationsKey, userReservations, this.reservationTTL);
        
        console.log(`✅ [RESERVE] Credits reserved successfully: ${amount} credits for operation ${operationId}`);
        
        // Cache'i temizle - fresh data için
        await this.clearUserCreditCache(userId);
        
        return {
          success: true,
          reservationId: operationId,
          amount,
          expiresAt: reservationData.expiresAt
        };
      });
    } catch (error) {
      console.error(`❌ [RESERVE] Failed to reserve credits:`, error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * 2. TÜKETİM AŞAMASI - Credit Consumption  
   * İşlem başarıyla tamamlandığında rezerve edilen kredileri tüket
   */
  async consumeReservedCredits(operationId, metadata = {}) {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        console.log(`💳 [CONSUME] Starting credit consumption for operation ${operationId}`);
        
        // Rezervasyonu getir
        const reservationKey = `credit:reservation:${operationId}`;
        const reservation = await RedisManager.getCache(reservationKey);
        
        if (!reservation) {
          throw new Error(`Reservation not found: ${operationId}`);
        }
        
        if (reservation.status !== 'reserved') {
          throw new Error(`Invalid reservation status: ${reservation.status}`);
        }
        
        // Rezervasyonun süresinin dolup dolmadığını kontrol et
        if (new Date() > new Date(reservation.expiresAt)) {
          // Süresi dolmuş rezervasyonu temizle
          await RedisManager.deleteCache(reservationKey);
          throw new Error(`Reservation expired: ${operationId}`);
        }
        
        // Subscription'dan kredileri düş
        const result = await Subscription.findOneAndUpdate(
          { user: reservation.userId, status: 'active' },
          {
            $inc: { 'credits.used': reservation.amount },
            $push: {
              'credits.history': {
                date: new Date(),
                service: reservation.service,
                credits: reservation.amount,
                operationId,
                metadata: {
                  ...metadata,
                  reservedAt: reservation.createdAt,
                  consumedAt: new Date().toISOString()
                }
              }
            }
          },
          { new: true, session }
        );
        
        if (!result) {
          throw new Error(`Subscription not found for user: ${reservation.userId}`);
        }
        
        // Rezervasyonu tüketime işaretle
        reservation.status = 'consumed';
        reservation.consumedAt = new Date().toISOString();
        reservation.metadata = metadata;
        await RedisManager.setCache(reservationKey, reservation, 86400); // 24 saat tutma
        
        // Kullanıcının rezervasyon listesinden çıkar
        await this.removeUserReservation(reservation.userId, operationId);
        
        // Cache'leri temizle
        await this.clearUserCreditCache(reservation.userId);
        
        console.log(`✅ [CONSUME] Credits consumed successfully: ${reservation.amount} credits for user ${reservation.userId}`);
        
        // Real-time güncelleme için WebSocket event gönder
        await this.notifyUserCreditUpdate(reservation.userId);
        
        // Analytics event yayınla
        await EventBus.publishSystemEvent('credit.consumed', {
          userId: reservation.userId,
          service: reservation.service,
          credits: reservation.amount,
          operationId,
          metadata
        });
        
        return {
          success: true,
          creditsConsumed: reservation.amount,
          operationId,
          userId: reservation.userId
        };
      });
    } catch (error) {
      console.error(`❌ [CONSUME] Failed to consume credits:`, error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * 3. İPTAL AŞAMASI - Credit Reservation Cancellation
   * İşlem başarısız olduğunda rezervasyonu iptal et
   */
  async cancelReservation(operationId, reason = 'Operation failed') {
    try {
      console.log(`💳 [CANCEL] Cancelling reservation for operation ${operationId}`);
      
      const reservationKey = `credit:reservation:${operationId}`;
      const reservation = await RedisManager.getCache(reservationKey);
      
      if (!reservation) {
        console.log(`⚠️ [CANCEL] Reservation not found: ${operationId}`);
        return { success: true, message: 'Reservation not found' };
      }
      
      // Rezervasyonu iptal et
      reservation.status = 'cancelled';
      reservation.cancelledAt = new Date().toISOString();
      reservation.cancellationReason = reason;
      await RedisManager.setCache(reservationKey, reservation, 86400); // 24 saat tutma
      
      // Kullanıcının rezervasyon listesinden çıkar
      await this.removeUserReservation(reservation.userId, operationId);
      
      console.log(`✅ [CANCEL] Reservation cancelled: ${operationId}`);
      
      return {
        success: true,
        operationId,
        reason
      };
    } catch (error) {
      console.error(`❌ [CANCEL] Failed to cancel reservation:`, error);
      throw error;
    }
  }

  /**
   * Kullanıcının mevcut kredi bilgilerini getir (rezervasyonlar dahil)
   */
  async getUserCreditInfo(userId) {
    try {
      const cacheKey = `credit:info:${userId}`;
      
      // Cache'den dene
      const cached = await RedisManager.getCache(cacheKey);
      if (cached) {
        return cached;
      }
      
      // Aktif subscription getir
      let subscription = await Subscription.findOne({
        user: userId,
        status: 'active'
      }).populate('plan');
      
      // Subscription yoksa free plan ile oluştur
      if (!subscription) {
        subscription = await this.createFreeSubscription(userId);
      }
      
      if (!subscription || !subscription.plan) {
        throw new Error('Failed to create or find subscription');
      }
      
      // Aktif rezervasyonları getir
      const reservedCredits = await this.getUserReservedCredits(userId);
      
      // Rollover kredilerini getir
      const rolloverCredits = await this.getRolloverCredits(userId);
      
      const subscriptionUsed = subscription.credits?.used || 0;
      const totalAvailable = subscription.plan.credits.monthly + rolloverCredits;
      const actuallyAvailable = Math.max(0, totalAvailable - subscriptionUsed - reservedCredits);
      
      const creditInfo = {
        plan: {
          id: subscription.plan._id,
          name: subscription.plan.displayName,
          monthly: subscription.plan.credits.monthly
        },
        used: subscriptionUsed,
        reserved: reservedCredits,
        available: actuallyAvailable,
        rollover: rolloverCredits,
        total: totalAvailable,
        utilizationPercent: Math.round((subscriptionUsed / totalAvailable) * 100)
      };
      
      // Kısa cache - dinamik veri
      await RedisManager.setCache(cacheKey, creditInfo, 60);
      
      return creditInfo;
    } catch (error) {
      logger.error('Failed to get user credit info:', error);
      throw error;
    }
  }

  /**
   * WebSocket ile kullanıcıya real-time kredi güncellemesi gönder
   */
  async notifyUserCreditUpdate(userId) {
    try {
      const SocketManager = require('./SocketManager');
      const freshCreditInfo = await this.getUserCreditInfo(userId);
      
      SocketManager.emitToUser(userId, 'credit_updated', {
        credits: freshCreditInfo.available,
        used: freshCreditInfo.used,
        total: freshCreditInfo.total,
        reserved: freshCreditInfo.reserved,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📡 [WEBSOCKET] Credit update sent to user ${userId}: ${freshCreditInfo.available} credits`);
    } catch (error) {
      console.error(`Failed to notify user credit update:`, error);
    }
  }

  /**
   * Utility Methods
   */
  async getUserReservedCredits(userId) {
    try {
      const userReservationsKey = `credit:user_reservations:${userId}`;
      const reservationIds = await RedisManager.getCache(userReservationsKey) || [];
      
      let totalReserved = 0;
      for (const operationId of reservationIds) {
        const reservationKey = `credit:reservation:${operationId}`;
        const reservation = await RedisManager.getCache(reservationKey);
        
        if (reservation && reservation.status === 'reserved') {
          // Süresinin dolup dolmadığını kontrol et
          if (new Date() <= new Date(reservation.expiresAt)) {
            totalReserved += reservation.amount;
          } else {
            // Süresi dolmuş, temizle
            await RedisManager.deleteCache(reservationKey);
          }
        }
      }
      
      return totalReserved;
    } catch (error) {
      console.error('Failed to get user reserved credits:', error);
      return 0;
    }
  }

  async removeUserReservation(userId, operationId) {
    const userReservationsKey = `credit:user_reservations:${userId}`;
    let userReservations = await RedisManager.getCache(userReservationsKey) || [];
    userReservations = userReservations.filter(id => id !== operationId);
    
    if (userReservations.length > 0) {
      await RedisManager.setCache(userReservationsKey, userReservations, this.reservationTTL);
    } else {
      await RedisManager.deleteCache(userReservationsKey);
    }
  }

  async clearUserCreditCache(userId) {
    const cacheKey = `credit:info:${userId}`;
    await RedisManager.deleteCache(cacheKey);
    
    const usageCacheKey = `credit:usage:${userId}:${this.getCurrentMonth()}`;
    await RedisManager.deleteCache(usageCacheKey);
  }

  async createFreeSubscription(userId) {
    console.log(`Creating free subscription for user: ${userId}`);
    
    const freePlan = await Plan.findOne({ name: 'free' });
    if (!freePlan) {
      throw new Error('Free plan not found. Please seed plans first.');
    }
    
    const subscription = new Subscription({
      user: userId,
      plan: freePlan._id,
      planName: 'Free Plan',
      pricing: {
        amount: 0,
        currency: 'USD',
        interval: 'monthly'
      },
      credits: {
        monthly: freePlan.credits.monthly,
        used: 0,
        rollover: 0,
        periodStart: new Date(),
        usageByService: {
          tts: 0,
          music: 0,
          voiceClone: 0,
          voiceIsolator: 0
        },
        history: []
      },
      status: 'active',
      metadata: {
        source: 'auto-created'
      }
    });
    
    await subscription.save();
    return await Subscription.findById(subscription._id).populate('plan');
  }

  async getRolloverCredits(userId) {
    try {
      const rolloverKey = `credit:rollover:${userId}`;
      const rolloverData = await RedisManager.getCache(rolloverKey);
      
      if (!rolloverData) {
        return 0;
      }
      
      const monthsOld = this.getMonthsDifference(new Date(rolloverData.expiresAt), new Date());
      
      if (monthsOld <= 0) {
        return rolloverData.credits || 0;
      }
      
      await RedisManager.deleteCache(rolloverKey);
      return 0;
    } catch (error) {
      console.error('Failed to get rollover credits:', error);
      return 0;
    }
  }

  getCurrentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  getMonthsDifference(date1, date2) {
    return (date2.getFullYear() - date1.getFullYear()) * 12 + date2.getMonth() - date1.getMonth();
  }

  /**
   * Süresi dolmuş rezervasyonları temizleme görevi
   */
  async cleanupExpiredReservations() {
    try {
      console.log('🧹 [CLEANUP] Starting expired reservation cleanup...');
      
      // Bu gelecek implementasyon için - Redis pattern matching gerekli
      // Şimdilik manuel cleanup yapılacak
      
      console.log('✅ [CLEANUP] Cleanup completed');
    } catch (error) {
      console.error('❌ [CLEANUP] Failed to cleanup expired reservations:', error);
    }
  }
}

// Export singleton instance
module.exports = new EnterpriseCreditService();