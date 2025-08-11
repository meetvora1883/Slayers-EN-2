require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const http = require('http');

// ======================
// 1. SERVER SETUP (Render.com)
// ======================
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Slayer Bot Status: OPERATIONAL\n');
}).listen(process.env.PORT || 3000, () => {
  console.log(`[SERVER] HTTP server running on port ${process.env.PORT || 3000}`);
});

// ======================
// 2. DISCORD CLIENT SETUP
// ======================
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent
  ],
  presence: {
    status: 'online',
    activities: [{ name: 'Slayer Management', type: 3 }] // WATCHING
  }
});

// ======================
// 3. TRACKING SYSTEMS
// ======================
const cooldowns = new Map();
const statusHistory = new Map(); // Tracks user status history
const slayerRegistry = new Map(); // Tracks all Slayers

// ======================
// 4. PRESENCE TRACKING WITH DETAILED LOGGING
// ======================
client.on('presenceUpdate', (oldPresence, newPresence) => {
  const member = newPresence?.member || oldPresence?.member;
  if (!member || member.user.bot) return;

  const oldStatus = oldPresence?.status || 'offline';
  const newStatus = newPresence?.status || 'offline';

  if (oldStatus !== newStatus) {
    const timestamp = new Date();
    const isSlayer = member.roles.cache.has(process.env.SLAYER_ROLE);

    // Update status history
    if (!statusHistory.has(member.id)) {
      statusHistory.set(member.id, []);
    }
    statusHistory.get(member.id).push({
      status: newStatus,
      timestamp
    });

    // Console logging with emoji indicators
    const statusEmojis = {
      online: '🟢',
      idle: '🟡',
      dnd: '🔴',
      offline: '⚫'
    };

    console.log(`[${timestamp.toLocaleTimeString()}] ${statusEmojis[newStatus] || '⚪'} ${member.user.tag} (${isSlayer ? 'SLAYER' : 'member'}) ${oldStatus.toUpperCase()} → ${newStatus.toUpperCase()}`);

    // Additional logging for Slayers
    if (isSlayer) {
      const statusChannel = client.channels.cache.get(process.env.STATUS_LOG_CHANNEL);
      if (statusChannel) {
        const embed = new EmbedBuilder()
          .setColor(getStatusColor(newStatus))
          .setTitle('Slayer Status Change')
          .setDescription(`${member.toString()} status updated`)
          .addFields(
            { name: 'Previous', value: oldStatus.toUpperCase(), inline: true },
            { name: 'Current', value: newStatus.toUpperCase(), inline: true },
            { name: 'Duration', value: getDurationText(member.id, newStatus), inline: true }
          )
          .setThumbnail(member.user.displayAvatarURL())
          .setTimestamp();

        statusChannel.send({ embeds: [embed] });
      }
    }
  }
});

function getDurationText(userId, newStatus) {
  const history = statusHistory.get(userId);
  if (!history || history.length < 2) return 'First status';

  const prevEntry = history[history.length - 2];
  const duration = (new Date() - prevEntry.timestamp) / 1000;
  
  if (duration < 60) return `${Math.floor(duration)} sec`;
  if (duration < 3600) return `${Math.floor(duration/60)} min`;
  return `${Math.floor(duration/3600)} hours`;
}

// ======================
// 5. ROLE REQUEST SYSTEM
// ======================
client.on('messageCreate', async (message) => {
  if (message.author.bot || message.channel.id !== process.env.ROLE_REQUEST_CHANNEL) return;

  // Parse message: "Name: [name] ID: [id] Rank: [rank]"
  const parseError = async () => {
    await message.react('❌');
    await message.author.send({
      embeds: [new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Invalid Format')
        .setDescription('Use:\n```Name: YourName\nID: 123456\nRank: 5```')
      ]
    });
  };

  const lines = message.content.split('\n').map(l => l.trim());
  const nameLine = lines.find(l => l.toLowerCase().startsWith('name:'));
  const idLine = lines.find(l => l.toLowerCase().startsWith('id:'));
  const rankLine = lines.find(l => l.toLowerCase().startsWith('rank:'));

  if (!nameLine || !idLine || !rankLine) return parseError();

  const extractValue = (line) => line.split(':')[1]?.trim();
  const name = extractValue(nameLine);
  const id = extractValue(idLine);
  const rank = extractValue(rankLine);

  if (!name || !id || !rank) return parseError();

  // Cooldown check
  if (cooldowns.has(message.author.id)) {
    const remaining = cooldowns.get(message.author.id) - Date.now();
    if (remaining > 0) {
      await message.react('⏳');
      return message.author.send(`⏳ Please wait ${Math.ceil(remaining/60000)} minutes before another request.`);
    }
  }

  try {
    // Format nickname and assign role
    const nickname = `${name} | ${id}`;
    await message.member.setNickname(nickname);
    await message.member.roles.add(process.env.SLAYER_ROLE);

    // Register Slayer
    slayerRegistry.set(message.author.id, {
      name,
      id,
      rank,
      joinDate: new Date(),
      status: message.member.presence?.status || 'offline'
    });

    // Send confirmation
    const confirmEmbed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('✅ Slayer Registration Complete')
      .setDescription(`**${nickname}**`)
      .addFields(
        { name: 'Rank', value: rank, inline: true },
        { name: 'Current Status', value: message.member.presence?.status?.toUpperCase() || 'OFFLINE', inline: true }
      )
      .setThumbnail(message.author.displayAvatarURL())
      .setTimestamp();

    await message.react('✅');
    await message.author.send({ embeds: [confirmEmbed] });

    // Log to Slayer channel
    const logChannel = client.channels.cache.get(process.env.SLAYER_LOG_CHANNEL);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor('#0099FF')
        .setTitle('New Slayer Initiated')
        .setDescription(`${message.author.toString()} joined the ranks`)
        .addFields(
          { name: 'Nickname', value: nickname },
          { name: 'Rank', value: rank },
          { name: 'Status', value: message.member.presence?.status?.toUpperCase() || 'OFFLINE' }
        )
        .setThumbnail(message.author.displayAvatarURL())
        .setTimestamp();

      await logChannel.send({ embeds: [logEmbed] });
    }

    // Set cooldown
    cooldowns.set(message.author.id, Date.now() + parseInt(process.env.COOLDOWN));
    console.log(`[REGISTER] New Slayer: ${message.author.tag} as "${nickname}" (Rank ${rank})`);

  } catch (error) {
    console.error(`[REGISTER ERROR] ${message.author.tag}:`, error);
    await message.react('⚠️');
    await message.author.send('❌ Registration failed. Please contact High Command.');
  }
});

// ======================
// 6. SLASH COMMANDS
// ======================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'slayerlist':
        await handleSlayerList(interaction);
        break;
      case 'removeslayer':
        await handleRemoveSlayer(interaction);
        break;
      case 'slayerstats':
        await handleSlayerStats(interaction);
        break;
      case 'checkstatus':
        await handleCheckStatus(interaction);
        break;
      default:
        await interaction.reply({ content: '❌ Unknown command', ephemeral: true });
    }
  } catch (error) {
    console.error(`[COMMAND ERROR] ${interaction.commandName}:`, error);
    await interaction.reply({ content: '⚠️ Command failed', ephemeral: true });
  }
});

// Command: /slayerlist
async function handleSlayerList(interaction) {
  const slayers = (await interaction.guild.members.fetch())
    .filter(m => m.roles.cache.has(process.env.SLAYER_ROLE))
    .sort((a, b) => (a.nickname || a.user.username).localeCompare(b.nickname || b.user.username));

  if (slayers.size === 0) {
    return interaction.reply({ content: 'No Slayers found', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle('🏆 Slayer Roster')
    .setColor('#FFD700')
    .setDescription(`Total Slayers: ${slayers.size}`);

  // Split into fields of 10
  const slayerArray = Array.from(slayers.values());
  for (let i = 0; i < slayerArray.length; i += 10) {
    const batch = slayerArray.slice(i, i + 10);
    embed.addFields({
      name: `Batch ${Math.floor(i/10) + 1}`,
      value: batch.map(m => {
        const status = m.presence?.status || 'offline';
        const statusEmoji = {
          online: '🟢',
          idle: '🟡',
          dnd: '🔴',
          offline: '⚫'
        }[status];
        return `${statusEmoji || '⚪'} ${m.nickname || m.user.username}`;
      }).join('\n'),
      inline: true
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
  console.log(`[COMMAND] ${interaction.user.tag} requested Slayer list`);
}

// Command: /removeslayer
async function handleRemoveSlayer(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
  }

  const target = interaction.options.getMember('user');
  if (!target) {
    return interaction.reply({ content: '❌ Member not found', ephemeral: true });
  }

  if (!target.roles.cache.has(process.env.SLAYER_ROLE)) {
    return interaction.reply({ content: '❌ Target is not a Slayer', ephemeral: true });
  }

  try {
    // Remove role and registry entry
    await target.roles.remove(process.env.SLAYER_ROLE);
    slayerRegistry.delete(target.id);

    // Notify target
    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('⚔️ Slayer Status Revoked')
          .setDescription('Your Slayer role has been removed')
          .addFields(
            { name: 'By', value: interaction.user.toString() },
            { name: 'Status at Removal', value: target.presence?.status?.toUpperCase() || 'OFFLINE' }
          )
          .setTimestamp()
        ]
      });
    } catch (dmError) {
      console.log(`[WARN] Could not DM ${target.user.tag}`);
    }

    // Log removal
    const logChannel = client.channels.cache.get(process.env.SLAYER_LOG_CHANNEL);
    if (logChannel) {
      await logChannel.send({
        embeds: [new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('Slayer Removed')
          .setDescription(`${target.toString()} was removed from the Slayers`)
          .addFields(
            { name: 'By', value: interaction.user.toString() },
            { name: 'Duration as Slayer', value: getDurationText(target.id, 'removed') }
          )
          .setThumbnail(target.user.displayAvatarURL())
          .setTimestamp()
        ]
      });
    }

    await interaction.reply({ 
      content: `✅ Removed Slayer role from ${target.toString()}`,
      ephemeral: true 
    });
    console.log(`[COMMAND] ${interaction.user.tag} removed ${target.user.tag} from Slayers`);

  } catch (error) {
    console.error('[REMOVAL ERROR]', error);
    await interaction.reply({ content: '❌ Failed to remove role', ephemeral: true });
  }
}

// Command: /slayerstats
async function handleSlayerStats(interaction) {
  const slayers = (await interaction.guild.members.fetch())
    .filter(m => m.roles.cache.has(process.env.SLAYER_ROLE));

  const statusCount = {
    online: 0,
    idle: 0,
    dnd: 0,
    offline: 0
  };

  slayers.forEach(member => {
    const status = member.presence?.status || 'offline';
    statusCount[status]++;
  });

  const total = slayers.size;
  const embed = new EmbedBuilder()
    .setTitle('📊 Slayer Force Status')
    .setColor('#00AAFF')
    .addFields(
      { name: 'Total Slayers', value: total.toString(), inline: true },
      { name: '🟢 Online', value: statusCount.online.toString(), inline: true },
      { name: '🟡 Idle', value: statusCount.idle.toString(), inline: true },
      { name: '🔴 DND', value: statusCount.dnd.toString(), inline: true },
      { name: '⚫ Offline', value: statusCount.offline.toString(), inline: true },
      { name: 'Activity Rate', value: `${Math.round(((statusCount.online + statusCount.idle)/total)*100)}%`, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  console.log(`[COMMAND] ${interaction.user.tag} requested Slayer stats`);
}

// Command: /checkstatus
async function handleCheckStatus(interaction) {
  const member = interaction.options.getMember('user') || interaction.member;
  const status = member.presence?.status || 'offline';
  const history = statusHistory.get(member.id) || [];

  const statusEmoji = {
    online: '🟢',
    idle: '🟡',
    dnd: '🔴',
    offline: '⚫'
  }[status];

  const embed = new EmbedBuilder()
    .setTitle(`${statusEmoji || '⚪'} ${member.user.username}'s Status`)
    .setColor(getStatusColor(status))
    .addFields(
      { name: 'Current Status', value: status.toUpperCase(), inline: true },
      { name: 'Last Changed', value: history.length > 0 ? 
        `<t:${Math.floor(history[history.length-1].timestamp/1000)}:R>` : 'Unknown', inline: true }
    )
    .setThumbnail(member.user.displayAvatarURL());

  if (history.length > 1) {
    const lastOnline = history.findLast(e => e.status === 'online');
    if (lastOnline) {
      embed.addFields({
        name: 'Last Online',
        value: `<t:${Math.floor(lastOnline.timestamp/1000)}:R>`,
        inline: true
      });
    }
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
  console.log(`[COMMAND] ${interaction.user.tag} checked ${member.user.tag}'s status`);
}

// ======================
// 7. UTILITY FUNCTIONS
// ======================
function getStatusColor(status) {
  const colors = {
    online: '#43B581',
    idle: '#FAA61A',
    dnd: '#F04747',
    offline: '#747F8D'
  };
  return colors[status] || '#000000';
}

// ======================
// 8. BOT STARTUP
// ======================
client.on('ready', async () => {
  console.log(`[BOT] ${client.user.tag} is online in ${client.guilds.cache.size} servers`);
  
  // Initial status scan
  const guild = client.guilds.cache.first(); // Assuming one guild
  const members = await guild.members.fetch();
  
  members.forEach(member => {
    if (member.user.bot) return;
    
    const status = member.presence?.status || 'offline';
    if (!statusHistory.has(member.id)) {
      statusHistory.set(member.id, []);
    }
    statusHistory.get(member.id).push({
      status,
      timestamp: new Date()
    });

    // Log initial Slayer statuses
    if (member.roles.cache.has(process.env.SLAYER_ROLE)) {
      console.log(`[INIT] Slayer ${member.user.tag}: ${status.toUpperCase()}`);
    }
  });

  // Register slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('slayerlist')
      .setDescription('List all Slayers with statuses'),
    new SlashCommandBuilder()
      .setName('removeslayer')
      .setDescription('Remove Slayer role from a member')
      .addUserOption(option =>
        option.setName('user')
          .setDescription('The member to remove')
          .setRequired(true))
      .setDefaultMemberPermissions(0),
    new SlashCommandBuilder()
      .setName('slayerstats')
      .setDescription('Show current Slayer activity statistics'),
    new SlashCommandBuilder()
      .setName('checkstatus')
      .setDescription("Check a member's status history")
      .addUserOption(option =>
        option.setName('user')
          .setDescription('Member to check')
          .setRequired(false))
  ].map(cmd => cmd.toJSON());

  try {
    await client.application.commands.set(commands);
    console.log('[BOT] Slash commands registered');
  } catch (err) {
    console.error('[ERROR] Command registration failed:', err);
  }
});

// ======================
// 9. ERROR HANDLING
// ======================
process.on('unhandledRejection', err => {
  console.error('[UNHANDLED REJECTION]', err);
});

process.on('uncaughtException', err => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

// ======================
// 10. SHUTDOWN HANDLING
// ======================
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] Initiating graceful shutdown...');
  
  Promise.all([
    new Promise(resolve => server.close(resolve)),
    client.destroy()
  ]).then(() => {
    console.log('[SHUTDOWN] Completed successfully');
    process.exit(0);
  }).catch(err => {
    console.error('[SHUTDOWN ERROR]', err);
    process.exit(1);
  });
});

// ======================
// START THE BOT
// ======================
client.login(process.env.TOKEN)
  .then(() => console.log('[BOT] Login successful'))
  .catch(err => {
    console.error('[LOGIN ERROR]', err);
    process.exit(1);
  });
