const { EmbedBuilder } = require('discord.js');
const { sanitizeName, extractNameAndID } = require('./utilities');

module.exports = {
  name: 'nameChange',
  async execute(message, client) {
    try {
      const { content, author, member, guild, channel } = message;
      
      // Check channel
      if (channel.id !== process.env.ROLE_REQUEST_CHANNEL) return;

      // Handle mentions
      if (message.mentions.users.size > 0) {
        await sendInvalidFormatDM(message, 'You mentioned a user instead of typing the name');
        return;
      }

      // Extract name and ID
      const { name, id } = extractNameAndID(content);
      if (!name || !id) {
        await sendInvalidFormatDM(message, 'Invalid format. Use: Name\nID\nRank or Name - ID');
        return;
      }

      // Sanitize and format
      const sanitizedName = sanitizeName(name);
      const newNickname = `${sanitizedName} | ${id}`;

      // Check permissions
      if (!(await checkPermissions(member, guild))) return;

      // Update nickname
      const originalNickname = member.nickname || author.username;
      await member.setNickname(newNickname);
      console.log(`[NICKNAME] ${author.tag}: ${originalNickname} → ${newNickname}`);

      // Send confirmations
      await sendSuccessDM(message, originalNickname, newNickname);
      await logChange(guild, author, originalNickname, newNickname);

    } catch (error) {
      console.error('[ERROR]', error);
      await logError(guild, author, error.message);
    }
  }
};

async function checkPermissions(member, guild) {
  if (member.permissions.has('Administrator')) {
    console.warn(`[ADMIN] ${member.user.tag} tried nickname change`);
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

async function sendInvalidFormatDM(message, reason) {
  try {
    await message.react('❌');
    const embed = new EmbedBuilder()
      .setTitle('❌ Invalid Format')
      .setDescription(`${reason}\n\n**Correct Formats:**\n\`Name\nID\nRank\`\nor\n\`Name - ID\``)
      .addFields({ name: 'Example', value: 'John Doe\n12345\n3' })
      .setColor(0xFFA500);

    await message.author.send({ 
      content: `Your message: \`\`\`${message.content}\`\`\``,
      embeds: [embed] 
    });
  } catch (error) {
    console.error('[DM ERROR]', error);
  }
}

async function sendSuccessDM(message, oldName, newName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('✅ Nickname Updated')
      .addFields(
        { name: 'Old Name', value: oldName },
        { name: 'New Name', value: newName }
      )
      .setColor(0x00FF00);

    await message.author.send({ 
      content: `[Original Request](${message.url})`,
      embeds: [embed] 
    });
  } catch (error) {
    console.error('[DM ERROR]', error);
  }
}

async function logChange(guild, author, oldName, newName) {
  const embed = new EmbedBuilder()
    .setTitle('Nickname Changed')
    .addFields(
      { name: 'User', value: author.toString() },
      { name: 'Before', value: oldName },
      { name: 'After', value: newName }
    )
    .setColor(0x3498db)
    .setTimestamp();

  await logToChannel(guild, { embeds: [embed] });
}

async function logError(guild, author, error) {
  await logToChannel(guild, `❌ Error for ${author.toString()}: ${error}`);
}

async function logToChannel(guild, content) {
  if (!process.env.LOG_CHANNEL) return;
  const channel = guild.channels.cache.get(process.env.LOG_CHANNEL);
  if (channel) await channel.send(content).catch(console.error);
}
