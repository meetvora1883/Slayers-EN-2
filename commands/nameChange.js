// commands/nameChange.js
const { EmbedBuilder } = require('discord.js');
const { sanitizeName, extractNameAndID } = require('./utilities'); // Correct relative path

module.exports = {
  name: 'nameChange',
  /**
   * Handles nickname change requests
   * @param {Message} message - The Discord message object
   * @param {Client} client - The Discord client
   */
  async execute(message, client) {
    try {
      const { content, author, member, guild, channel } = message;
      
      // Validate channel
      if (channel.id !== process.env.ROLE_REQUEST_CHANNEL) return;

      // Check for mentions
      if (message.mentions.users.size > 0) {
        return sendInvalidFormat(message, author, 
          'You mentioned a user instead of typing the name');
      }

      // Extract and validate name/ID
      const { name, id } = extractNameAndID(content);
      if (!name || !id || !/^\d+$/.test(id)) {
        return sendInvalidFormat(message, author, 
          'Invalid format. Use: Name\\nID\\nRank or Name - ID');
      }

      const sanitizedName = sanitizeName(name);
      if (!sanitizedName) {
        return sendInvalidFormat(message, author,
          'Name contains invalid characters');
      }

      // Format nickname as "John Doe | 12345"
      const newNickname = `${sanitizedName} | ${id}`;

      // Check permissions
      if (!(await verifyPermissions(message, member, guild))) return;

      // Execute nickname change
      await updateNickname(message, member, newNickname);
      
      // Send confirmations
      await sendConfirmationMessages(message, member.nickname || author.username, newNickname);

    } catch (error) {
      console.error(`[ERROR] ${error.message}`);
      await logError(message.guild, author, error.message);
    }
  }
};

// Helper Functions
async function verifyPermissions(message, member, guild) {
  if (member.permissions.has('Administrator')) {
    console.warn(`[ADMIN] ${member.user.tag} attempted change`);
    return false;
  }

  if (!guild.members.me.permissions.has('ManageNicknames')) {
    await logToChannel(guild, '❌ Bot lacks nickname permissions');
    return false;
  }

  if (member.roles.highest.position >= guild.members.me.roles.highest.position) {
    await logToChannel(guild, `⚠️ Cannot change ${member.toString()} (role hierarchy)`);
    return false;
  }

  return true;
}

async function updateNickname(message, member, newNickname) {
  const oldNickname = member.nickname || member.user.username;
  await member.setNickname(newNickname);
  console.log(`[NICKNAME] ${member.user.tag}: ${oldNickname} → ${newNickname}`);
}

async function sendConfirmationMessages(message, oldName, newName) {
  // DM to user
  const dmEmbed = new EmbedBuilder()
    .setTitle('✅ Nickname Updated')
    .addFields(
      { name: 'Old Name', value: oldName },
      { name: 'New Name', value: newName }
    )
    .setColor(0x00FF00);

  await message.author.send({ 
    content: `[Original Request](${message.url})`,
    embeds: [dmEmbed] 
  });

  // Log to channel
  const logEmbed = new EmbedBuilder()
    .setTitle('Nickname Changed')
    .addFields(
      { name: 'User', value: message.author.toString() },
      { name: 'Before', value: oldName },
      { name: 'After', value: newName }
    )
    .setColor(0x3498db)
    .setTimestamp();

  await logToChannel(message.guild, { embeds: [logEmbed] });
}

async function sendInvalidFormat(message, author, reason) {
  await message.react('❌');
  
  const embed = new EmbedBuilder()
    .setTitle('❌ Invalid Format')
    .setDescription(reason)
    .addFields(
      { name: 'Correct Format', value: '```Name\nID\nRank```\nor\n```Name - ID```' },
      { name: 'Example', value: '```John Doe\n12345\n3```' }
    )
    .setColor(0xFFA500);

  await author.send({ 
    content: `Your message: \`\`\`${message.content}\`\`\``,
    embeds: [embed] 
  });
}

async function logToChannel(guild, content) {
  if (!process.env.LOG_CHANNEL) return;
  const channel = guild.channels.cache.get(process.env.LOG_CHANNEL);
  if (channel) await channel.send(content).catch(console.error);
}

async function logError(guild, author, error) {
  await logToChannel(guild, 
    `❌ Error processing ${author.toString()}: ${error}`
  );
}
