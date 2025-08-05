const { EmbedBuilder } = require('discord.js');
const { sanitizeName, extractNameAndID, formatOutput } = require('./utilities');

module.exports = {
  name: 'nameChange',
  async execute(message, client) {
    // Destructure message properties
    const { content, author, member, guild, channel } = message;
    
    try {
      // 1. Channel Validation
      if (channel.id !== process.env.ROLE_REQUEST_CHANNEL) {
        console.log(`[CHANNEL REJECT] ${author.tag} tried in #${channel.name}`);
        return;
      }

      // 2. Content Extraction and Validation
      const { name, id, rank, normalized } = extractNameAndID(content);
      
      if (!name || !id) {
        console.log(`[FORMAT REJECT] ${author.tag}: "${content}"`);
        await sendInvalidFormatDM(message);
        await message.react('❌');
        return;
      }

      // 3. Permission Checks
      if (!(await checkPermissions(member, guild))) {
        console.log(`[PERMISSION REJECT] ${author.tag}`);
        return;
      }

      // 4. Nickname Processing
      const originalName = member.nickname || author.username;
      const newNickname = formatOutput(name, id);
      
      await member.setNickname(newNickname);
      console.log(`[NICKNAME UPDATE] ${author.tag}: ${originalName} → ${newNickname}`);

      // 5. Success Responses
      await message.react('✅');
      await sendSuccessDM(message, originalName, newNickname);
      await logChange(guild, author, originalName, newNickname);

    } catch (error) {
      console.error(`[ERROR] ${author.tag}:`, error);
      await handleError(guild, author, error);
    }
  }
};

// Helper Functions

async function checkPermissions(member, guild) {
  if (member.permissions.has('Administrator')) {
    await logToChannel(guild, `⚠️ Admin bypass: ${member.toString()}`);
    return false;
  }

  if (!guild.members.me.permissions.has('ManageNicknames')) {
    await logToChannel(guild, '❌ Bot missing "ManageNicknames" permission');
    return false;
  }

  return true;
}

async function sendInvalidFormatDM(message) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('❌ Invalid Name Format')
      .setDescription([
        '**Correct Formats:**',
        '```name: YourName\nid: 123456\nrank: 3```',
        '```YourName - 123456 - 3```',
        '```YourName | 123456```'
      ].join('\n'))
      .addFields({
        name: 'Your Message',
        value: `\`\`\`${message.content}\`\`\``
      })
      .setColor(0xFF0000);

    await message.author.send({ embeds: [embed] });
  } catch (dmError) {
    console.error('[DM FAILURE]', dmError);
  }
}

async function sendSuccessDM(message, oldName, newName) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('✅ Nickname Updated')
      .addFields(
        { name: 'Previous', value: oldName, inline: true },
        { name: 'Updated', value: newName, inline: true }
      )
      .setColor(0x00FF00)
      .setFooter({ text: `Requested in #${message.channel.name}` });

    await message.author.send({ 
      content: `[Original Message](${message.url})`,
      embeds: [embed] 
    });
  } catch (dmError) {
    console.error('[DM FAILURE]', dmError);
  }
}

async function logChange(guild, user, oldName, newName) {
  if (!process.env.LOG_CHANNEL) return;
  
  const embed = new EmbedBuilder()
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setTitle('Nickname Changed')
    .addFields(
      { name: 'User', value: user.toString() },
      { name: 'Before', value: oldName },
      { name: 'After', value: newName }
    )
    .setColor(0x3498DB)
    .setTimestamp();

  await logToChannel(guild, { embeds: [embed] });
}

async function handleError(guild, user, error) {
  await logToChannel(guild, `❌ Error for ${user.toString()}: ${error.message}`);
  try {
    await user.send('⚠️ An error occurred processing your request. Please try again later.');
  } catch {}
}

async function logToChannel(guild, content) {
  const channel = guild.channels.cache.get(process.env.LOG_CHANNEL);
  if (channel) {
    await channel.send(content).catch(console.error);
  }
}
