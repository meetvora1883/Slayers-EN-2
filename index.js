require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
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
    GatewayIntentBits.GuildMembers
  ]
});

// Global Collections
client.commands = new Collection();

// Load Commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.name, command);
}

// Load Events
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
  const event = require(path.join(eventsPath, file));
  client.on(event.name, (...args) => event.execute(...args, client));
}

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('[DATABASE] Connected to MongoDB'))
  .catch(err => console.error('[DATABASE ERROR]', err));

// Health Check Server
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(fs.readFileSync('./health.html', 'utf8'));
}).listen(process.env.PORT || 3000, () => {
  console.log(`[SERVER] Running on port ${process.env.PORT || 3000}`);
});

// Login to Discord
client.login(process.env.TOKEN)
  .then(() => console.log(`[DISCORD] Logged in as ${client.user.tag}`))
  .catch(error => {
    console.error('[LOGIN ERROR]', error);
    process.exit(1);
  });

// Error Handling
process.on('unhandledRejection', error => {
  console.error('[UNHANDLED REJECTION]', error);
});

process.on('uncaughtException', error => {
  console.error('[UNCAUGHT EXCEPTION]', error);
});
