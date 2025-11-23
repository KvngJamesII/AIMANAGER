const axios = require('axios');

class AIService {
  constructor() {
    this.apiUrl = 'https://apis.davidcyriltech.my.id/ai/chatbot';
    this.apiKey = ''; // API key is not needed based on the test
    this.conversationCache = new Map(); // Cache conversations per group
  }

  /**
   * Get AI response with context
   */
  async getResponse(query, systemContext = '', groupId = null) {
    try {
      // Build enhanced query with context
      let enhancedQuery = query;
      
      if (systemContext) {
        enhancedQuery = `Context: ${systemContext}\n\nUser question: ${query}`;
      }

      // Make API request
      const response = await axios.get(this.apiUrl, {
        params: {
          query: enhancedQuery,
          apikey: this.apiKey
        },
        timeout: 10000 // 10 second timeout
      });

      if (response.data && response.data.success && response.data.result) {
        const aiResponse = response.data.result;
        
        // Cache response if groupId provided
        if (groupId) {
          this.cacheResponse(groupId, query, aiResponse);
        }

        return aiResponse;
      }

      return null;
    } catch (error) {
      console.error('AI Service Error:', error.message);
      return this.getFallbackResponse(query);
    }
  }

  /**
   * Get response with conversation history
   */
  async getResponseWithHistory(query, conversationHistory = [], groupId = null) {
    try {
      // Build conversation context
      let contextQuery = '';
      
      if (conversationHistory.length > 0) {
        contextQuery = 'Previous conversation:\n';
        conversationHistory.forEach(msg => {
          contextQuery += `${msg.role}: ${msg.content}\n`;
        });
        contextQuery += `\nUser: ${query}`;
      } else {
        contextQuery = query;
      }

      return await this.getResponse(contextQuery, '', groupId);
    } catch (error) {
      console.error('Error getting response with history:', error);
      return this.getFallbackResponse(query);
    }
  }

  /**
   * Analyze sentiment of a message
   */
  async analyzeSentiment(text) {
    try {
      const response = await this.getResponse(
        `Analyze the sentiment of this message in one word (positive, negative, or neutral): "${text}"`
      );
      
      const sentiment = response.toLowerCase().trim();
      if (['positive', 'negative', 'neutral'].includes(sentiment)) {
        return sentiment;
      }
      
      return 'neutral';
    } catch (error) {
      return 'neutral';
    }
  }

  /**
   * Extract keywords from text
   */
  async extractKeywords(text, count = 5) {
    try {
      const response = await this.getResponse(
        `Extract the ${count} most important keywords from this text, return only the keywords separated by commas: "${text}"`
      );
      
      return response.split(',').map(k => k.trim()).filter(k => k.length > 0);
    } catch (error) {
      return [];
    }
  }

  /**
   * Summarize text
   */
  async summarize(text, maxLength = 100) {
    try {
      const response = await this.getResponse(
        `Summarize this text in ${maxLength} characters or less: "${text}"`
      );
      
      return response;
    } catch (error) {
      return text.substring(0, maxLength) + '...';
    }
  }

  /**
   * Check if message is spam
   */
  async isSpam(text) {
    try {
      const response = await this.getResponse(
        `Is this message spam? Answer only "yes" or "no": "${text}"`
      );
      
      return response.toLowerCase().includes('yes');
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if message is inappropriate
   */
  async isInappropriate(text, rules = []) {
    try {
      let query = `Is this message inappropriate or offensive? Answer only "yes" or "no": "${text}"`;
      
      if (rules.length > 0) {
        query = `Based on these rules: ${rules.join(', ')}. Is this message violating any rules? Answer only "yes" or "no": "${text}"`;
      }
      
      const response = await this.getResponse(query);
      return response.toLowerCase().includes('yes');
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate a welcome message
   */
  async generateWelcomeMessage(userName, groupName, groupPurpose) {
    try {
      const response = await this.getResponse(
        `Generate a friendly welcome message for ${userName} joining ${groupName}. ` +
        `The group is about: ${groupPurpose}. Keep it brief and welcoming.`
      );
      
      return response;
    } catch (error) {
      return `👋 Welcome ${userName} to ${groupName}!`;
    }
  }

  /**
   * Improve response based on feedback
   */
  async improveResponse(originalQuestion, originalAnswer, feedback) {
    try {
      const response = await this.getResponse(
        `The question was: "${originalQuestion}". ` +
        `I answered: "${originalAnswer}". ` +
        `User feedback: ${feedback}. ` +
        `Generate an improved answer.`
      );
      
      return response;
    } catch (error) {
      return originalAnswer;
    }
  }

  /**
   * Cache response for faster retrieval
   */
  cacheResponse(groupId, query, response) {
    if (!this.conversationCache.has(groupId)) {
      this.conversationCache.set(groupId, []);
    }

    const cache = this.conversationCache.get(groupId);
    cache.push({
      query: query.toLowerCase(),
      response,
      timestamp: Date.now()
    });

    // Keep only last 50 responses
    if (cache.length > 50) {
      cache.shift();
    }
  }

  /**
   * Get cached response if available
   */
  getCachedResponse(groupId, query) {
    if (!this.conversationCache.has(groupId)) {
      return null;
    }

    const cache = this.conversationCache.get(groupId);
    const normalizedQuery = query.toLowerCase();

    // Find exact or similar match
    const match = cache.find(item => {
      const similarity = this.calculateSimilarity(item.query, normalizedQuery);
      return similarity > 0.8;
    });

    if (match && (Date.now() - match.timestamp) < 3600000) { // 1 hour cache
      return match.response;
    }

    return null;
  }

  /**
   * Calculate string similarity (simple implementation)
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Levenshtein distance calculation
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Fallback response when AI is unavailable
   */
  getFallbackResponse(query) {
    const fallbacks = [
      "I'm having trouble connecting to my AI service right now. Please try again in a moment.",
      "Hmm, I couldn't process that right now. Could you rephrase your question?",
      "I'm experiencing some technical difficulties. An admin will help you shortly!",
      "Sorry, I couldn't understand that. Could you ask in a different way?"
    ];

    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  /**
   * Clear cache for a group
   */
  clearCache(groupId) {
    this.conversationCache.delete(groupId);
  }

  /**
   * Get cache size
   */
  getCacheSize(groupId) {
    return this.conversationCache.has(groupId) 
      ? this.conversationCache.get(groupId).length 
      : 0;
  }
}

module.exports = AIService;
