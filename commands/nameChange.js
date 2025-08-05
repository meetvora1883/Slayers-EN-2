module.exports = {
  execute: async (message) => {
    const content = message.content;
    const user = message.author;
    const member = message.member;

    // Parse the request
    const nameMatch = content.match(/Name:\s*(.+)/i);
    const idMatch = content.match(/ID:\s*(\d+)/i);

    if (!nameMatch || !idMatch) return;

    const newName = nameMatch[1].trim();
    const userId = idMatch[1].trim();
    const newNickname = `${newName} | ${userId}`;

    try {
      // Save original nickname
      const originalNickname = member.nickname || user.username;

      // Update nickname
      await member.setNickname(newNickname, 'Role request nickname update');

      // Get log channel
      const logChannel = message.guild.channels.cache.get(process.env.LOG_CHANNEL);
      
      // Send log message
      if (logChannel) {
        logChannel.send({
          embeds: [{
            title: 'Nickname Updated',
            fields: [
              { name: 'User', value: user.toString(), inline: true },
              { name: 'Original', value: originalNickname, inline: true },
              { name: 'Updated', value: newNickname, inline: true }
            ],
            color: 0x3498db,
            timestamp: new Date()
          }]
        });
      }

      // Send DM confirmation
      try {
        const dmEmbed = {
          title: 'Nickname Updated',
          description: `Your nickname in **${message.guild.name}** has been updated`,
          fields: [
            { name: 'Original', value: originalNickname },
            { name: 'New Nickname', value: newNickname }
          ],
          color: 0x2ecc71,
          timestamp: new Date()
        };
        
        await user.send({ embeds: [dmEmbed] });
      } catch (dmError) {
        console.error(`Could not send DM to ${user.tag}:`, dmError);
      }

    } catch (error) {
      console.error('Error updating nickname:', error);
      message.reply('Failed to update your nickname. Please check permissions and try again.').catch(console.error);
    }
  }
};
