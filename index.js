require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Color codes for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

// ==========================================
// 0. TOKEN VERIFICATION
// ==========================================
console.log(`${colors.cyan}[${new Date().toISOString()}] 🔍 Verifying environment variables...${colors.reset}`);

if (!process.env.TOKEN) {
  console.error(`${colors.red}[${new Date().toISOString()}] 🛑 FATAL: Missing DISCORD_TOKEN in .env file${colors.reset}`);
  process.exit(1);
}

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
// 1. LOAD COMMANDS & EVENTS
// ==========================================
const loadFiles = (dir, type) => {
  const files = fs.readdirSync(path.join(__dirname, dir))
    .filter(file => file.endsWith('.js'));

  files.forEach(file => {
    try {
      const req = require(path.join(__dirname, dir, file));
      if (type === 'commands' && req.execute) {
        client.commands.set(req.name, req);
        console.log(`${colors.green}[${new Date().toISOString()}] ✅ Loaded ${type.slice(0, -1)}: ${req.name}${colors.reset}`);
      } else if (type === 'events' && req.execute) {
        client.on(req.name, (...args) => req.execute(...args, client));
        console.log(`${colors.green}[${new Date().toISOString()}] ✅ Registered event: ${req.name}${colors.reset}`);
      }
    } catch (error) {
      console.error(`${colors.red}[${new Date().toISOString()}] ❌ Failed to load ${file}: ${error.message}${colors.reset}`);
    }
  });
};

console.log(`${colors.cyan}[${new Date().toISOString()}] 🔄 Loading commands...${colors.reset}`);
loadFiles('./commands', 'commands');

console.log(`${colors.cyan}[${new Date().toISOString()}] 🔄 Loading events...${colors.reset}`);
loadFiles('./events', 'events');

// ==========================================
// 2. DATABASE & SERVER SETUP
// ==========================================
const startServices = async () => {
  if (process.env.MONGODB_URI) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log(`${colors.green}[${new Date().toISOString()}] 🗄️  MongoDB connected${colors.reset}`);
    } catch (error) {
      console.error(`${colors.yellow}[${new Date().toISOString()}] ⚠️  MongoDB connection failed: ${error.message}${colors.reset}`);
    }
  }

  http.createServer((req, res) => {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(fs.readFileSync('./health.html', 'utf8'));
  }).listen(process.env.PORT || 3000, () => {
    console.log(`${colors.green}[${new Date().toISOString()}] 🌐 Health server running on port ${process.env.PORT || 3000}${colors.reset}`);
  });
};

// ==========================================
// 3. BOT LOGIN WITH ENHANCED ERROR HANDLING
// ==========================================
const startBot = async () => {
  try {
    await startServices();
    
    console.log(`${colors.cyan}[${new Date().toISOString()}] 🔑 Logging in to Discord...${colors.reset}`);
    
    await client.login(process.env.TOKEN)
      .then(() => {
        console.log(`${colors.green}[${new Date().toISOString()}] 🤖 Logged in as ${client.user.tag}${colors.reset}`);
        console.log(`${colors.blue}[${new Date().toISOString()}] 🚀 Serving ${client.guilds.cache.size} guilds${colors.reset}`);
      })
      .catch(error => {
        console.error(`${colors.red}[${new Date().toISOString()}] 🛑 Login failed: ${error.message}${colors.reset}`);
        console.error(`${colors.red}[${new Date().toISOString()}] 🛑 Possible causes:${colors.reset}`);
        console.error(`${colors.red}• Invalid/expired bot token${colors.reset}`);
        console.error(`${colors.red}• Missing Gateway Intents${colors.reset}`);
        console.error(`${colors.red}• Incorrect bot permissions${colors.reset}`);
        process.exit(1);
      });

  } catch (error) {
    console.error(`${colors.red}[${new Date().toISOString()}] 💥 Critical startup error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
};

// ==========================================
// ERROR HANDLERS
// ==========================================
process.on('unhandledRejection', error => {
  console.error(`${colors.red}[${new Date().toISOString()}] ⚠️  Unhandled rejection: ${error.message}${colors.reset}`);
});

process.on('uncaughtException', error => {
  console.error(`${colors.red}[${new Date().toISOString()}] 💥 Uncaught exception: ${error.message}${colors.reset}`);
  process.exit(1);
});

// Start the bot
startBot();
