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
    this.setupStates = new Map(); // Track user setup states
    this.initializeBot();
  }

  initializeBot() {
    console.log('🤖 AI Group Manager Bot Starting...');
    
    // Command handlers
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.bot.onText(/\/setup/, (msg) => this.handleSetup(msg));
    this.bot.onText(/\/train (.+)/, (msg, match) => this.handleTrain(msg, match));
    this.bot.onText(/\/stats/, (msg) => this.handleStats(msg));
    this.bot.onText(/\/forget (.+)/, (msg, match) => this.handleForget(msg, match));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));
    this.bot.onText(/\/privacy/, (msg) => this.handlePrivacy(msg));
    this.bot.onText(/\/pause/, (msg) => this.handlePause(msg));
    this.bot.onText(/\/resume/, (msg) => this.handleResume(msg));
    this.bot.onText(/\/export/, (msg) => this.handleExport(msg));
    
    // Message handlers
    this.bot.on('message', (msg) => this.handleMessage(msg));
    this.bot.on('new_chat_members', (msg) => this.handleNewMember(msg));
    this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));
    this.bot.on('my_chat_member', (msg) => this.handleChatMemberUpdate(msg));
    
    console.log('✅ Bot initialized successfully!');
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

3️⃣ I'll send a confirmation message in the group
4️⃣ Click "DONE" to complete setup

**What I can do:**
🧠 Learn from admin responses
💬 Answer common questions
🛡️ Moderate content
📊 Provide analytics
👥 Welcome new members
🎯 Remember group context

Ready to get started? Add me to your group now!`;

      await this.bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
    }
  }

  async handleChatMemberUpdate(msg) {
    const botId = this.bot.options.polling.params.offset;
    const newStatus = msg.new_chat_member?.status;
    const chatId = msg.chat.id;
    const chatTitle = msg.chat.title;

    // Check if bot was added to group
    if (msg.new_chat_member?.user?.id === (await this.bot.getMe()).id) {
      if (newStatus === 'administrator') {
        // Bot added as admin
        const keyboard = {
          inline_keyboard: [[
            { text: '✅ DONE - Complete Setup', callback_data: `setup_${msg.from.id}_${chatId}` }
          ]]
        };

        await this.bot.sendMessage(
          chatId,
          `🎉 Thank you for adding me to **${chatTitle}**!\n\nAllow "Manager Bot" to manage your group?\n\n` +
          `I need to be an admin to work properly. Once you're ready, click the button below to complete the setup in private chat.`,
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );

        // Save group to database
        await this.db.addGroup(chatId, chatTitle);
      } else if (newStatus === 'member') {
        await this.bot.sendMessage(
          chatId,
          `⚠️ I need admin permissions to work properly. Please make me an admin with the required permissions.`
        );
      }
    }
  }

  async handleCallbackQuery(query) {
    const data = query.data;
    const chatId = query.message.chat.id;

    if (data.startsWith('setup_')) {
      const [, userId, groupId] = data.split('_');
      
      // Check if the person clicking is the one who added the bot
      if (query.from.id.toString() !== userId) {
        await this.bot.answerCallbackQuery(query.id, {
          text: '❌ Only the person who added me can complete setup',
          show_alert: true
        });
        return;
      }

      await this.bot.answerCallbackQuery(query.id, {
        text: '✅ Redirecting to private chat...'
      });

      // Start setup in private chat
      const privateMessage = `🔧 **Group Setup**

Let's configure your group! I'll ask you a few questions to understand your group better.

**Question 1:** What is your group mainly about? (e.g., "Tech support", "Gaming community", "Study group")

Please describe in 1-2 sentences.`;

      await this.bot.sendMessage(userId, privateMessage, { parse_mode: 'Markdown' });
      
      // Set setup state
      this.setupStates.set(userId, {
        step: 'purpose',
        groupId: parseInt(groupId),
        data: {}
      });
    } else if (data.startsWith('confirm_')) {
      const [, action, messageId] = data.split('_');
      await this.handleAdminConfirmation(query, action, messageId);
    } else if (data.startsWith('feedback_')) {
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

    // Handle setup flow in private chat
    if (chatType === 'private' && this.setupStates.has(userId)) {
      await this.handleSetupFlow(msg);
      return;
    }

    // Handle group messages
    if (chatType === 'group' || chatType === 'supergroup') {
      await this.handleGroupMessage(msg);
    }
  }

  async handleSetupFlow(msg) {
    const userId = msg.from.id;
    const text = msg.text;
    const state = this.setupStates.get(userId);

    switch (state.step) {
      case 'purpose':
        state.data.purpose = text;
        state.step = 'tone';
        await this.bot.sendMessage(
          userId,
          `Great! 👍\n\n**Question 2:** What tone should I use when responding?\n\n` +
          `Choose: "Professional", "Casual", "Friendly", or describe your preferred style.`
        );
        break;

      case 'tone':
        state.data.tone = text;
        state.step = 'rules';
        await this.bot.sendMessage(
          userId,
          `Perfect! 📝\n\n**Question 3:** What are the main rules or guidelines for this group?\n\n` +
          `List them separated by commas, or type "None" if you don't have specific rules yet.`
        );
        break;

      case 'rules':
        state.data.rules = text.toLowerCase() !== 'none' ? text.split(',').map(r => r.trim()) : [];
        state.step = 'triggers';
        await this.bot.sendMessage(
          userId,
          `Excellent! 🎯\n\n**Question 4:** When should I respond to messages?\n\n` +
          `Type keywords or phrases (comma-separated) that should trigger my responses, or type "all" to respond to all questions.`
        );
        break;

      case 'triggers':
        state.data.triggers = text.toLowerCase() === 'all' ? ['all'] : text.split(',').map(t => t.trim());
        
        // Save configuration
        await this.db.updateGroupConfig(state.groupId, state.data);
        
        const summary = `✅ **Setup Complete!**

Your group is now configured:

📋 **Purpose:** ${state.data.purpose}
🎨 **Tone:** ${state.data.tone}
📜 **Rules:** ${state.data.rules.length > 0 ? state.data.rules.join(', ') : 'None set'}
🎯 **Triggers:** ${state.data.triggers.join(', ')}

I'm now active in your group and learning! 🧠

**Available Commands:**
/train <question>|<answer> - Teach me a specific response
/stats - View bot performance
/forget <keyword> - Remove learned information
/pause - Pause learning temporarily
/resume - Resume learning
/export - Export learned knowledge
/help - Show all commands

I'll start learning from your group conversations and admin responses right away!`;

        await this.bot.sendMessage(userId, summary, { parse_mode: 'Markdown' });
        this.setupStates.delete(userId);
        break;
    }
  }

  async handleGroupMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    const messageId = msg.message_id;

    // Get group config
    const group = await this.db.getGroup(chatId);
    if (!group || !group.setup_complete) return;

    // Check if bot is paused
    if (group.paused) return;

    // Store message for learning
    await this.db.storeMessage(chatId, userId, text, messageId);

    // Check if we should respond
    const shouldRespond = await this.shouldRespond(msg, group);
    if (!shouldRespond) return;

    // Get user info
    const userInfo = await this.bot.getChatMember(chatId, userId);
    const isAdmin = ['administrator', 'creator'].includes(userInfo.status);

    // If admin is responding, learn from it
    if (isAdmin && msg.reply_to_message) {
      const originalMessage = msg.reply_to_message.text;
      await this.learnFromAdmin(chatId, originalMessage, text);
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
    const botUsername = (await this.bot.getMe()).username;

    // Always respond if mentioned
    if (msg.text.includes(`@${botUsername}`)) return true;

    // Check if replying to bot
    if (msg.reply_to_message && msg.reply_to_message.from.is_bot) return true;

    // Check triggers
    if (group.triggers.includes('all')) return true;

    // Check for question marks
    if (text.includes('?')) return true;

    // Check custom triggers
    return group.triggers.some(trigger => text.includes(trigger.toLowerCase()));
  }

  async generateAIResponse(msg, group) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const messageId = msg.message_id;

    try {
      // Get group context
      const context = await this.db.getGroupContext(chatId);
      const recentMessages = await this.db.getRecentMessages(chatId, 10);

      // Build context for AI
      const systemContext = `You are a helpful AI assistant for a Telegram group.
Group Purpose: ${group.purpose}
Tone: ${group.tone}
Rules: ${group.rules ? group.rules.join(', ') : 'None'}
Recent context: ${recentMessages.map(m => m.content).join('\n')}

Answer the user's question naturally and helpfully. Keep responses concise and relevant.`;

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
    console.log(`📚 Learned from admin: ${question.substring(0, 50)}...`);
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
        // Ignore errors (message might be too old)
      }
    }, 1000);
  }

  async handleFeedback(query) {
    const [, sentiment, id] = query.data.split('_');
    
    await this.bot.answerCallbackQuery(query.id, {
      text: sentiment === 'good' ? '✅ Thanks for feedback!' : '👎 Noted, I\'ll improve!'
    });

    // Update confidence score
    if (id !== 'null') {
      await this.db.updateResponseConfidence(id, sentiment === 'good');
    }

    // Remove buttons
    await this.bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id
    });
  }

  async handleNewMember(msg) {
    const chatId = msg.chat.id;
    const group = await this.db.getGroup(chatId);
    
    if (!group) return;

    const newMembers = msg.new_chat_members;
    for (const member of newMembers) {
      if (!member.is_bot) {
        const welcomeMsg = `👋 Welcome ${member.first_name} to ${msg.chat.title}!\n\n` +
          `${group.purpose}\n\nFeel free to ask me anything!`;
        
        await this.bot.sendMessage(chatId, welcomeMsg);
      }
    }
  }

  async handleTrain(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const input = match[1];

    // Check if user is admin
    const member = await this.bot.getChatMember(chatId, userId);
    if (!['administrator', 'creator'].includes(member.status)) {
      await this.bot.sendMessage(chatId, '❌ Only admins can use this command.');
      return;
    }

    // Parse training data
    const parts = input.split('|');
    if (parts.length !== 2) {
      await this.bot.sendMessage(
        chatId,
        '❌ Invalid format. Use: /train question|answer'
      );
      return;
    }

    const [question, answer] = parts.map(p => p.trim());
    await this.db.addLearnedResponse(chatId, question, answer, 'manual');
    
    await this.bot.sendMessage(chatId, `✅ Learned! I'll now respond with that answer when asked: "${question}"`);
  }

  async handleStats(msg) {
    const chatId = msg.chat.id;
    const stats = await this.db.getGroupStats(chatId);

    const statsMessage = `📊 **Bot Statistics**

💬 Total Messages: ${stats.totalMessages}
🤖 Bot Responses: ${stats.botResponses}
📚 Learned Responses: ${stats.learnedResponses}
👥 Active Users: ${stats.activeUsers}
📈 Accuracy: ${stats.accuracy}%

Most common topics:
${stats.topTopics.map((t, i) => `${i + 1}. ${t.topic} (${t.count} times)`).join('\n')}`;

    await this.bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
  }

  async handleForget(msg, match) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const keyword = match[1];

    const member = await this.bot.getChatMember(chatId, userId);
    if (!['administrator', 'creator'].includes(member.status)) {
      await this.bot.sendMessage(chatId, '❌ Only admins can use this command.');
      return;
    }

    const deleted = await this.db.forgetLearnedData(chatId, keyword);
    await this.bot.sendMessage(chatId, `✅ Forgot ${deleted} learned response(s) containing "${keyword}"`);
  }

  async handleHelp(msg) {
    const helpMessage = `🤖 **AI Group Manager Bot - Commands**

**Admin Commands:**
/train <question>|<answer> - Teach me a response
/forget <keyword> - Remove learned data
/stats - View statistics
/pause - Pause learning
/resume - Resume learning
/export - Export knowledge
/privacy - Privacy settings

**General Commands:**
/help - Show this message
/setup - Reconfigure bot

**What I Do:**
🧠 Learn from conversations
💬 Answer questions
🛡️ Moderate content
📊 Provide insights
👥 Welcome members

I'm always learning! React to my messages with 👍 or 👎 to help me improve.`;

    await this.bot.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
  }

  async handlePause(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const member = await this.bot.getChatMember(chatId, userId);
    if (!['administrator', 'creator'].includes(member.status)) {
      await this.bot.sendMessage(chatId, '❌ Only admins can use this command.');
      return;
    }

    await this.db.togglePause(chatId, true);
    await this.bot.sendMessage(chatId, '⏸️ Bot paused. Use /resume to continue.');
  }

  async handleResume(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const member = await this.bot.getChatMember(chatId, userId);
    if (!['administrator', 'creator'].includes(member.status)) {
      await this.bot.sendMessage(chatId, '❌ Only admins can use this command.');
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
- Use /forget to delete specific data
- Use /export to download your data
- Messages are stored encrypted
- Data is never shared with third parties

**Retention:** 90 days by default

Contact admin to request full data deletion.`;

    await this.bot.sendMessage(msg.chat.id, privacyMsg, { parse_mode: 'Markdown' });
  }

  async handleExport(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const member = await this.bot.getChatMember(chatId, userId);
    if (!['administrator', 'creator'].includes(member.status)) {
      await this.bot.sendMessage(chatId, '❌ Only admins can use this command.');
      return;
    }

    const data = await this.db.exportGroupData(chatId);
    const filename = `group_${chatId}_export_${Date.now()}.json`;
    
    await this.bot.sendDocument(chatId, Buffer.from(JSON.stringify(data, null, 2)), {
      caption: '📦 Here\'s your exported data'
    }, {
      filename: filename,
      contentType: 'application/json'
    });
  }

  async handleSetup(msg) {
    const chatId = msg.chat.id;
    
    if (msg.chat.type !== 'private') {
      await this.bot.sendMessage(chatId, '⚠️ Please use this command in private chat with me.');
      return;
    }

    await this.bot.sendMessage(
      chatId,
      '🔧 To setup or reconfigure a group, please add me to the group first, then make me an admin.'
    );
  }
}

// Start the bot
const bot = new AIGroupManagerBot();

module.exports = AIGroupManagerBot;
