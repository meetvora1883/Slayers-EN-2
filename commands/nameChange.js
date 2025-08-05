// commands/nameChange.js
const { EmbedBuilder } = require('discord.js');
const { sanitizeName, extractNameAndID } = require('./utilities');

module.exports = {
  name: 'nameChange',
  async execute(message, client) {
    try {
      const { content, author, member, guild, channel } = message;
      
      // Check if message is in role request channel
      if (channel.id !== process.env.ROLE_REQUEST_CHANNEL) return;

      // Check if user mentioned someone instead of typing name
      if (message.mentions.users.size > 0) {
        await message.react('❌');
        
        const dmEmbed = new EmbedBuilder()
          .setTitle('Invalid Role Request Format')
          .setDescription('You mentioned a user instead of typing the name. Please use the correct format:')
          .addFields(
            { name: 'Correct Format', value: 'Name\nID\nRank' },
            { name: 'Your Message', value: `[Jump to Message](${message.url})` }
          )
          .setColor(0xFF0000)
          .setFooter({ text: 'Please delete your incorrect request and submit a new one' });
        
        await author.send({ embeds: [dmEmbed] });
        return;
      }

      // Extract name and ID with flexible separators
      const { name, id } = extractNameAndID(content);
      
      if (!name || !id) {
        console.log(`[FORMAT ERROR] Invalid format from ${author.tag}: ${content}`);
        await handleInvalidRequest(message, author);
        return;
      }

      const sanitizedName = sanitizeName(name);
      const newNickname = `${sanitizedName} | ${id}`;

      // Permission checks
      if (member.permissions.has('Administrator')) {
        console.warn(`[ADMIN BLOCK] Admin ${author.tag} tried to change nickname`);
        return;
      }

      if (!guild.members.me.permissions.has('ManageNicknames')) {
        console.error('[PERMISSION ERROR] Bot lacks ManageNicknames permission');
        return;
      }

      if (member.roles.highest.position >= guild.members.me.roles.highest.position) {
        console.warn(`[HIERARCHY WARNING] ${author.tag}'s role is above bot`);
        return;
      }

      // Change nickname
      const originalNickname = member.nickname || author.username;
      await member.setNickname(newNickname, 'Role request nickname update');
      console.log(`[NICKNAME CHANGE] ${author.tag}: ${originalNickname} → ${newNickname}`);

      // Send success DM
      const successEmbed = new EmbedBuilder()
        .setTitle('Nickname Updated Successfully')
        .setDescription(`Your nickname in **${guild.name}** has been updated`)
        .addFields(
          { name: 'Original', value: originalNickname },
          { name: 'New Nickname', value: newNickname },
          { name: 'Request Message', value: `[View Original](${message.url})` }
        )
        .setColor(0x00FF00)
        .setFooter({ text: 'You may delete your original request message now' });

      await author.send({ embeds: [successEmbed] });

      // Log to channel
      const logEmbed = new EmbedBuilder()
        .setTitle('Nickname Updated')
        .setColor(0x3498db)
        .addFields(
          { name: 'User', value: author.toString(), inline: true },
          { name: 'Before', value: originalNickname, inline: true },
          { name: 'After', value: newNickname, inline: true }
        )
        .setTimestamp();

      const logChannel = guild.channels.cache.get(process.env.LOG_CHANNEL);
      if (logChannel) {
        await logChannel.send({ embeds: [logEmbed] });
      }

    } catch (error) {
      console.error('[NICKNAME ERROR]', error);
      const logChannel = message.guild.channels.cache.get(process.env.LOG_CHANNEL);
      if (logChannel) {
        await logChannel.send(`❌ Error processing nickname change for ${message.author.toString()}: ${error.message}`);
      }
    }
  }
};

async function handleInvalidRequest(message, author) {
  await message.react('❌');
  
  const dmEmbed = new EmbedBuilder()
    .setTitle('Incorrect Role Request Format')
    .setDescription('Please use the following format:')
    .addFields(
      { name: 'Correct Format', value: 'Name\nID\nRank' },
      { name: 'Example', value: 'John Doe\n123456\n3' },
      { name: 'Your Message', value: `\`\`\`${message.content}\`\`\`` }
    )
    .setColor(0xFFA500)
    .setFooter({ text: 'Please delete your message and submit a new request with the correct format' });

  await author.send({ 
    content: `Here's your original message for reference:`,
    embeds: [dmEmbed] 
  });
}
