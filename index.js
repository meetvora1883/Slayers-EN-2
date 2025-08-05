require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageTyping
  ]
});

// Global Collections
client.commands = new Map();
let httpServer;

// ==========================================
// 1. COMMAND LOADER
// ==========================================
function loadCommands() {
  try {
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath)
      .filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
      try {
        const command = require(path.join(commandsPath, file));
        if (!command.name || !command.execute) {
          console.warn(`[WARNING] Command ${file} is missing required properties`);
          continue;
        }
        client.commands.set(command.name, command);
        console.log(`[COMMAND] Loaded: ${command.name}`);
      } catch (error) {
        console.error(`[ERROR] Failed to load command ${file}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[CRITICAL] Failed to load commands:', error);
    process.exit(1);
  }
}

// ==========================================
// 2. EVENT HANDLER LOADER
// ==========================================
function loadEvents() {
  try {
    const eventsPath = path.join(__dirname, 'events');
    const eventFiles = fs.readdirSync(eventsPath)
      .filter(file => file.endsWith('.js'));

    for (const file of eventFiles) {
      try {
        const event = require(path.join(eventsPath, file));
        if (event.once) {
          client.once(event.name, (...args) => event.execute(...args, client));
        } else {
          client.on(event.name, (...args) => event.execute(...args, client));
        }
        console.log(`[EVENT] Loaded: ${event.name}`);
      } catch (error) {
        console.error(`[ERROR] Failed to load event ${file}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[CRITICAL] Failed to load events:', error);
    process.exit(1);
  }
}

// ==========================================
// 3. DATABASE CONNECTION
// ==========================================
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000
    });
    console.log('[DATABASE] Connected successfully');
  } catch (error) {
    console.error('[DATABASE ERROR] Connection failed:', error);
    process.exit(1);
  }
}

// ==========================================
// 4. HEALTH CHECK SERVER
// ==========================================
function startHealthServer() {
  httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        uptime: process.uptime(),
        guilds: client.guilds?.cache.size || 0
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(path.join(__dirname, 'health.html')));
    }
  });

  httpServer.listen(process.env.PORT || 3000, () => {
    console.log(`[HEALTH] Server running on port ${process.env.PORT || 3000}`);
  });

  httpServer.on('error', (error) => {
    console.error('[SERVER ERROR]', error);
  });
}

// ==========================================
// 5. GRACEFUL SHUTDOWN HANDLER
// ==========================================
function handleShutdown() {
  console.log('\n[SHUTDOWN] Received termination signal');

  // 1. Close HTTP server
  if (httpServer) {
    httpServer.close(() => {
      console.log('[SHUTDOWN] HTTP server closed');
    });
  }

  // 2. Disconnect from Discord
  if (client && client.isReady()) {
    client.destroy();
    console.log('[SHUTDOWN] Discord connection closed');
  }

  // 3. Disconnect from MongoDB
  mongoose.disconnect()
    .then(() => {
      console.log('[SHUTDOWN] MongoDB connection closed');
      process.exit(0);
    })
    .catch(err => {
      console.error('[SHUTDOWN ERROR] MongoDB disconnection failed:', err);
      process.exit(1);
    });
}

// ==========================================
// 6. BOT STARTUP SEQUENCE
// ==========================================
async function startBot() {
  try {
    console.log('[STARTUP] Initializing bot...');

    // Load components
    loadCommands();
    loadEvents();
    await connectDB();
    startHealthServer();

    // Start Discord client
    await client.login(process.env.TOKEN);
    console.log(`[LOGIN] Connected as ${client.user.tag}`);

    // Set up shutdown handlers
    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);

  } catch (error) {
    console.error('[STARTUP FAILURE]', error);
    process.exit(1);
  }
}

// ==========================================
// GLOBAL ERROR HANDLERS
// ==========================================
process.on('unhandledRejection', (error) => {
  console.error('[UNHANDLED REJECTION]', error);
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  handleShutdown();
});

// ==========================================
// START THE BOT
// ==========================================
startBot();
