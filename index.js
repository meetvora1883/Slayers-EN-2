require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs'); // ADD THIS LINE

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageTyping
  ]
});

// Load commands
client.commands = new Map();
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js')); // FIXED TYPO (.file → .filter)

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.name, command);
}

// Rest of your code (MongoDB connection, event handlers, etc.)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('[DATABASE] Connected to MongoDB'))
  .catch(err => console.error('[DATABASE ERROR]', err));

client.once('ready', () => {
  console.log(`[DISCORD] Logged in as ${client.user.tag}`);
});

// Add other event handlers here

client.login(process.env.TOKEN);

// HTTP server for Render
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end('<h1>Discord Bot Status: Online</h1>');
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`[SERVER] Running on port ${process.env.PORT || 3000}`);
});
