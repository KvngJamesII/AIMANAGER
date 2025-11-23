const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

class Database {
  constructor() {
    this.db = null;
    this.initialize();
  }

  async initialize() {
    try {
      this.db = await open({
        filename: path.join(__dirname, 'bot_database.db'),
        driver: sqlite3.Database
      });

      await this.createTables();
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      throw error;
    }
  }

  async createTables() {
    // Groups table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY,
        group_id INTEGER UNIQUE NOT NULL,
        group_name TEXT,
        purpose TEXT,
        tone TEXT,
        rules TEXT,
        triggers TEXT,
        setup_complete BOOLEAN DEFAULT 0,
        paused BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Setup states table (NEW - for persistent setup tracking)
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS setup_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER UNIQUE NOT NULL,
        group_id INTEGER NOT NULL,
        step TEXT NOT NULL,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Messages table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        message_id INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(group_id)
      )
    `);

    // Learned responses table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS learned_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        learned_from TEXT DEFAULT 'manual',
        usage_count INTEGER DEFAULT 0,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(group_id)
      )
    `);

    // Interactions table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        source TEXT DEFAULT 'ai',
        question_msg_id INTEGER,
        answer_msg_id INTEGER,
        feedback INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(group_id)
      )
    `);

    // Keywords table for learning
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        frequency INTEGER DEFAULT 1,
        context TEXT,
        last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(group_id)
      )
    `);

    // User stats table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(group_id),
        UNIQUE(group_id, user_id)
      )
    `);

    // Create indexes for better performance
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
      CREATE INDEX IF NOT EXISTS idx_learned_responses_group ON learned_responses(group_id);
      CREATE INDEX IF NOT EXISTS idx_interactions_group ON interactions(group_id);
      CREATE INDEX IF NOT EXISTS idx_keywords_group ON keywords(group_id);
      CREATE INDEX IF NOT EXISTS idx_setup_states_user ON setup_states(user_id);
    `);
  }

  // Setup state operations
  async saveSetupState(userId, groupId, step, data = {}) {
    try {
      await this.db.run(`
        INSERT INTO setup_states (user_id, group_id, step, data, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) 
        DO UPDATE SET step = ?, data = ?, updated_at = CURRENT_TIMESTAMP
      `, [userId, groupId, step, JSON.stringify(data), step, JSON.stringify(data)]);
    } catch (error) {
      console.error('Error saving setup state:', error);
    }
  }

  async getSetupState(userId) {
    try {
      const state = await this.db.get(
        'SELECT * FROM setup_states WHERE user_id = ?',
        [userId]
      );
      
      if (state && state.data) {
        state.data = JSON.parse(state.data);
      }
      
      return state;
    } catch (error) {
      console.error('Error getting setup state:', error);
      return null;
    }
  }

  async deleteSetupState(userId) {
    try {
      await this.db.run(
        'DELETE FROM setup_states WHERE user_id = ?',
        [userId]
      );
    } catch (error) {
      console.error('Error deleting setup state:', error);
    }
  }

  // Group operations
  async addGroup(groupId, groupName) {
    try {
      await this.db.run(
        'INSERT OR IGNORE INTO groups (group_id, group_name) VALUES (?, ?)',
        [groupId, groupName]
      );
    } catch (error) {
      console.error('Error adding group:', error);
    }
  }

  async getGroup(groupId) {
    try {
      const group = await this.db.get(
        'SELECT * FROM groups WHERE group_id = ?',
        [groupId]
      );
      
      if (group && group.rules) {
        group.rules = JSON.parse(group.rules);
      }
      if (group && group.triggers) {
        group.triggers = JSON.parse(group.triggers);
      }
      
      return group;
    } catch (error) {
      console.error('Error getting group:', error);
      return null;
    }
  }

  async updateGroupConfig(groupId, config) {
    try {
      await this.db.run(`
        UPDATE groups 
        SET purpose = ?, tone = ?, rules = ?, triggers = ?, setup_complete = 1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ?
      `, [
        config.purpose,
        config.tone,
        JSON.stringify(config.rules),
        JSON.stringify(config.triggers),
        groupId
      ]);
    } catch (error) {
      console.error('Error updating group config:', error);
    }
  }

  async togglePause(groupId, paused) {
    try {
      await this.db.run(
        'UPDATE groups SET paused = ? WHERE group_id = ?',
        [paused ? 1 : 0, groupId]
      );
    } catch (error) {
      console.error('Error toggling pause:', error);
    }
  }

  // Message operations
  async storeMessage(groupId, userId, content, messageId) {
    try {
      await this.db.run(
        'INSERT INTO messages (group_id, user_id, content, message_id) VALUES (?, ?, ?, ?)',
        [groupId, userId, content, messageId]
      );

      // Update user stats
      await this.db.run(`
        INSERT INTO user_stats (group_id, user_id, message_count, last_active)
        VALUES (?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, user_id) 
        DO UPDATE SET message_count = message_count + 1, last_active = CURRENT_TIMESTAMP
      `, [groupId, userId]);
    } catch (error) {
      console.error('Error storing message:', error);
    }
  }

  async getRecentMessages(groupId, limit = 10) {
    try {
      return await this.db.all(
        'SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?',
        [groupId, limit]
      );
    } catch (error) {
      console.error('Error getting recent messages:', error);
      return [];
    }
  }

  // Learned responses operations
  async addLearnedResponse(groupId, question, answer, source = 'manual') {
    try {
      // Check if similar question exists
      const existing = await this.db.get(
        'SELECT id FROM learned_responses WHERE group_id = ? AND LOWER(question) = LOWER(?)',
        [groupId, question]
      );

      if (existing) {
        // Update existing
        await this.db.run(
          'UPDATE learned_responses SET answer = ?, confidence = 1.0, learned_from = ? WHERE id = ?',
          [answer, source, existing.id]
        );
      } else {
        // Insert new
        await this.db.run(
          'INSERT INTO learned_responses (group_id, question, answer, learned_from) VALUES (?, ?, ?, ?)',
          [groupId, question, answer, source]
        );
      }
    } catch (error) {
      console.error('Error adding learned response:', error);
    }
  }

  async findLearnedResponse(groupId, question) {
    try {
      // Try exact match first
      let response = await this.db.get(
        'SELECT * FROM learned_responses WHERE group_id = ? AND LOWER(question) = LOWER(?) AND confidence > 0.5',
        [groupId, question]
      );

      if (!response) {
        // Try partial match
        response = await this.db.get(
          'SELECT * FROM learned_responses WHERE group_id = ? AND LOWER(?) LIKE \'%\' || LOWER(question) || \'%\' AND confidence > 0.5 ORDER BY confidence DESC LIMIT 1',
          [groupId, question]
        );
      }

      return response;
    } catch (error) {
      console.error('Error finding learned response:', error);
      return null;
    }
  }

  async incrementResponseUsage(responseId) {
    try {
      await this.db.run(
        'UPDATE learned_responses SET usage_count = usage_count + 1, last_used = CURRENT_TIMESTAMP WHERE id = ?',
        [responseId]
      );
    } catch (error) {
      console.error('Error incrementing usage:', error);
    }
  }

  async updateResponseConfidence(responseId, isGood) {
    try {
      const adjustment = isGood ? 0.1 : -0.15;
      await this.db.run(
        'UPDATE learned_responses SET confidence = MAX(0, MIN(1, confidence + ?)) WHERE id = ?',
        [adjustment, responseId]
      );
    } catch (error) {
      console.error('Error updating confidence:', error);
    }
  }

  async forgetLearnedData(groupId, keyword) {
    try {
      const result = await this.db.run(
        'DELETE FROM learned_responses WHERE group_id = ? AND (LOWER(question) LIKE ? OR LOWER(answer) LIKE ?)',
        [groupId, `%${keyword.toLowerCase()}%`, `%${keyword.toLowerCase()}%`]
      );
      return result.changes || 0;
    } catch (error) {
      console.error('Error forgetting data:', error);
      return 0;
    }
  }

  // Interaction operations
  async storeInteraction(groupId, question, answer, source, questionMsgId, answerMsgId) {
    try {
      await this.db.run(
        'INSERT INTO interactions (group_id, question, answer, source, question_msg_id, answer_msg_id) VALUES (?, ?, ?, ?, ?, ?)',
        [groupId, question, answer, source, questionMsgId, answerMsgId]
      );
    } catch (error) {
      console.error('Error storing interaction:', error);
    }
  }

  async updateInteractionFeedback(answerMsgId, feedback) {
    try {
      await this.db.run(
        'UPDATE interactions SET feedback = ? WHERE answer_msg_id = ?',
        [feedback, answerMsgId]
      );
    } catch (error) {
      console.error('Error updating feedback:', error);
    }
  }

  // Statistics operations
  async getGroupStats(groupId) {
    try {
      const totalMessages = await this.db.get(
        'SELECT COUNT(*) as count FROM messages WHERE group_id = ?',
        [groupId]
      );

      const botResponses = await this.db.get(
        'SELECT COUNT(*) as count FROM interactions WHERE group_id = ?',
        [groupId]
      );

      const learnedResponses = await this.db.get(
        'SELECT COUNT(*) as count FROM learned_responses WHERE group_id = ?',
        [groupId]
      );

      const activeUsers = await this.db.get(
        'SELECT COUNT(DISTINCT user_id) as count FROM user_stats WHERE group_id = ?',
        [groupId]
      );

      const goodFeedback = await this.db.get(
        'SELECT COUNT(*) as count FROM interactions WHERE group_id = ? AND feedback = 1',
        [groupId]
      );

      const totalFeedback = await this.db.get(
        'SELECT COUNT(*) as count FROM interactions WHERE group_id = ? AND feedback != 0',
        [groupId]
      );

      const topKeywords = await this.db.all(
        'SELECT keyword as topic, frequency as count FROM keywords WHERE group_id = ? ORDER BY frequency DESC LIMIT 5',
        [groupId]
      );

      const accuracy = totalFeedback.count > 0 
        ? Math.round((goodFeedback.count / totalFeedback.count) * 100)
        : 0;

      return {
        totalMessages: totalMessages.count,
        botResponses: botResponses.count,
        learnedResponses: learnedResponses.count,
        activeUsers: activeUsers.count,
        accuracy,
        topTopics: topKeywords
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return {
        totalMessages: 0,
        botResponses: 0,
        learnedResponses: 0,
        activeUsers: 0,
        accuracy: 0,
        topTopics: []
      };
    }
  }

  // Context operations
  async getGroupContext(groupId) {
    try {
      const keywords = await this.db.all(
        'SELECT keyword, context FROM keywords WHERE group_id = ? ORDER BY frequency DESC LIMIT 20',
        [groupId]
      );

      const recentTopics = await this.db.all(
        'SELECT DISTINCT content FROM messages WHERE group_id = ? ORDER BY timestamp DESC LIMIT 10',
        [groupId]
      );

      return {
        keywords: keywords.map(k => k.keyword),
        recentTopics: recentTopics.map(t => t.content)
      };
    } catch (error) {
      console.error('Error getting context:', error);
      return { keywords: [], recentTopics: [] };
    }
  }

  async addKeyword(groupId, keyword, context = '') {
    try {
      await this.db.run(`
        INSERT INTO keywords (group_id, keyword, context, frequency, last_seen)
        VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(group_id, keyword)
        DO UPDATE SET frequency = frequency + 1, last_seen = CURRENT_TIMESTAMP
      `, [groupId, keyword, context]);
    } catch (error) {
      console.error('Error adding keyword:', error);
    }
  }

  // Export operations
  async exportGroupData(groupId) {
    try {
      const group = await this.getGroup(groupId);
      const learnedResponses = await this.db.all(
        'SELECT * FROM learned_responses WHERE group_id = ?',
        [groupId]
      );
      const stats = await this.getGroupStats(groupId);

      return {
        group,
        learnedResponses,
        stats,
        exportedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error exporting data:', error);
      return null;
    }
  }

  // Cleanup old data
  async cleanupOldData(days = 90) {
    try {
      await this.db.run(
        'DELETE FROM messages WHERE timestamp < datetime(\'now\', ?)',
        [`-${days} days`]
      );

      await this.db.run(
        'DELETE FROM interactions WHERE timestamp < datetime(\'now\', ?)',
        [`-${days} days`]
      );

      console.log(`🧹 Cleaned up data older than ${days} days`);
    } catch (error) {
      console.error('Error cleaning up data:', error);
    }
  }

  async close() {
    if (this.db) {
      await this.db.close();
    }
  }
}

module.exports = Database;
