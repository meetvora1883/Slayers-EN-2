require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const http = require('http');

// =====================================
// HTTP Server for Render.com
// =====================================
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Discord Name Manager Bot is running\n');
}).listen(process.env.PORT || 3000, () => {
  console.log(`🖥️ HTTP server running on port ${process.env.PORT || 3000}`);
});

// =====================================
// Discord Client Setup
// =====================================
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildPresences,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.DirectMessages
  ],
  presence: {
    status: 'online',
    activities: [{
      name: 'Name Management',
      type: 3 // WATCHING
    }]
  }
});

// Constants
const nameChangeCooldowns = new Map();
const ID_REGEX = /(?:\bID\s*[:|-]\s*)(\d+)/i;
const NAME_REGEX = /(?:\bName\s*[:|-]\s*)([^\n\r]+)/i;
const RANK_REGEX = /(?:\bRank\s*[:|-]\s*)(\d+)/i;

// =====================================
// Presence Tracking System
// =====================================
client.on('presenceUpdate', (oldPresence, newPresence) => {
  const user = newPresence?.user || oldPresence?.user;
  if (!user || user.bot) return;

  const oldStatus = oldPresence?.status || 'offline';
  const newStatus = newPresence?.status || 'offline';
  
  if (oldStatus !== newStatus) {
    const timestamp = new Date().toLocaleString();
    console.log(`🔄 [${timestamp}] ${user.tag} status changed: ${oldStatus.toUpperCase()} → ${newStatus.toUpperCase()}`);
    
    // Send to admin channel if configured
    const logChannel = client.channels.cache.get(process.env.ADMIN_LOG_CHANNEL_ID);
    if (logChannel) {
      const statusColors = {
        online: '#43B581',
        idle: '#FAA61A',
        dnd: '#F04747',
        offline: '#747F8D'
      };

      logChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(statusColors[newStatus] || '#000000')
          .setTitle('Member Status Changed')
          .setDescription(`${user.toString()} is now **${newStatus.toUpperCase()}**`)
          .setThumbnail(user.displayAvatarURL())
          .setTimestamp()
        ]
      });
    }
  }
});

// =====================================
// Name Management System
// =====================================
function validateNameFormat(content) {
  const nameMatch = content.match(NAME_REGEX);
  const idMatch = content.match(ID_REGEX);
  const rankMatch = content.match(RANK_REGEX);

  if (!nameMatch || !idMatch || !rankMatch) {
    return { valid: false };
  }

  return {
    valid: true,
    name: nameMatch[1].trim(),
    id: idMatch[1].trim(),
    rank: rankMatch[1].trim()
  };
}

async function checkDuplicateId(guild, id, userId) {
  const members = await guild.members.fetch();
  for (const member of members.values()) {
    if (member.id === userId) continue;
    if (member.nickname && member.nickname.includes(`| ${id}`)) {
      return member;
    }
  }
  return null;
}

client.on('messageCreate', async (message) => {
  if (message.author.bot || message.channel.id !== process.env.ROLE_REQUEST_CHANNEL_ID) return;

  // Cooldown check
  if (nameChangeCooldowns.has(message.author.id)) {
    const remaining = nameChangeCooldowns.get(message.author.id) - Date.now();
    if (remaining > 0) {
      await message.react('⏳');
      await message.author.send(`⌛ Please wait ${Math.ceil(remaining/60000)} minutes before another request.`);
      return;
    }
  }

  const validation = validateNameFormat(message.content);
  if (!validation.valid) {
    await message.react('❌');
    const example = "**Correct Format Example:**\n```Name: Patel Slayers\nID: 123456\nRank: 6```\nPlease use this format exactly to get your role.";
    await message.author.send(`Your name change request doesn't follow the required format.\n${example}`);
    return;
  }

  const { name, id, rank } = validation;
  const newNickname = `${name} | ${id}`;

  try {
    await message.member.setNickname(newNickname);
    await message.member.roles.add(process.env.SLAYER_ROLE_ID);

    // Send confirmation DM
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('✅ Name Change Successful')
        .setDescription(`Your nickname has been updated to:\n**${newNickname}**`)
        .addFields(
          { name: 'Rank', value: rank, inline: true },
          { name: 'ID', value: id, inline: true }
        )
        .setTimestamp();
      
      await message.author.send({ embeds: [dmEmbed] });
      await message.react('✅');
      
      // Log to output channel
      const outputChannel = client.channels.cache.get(process.env.NAME_CHANGE_OUTPUT_CHANNEL_ID);
      if (outputChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('Name Change Processed')
          .setDescription(`${message.author.toString()} updated their name`)
          .addFields(
            { name: 'New Name', value: newNickname },
            { name: 'DM Status', value: '✅ Delivered' }
          )
          .setTimestamp();
        
        await outputChannel.send({ embeds: [logEmbed] });
      }
    } catch (dmError) {
      console.error('Failed to send DM:', dmError);
      const outputChannel = client.channels.cache.get(process.env.NAME_CHANGE_OUTPUT_CHANNEL_ID);
      if (outputChannel) {
        await outputChannel.send({
          embeds: [new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('Name Change Processed (DM Failed)')
            .setDescription(`${message.author.toString()}'s name was updated but DM failed`)
            .addFields(
              { name: 'New Name', value: newNickname }
            )
            .setTimestamp()
          ]
        });
      }
    }

    nameChangeCooldowns.set(message.author.id, Date.now() + parseInt(process.env.NAME_CHANGE_COOLDOWN));
  } catch (error) {
    console.error('Error processing name change:', error);
    await message.react('⚠️');
    await message.author.send('❌ An error occurred while processing your name change. Please try again later.');
  }
});

// =====================================
// Slash Commands
// =====================================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'slayer_list':
        await handleSlayerList(interaction);
        break;
      case 'export_slayers':
        await handleExportCommand(interaction);
        break;
      case 'remove_slayer':
        await handleRemoveSlayer(interaction);
        break;
      default:
        await interaction.reply({ content: '❌ Unknown command', ephemeral: true });
    }
  } catch (error) {
    console.error('Command error:', error);
    await interaction.reply({ content: '❌ An error occurred while processing your command.', ephemeral: true });
  }
});

async function handleSlayerList(interaction) {
  const members = await interaction.guild.members.fetch();
  const slayers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));
  
  const embed = new EmbedBuilder()
    .setTitle('🏆 Slayer Members')
    .setDescription(slayers.map(m => `• ${m.nickname || m.user.username} (${m.presence?.status || 'offline'})`).join('\n'))
    .setFooter({ text: `Total: ${slayers.size} members` })
    .setColor('#0099FF');
    
  await interaction.reply({ embeds: [embed] });
}

async function handleExportCommand(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const csvPath = './slayers_export.csv';
  const members = await interaction.guild.members.fetch();
  const slayers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));

  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: 'name', title: 'NAME' },
      { id: 'id', title: 'ID' },
      { id: 'status', title: 'STATUS' },
      { id: 'joinedAt', title: 'JOIN_DATE' }
    ]
  });

  const records = slayers.map(member => ({
    name: member.nickname || member.user.username,
    id: member.user.id,
    status: member.presence?.status || 'offline',
    joinedAt: member.joinedAt.toISOString()
  }));

  await csvWriter.writeRecords(records);
  
  const attachment = new AttachmentBuilder(csvPath);
  await interaction.followUp({ 
    content: '📊 Slayer member export:',
    files: [attachment],
    ephemeral: true
  });
  
  fs.unlinkSync(csvPath); // Clean up
}

async function handleRemoveSlayer(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
  }

  const target = interaction.options.getMember('member');
  if (!target) {
    return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
  }

  try {
    await target.roles.remove(process.env.SLAYER_ROLE_ID);
    
    // Send DM notification
    try {
      await target.send({
        embeds: [new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('❌ Slayer Role Removed')
          .setDescription('You are no longer part of the Slayer family.')
          .setTimestamp()
        ]
      });
    } catch (dmError) {
      console.error('Failed to send DM:', dmError);
    }

    // Log removal
    const logChannel = client.channels.cache.get(process.env.ADMIN_LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send({
        embeds: [new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('Slayer Role Removed')
          .setDescription(`${target.toString()} was removed by ${interaction.user.toString()}`)
          .addFields(
            { name: 'Status at removal', value: target.presence?.status || 'offline' }
          )
          .setTimestamp()
        ]
      });
    }

    await interaction.reply({ 
      content: `✅ Removed Slayer role from ${target.toString()}`,
      ephemeral: true 
    });
  } catch (error) {
    console.error('Error removing role:', error);
    await interaction.reply({ 
      content: '❌ Failed to remove role', 
      ephemeral: true 
    });
  }
}

// =====================================
// Startup and Monitoring
// =====================================
client.on('ready', () => {
  console.log(`✅ ${client.user.tag} is online in ${client.guilds.cache.size} servers!`);
  
  // Initial presence logging
  client.guilds.cache.forEach(guild => {
    guild.members.fetch().then(members => {
      members.forEach(member => {
        if (!member.user.bot) {
          console.log(`👤 ${member.user.tag}: ${member.presence?.status || 'offline'}`);
        }
      });
    });
  });
});

client.login(process.env.TOKEN)
  .then(() => console.log('🔑 Bot login initiated'))
  .catch(err => {
    console.error('❌ Login failed:', err);
    process.exit(1);
  });

// =====================================
// Error Handling
// =====================================
process.on('unhandledRejection', error => {
  console.error('❗ Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('❗ Uncaught exception:', error);
});

// =====================================
// Graceful Shutdown
// =====================================
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM. Shutting down gracefully...');
  
  const shutdownTasks = [
    new Promise(resolve => server.close(resolve)),
    client.destroy()
  ];

  Promise.all(shutdownTasks)
    .then(() => {
      console.log('✅ Services stopped successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Error during shutdown:', err);
      process.exit(1);
    });
});
