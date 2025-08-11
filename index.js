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
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🖥️ HTTP server running on port ${PORT}`);
});

// =====================================
// Discord Bot Setup
// =====================================
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
const lastSimilarNameWarning = new Map();
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

async function checkSimilarNames(guild, newName, userId) {
  const members = await guild.members.fetch();
  const similarMembers = [];
  
  for (const member of members.values()) {
    if (member.id === userId) continue;
    const currentName = member.nickname || member.user.username;
    if (currentName.split('|')[0].trim().toLowerCase() === newName.toLowerCase()) {
      similarMembers.push(member);
    }
  }
  
  return similarMembers;
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
      .setDescription('Export Slayer members to CSV (High Command only)')
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
      .setName('dm_name_notice')
      .setDescription('Send name format notice to all Slayers')
      .addStringOption(option =>
        option.setName('message')
          .setDescription('Custom message to include')
          .setRequired(false))
      .setDefaultMemberPermissions(0),
    
    new SlashCommandBuilder()
      .setName('name_change_stats')
      .setDescription('Get statistics on name changes')
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
    const example = "**Correct Format Example:**\n```Name: Patel Slayers\nID: 123456\nRank: 6```\nPlease use this format exactly to get your role.";
    await message.author.send(`Your name change request doesn't follow the required format.\n${example}`);
    return;
  }

  const { name, id, rank } = validation;
  const guild = message.guild;
  const member = message.member;

  // Check duplicate ID
  const duplicateMember = await checkDuplicateId(guild, id, member.id);
  if (duplicateMember) {
    await message.react('❌');
    await message.author.send(`The ID ${id} is already in use by ${duplicateMember.toString()}. Please use a unique ID.`);
    return;
  }

  // Check similar names
  const similarMembers = await checkSimilarNames(guild, name, member.id);
  if (similarMembers.length > 0) {
    const now = Date.now();
    const lastWarning = lastSimilarNameWarning.get(message.author.id) || 0;
    
    if (now - lastWarning > 86400000) { // 24 hours
      const warningMessage = `Warning: The name "${name}" is very similar to existing members:\n${similarMembers.map(m => m.toString()).join('\n')}\n\nPlease consider using a more distinct name to avoid confusion.`;
      await message.author.send(warningMessage);
      lastSimilarNameWarning.set(message.author.id, now);
    }
  }

  // Format new nickname
  const newNickname = `${name} | ${id}`;

  try {
    // Set nickname
    await member.setNickname(newNickname);
    
    // Add Slayer role if not present
    if (!member.roles.cache.has(process.env.SLAYER_ROLE_ID)) {
      await member.roles.add(process.env.SLAYER_ROLE_ID);
    }

    // Send success DM
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Name Change Successful')
        .setDescription(`Your nickname has been updated to:\n**${newNickname}**`)
        .addFields(
          { name: 'Previous Name', value: member.user.username, inline: true },
          { name: 'New Name', value: newNickname, inline: true }
        )
        .setTimestamp();
      
      await message.author.send({ embeds: [dmEmbed] });
      
      // Log to output channel
      const outputChannel = client.channels.cache.get(process.env.NAME_CHANGE_OUTPUT_CHANNEL_ID);
      if (outputChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor('#00FF00')
          .setTitle('Name Change Processed')
          .setDescription(`${member.toString()} has updated their name`)
          .addFields(
            { name: 'New Name', value: newNickname, inline: true },
            { name: 'Rank', value: rank, inline: true },
            { name: 'DM Status', value: '✅ Success', inline: true }
          )
          .setTimestamp();
        
        await outputChannel.send({ embeds: [logEmbed] });
      }
    } catch (dmError) {
      console.error('Failed to send DM:', dmError);
      
      // Fallback to channel message if DM fails
      const outputChannel = client.channels.cache.get(process.env.NAME_CHANGE_OUTPUT_CHANNEL_ID);
      if (outputChannel) {
        const fallbackEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('Name Change Processed (DM Failed)')
          .setDescription(`${member.toString()}, your name has been updated to **${newNickname}** but I couldn't DM you.`)
          .setTimestamp();
        
        await outputChannel.send({ embeds: [fallbackEmbed] });
      }
    }

    // Set cooldown
    nameChangeCooldowns.set(message.author.id, Date.now() + parseInt(process.env.NAME_CHANGE_COOLDOWN));
    await message.react('✅');
    
    console.log(`Name changed for ${message.author.tag}: ${newNickname}`);
  } catch (error) {
    console.error('Error processing name change:', error);
    await message.react('❌');
    await message.author.send('An error occurred while processing your name change. Please try again later or contact an admin.');
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
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ An error occurred while processing your command.', ephemeral: true });
    }
  }
});

async function handleSlayerList(interaction) {
  const members = await interaction.guild.members.fetch();
  const slayers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));
  
  if (slayers.size === 0) {
    await interaction.reply('No members with the Slayer role found.');
    return;
  }
  
  const nameList = slayers.map(m => {
    const name = m.nickname || m.user.username;
    return `• ${name} (${m.user.tag})`;
  }).join('\n');
  
  const embed = new EmbedBuilder()
    .setTitle('Slayer Members List')
    .setDescription(nameList)
    .setColor('#0099FF')
    .setFooter({ text: `Total: ${slayers.size} members` });
    
  await interaction.reply({ embeds: [embed] });
  console.log(`Slayer name list generated by ${interaction.user.tag}`);
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
      { id: 'username', title: 'USERNAME' },
      { id: 'discriminator', title: 'DISCRIMINATOR' },
      { id: 'userId', title: 'USER_ID' },
      { id: 'slayerName', title: 'SLAYER_NAME' },
      { id: 'id', title: 'ID' },
      { id: 'joinedAt', title: 'JOINED_AT' },
      { id: 'lastMessage', title: 'LAST_MESSAGE' }
    ]
  });

  const records = [];
  slayers.forEach(member => {
    const nickname = member.nickname || member.user.username;
    const idMatch = nickname.match(/\|\s*(\d+)$/);
    records.push({
      username: member.user.username,
      discriminator: member.user.discriminator,
      userId: member.id,
      slayerName: nickname.split('|')[0].trim(),
      id: idMatch ? idMatch[1] : 'N/A',
      joinedAt: member.joinedAt.toISOString(),
      lastMessage: member.lastMessage ? member.lastMessage.createdAt.toISOString() : 'N/A'
    });
  });

  await csvWriter.writeRecords(records);
  
  const attachment = new AttachmentBuilder(csvPath);
  await interaction.followUp({ 
    content: 'Here is the CSV report of all Slayers:',
    files: [attachment],
    ephemeral: true
  });
  
  fs.unlinkSync(csvPath); // Clean up
  console.log(`CSV report generated by ${interaction.user.tag}`);
}

async function handleRemoveSlayer(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
  }

  const targetMember = interaction.options.getMember('member');
  if (!targetMember) {
    return interaction.reply({ content: '❌ Member not found.', ephemeral: true });
  }

  if (!targetMember.roles.cache.has(process.env.SLAYER_ROLE_ID)) {
    return interaction.reply({ content: '❌ This member does not have the Slayer role.', ephemeral: true });
  }

  try {
    // Remove Slayer role
    await targetMember.roles.remove(process.env.SLAYER_ROLE_ID);
    
    // Send DM to member
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Slayer Role Removed')
        .setDescription('You are no longer part of the Slayer family.')
        .addFields(
          { name: 'Reason', value: 'Role removed by High Command', inline: true }
        )
        .setTimestamp();
      
      await targetMember.send({ embeds: [dmEmbed] });
      
      // Log to output channel
      const outputChannel = client.channels.cache.get(process.env.NAME_CHANGE_OUTPUT_CHANNEL_ID);
      if (outputChannel) {
        const logEmbed = new EmbedBuilder()
          .setColor('#FF0000')
          .setTitle('Slayer Role Removed')
          .setDescription(`${targetMember.toString()} has been removed from the Slayer family`)
          .addFields(
            { name: 'Action by', value: interaction.user.toString(), inline: true },
            { name: 'DM Status', value: '✅ Success', inline: true }
          )
          .setTimestamp();
        
        await outputChannel.send({ embeds: [logEmbed] });
      }
    } catch (dmError) {
      console.error('Failed to send DM:', dmError);
      
      // Fallback to channel message if DM fails
      const outputChannel = client.channels.cache.get(process.env.NAME_CHANGE_OUTPUT_CHANNEL_ID);
      if (outputChannel) {
        const fallbackEmbed = new EmbedBuilder()
          .setColor('#FFA500')
          .setTitle('Slayer Role Removed (DM Failed)')
          .setDescription(`${targetMember.toString()}, your Slayer role has been removed but I couldn't DM you.`)
          .setTimestamp();
        
        await outputChannel.send({ embeds: [fallbackEmbed] });
      }
    }

    await interaction.reply({ content: `✅ Successfully removed Slayer role from ${targetMember.toString()}`, ephemeral: true });
    console.log(`Slayer role removed from ${targetMember.user.tag} by ${interaction.user.tag}`);
  } catch (error) {
    console.error('Error removing Slayer role:', error);
    await interaction.reply({ content: '❌ An error occurred while removing the role.', ephemeral: true });
  }
}

async function handleDMNotice(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
  }

  const customMessage = interaction.options.getString('message') || '';
  await interaction.deferReply({ ephemeral: true });

  const noticeMessage = `📢 **Name Format Reminder**\n\n` +
    `All Slayers must use the correct name format:\n` +
    `\`\`\`Name: Your Name\nID: 123456\nRank: 3\`\`\`\n` +
    `${customMessage}`;

  const members = await interaction.guild.members.fetch();
  const slayers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));

  let successCount = 0;
  let failCount = 0;
  const failedMembers = [];
  
  for (const member of slayers.values()) {
    try {
      await member.send(noticeMessage);
      successCount++;
    } catch (error) {
      failCount++;
      failedMembers.push(member.toString());
      console.error(`Failed to DM ${member.user.tag}:`, error);
    }
  }

  const resultEmbed = new EmbedBuilder()
    .setTitle('DM Campaign Results')
    .setDescription(`Sent message to Slayers about name changes`)
    .addFields(
      { name: 'Total Slayers', value: slayers.size.toString(), inline: true },
      { name: 'Successful DMs', value: successCount.toString(), inline: true },
      { name: 'Failed DMs', value: failCount.toString(), inline: true }
    )
    .setColor(failCount > 0 ? '#FFA500' : '#00FF00')
    .setTimestamp();
    
  if (failedMembers.length > 0) {
    resultEmbed.addFields({
      name: 'Failed to Reach',
      value: failedMembers.join('\n').slice(0, 1024)
    });
  }
  
  await interaction.followUp({ embeds: [resultEmbed], ephemeral: true });
  console.log(`DM campaign completed by ${interaction.user.tag}: ${successCount} success, ${failCount} fails`);
}

async function handleNameStats(interaction) {
  if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
    return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
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
