require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const http = require('http');
const fs = require('fs');

// ======================
// 1. ENHANCED INDIAN TIME LOGGER
// ======================
class ISTLogger {
  static getCurrentIST() {
    return new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  }

  static formatTime() {
    return this.getCurrentIST().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: true,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  static log(level, message, error = null) {
    const timestamp = this.formatTime();
    const colors = {
      INFO: '\x1b[36m',     // Cyan
      SUCCESS: '\x1b[32m',  // Green
      WARNING: '\x1b[33m',  // Yellow
      ERROR: '\x1b[31m',    // Red
      CRITICAL: '\x1b[41m'  // Red background
    };
    const reset = '\x1b[0m';
    
    let logMessage = `${colors[level]}[${timestamp}] [${level}] ${message}${reset}`;
    if (error) {
      logMessage += `\n${colors.ERROR}Stack: ${error.stack || error.message || 'No stack trace'}${reset}`;
    }
    
    console.log(logMessage);
    
    // Log to file if enabled
    if (process.env.LOG_TO_FILE === 'true') {
      const logEntry = `[${timestamp}] [${level}] ${message}` + 
        (error ? `\nError: ${error.message}\nStack: ${error.stack}` : '');
      fs.appendFileSync('bot.log', logEntry + '\n');
    }
  }

  static info(message) { this.log('INFO', message); }
  static success(message) { this.log('SUCCESS', message); }
  static warn(message) { this.log('WARNING', message); }
  static error(message, err) { this.log('ERROR', message, err); }
  static critical(message, err) { this.log('CRITICAL', message, err); }
}

// ======================
// 2. SERVER SETUP
// ======================
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Slayer Bot Status: OPERATIONAL\n');
}).listen(process.env.PORT || 3000, () => {
  ISTLogger.info(`Server started on port ${process.env.PORT || 3000}`);
});

// ======================
// 3. DISCORD CLIENT SETUP
// ======================
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent
  ],
  partials: ['MESSAGE', 'CHANNEL', 'REACTION', 'USER']
});

// ======================
// 4. TRACKING SYSTEMS
// ======================
const statusHistory = new Map();
const slayerRegistry = new Map();
const onlineStatus = {
  online: 0,
  idle: 0,
  dnd: 0,
  offline: 0,
  lastUpdated: null
};

// ======================
// 5. PRESENCE TRACKING SYSTEM
// ======================
client.on('presenceUpdate', async (oldPresence, newPresence) => {
  try {
    const member = newPresence?.member || oldPresence?.member;
    if (!member || member.user.bot) return;

    const oldStatus = oldPresence?.status || 'offline';
    const newStatus = newPresence?.status || 'offline';

    if (oldStatus !== newStatus) {
      // Update status history
      if (!statusHistory.has(member.id)) {
        statusHistory.set(member.id, []);
      }
      statusHistory.get(member.id).push({
        status: newStatus,
        timestamp: new Date()
      });

      // Update online counters
      if (oldStatus in onlineStatus) onlineStatus[oldStatus]--;
      if (newStatus in onlineStatus) onlineStatus[newStatus]++;
      onlineStatus.lastUpdated = new Date();

      // Log status change
      const emoji = {
        online: '🟢',
        idle: '🟡',
        dnd: '🔴',
        offline: '⚫'
      }[newStatus] || '⚪';

      ISTLogger.info(`${emoji} ${member.user.tag} changed status: ${oldStatus} → ${newStatus}`);

      // Special handling for Slayers
      if (member.roles.cache.has(process.env.SLAYER_ROLE)) {
        const logChannel = client.channels.cache.get(process.env.STATUS_LOG_CHANNEL);
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setColor(getStatusColor(newStatus))
            .setTitle('Slayer Status Update')
            .setDescription(`${member.toString()} status changed`)
            .addFields(
              { name: 'Previous', value: oldStatus.toUpperCase(), inline: true },
              { name: 'Current', value: newStatus.toUpperCase(), inline: true },
              { name: 'Changed At', value: ISTLogger.formatTime(), inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setFooter({ text: 'Status Tracking System' });

          await logChannel.send({ embeds: [embed] }).catch(err => {
            ISTLogger.error('Failed to send status update', err);
          });
        }
      }
    }
  } catch (error) {
    ISTLogger.error('Error in presenceUpdate handler', error);
  }
});

// ======================
// 6. ROLE REQUEST SYSTEM
// ======================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || message.channel.id !== process.env.ROLE_REQUEST_CHANNEL) return;

  try {
    const content = message.content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Basic validation
    if (content.length < 3) {
      await message.react('❌');
      return sendFormatError(message, 
        'Need at least 3 lines (Name, ID, Rank)',
        'Name: YourName\nID: 123456\nRank: 5'
      );
    }

    // Extract fields
    const fields = {
      name: content.find(l => l.toLowerCase().startsWith('name:')),
      id: content.find(l => l.toLowerCase().startsWith('id:')),
      rank: content.find(l => l.toLowerCase().startsWith('rank:'))
    };

    // Validate fields exist
    if (!fields.name || !fields.id || !fields.rank) {
      await message.react('❌');
      return sendFormatError(message,
        'Missing required fields (Name, ID, or Rank)',
        'Name: YourName\nID: 123456\nRank: 5'
      );
    }

    // Extract values
    const getValue = (field) => field.split(':').slice(1).join(':').trim();
    const name = getValue(fields.name);
    const id = getValue(fields.id);
    const rank = getValue(fields.rank);

    // Validate values
    if (!name || name.length > 32) {
      await message.react('❌');
      return sendFormatError(message,
        'Name must be 1-32 characters',
        'Name: YourInGameName'
      );
    }

    if (!id || id.length > 6 || !/^\d+$/.test(id)) {
      await message.react('❌');
      return sendFormatError(message,
        'ID must be up to 6 digits',
        'ID: 123456'
      );
    }

    if (!rank || !/^([1-9]|10)$/.test(rank)) {
      await message.react('❌');
      return sendFormatError(message,
        'Rank must be number 1-10',
        'Rank: 5'
      );
    }

    // Success
    await message.react('✅');
    ISTLogger.success(`Valid request from ${message.author.tag}: ${name} | ${id} | Rank ${rank}`);

  } catch (error) {
    ISTLogger.error(`Error processing request from ${message.author.tag}`, error);
    try {
      await message.react('❌');
    } catch (reactError) {
      ISTLogger.warn(`Failed to react to message from ${message.author.tag}`);
    }
  }
});

// ======================
// 7. SLASH COMMANDS
// ======================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  try {
    await interaction.deferReply({ ephemeral: true });

    switch (interaction.commandName) {
      case 'removeslayer':
        await handleRemoveSlayer(interaction);
        break;
      case 'slayerlist':
        await handleSlayerList(interaction);
        break;
      case 'slayerstats':
        await handleSlayerStats(interaction);
        break;
      case 'onlinestats':
        await handleOnlineStats(interaction);
        break;
      case 'checkstatus':
        await handleCheckStatus(interaction);
        break;
      default:
        await interaction.editReply('❌ Unknown command');
    }
  } catch (error) {
    ISTLogger.error(`Command error: ${interaction.commandName}`, error);
    try {
      await interaction.editReply('❌ Command failed (error logged)');
    } catch (replyError) {
      ISTLogger.error('Failed to send error reply', replyError);
    }
  }
});

// Command: /removeslayer
async function handleRemoveSlayer(interaction) {
  // Permission check
  if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.editReply('❌ You need Manage Roles permission');
  }

  const target = interaction.options.getMember('user');
  if (!target) {
    return interaction.editReply('❌ User not found');
  }

  // Verify bot permissions
  const botMember = await interaction.guild.members.fetchMe();
  if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return interaction.editReply('❌ Bot lacks Manage Roles permission');
  }

  // Check if target has Slayer role
  if (!target.roles.cache.has(process.env.SLAYER_ROLE)) {
    return interaction.editReply(`❌ ${target.user.tag} is not a Slayer`);
  }

  // Role hierarchy check
  if (target.roles.highest.position >= botMember.roles.highest.position) {
    return interaction.editReply('❌ Cannot remove role from higher/equal role members');
  }

  // Remove role
  await target.roles.remove(process.env.SLAYER_ROLE);
  ISTLogger.success(`Removed Slayer role from ${target.user.tag} by ${interaction.user.tag}`);

  // Send DM to removed user
  try {
    const dmEmbed = new EmbedBuilder()
      .setColor('#FF5555')
      .setTitle('⚔️ Slayer Status Revoked')
      .setDescription(`Your Slayer role has been removed in **${interaction.guild.name}**`)
      .addFields(
        { name: 'Removed By', value: interaction.user.tag, inline: true },
        { name: 'Removed At', value: ISTLogger.formatTime(), inline: true }
      )
      .setFooter({ text: 'Contact server staff if this was a mistake' });

    await target.send({ embeds: [dmEmbed] });
  } catch (dmError) {
    ISTLogger.warn(`Could not DM ${target.user.tag} about role removal`);
  }

  await interaction.editReply(`✅ Removed Slayer role from ${target.toString()}`);
}

// Command: /slayerlist
async function handleSlayerList(interaction) {
  const slayers = (await interaction.guild.members.fetch())
    .filter(m => m.roles.cache.has(process.env.SLAYER_ROLE))
    .sort((a, b) => (a.displayName || a.user.username).localeCompare(b.displayName || b.user.username));

  if (slayers.size === 0) {
    return interaction.editReply('❌ No Slayers found');
  }

  const embed = new EmbedBuilder()
    .setTitle('🏆 Slayer Roster')
    .setColor('#FFD700')
    .setDescription(`Total Slayers: ${slayers.size}`)
    .setFooter({ text: `Last updated: ${ISTLogger.formatTime()}` });

  // Split into batches of 10
  const slayerArray = Array.from(slayers.values());
  for (let i = 0; i < slayerArray.length; i += 10) {
    const batch = slayerArray.slice(i, i + 10);
    embed.addFields({
      name: `Batch ${Math.floor(i/10) + 1}`,
      value: batch.map(m => {
        const status = m.presence?.status || 'offline';
        const emoji = { online: '🟢', idle: '🟡', dnd: '🔴', offline: '⚫' }[status] || '⚪';
        return `${emoji} ${m.displayName || m.user.username}`;
      }).join('\n'),
      inline: true
    });
  }

  await interaction.editReply({ embeds: [embed] });
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

  slayers.forEach(m => {
    const status = m.presence?.status || 'offline';
    statusCount[status]++;
  });

  const total = slayers.size;
  const active = statusCount.online + statusCount.idle;
  const activityRate = total > 0 ? Math.round((active / total) * 100) : 0;

  const embed = new EmbedBuilder()
    .setTitle('📊 Slayer Force Status')
    .setColor('#00AAFF')
    .addFields(
      { name: 'Total Slayers', value: total.toString(), inline: true },
      { name: '🟢 Online', value: statusCount.online.toString(), inline: true },
      { name: '🟡 Idle', value: statusCount.idle.toString(), inline: true },
      { name: '🔴 DND', value: statusCount.dnd.toString(), inline: true },
      { name: '⚫ Offline', value: statusCount.offline.toString(), inline: true },
      { name: 'Activity Rate', value: `${activityRate}%`, inline: true }
    )
    .setFooter({ text: `Last updated: ${ISTLogger.formatTime()}` });

  await interaction.editReply({ embeds: [embed] });
}

// Command: /onlinestats
async function handleOnlineStats(interaction) {
  const members = await interaction.guild.members.fetch();
  const totalMembers = members.size;
  const botCount = members.filter(m => m.user.bot).size;
  const humanCount = totalMembers - botCount;

  const statusCount = {
    online: 0,
    idle: 0,
    dnd: 0,
    offline: 0
  };

  members.forEach(m => {
    if (!m.user.bot) {
      const status = m.presence?.status || 'offline';
      statusCount[status]++;
    }
  });

  const active = statusCount.online + statusCount.idle;
  const activityRate = humanCount > 0 ? Math.round((active / humanCount) * 100) : 0;

  const embed = new EmbedBuilder()
    .setTitle('🌐 Server Online Status')
    .setColor('#43B581')
    .addFields(
      { name: 'Total Members', value: totalMembers.toString(), inline: true },
      { name: 'Humans', value: humanCount.toString(), inline: true },
      { name: 'Bots', value: botCount.toString(), inline: true },
      { name: '🟢 Online', value: statusCount.online.toString(), inline: true },
      { name: '🟡 Idle', value: statusCount.idle.toString(), inline: true },
      { name: '🔴 DND', value: statusCount.dnd.toString(), inline: true },
      { name: '⚫ Offline', value: statusCount.offline.toString(), inline: true },
      { name: 'Activity Rate', value: `${activityRate}%`, inline: true }
    )
    .setFooter({ text: `Last updated: ${ISTLogger.formatTime()}` });

  await interaction.editReply({ embeds: [embed] });
}

// Command: /checkstatus
async function handleCheckStatus(interaction) {
  const member = interaction.options.getMember('user') || interaction.member;
  const status = member.presence?.status || 'offline';
  const history = statusHistory.get(member.id) || [];

  const emoji = { online: '🟢', idle: '🟡', dnd: '🔴', offline: '⚫' }[status] || '⚪';
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${member.displayName}'s Status`)
    .setColor(getStatusColor(status))
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Current Status', value: status.toUpperCase(), inline: true },
      { name: 'Last Changed', value: history.length > 0 ? 
        `<t:${Math.floor(history[history.length-1].timestamp/1000)}:R>` : 'Unknown', inline: true }
    );

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

  await interaction.editReply({ embeds: [embed] });
}

// ======================
// 8. UTILITY FUNCTIONS
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

async function sendFormatError(message, reason, example) {
  try {
    const embed = new EmbedBuilder()
      .setColor('#FF5555')
      .setTitle('❌ Invalid Request Format')
      .setDescription(`**Reason:** ${reason}`)
      .addFields({
        name: 'Example Format',
        value: `\`\`\`${example}\`\`\``
      });

    await message.author.send({ embeds: [embed] });
  } catch (dmError) {
    ISTLogger.warn(`Could not DM format error to ${message.author.tag}`);
    try {
      await message.reply({ 
        content: `❌ ${reason}\nExample:\n\`\`\`${example}\`\`\``,
        ephemeral: true 
      });
    } catch (replyError) {
      ISTLogger.error('Failed to send format error', replyError);
    }
  }
}

// ======================
// 9. BOT STARTUP
// ======================
client.on('ready', async () => {
  ISTLogger.success(`Logged in as ${client.user.tag}`);

  // Register slash commands
  try {
    await client.application.commands.set([
      // Remove Slayer command
      new SlashCommandBuilder()
        .setName('removeslayer')
        .setDescription('Remove Slayer role from a member')
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The member to remove from Slayers')
            .setRequired(true))
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles),
      
      // Slayer List command
      new SlashCommandBuilder()
        .setName('slayerlist')
        .setDescription('List all Slayers with their current status'),
      
      // Slayer Stats command
      new SlashCommandBuilder()
        .setName('slayerstats')
        .setDescription('Show statistics about Slayer activity'),
      
      // Online Stats command
      new SlashCommandBuilder()
        .setName('onlinestats')
        .setDescription('Show server online statistics'),
      
      // Check Status command
      new SlashCommandBuilder()
        .setName('checkstatus')
        .setDescription("Check a member's status history")
        .addUserOption(option =>
          option.setName('user')
            .setDescription('The member to check')
            .setRequired(false))
    ]);

    ISTLogger.success('Slash commands registered successfully');
  } catch (error) {
    ISTLogger.error('Failed to register commands', error);
  }

  // Initial status scan
  try {
    const guild = client.guilds.cache.first();
    if (guild) {
      const members = await guild.members.fetch();
      members.forEach(member => {
        if (!member.user.bot) {
          const status = member.presence?.status || 'offline';
          if (!statusHistory.has(member.id)) {
            statusHistory.set(member.id, []);
          }
          statusHistory.get(member.id).push({
            status,
            timestamp: new Date()
          });
          
          // Update online counters
          if (status in onlineStatus) onlineStatus[status]++;
        }
      });
      onlineStatus.lastUpdated = new Date();
      ISTLogger.info(`Initialized status tracking for ${members.size} members`);
    }
  } catch (error) {
    ISTLogger.error('Failed to initialize status tracking', error);
  }
});

// ======================
// 10. ERROR HANDLING
// ======================
process.on('unhandledRejection', (error) => {
  ISTLogger.error('Unhandled Promise Rejection', error);
});

process.on('uncaughtException', (error) => {
  ISTLogger.critical('Uncaught Exception', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  ISTLogger.info('Shutting down gracefully...');
  client.destroy().then(() => process.exit(0));
});

// ======================
// START THE BOT
// ======================
client.login(process.env.TOKEN)
  .then(() => ISTLogger.success('Bot is now online'))
  .catch(error => {
    ISTLogger.critical('Login failed', error);
    process.exit(1);
  });
