require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Initialize Discord Client
console.log('[BOOT] Initializing Discord client...');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageTyping
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION']
});

// Global Collections
client.commands = new Collection();
client.events = new Collection();
client.utilities = {};

// ==========================================
// 1. LOAD UTILITIES
// ==========================================
console.log('[BOOT] Loading utilities...');
try {
  const utilitiesPath = path.join(__dirname, 'commands', 'utilities.js');
  if (fs.existsSync(utilitiesPath)) {
    client.utilities = require(utilitiesPath);
    console.log(`[SUCCESS] Loaded utilities: ${Object.keys(client.utilities).join(', ')}`);
  } else {
    console.warn('[WARNING] utilities.js not found in commands folder');
  }
} catch (error) {
  console.error('[ERROR] Failed to load utilities:', error);
  process.exit(1);
}

// ==========================================
// 2. LOAD COMMANDS
// ==========================================
console.log('[BOOT] Loading commands...');
const commandsPath = path.join(__dirname, 'commands');
try {
  const commandFiles = fs.readdirSync(commandsPath)
    .filter(file => file.endsWith('.js') && file !== 'utilities.js');

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (!command.name || !command.execute) {
        console.warn(`[WARNING] Command ${file} is missing required properties`);
        continue;
      }
      client.commands.set(command.name, command);
      console.log(`[LOADED] Command: ${command.name}`);
    } catch (error) {
      console.error(`[ERROR] Failed to load command ${file}:`, error.message);
    }
  }
} catch (error) {
  console.error('[ERROR] Failed to read commands directory:', error);
  process.exit(1);
}

// ==========================================
// 3. LOAD EVENTS
// ==========================================
console.log('[BOOT] Loading events...');
const eventsPath = path.join(__dirname, 'events');
try {
  const eventFiles = fs.readdirSync(eventsPath)
    .filter(file => file.endsWith('.js'));

  for (const file of eventFiles) {
    try {
      const event = require(path.join(eventsPath, file));
      if (!event.name || !event.execute) {
        console.warn(`[WARNING] Event ${file} is missing required properties`);
        continue;
      }
      
      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }
      console.log(`[LOADED] Event: ${event.name}`);
    } catch (error) {
      console.error(`[ERROR] Failed to load event ${file}:`, error.message);
    }
  }
} catch (error) {
  console.error('[ERROR] Failed to read events directory:', error);
  process.exit(1);
}

// ==========================================
// 4. DATABASE CONNECTION
// ==========================================
async function connectDB() {
  console.log('[BOOT] Connecting to MongoDB...');
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000
    });
    console.log('[SUCCESS] MongoDB connected');
  } catch (error) {
    console.error('[ERROR] MongoDB connection failed:', error);
    process.exit(1);
  }
}

// ==========================================
// 5. HEALTH CHECK SERVER
// ==========================================
function startHealthServer() {
  console.log('[BOOT] Starting health server...');
  try {
    const server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'online',
          uptime: process.uptime(),
          commands: client.commands.size,
          events: client.events.size
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(path.join(__dirname, 'health.html')));
      }
    });

    server.listen(process.env.PORT || 3000, () => {
      console.log(`[SUCCESS] Health server running on port ${process.env.PORT || 3000}`);
    });

    server.on('error', (error) => {
      console.error('[ERROR] Health server error:', error);
    });
  } catch (error) {
    console.error('[ERROR] Failed to start health server:', error);
  }
}

// ==========================================
// 6. BOT STARTUP
// ==========================================
async function startBot() {
  try {
    await connectDB();
    startHealthServer();

    console.log('[BOOT] Logging in to Discord...');
    await client.login(process.env.TOKEN);
    console.log(`[SUCCESS] Logged in as ${client.user.tag}`);

    // Ready confirmation
    client.user.setActivity('with your nicknames', { type: 'PLAYING' });
    console.log(`[READY] Serving ${client.guilds.cache.size} guilds`);

  } catch (error) {
    console.error('[FATAL] Startup failed:', error);
    process.exit(1);
  }
}

// ==========================================
// ERROR HANDLING
// ==========================================
process.on('unhandledRejection', error => {
  console.error('[UNHANDLED] Promise rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('[UNCAUGHT] Exception:', error);
  process.exit(1);
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] Received SIGTERM');
  shutdown();
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] Received SIGINT');
  shutdown();
});

async function shutdown() {
  console.log('[SHUTDOWN] Initiating graceful shutdown...');
  try {
    await mongoose.disconnect();
    console.log('[SHUTDOWN] MongoDB disconnected');
    client.destroy();
    console.log('[SHUTDOWN] Discord client destroyed');
    process.exit(0);
  } catch (error) {
    console.error('[SHUTDOWN ERROR]', error);
    process.exit(1);
  }
}

// ==========================================
// START THE BOT
// ==========================================
startBot();
