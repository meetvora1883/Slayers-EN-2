require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Initialize Discord Client with commands collection
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// Initialize collections BEFORE loading files
client.commands = new Collection(); // Fix: Initialize here

// ==========================================
// 1. LOAD COMMANDS
// ==========================================
console.log('[BOOT] Loading commands...');
try {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath)
    .filter(file => file.endsWith('.js') && file !== 'utilities.js'); // Exclude utilities

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      
      // Validate command structure
      if (typeof command.name !== 'string' || typeof command.execute !== 'function') {
        console.warn(`[WARNING] Invalid command in ${file} - missing name or execute`);
        continue;
      }
      
      client.commands.set(command.name, command);
      console.log(`[LOADED] Command: ${command.name}`);
    } catch (error) {
      console.error(`[ERROR] Failed to load command ${file}:`, error.message);
    }
  }
} catch (error) {
  console.error('[CRITICAL] Failed to load commands:', error);
  process.exit(1);
}

// ==========================================
// 2. LOAD EVENTS
// ==========================================
console.log('[BOOT] Loading events...');
try {
  const eventsPath = path.join(__dirname, 'events');
  const eventFiles = fs.readdirSync(eventsPath)
    .filter(file => file.endsWith('.js'));

  for (const file of eventFiles) {
    try {
      const event = require(path.join(eventsPath, file));
      
      if (typeof event.name !== 'string' || typeof event.execute !== 'function') {
        console.warn(`[WARNING] Invalid event in ${file} - missing name or execute`);
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
  console.error('[CRITICAL] Failed to load events:', error);
}

// ==========================================
// 3. START SERVICES
// ==========================================
async function startServices() {
  // Database connection
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log('[SUCCESS] MongoDB connected');
    } catch (error) {
      console.error('[ERROR] MongoDB connection failed:', error.message);
    }
  }

  // Health server
  http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(fs.readFileSync('./health.html', 'utf8'));
  }).listen(process.env.PORT || 3000, () => {
    console.log(`[SERVER] Running on port ${process.env.PORT || 3000}`);
  });
}

// ==========================================
// 4. BOT LOGIN
// ==========================================
client.login(process.env.TOKEN)
  .then(() => {
    console.log(`[DISCORD] Logged in as ${client.user.tag}`);
    console.log(`[READY] Serving ${client.guilds.cache.size} guilds`);
  })
  .catch(error => {
    console.error('[FATAL] Login failed:', error.message);
    process.exit(1);
  });

// Start all services
startServices();

// Error handling
process.on('unhandledRejection', error => {
  console.error('[UNHANDLED]', error.message);
});
