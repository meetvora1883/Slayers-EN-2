require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Initialize Discord Client with validated intents
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

// ========================
// 1. COMMAND LOADER
// ========================
client.commands = new Map();

const loadCommands = () => {
  try {
    const commandsPath = path.join(__dirname, 'commands');
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

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
};

// ========================
// 2. EVENT HANDLER LOADER
// ========================
const loadEvents = () => {
  try {
    const eventsPath = path.join(__dirname, 'events');
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

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
};

// ========================
// 3. DATABASE CONNECTION
// ========================
const connectDB = async () => {
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
};

// ========================
// 4. HEALTH CHECK SERVER
// ========================
const startHealthServer = () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200).end(JSON.stringify({
        status: 'online',
        uptime: process.uptime(),
        guilds: client.guilds?.cache.size || 0
      }));
    } else {
      res.writeHead(200).end(fs.readFileSync(path.join(__dirname, 'health.html')));
    }
  });

  server.listen(process.env.PORT || 3000, () => {
    console.log(`[HEALTH] Server running on port ${process.env.PORT || 3000}`);
  });

  server.on('error', (error) => {
    console.error('[SERVER ERROR]', error);
  });
};

// ========================
// 5. BOT STARTUP SEQUENCE
// ========================
const startBot = async () => {
  try {
    loadCommands();
    loadEvents();
    await connectDB();
    startHealthServer();

    client.login(process.env.TOKEN)
      .then(() => console.log('[LOGIN] Bot is connecting to Discord...'))
      .catch(error => {
        console.error('[LOGIN ERROR]', error);
        process.exit(1);
      });

  } catch (error) {
    console.error('[STARTUP FAILURE]', error);
    process.exit(1);
  }
};

// ========================
// GLOBAL ERROR HANDLING
// ========================
process.on('unhandledRejection', (error) => {
  console.error('[UNHANDLED REJECTION]', error);
});

process.on('uncaughtException', (error) => {
  console.error('[UNCAUGHT EXCEPTION]', error);
  process.exit(1);
});

// Start the bot
startBot();
