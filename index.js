require('dotenv').config();
const { Client, IntentsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMembers,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.DirectMessages
  ]
});

// Environment variables
const TOKEN = process.env.TOKEN;
const ROLE_REQUEST_CHANNEL_ID = process.env.ROLE_REQUEST_CHANNEL_ID;
const OUTPUT_CHANNEL_ID = process.env.OUTPUT_CHANNEL_ID;
const SLAYER_ROLE_ID = process.env.SLAYER_ROLE_ID;
const HIGH_COMMAND_ROLE_ID = process.env.HIGH_COMMAND_ROLE_ID;

// Data storage
const userDataPath = path.join(__dirname, 'userData.json');
let userData = {};
const cooldowns = new Map();
const NAME_CHANGE_COOLDOWN = 300000; // 5 minutes

// Initialize data
function loadData() {
  try {
    if (fs.existsSync(userDataPath)) {
      userData = JSON.parse(fs.readFileSync(userDataPath));
    }
  } catch (error) {
    console.error('❌ Data load error:', error);
  }
}

function saveData() {
  try {
    fs.writeFileSync(userDataPath, JSON.stringify(userData, null, 2));
  } catch (error) {
    console.error('❌ Data save error:', error);
  }
}

// Parse request message
function parseRequest(content) {
  const patterns = [
    /Name\s*[:-\s]\s*(.+?)\s*(?:\n|$)/i,
    /ID\s*[:-\s]\s*(\d+)\s*(?:\n|$)/i,
    /Rank\s*[:-\s]\s*(\d+)\s*(?:\n|$)/i
  ];

  const nameMatch = content.match(patterns[0]);
  const idMatch = content.match(patterns[1]);
  const rankMatch = content.match(patterns[2]);

  if (!nameMatch || !idMatch || !rankMatch) return null;

  return {
    name: nameMatch[1].trim(),
    id: idMatch[1].trim(),
    rank: parseInt(rankMatch[1])
  };
}

// Validate and format name
function validateAndFormatName(name, id) {
  const cleanName = name.replace(/[|\\<>@#&]/g, '').trim();
  return `${cleanName} | ${id}`;
}

// Check for duplicates
function checkDuplicates(userId, newId) {
  for (const [id, data] of Object.entries(userData)) {
    if (id === userId) continue;
    if (data.id === newId) return `❌ ID ${newId} is already in use by ${data.name}`;
    if (data.name.toLowerCase() === userData[userId].name.toLowerCase()) {
      return `⚠️ Similar name already exists: ${data.name}`;
    }
  }
  return null;
}

// Send DM with fallback
async function safeSendDM(user, message, channel) {
  try {
    await user.send(message);
    return true;
  } catch (error) {
    console.error(`❌ DM failed for ${user.tag}:`, error);
    if (channel) {
      await channel.send(`${user} ${message}`);
    }
    return false;
  }
}

// Handle role request
client.on('messageCreate', async message => {
  if (message.channel.id !== ROLE_REQUEST_CHANNEL_ID || message.author.bot) return;

  const lastRequest = cooldowns.get(message.author.id);
  if (lastRequest && Date.now() - lastRequest < NAME_CHANGE_COOLDOWN) {
    const remaining = Math.ceil((NAME_CHANGE_COOLDOWN - (Date.now() - lastRequest)) / 60000);
    await message.react('⏳');
    await safeSendDM(
      message.author,
      `⌛ You're on cooldown! Please wait ${remaining} minutes before requesting again.`,
      message.channel
    );
    return;
  }

  const requestData = parseRequest(message.content);
  if (!requestData) {
    await message.react('❌');
    const example = "**Correct Format:**\nName: Patel Slayers\nID: 123456\nRank: 6";
    await safeSendDM(
      message.author,
      `❌ Invalid format! Please use:\n${example}\n\nWithout correct formatting, you won't receive the role.`,
      message.channel
    );
    return;
  }

  cooldowns.set(message.author.id, Date.now());
  const formattedName = validateAndFormatName(requestData.name, requestData.id);
  
  // Check duplicates
  const duplicateError = checkDuplicates(message.author.id, requestData.id);
  if (duplicateError) {
    await message.react('⚠️');
    await safeSendDM(
      message.author,
      duplicateError + "\n\nPlease correct your submission.",
      message.channel
    );
    return;
  }

  try {
    // Update nickname
    await message.member.setNickname(formattedName);
    
    // Assign role
    await message.member.roles.add(SLAYER_ROLE_ID);
    
    // Update user data
    userData[message.author.id] = {
      name: requestData.name,
      id: requestData.id,
      rank: requestData.rank,
      formattedName,
      timestamp: new Date().toISOString()
    };
    saveData();

    // Send confirmation
    await message.react('✅');
    const successDM = `✅ Your name has been updated to:\n**${formattedName}**\nSlayer role assigned!`;
    const dmSent = await safeSendDM(message.author, successDM);
    
    // Log to output channel
    const outputChannel = client.channels.cache.get(OUTPUT_CHANNEL_ID);
    if (outputChannel) {
      const logEmbed = new EmbedBuilder()
        .setTitle('Name Change Processed')
        .addFields(
          { name: 'User', value: message.author.toString(), inline: true },
          { name: 'Old Name', value: message.member.displayName, inline: true },
          { name: 'New Name', value: formattedName, inline: true },
          { name: 'DM Status', value: dmSent ? '✅ Sent' : '❌ Failed', inline: true },
          { name: 'Rank', value: requestData.rank.toString(), inline: true }
        )
        .setColor('#00ff00')
        .setTimestamp();
      
      await outputChannel.send({ embeds: [logEmbed] });
    }

    console.log(`✅ Name changed for ${message.author.tag}: ${formattedName}`);
  } catch (error) {
    console.error(`❌ Processing error for ${message.author.tag}:`, error);
    await message.react('⚠️');
    await safeSendDM(
      message.author,
      "❌ System error! Please contact moderators.",
      message.channel
    );
  }
});

// Slash command handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  // Slayer role removal
  if (interaction.commandName === 'slayer_role_remove') {
    if (!interaction.member.roles.cache.has(HIGH_COMMAND_ROLE_ID)) {
      return interaction.reply({ 
        content: "❌ You don't have permission for this action.", 
        ephemeral: true 
      });
    }

    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);

    if (!member.roles.cache.has(SLAYER_ROLE_ID)) {
      return interaction.reply({
        content: "⚠️ User doesn't have the Slayer role.",
        ephemeral: true
      });
    }

    try {
      await member.roles.remove(SLAYER_ROLE_ID);
      delete userData[user.id];
      saveData();

      const dmMessage = member.roles.cache.size > 1
        ? "🔰 Your Slayer role was removed, but you're still part of our family! Contact High Command if this was a mistake."
        : "😢 You're no longer in the Slayers family. We hope to see you again someday!";
      
      await safeSendDM(user, dmMessage);
      await interaction.reply({
        content: `✅ Removed Slayer role from ${user.tag}`,
        ephemeral: true
      });
      console.log(`➖ Slayer role removed from ${user.tag}`);
    } catch (error) {
      console.error('❌ Role removal error:', error);
      await interaction.reply({
        content: "❌ Failed to remove role. Check permissions.",
        ephemeral: true
      });
    }
  }

  // Name list command
  if (interaction.commandName === 'name_list') {
    const slayers = Object.entries(userData)
      .map(([id, data]) => `• ${data.formattedName} (Rank ${data.rank})`)
      .join('\n') || 'No Slayers found';

    const embed = new EmbedBuilder()
      .setTitle('Current Slayers')
      .setDescription(slayers)
      .setColor('#0099ff');
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Name change DM commands
  if (interaction.commandName === 'dm_name_change') {
    if (!interaction.member.roles.cache.has(HIGH_COMMAND_ROLE_ID)) {
      return interaction.reply({ 
        content: "❌ High Command permission required", 
        ephemeral: true 
      });
    }

    const subCommand = interaction.options.getSubcommand();
    const message = "📢 **Name Format Reminder**\n" +
      "Ensure your name follows:\n" +
      "```Name: Your Name\nID: 123456\nRank: 3```\n" +
      "Incorrect formatting = no role!";

    if (subCommand === 'all') {
      await interaction.deferReply({ ephemeral: true });
      let success = 0, failed = 0;

      for (const userId in userData) {
        try {
          const user = await client.users.fetch(userId);
          if (await safeSendDM(user, message)) success++;
          else failed++;
        } catch (error) {
          failed++;
          console.error(`❌ DM error for ${userId}:`, error);
        }
      }

      await interaction.editReply(
        `✅ Sent name reminders:\n• Success: ${success}\n• Failed: ${failed}`
      );
    } 
    else if (subCommand === 'user') {
      const user = interaction.options.getUser('target');
      const dmSent = await safeSendDM(user, message);
      
      await interaction.reply({
        content: dmSent 
          ? `✅ Reminder sent to ${user.tag}` 
          : `⚠️ Failed to DM ${user.tag}. Sent in channel instead.`,
        ephemeral: true
      });
    }
  }

  // CSV Export
  if (interaction.commandName === 'export_slayers') {
    if (!interaction.member.roles.cache.has(HIGH_COMMAND_ROLE_ID)) {
      return interaction.reply({ 
        content: "❌ High Command permission required", 
        ephemeral: true 
      });
    }

    let csv = 'User ID,Name,Formatted Name,ID,Rank,Timestamp\n';
    for (const [userId, data] of Object.entries(userData)) {
      csv += `"${userId}","${data.name}","${data.formattedName}",${data.id},${data.rank},${data.timestamp}\n`;
    }

    const buffer = Buffer.from(csv, 'utf-8');
    const attachment = new AttachmentBuilder(buffer, { name: 'slayers_export.csv' });

    await interaction.reply({
      content: '📊 Slayers Data Export:',
      files: [attachment],
      ephemeral: true
    });
  }
});

// Initialize
client.once('ready', () => {
  console.log(`🚀 Bot launched as ${client.user.tag}`);
  loadData();
  
  // Rebuild userData from server members
  const guild = client.guilds.cache.first();
  guild.members.fetch().then(members => {
    members.forEach(member => {
      if (member.roles.cache.has(SLAYER_ROLE_ID) && member.nickname && /(.+)\s\|\s(\d+)/.test(member.nickname)) {
        const [, name, id] = member.nickname.match(/(.+)\s\|\s(\d+)/);
        userData[member.id] = {
          name,
          id,
          formattedName: member.nickname,
          rank: 0, // Unknown from nickname
          timestamp: new Date().toISOString()
        };
      }
    });
    saveData();
    console.log(`🔍 Loaded ${Object.keys(userData).length} Slayers from server`);
  });
  
  // Register commands
  const commands = [
    {
      name: 'slayer_role_remove',
      description: 'Remove Slayer role from a user',
      options: [{
        name: 'user',
        type: 6,
        description: 'User to remove role from',
        required: true
      }]
    },
    {
      name: 'name_list',
      description: 'List all Slayers with formatted names'
    },
    {
      name: 'dm_name_change',
      description: 'Send name format reminders',
      options: [
        {
          name: 'all',
          type: 1,
          description: 'DM all Slayers'
        },
        {
          name: 'user',
          type: 1,
          description: 'DM specific user',
          options: [{
            name: 'target',
            type: 6,
            description: 'User to remind',
            required: true
          }]
        }
      ]
    },
    {
      name: 'export_slayers',
      description: 'Export Slayer data to CSV'
    }
  ];

  client.application.commands.set(commands)
    .then(() => console.log('✅ Slash commands registered'))
    .catch(console.error);
});

client.login(TOKEN);
