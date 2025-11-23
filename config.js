require('dotenv').config();

module.exports = {
  // Telegram Bot Token from BotFather
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',

  // AI API Configuration
  AI_API_URL: process.env.AI_API_URL || 'https://apis.davidcyriltech.my.id/ai/chatbot',
  AI_API_KEY: process.env.AI_API_KEY || '',

  // Bot Configuration
  BOT_USERNAME: process.env.BOT_USERNAME || 'AIC5GroupManagerBot',
  
  // Learning Configuration
  LEARNING_ENABLED: process.env.LEARNING_ENABLED !== 'false',
  MIN_CONFIDENCE_THRESHOLD: parseFloat(process.env.MIN_CONFIDENCE_THRESHOLD) || 0.7,
  MAX_RESPONSE_LENGTH: parseInt(process.env.MAX_RESPONSE_LENGTH) || 1000,

  // Database Configuration
  DATABASE_PATH: process.env.DATABASE_PATH || './bot_database.db',
  DATABASE_CLEANUP_DAYS: parseInt(process.env.DATABASE_CLEANUP_DAYS) || 90,

  // Rate Limiting
  MAX_MESSAGES_PER_MINUTE: parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 20,
  
  // Moderation Settings
  AUTO_MODERATION: process.env.AUTO_MODERATION === 'true',
  SPAM_DETECTION: process.env.SPAM_DETECTION !== 'false',

  // Feature Flags
  WELCOME_NEW_MEMBERS: process.env.WELCOME_NEW_MEMBERS !== 'false',
  FEEDBACK_BUTTONS: process.env.FEEDBACK_BUTTONS !== 'false',
  ANALYTICS_ENABLED: process.env.ANALYTICS_ENABLED !== 'false',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_FILE: process.env.LOG_FILE || './bot.log',

  // Admin Configuration
  SUPER_ADMIN_IDS: process.env.SUPER_ADMIN_IDS 
    ? process.env.SUPER_ADMIN_IDS.split(',').map(id => parseInt(id.trim()))
    : [],

  // Response Configuration
  DEFAULT_TONE: process.env.DEFAULT_TONE || 'friendly',
  RESPONSE_DELAY_MS: parseInt(process.env.RESPONSE_DELAY_MS) || 1000,

  // Cache Configuration
  CACHE_TTL_SECONDS: parseInt(process.env.CACHE_TTL_SECONDS) || 3600,
  MAX_CACHE_SIZE: parseInt(process.env.MAX_CACHE_SIZE) || 100,

  // Context Window
  MAX_CONTEXT_MESSAGES: parseInt(process.env.MAX_CONTEXT_MESSAGES) || 10,
  
  // Validation
  validate() {
    const errors = [];

    if (!this.TELEGRAM_BOT_TOKEN) {
      errors.push('TELEGRAM_BOT_TOKEN is required');
    }

    if (!this.AI_API_URL) {
      errors.push('AI_API_URL is required');
    }

    if (errors.length > 0) {
      console.error('❌ Configuration Errors:');
      errors.forEach(err => console.error(`  - ${err}`));
      throw new Error('Invalid configuration. Please check your .env file.');
    }

    console.log('✅ Configuration validated successfully');
    return true;
  }
};

// Validate on load
if (require.main === module) {
  module.exports.validate();
}
