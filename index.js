require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const http = require('http');

// Initialize Discord Client with logging
console.log('[INIT] Starting bot initialization...');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ==========================================
// 1. EXPLICIT FILE LOADING WITH LOGGING
// ==========================================

console.log('[LOAD] Loading utilities...');
const utilities = require('./commands/utilities');
client.utilities = utilities;
console.log('[SUCCESS] Utilities loaded');

console.log('[LOAD] Loading nameChange command...');
const nameChangeCommand = require('./commands/nameChange');
client.commands = new Map();
client.commands.set(nameChangeCommand.name, nameChangeCommand);
console.log(`[SUCCESS] Command loaded: ${nameChangeCommand.name}`);

console.log('[LOAD] Loading messageCreate event...');
const messageCreateEvent = require('./events/messageCreate');
console.log('[SUCCESS] Event handler loaded');

// ==========================================
// 2. EVENT REGISTRATION
// ==========================================

console.log('[SETUP] Registering event handlers...');
client.on('messageCreate', (message) => {
  console.log(`[EVENT] Message received from ${message.author.tag} in #${message.channel.name}`);
  messageCreateEvent.execute(message, client);
});
console.log('[SUCCESS] Events registered');

// ==========================================
// 3. DATABASE CONNECTION WITH RETRIES
// ==========================================

async function connectDB() {
  console.log('[DATABASE] Connecting to MongoDB...');
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000
    });
    console.log('[SUCCESS] Database connected');
  } catch (error) {
    console.error('[DATABASE ERROR] Connection failed:', error);
    process.exit(1);
  }
}

// ==========================================
// 4. HEALTH CHECK SERVER
// ==========================================

function startHealthServer() {
  console.log('[SERVER] Starting health check server...');
  const server = http.createServer((req, res) => {
    console.log(`[HEALTH] Received ${req.method} request to ${req.url}`);
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(require('fs').readFileSync('./health.html', 'utf8'));
  });

  server.listen(process.env.PORT || 3000, () => {
    console.log(`[SUCCESS] Health server running on port ${process.env.PORT || 3000}`);
  });

  server.on('error', (error) => {
    console.error('[SERVER ERROR]', error);
  });
}

// ==========================================
// 5. BOT STARTUP SEQUENCE
// ==========================================

async function startBot() {
  try {
    console.log('[STARTUP] Beginning bot startup sequence...');
    
    await connectDB();
    startHealthServer();
    
    console.log('[LOGIN] Connecting to Discord...');
    await client.login(process.env.TOKEN);
    console.log(`[SUCCESS] Logged in as ${client.user.tag}`);

    // Ready confirmation
    client.once('ready', () => {
      console.log(`[READY] Bot fully operational as ${client.user.tag}`);
      console.log(`[INFO] Serving ${client.guilds.cache.size} guilds`);
    });

  } catch (error) {
    console.error('[STARTUP FAILURE]', error);
    process.exit(1);
  }
}

// ==========================================
// ERROR HANDLING
// ==========================================

process.on('unhandledRejection', error => {
  console.error('[UNHANDLED REJECTION]', error);
});

process.on('uncaughtException', error => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  process.exit(1);
});

// ==========================================
// START THE BOT
// ==========================================

startBot();
