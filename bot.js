const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Database = require('./database');
const AIService = require('./aiService');
const config = require('./config');

class AIGroupManagerBot {
  constructor() {
    this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
    this.db = new Database();
    this.ai = new AIService();
    this.pendingSetups = new Map(); // Simple in-memory cache for active setups
    this.initializeBot();
  }

  async initializeBot() {
    console.log('🤖 AI Group Manager Bot Starting...');
    
    // Wait for database
    await this.waitForDatabase();
    
    // Command handlers
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.bot.onText(/\/quicksetup (.+)/, (msg, match) => this.handleQuickSetup(msg, match));
    this.bot.onText(/\/setup/, (msg) => this.handleSetupCommand(msg));
    this.bot.onText(/\/train (.+)/, (msg, match) => this.handleTrain(msg, match));
    this.bot.onText(/\/stats/, (msg) => this.handleStats(msg));
    this.bot.onText(/\/forget (.+)/, (msg, match) => this.handleForget(msg, match));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));
    this.bot.onText(/\/privacy/, (msg) => this.handlePrivacy(msg));
    this.bot.onText(/\/pause/, (msg) => this.handlePause(msg));
    this.bot.onText(/\/resume/, (msg) => this.handleResume(msg));
    this.bot.onText(/\/export/, (msg) => this.handleExport(msg));
    
    // Message handlers - must be last
    this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));
    this.bot.on('my_chat_member', (msg) => this.handleChatMemberUpdate(msg));
    this.bot.on('new_chat_members', (msg) => this.handleNewMember(msg));
    this.bot.on('message', (msg) => this.handleMessage(msg));
    
    console.log('✅ Bot initialized successfully!');
  }

  async waitForDatabase() {
    let attempts = 0;
    while (!this.db.db && attempts < 20) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    if (!this.db.db) {
      throw new Error('Database initialization timeout');
    }
  }

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type;

    if (chatType === 'private') {
      const welcomeMessage = `👋 Welcome to **AI Group Manager Bot**!

I'm an intelligent bot that learns from your group to answer questions and manage conversations.

**Getting Started:**
1️⃣ Add me to your group
2️⃣ Make me an admin (I need these permissions):
   • Delete messages
   • Ban users  
   • Pin messages
   • Manage messages

3️⃣ I'll guide you through quick setup

**What I can do:**
🧠 Learn from admin responses
💬 Answer common questions
🛡️ Moderate content
📊 Provide analytics
👥 Welcome new members

Ready? Add me to your group now!`;

      await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    }
  }

  async handleChatMemberUpdate(msg) {
    const newStatus = msg.new_chat_member?.status;
    const chatId = msg.chat.id;
    const chatTitle = msg.chat.title;

    const botInfo = await this.bot.getMe();
    
    if (msg.new_chat_member?.user?.id === botInfo.id) {
      if (newStatus === 'administrator') {
        // Save group first
        await this.db.addGroup(chatId, chatTitle);
        
        const setupMsg = `🎉 Thank you for adding me to **${chatTitle}**!

I'm ready to help manage your group. Let's do a quick 1-command setup!

**Use this command to configure me:**
\`/quicksetup Gaming community|Friendly|No spam, be respectful|all\`

**Format:**
\`/quicksetup [purpose]|[tone]|[rules]|[triggers]\`

**Example:**
\`/quicksetup Tech support group|Professional|No spam, stay on topic|help,question,?\`

Or type \`/setup\` for detailed instructions.`;

        await this.bot.sendMessage(chatId, setupMsg, { parse_mode: 'Markdown' });
        
        console.log(`✅ Bot added to group ${chatId} (${chatTitle})`);
      } else if (newStatus === 'member') {
        await this.bot.sendMessage(
          chatId,
          `⚠️ I need admin permissions to work properly. Please make me an admin.`
        );
      }
    }
  }

  async handleQuickSetup(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1];

    // Only allow in groups
    if (msg.chat.type === 'private') {
      await this.bot.sendMessage(chatId, '❌ This command only works in groups!');
      return;
    }

    // Check if user is admin
    try {
      const member = await this.bot.getChatMember(chatId, userId);
      if (!['administrator', 'creator'].includes(member.status)) {
        await this.bot.sendMessage(chatId, '❌ Only admins can configure the bot.');
        return;
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
      return;
    }

    // Parse setup data
    const parts = input.split('|').map(p => p.trim());
    
    if (parts.length !== 4) {
      await this.bot.sendMessage(
        chatId,
        `❌ Invalid format! Use:
\`/quicksetup [purpose]|[tone]|[rules]|[triggers]\`

Example:
\`/quicksetup Gaming community|Friendly|No spam|all\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const [purpose, tone, rulesStr, triggersStr] = parts;
    const rules = rulesStr.toLowerCase() === 'none' ? [] : rulesStr.split(',').map(r => r.trim());
    const triggers = triggersStr.toLowerCase() === 'all' ? ['all'] : triggersStr.split(',').map(t => t.trim());

    // Save configuration
    await this.db.updateGroupConfig(chatId, {
      purpose,
      tone,
      rules,
      triggers
    });

    const summary = `✅ **Setup Complete!**

Your group is now configured:

📋 **Purpose:** ${purpose}
🎨 **Tone:** ${tone}
📜 **Rules:** ${rules.length > 0 ? rules.join(', ') : 'None'}
🎯 **Triggers:** ${triggers.join(', ')}

I'm now active and learning! 🧠

**Commands:**
/train <question>|<answer> - Teach me
/stats - View statistics
/pause - Pause bot
/help - Show all commands

Try asking me a question!`;

    await this.bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
    console.log(`✅ Quick setup completed for group ${chatId}`);
  }

  async handleSetupCommand(msg) {
    const chatId = msg.chat.id;
    
    const instructions = `🔧 **Setup Instructions**

Use the quick setup command in your group:

\`/quicksetup [purpose]|[tone]|[rules]|[triggers]\`

**Parameters:**

1️⃣ **Purpose** - What your group is about
   Example: "Gaming community", "Tech support"

2️⃣ **Tone** - How I should communicate  
   Example: "Friendly", "Professional", "Casual"

3️⃣ **Rules** - Group rules (comma-separated)
   Example: "No spam, Be respectful"
   Or: "None"

4️⃣ **Triggers** - When to respond
   Example: "all" (respond to all questions)
   Or: "help,question,?" (specific keywords)

**Full Example:**
\`/quicksetup Gaming community|Friendly|No spam, be nice|all\`

**Another Example:**
\`/quicksetup Tech support|Professional|Stay on topic|help,error,issue\`

Go to your group and use this command!`;

    await this.bot.sendMessage(chatId, instructions, { parse_mode: 'Markdown' });
  }

  async handleCallbackQuery(query) {
    const data = query.data;

    if (data.startsWith('feedback_')) {
      await this.handleFeedback(query);
    }
  }

  async handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    const chatType = msg.chat.type;

    // Skip if no text or if it's a command
    if (!text || text.startsWith('/')) return;

    // Only handle group messages
    if (chatType === 'group' || chatType === 'supergroup') {
      await this.handleGroupMessage(msg);
    }
  }

  async handleGroupMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    const messageId = msg.message_id;

    // Get group config
    const group = await this.db.getGroup(chatId);
    if (!group || !group.setup_complete) {
      // Group not configured yet
      return;
    }

    // Check if bot is paused
    if (group.paused) return;

    // Store message for learning
    await this.db.storeMessage(chatId, userId, text, messageId);

    // Check if we should respond
    const shouldRespond = await this.shouldRespond(msg, group);
    if (!shouldRespond) return;

    // Show typing indicator
    await this.bot.sendChatAction(chatId, 'typing');

    // Get user info
    try {
      const userInfo = await this.bot.getChatMember(chatId, userId);
      const isAdmin = ['administrator', 'creator'].includes(userInfo.status);

      // If admin is responding to a message, learn from it
      if (isAdmin && msg.reply_to_message) {
        const originalMessage = msg.reply_to_message.text;
        if (originalMessage) {
          await this.learnFromAdmin(chatId, originalMessage, text);
        }
      }
    } catch (error) {
      console.log('Could not check admin status:', error.message);
    }

    // Check for learned response first
    const learnedResponse = await this.db.findLearnedResponse(chatId, text);
    
    if (learnedResponse && learnedResponse.confidence > 0.7) {
      // Use learned response
      const response = await this.bot.sendMessage(chatId, learnedResponse.answer, {
        reply_to_message_id: messageId
      });
      
      await this.db.incrementResponseUsage(learnedResponse.id);
      await this.addFeedbackButtons(chatId, response.message_id, learnedResponse.id);
    } else {
      // Generate AI response
      await this.generateAIResponse(msg, group);
    }
  }

  async shouldRespond(msg, group) {
    const text = msg.text.toLowerCase();
    
    try {
      const botInfo = await this.bot.getMe();
      const botUsername = botInfo.username;

      // Always respond if mentioned
      if (msg.text.includes(`@${botUsername}`)) return true;

      // Check if replying to bot
      if (msg.reply_to_message && msg.reply_to_message.from.is_bot) return true;

      // Check triggers
      if (group.triggers && group.triggers.includes('all')) {
        // Respond to questions only
        if (text.includes('?')) return true;
      }

      // Check custom triggers
      if (group.triggers) {
        return group.triggers.some(trigger => text.includes(trigger.toLowerCase()));
      }

      return false;
    } catch (error) {
      console.error('Error in shouldRespond:', error);
      return false;
    }
  }

  async generateAIResponse(msg, group) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const messageId = msg.message_id;

    try {
      // Get group context
      const recentMessages = await this.db.getRecentMessages(chatId, 5);

      // Build context for AI
      const systemContext = `You are a helpful AI assistant for a Telegram group.
Group Purpose: ${group.purpose}
Tone: ${group.tone}
Rules: ${group.rules ? group.rules.join(', ') : 'None'}

Answer the user's question naturally and helpfully. Keep responses concise (under 200 words).`;

      // Get AI response
      const aiResponse = await this.ai.getResponse(text, systemContext);

      if (aiResponse) {
        // Send response
        const response = await this.bot.sendMessage(chatId, aiResponse, {
          reply_to_message_id: messageId
        });

        // Store for learning
        await this.db.storeInteraction(chatId, text, aiResponse, 'ai', messageId, response.message_id);
        
        // Add feedback buttons
        await this.addFeedbackButtons(chatId, response.message_id, null);
      }
    } catch (error) {
      console.error('Error generating AI response:', error);
    }
  }

  async learnFromAdmin(chatId, question, answer) {
    await this.db.addLearnedResponse(chatId, question, answer, 'admin');
    console.log(`📚 Learned from admin: Q: "${question.substring(0, 30)}..." A: "${answer.substring(0, 30)}..."`);
  }

  async addFeedbackButtons(chatId, messageId, responseId) {
    const keyboard = {
      inline_keyboard: [[
        { text: '👍', callback_data: `feedback_good_${responseId || messageId}` },
        { text: '👎', callback_data: `feedback_bad_${responseId || messageId}` }
      ]]
    };

    setTimeout(async () => {
      try {
        await this.bot.editMessageReplyMarkup(keyboard, {
          chat_id: chatId,
          message_id: messageId
        });
      } catch (error) {
        // Ignore errors
      }
    }, 1000);
  }

  async handleFeedback(query) {
    const [, sentiment, id] = query.data.split('_');
    
    await this.bot.answerCallbackQuery(query.id, {
      text: sentiment === 'good' ? '✅ Thanks!' : '👎 I\'ll improve!'
    });

    // Update confidence score
    if (id !== 'null') {
      await this.db.updateResponseConfidence(id, sentiment === 'good');
    }

    // Remove buttons
    try {
      await this.bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
    } catch (error) {
      // Ignore
    }
  }

  async handleNewMember(msg) {
    const chatId = msg.chat.id;
    const group = await this.db.getGroup(chatId);
    
    if (!group || !group.setup_complete) return;

    const newMembers = msg.new_chat_members;
    for (const member of newMembers) {
      if (!member.is_bot) {
        const welcomeMsg = `👋 Welcome ${member.first_name}!\n\n${group.purpose}`;
        await this.bot.sendMessage(chatId, welcomeMsg);
      }
    }
  }

  async handleTrain(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1];

    // Check if user is admin
    try {
      const member = await this.bot.getChatMember(chatId, userId);
      if (!['administrator', 'creator'].includes(member.status)) {
        await this.bot.sendMessage(chatId, '❌ Only admins can use this command.');
        return;
      }
    } catch (error) {
      return;
    }

    // Parse training data
    const parts = input.split('|');
    if (parts.length !== 2) {
      await this.bot.sendMessage(
        chatId,
        '❌ Invalid format. Use: `/train question|answer`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const [question, answer] = parts.map(p => p.trim());
    await this.db.addLearnedResponse(chatId, question, answer, 'manual');
    
    await this.bot.sendMessage(chatId, `✅ Learned! I'll respond to: "${question}"`);
  }

  async handleStats(msg) {
    const chatId = msg.chat.id;
    
    try {
      const stats = await this.db.getGroupStats(chatId);

      const statsMessage = `📊 **Bot Statistics**

💬 Total Messages: ${stats.totalMessages}
🤖 Bot Responses: ${stats.botResponses}
📚 Learned Responses: ${stats.learnedResponses}
👥 Active Users: ${stats.activeUsers}
📈 Accuracy: ${stats.accuracy}%

${stats.topTopics.length > 0 ? 'Most common topics:\n' + stats.topTopics.map((t, i) => `${i + 1}. ${t.topic} (${t.count}x)`).join('\n') : ''}`;

      await this.bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error getting stats:', error);
      await this.bot.sendMessage(chatId, '❌ Error retrieving statistics.');
    }
  }

  async handleForget(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const keyword = match[1];

    try {
      const member = await this.bot.getChatMember(chatId, userId);
      if (!['administrator', 'creator'].includes(member.status)) {
        await this.bot.sendMessage(chatId, '❌ Only admins can use this command.');
        return;
      }
    } catch (error) {
      return;
    }

    const deleted = await this.db.forgetLearnedData(chatId, keyword);
    await this.bot.sendMessage(chatId, `✅ Forgot ${deleted} response(s) containing "${keyword}"`);
  }

  async handleHelp(msg) {
    const helpMessage = `🤖 **AI Group Manager Bot**

**Setup:**
\`/quicksetup [purpose]|[tone]|[rules]|[triggers]\`
\`/setup\` - Show setup instructions

**Admin Commands:**
\`/train <q>|<a>\` - Teach response
\`/forget <keyword>\` - Remove data
\`/stats\` - View statistics
\`/pause\` - Pause bot
\`/resume\` - Resume bot
\`/export\` - Export data

**General:**
\`/help\` - This message
\`/privacy\` - Privacy info

React with 👍/👎 to help me learn!`;

    await this.bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
  }

  async handlePause(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const member = await this.bot.getChatMember(chatId, userId);
      if (!['administrator', 'creator'].includes(member.status)) {
        await this.bot.sendMessage(chatId, '❌ Only admins can use this.');
        return;
      }
    } catch (error) {
      return;
    }

    await this.db.togglePause(chatId, true);
    await this.bot.sendMessage(chatId, '⏸️ Bot paused. Use /resume to continue.');
  }

  async handleResume(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const member = await this.bot.getChatMember(chatId, userId);
      if (!['administrator', 'creator'].includes(member.status)) {
        await this.bot.sendMessage(chatId, '❌ Only admins can use this.');
        return;
      }
    } catch (error) {
      return;
    }

    await this.db.togglePause(chatId, false);
    await this.bot.sendMessage(chatId, '▶️ Bot resumed!');
  }

  async handlePrivacy(msg) {
    const privacyMsg = `🔒 **Privacy & Data**

**What I Store:**
- Group messages (for learning)
- Learned responses
- Interaction statistics

**Your Rights:**
- Use /forget to delete data
- Use /export to download data
- Data stored locally
- 90 day retention

Contact admin for data deletion.`;

    await this.bot.sendMessage(msg.chat.id, privacyMsg, { parse_mode: 'Markdown' });
  }

  async handleExport(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const member = await this.bot.getChatMember(chatId, userId);
      if (!['administrator', 'creator'].includes(member.status)) {
        await this.bot.sendMessage(chatId, '❌ Only admins can use this.');
        return;
      }
    } catch (error) {
      return;
    }

    const data = await this.db.exportGroupData(chatId);
    const filename = `group_${chatId}_export.json`;
    
    await this.bot.sendDocument(chatId, Buffer.from(JSON.stringify(data, null, 2)), {
      caption: '📦 Your exported data'
    }, {
      filename: filename,
      contentType: 'application/json'
    });
  }
}

// Start the bot
const bot = new AIGroupManagerBot();

module.exports = AIGroupManagerBot;
