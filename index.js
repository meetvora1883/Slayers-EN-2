require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const http = require('http');
const nameChange = require('./commands/nameChange');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Discord Bot Ready Event
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

// Message Handling
client.on('messageCreate', async message => {
  if (message.channel.id === process.env.ROLE_REQUEST_CHANNEL && !message.author.bot) {
    await nameChange.execute(message);
  }
});

// Start Discord Bot
client.login(process.env.TOKEN);

// HTTP Server for Render Health Checks
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(require('fs').readFileSync('./health.html', 'utf8'));
});

server.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
