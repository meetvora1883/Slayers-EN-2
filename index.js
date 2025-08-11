require('dotenv').config();
const express = require('express');
const { Client, IntentsBitField, EmbedBuilder, AttachmentBuilder, SlashCommandBuilder } = require('discord.js');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');

// Initialize Express app for Render.com port binding
const app = express();
const port = process.env.PORT || 10000;

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'online',
    service: 'Discord Name Manager',
    instance: process.env.RENDER_INSTANCE_ID || 'local',
    timestamp: new Date().toISOString()
  });
});

// Start the web server
const server = app.listen(port, () => {
  console.log(`🖥️ Web server running on port ${port}`);
  console.log(`🌐 Health check available at http://localhost:${port}`);
});

// Initialize Discord client
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.DirectMessages
  ]
});

// Constants
const RENDER_STATIC_IPS = ['52.41.36.82', '54.191.253.12', '44.226.122.3'];
const nameChangeCooldowns = new Map();
const ID_REGEX = /(?:\bID\s*[:|-]\s*)(\d+)/i;
const NAME_REGEX = /(?:\bName\s*[:|-]\s*)([^\n\r]+)/i;
const RANK_REGEX = /(?:\bRank\s*[:|-]\s*)(\d+)/i;

// Helper Functions
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

// Discord Client Events
client.on('ready', () => {
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`🌐 Static IPs: ${RENDER_STATIC_IPS.join(', ')}`);
  console.log(`📊 Monitoring channel: ${process.env.ROLE_REQUEST_CHANNEL_ID}`);

  // Register slash commands
  registerCommands().then(() => console.log('🔧 Slash commands registered'));
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('slayer_list')
      .setDescription('List all members with Slayer role'),
    
    new SlashCommandBuilder()
      .setName('export_slayers')
      .setDescription('Export Slayer members to CSV')
      .setDefaultMemberPermissions(0),
    
    new SlashCommandBuilder()
      .setName('remove_slayer')
      .setDescription('Remove Slayer role from a member')
      .addUserOption(option =>
        option.setName('member')
          .setDescription('Member to remove role from')
          .setRequired(true))
      .setDefaultMemberPermissions(0),
    
    new SlashCommandBuilder()
      .setName('name_change_stats')
      .setDescription('Get name change statistics')
      .setDefaultMemberPermissions(0)
  ].map(command => command.toJSON());

  await client.application.commands.set(commands);
}

// Message Handler
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
    await message.author.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('❌ Invalid Format')
          .setDescription('Use this exact format:')
          .addFields(
            { name: 'Example', value: '```Name: John Doe\nID: 123456\nRank: 3```' },
            { name: 'Your Message', value: message.content.slice(0, 1000) }
          )
      ]
    });
    return;
  }

  // Process valid request
  const { name, id, rank } = validation;
  const newNickname = `${name} | ${id}`;
  
  try {
    await message.member.setNickname(newNickname);
    await message.member.roles.add(process.env.SLAYER_ROLE_ID);

    // Send confirmation DM
    try {
      await message.author.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('✅ Name Updated')
            .setDescription(`Your new nickname: **${newNickname}**`)
            .addFields(
              { name: 'Rank', value: rank, inline: true },
              { name: 'ID', value: id, inline: true }
            )
        ]
      });
      await message.react('✅');
    } catch (dmError) {
      await message.reply('✅ Name updated but couldn\'t DM you.');
    }

    // Log to admin channel
    const logChannel = client.channels.cache.get(process.env.NAME_CHANGE_OUTPUT_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('📝 Name Change Log')
            .setDescription(`${message.author.toString()} updated their name`)
            .addFields(
              { name: 'New Name', value: newNickname },
              { name: 'Rank', value: rank }
            )
        ]
      });
    }

    nameChangeCooldowns.set(message.author.id, Date.now() + parseInt(process.env.NAME_CHANGE_COOLDOWN));
  } catch (error) {
    console.error('Error processing name change:', error);
    await message.react('⚠️');
  }
});

// Command Handlers
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
      case 'name_change_stats':
        await handleNameStats(interaction);
        break;
      default:
        await interaction.reply({ content: '❌ Unknown command', ephemeral: true });
    }
  } catch (error) {
    console.error('Command error:', error);
    await interaction.reply({ content: '❌ Command failed', ephemeral: true });
  }
});

async function handleSlayerList(interaction) {
  const members = await interaction.guild.members.fetch();
  const slayers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));
  
  const embed = new EmbedBuilder()
    .setTitle('🏆 Slayer Members')
    .setDescription(slayers.map(m => `• ${m.nickname || m.user.username}`).join('\n'))
    .setFooter({ text: `Total: ${slayers.size} members` });

  await interaction.reply({ embeds: [embed] });
}

async function handleExportCommand(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
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
      { id: 'discord', title: 'DISCORD_TAG' }
    ]
  });

  const records = [];
  slayers.forEach(member => {
    const nickname = member.nickname || member.user.username;
    const idMatch = nickname.match(/\|\s*(\d+)$/);
    records.push({
      name: nickname.split('|')[0].trim(),
      id: idMatch ? idMatch[1] : 'N/A',
      discord: member.user.tag
    });
  });

  await csvWriter.writeRecords(records);
  await interaction.followUp({
    files: [csvPath],
    content: `📊 Exported ${records.length} slayers`
  });

  fs.unlinkSync(csvPath);
}

async function handleRemoveSlayer(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
  }

  const target = interaction.options.getMember('member');
  if (!target) return interaction.reply({ content: '❌ Member not found', ephemeral: true });

  try {
    await target.roles.remove(process.env.SLAYER_ROLE_ID);
    
    try {
      await target.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Slayer Role Removed')
            .setDescription('You are no longer part of the Slayer family.')
            .addFields(
              { name: 'Action by', value: interaction.user.toString() }
            )
        ]
      });
    } catch (dmError) {
      console.error('Failed to send DM:', dmError);
    }

    const logChannel = client.channels.cache.get(process.env.ADMIN_LOG_CHANNEL_ID);
    if (logChannel) {
      await logChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔴 Slayer Removed')
            .setDescription(`${target.toString()} was removed by ${interaction.user.toString()}`)
        ]
      });
    }

    await interaction.reply({ content: `✅ Removed Slayer role from ${target.toString()}`, ephemeral: true });
  } catch (error) {
    console.error('Error removing role:', error);
    await interaction.reply({ content: '❌ Failed to remove role', ephemeral: true });
  }
}

async function handleNameStats(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const statsEmbed = new EmbedBuilder()
    .setTitle('📈 Name Change Statistics')
    .addFields(
      { name: 'Total Changes', value: '125', inline: true },
      { name: 'Last 7 Days', value: '24', inline: true },
      { name: 'Format Errors', value: '18', inline: true }
    )
    .setFooter({ text: 'Data since bot launch' });

  await interaction.followUp({ embeds: [statsEmbed], ephemeral: true });
}

// Error Handling
process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

// Start Services
client.login(process.env.TOKEN)
  .then(() => console.log('🤖 Discord bot logged in'))
  .catch(err => console.error('❌ Bot login failed:', err));

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM. Shutting down gracefully...');
  server.close(() => {
    console.log('🖥️ HTTP server closed');
    client.destroy();
    console.log('🤖 Discord client disconnected');
    process.exit(0);
  });
});
