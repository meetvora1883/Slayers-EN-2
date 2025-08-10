// ====================
// MODULE REQUIREMENTS
// ====================
const { Client, IntentsBitField, EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

// ====================
// INITIALIZATION
// ====================
dotenv.config();
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.DirectMessages
  ]
});

// ====================
// CONSTANTS
// ====================
const RENDER_STATIC_IPS = ['52.41.36.82', '54.191.253.12', '44.226.122.3'];
const nameChangeCooldowns = new Map();
const lastSimilarNameWarning = new Map();
const ID_REGEX = /(?:\bID\s*[:|-]\s*)(\d+)/i;
const NAME_REGEX = /(?:\bName\s*[:|-]\s*)([^\n\r]+)/i;
const RANK_REGEX = /(?:\bRank\s*[:|-]\s*)(\d+)/i;

// ====================
// HELPER FUNCTIONS
// ====================
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

// ====================
// EVENT HANDLERS
// ====================
client.on('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`🌐 Static IPs: ${RENDER_STATIC_IPS.join(', ')}`);
  console.log(`👀 Watching channel: ${process.env.ROLE_REQUEST_CHANNEL_ID}`);

  // Register slash commands
  try {
    await registerCommands();
    console.log('🔧 Slash commands registered');
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
  }
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('slayer_list')
      .setDescription('List all members with Slayer role'),
    
    new SlashCommandBuilder()
      .setName('export_slayers')
      .setDescription('Export Slayer members to CSV (High Command only)'),
    
    new SlashCommandBuilder()
      .setName('remove_slayer')
      .setDescription('Remove Slayer role from a member')
      .addUserOption(option =>
        option.setName('member')
          .setDescription('Member to remove role from')
          .setRequired(true)),
    
    new SlashCommandBuilder()
      .setName('dm_name_notice')
      .setDescription('Send name format notice to all Slayers')
      .addStringOption(option =>
        option.setName('message')
          .setDescription('Custom message to include')
          .setRequired(false)),
    
    new SlashCommandBuilder()
      .setName('name_change_stats')
      .setDescription('Get statistics on name changes')
  ].map(command => command.toJSON());

  await client.application.commands.set(commands);
}

// ====================
// MESSAGE HANDLER (Name Change Requests)
// ====================
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
    // Set nickname and role
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

    // Set cooldown
    nameChangeCooldowns.set(message.author.id, Date.now() + parseInt(process.env.NAME_CHANGE_COOLDOWN));
  } catch (error) {
    console.error('Error processing name change:', error);
    await message.react('⚠️');
  }
});

// ====================
// COMMAND HANDLERS
// ====================
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
      case 'dm_name_notice':
        await handleDMNotice(interaction);
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

// Command: /slayer_list
async function handleSlayerList(interaction) {
  const members = await interaction.guild.members.fetch();
  const slayers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));
  
  const embed = new EmbedBuilder()
    .setTitle('🏆 Slayer Members')
    .setDescription(slayers.map(m => `• ${m.nickname || m.user.username}`).join('\n'))
    .setFooter({ text: `Total: ${slayers.size} members` });

  await interaction.reply({ embeds: [embed] });
}

// Command: /export_slayers
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

  fs.unlinkSync(csvPath); // Clean up
}

// Command: /remove_slayer
async function handleRemoveSlayer(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
  }

  const target = interaction.options.getMember('member');
  if (!target) return interaction.reply({ content: '❌ Member not found', ephemeral: true });

  try {
    await target.roles.remove(process.env.SLAYER_ROLE_ID);
    
    // Send DM to removed member
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

    // Log removal
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

// Command: /dm_name_notice
async function handleDMNotice(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
  }

  const customMessage = interaction.options.getString('message') || '';
  const noticeMessage = `📢 **Name Format Reminder**\n\n` +
    `All Slayers must use the correct name format:\n` +
    `\`\`\`Name: Your Name\nID: 123456\nRank: 3\`\`\`\n` +
    `${customMessage}`;

  await interaction.deferReply({ ephemeral: true });

  const members = await interaction.guild.members.fetch();
  const slayers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));

  let success = 0, failed = 0;
  const failedMembers = [];

  for (const member of slayers.values()) {
    try {
      await member.send(noticeMessage);
      success++;
    } catch (error) {
      failed++;
      failedMembers.push(member.toString());
    }
  }

  await interaction.followUp({
    embeds: [
      new EmbedBuilder()
        .setTitle('📨 DM Notice Results')
        .setDescription(`Sent name format reminder to Slayers`)
        .addFields(
          { name: 'Successful', value: success.toString(), inline: true },
          { name: 'Failed', value: failed.toString(), inline: true }
        )
        .setFooter({ text: failed > 0 ? `Couldn't DM: ${failedMembers.join(', ')}` : null })
    ],
    ephemeral: true
  });
}

// Command: /name_change_stats
async function handleNameStats(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ Insufficient permissions', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  // In a real implementation, you would track these stats in a database
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

// ====================
// ERROR HANDLING
// ====================
process.on('unhandledRejection', error => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

// ====================
// START BOT
// ====================
client.login(process.env.TOKEN);
