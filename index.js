require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const http = require('http');

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ==========================================
// 1. EXPLICITLY LOAD REQUIRED FILES
// ==========================================

// Load utilities first
const utilities = require('./commands/utilities');
client.utilities = utilities;

// Load commands
const nameChangeCommand = require('./commands/nameChange');
client.commands = new Map();
client.commands.set(nameChangeCommand.name, nameChangeCommand);

// Load event handler
const messageCreateEvent = require('./events/messageCreate');

// ==========================================
// 2. EVENT REGISTRATION
// ==========================================
client.on('messageCreate', (message) => messageCreateEvent.execute(message, client));

// ==========================================
// 3. DATABASE CONNECTION
// ==========================================
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[DATABASE] Connected successfully');
  } catch (error) {
    console.error('[DATABASE ERROR] Connection failed:', error);
    process.exit(1);
  }
}

// ==========================================
// 4. HEALTH CHECK SERVER
// ==========================================
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(require('fs').readFileSync('./health.html', 'utf8'));
});

// ==========================================
// 5. STARTUP SEQUENCE
// ==========================================
async function startBot() {
  try {
    await connectDB();
    server.listen(process.env.PORT || 3000, () => {
      console.log(`[SERVER] Running on port ${process.env.PORT || 3000}`);
    });
    
    await client.login(process.env.TOKEN);
    console.log(`[DISCORD] Logged in as ${client.user.tag}`);

  } catch (error) {
    console.error('[STARTUP ERROR]', error);
    process.exit(1);
  }
}

// Start the bot
startBot();

// Error handling
process.on('unhandledRejection', error => {
  console.error('[UNHANDLED REJECTION]', error);
});

process.on('uncaughtException', error => {
  console.error('[UNCAUGHT EXCEPTION]', error);
});
