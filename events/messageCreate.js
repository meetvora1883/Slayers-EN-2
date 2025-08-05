const { EmbedBuilder } = require('discord.js');
const { sanitizeName, extractNameAndID } = require('../commands/utilities');

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author.bot) return;

    try {
      console.log(`[MESSAGE] ${message.author.tag} in #${message.channel.name}: ${message.content}`);

      // Role Request Handler
      if (message.channel.id === process.env.ROLE_REQUEST_CHANNEL) {
        await handleRoleRequest(message, client);
        return;
      }

      // Ping Command
      if (message.content.toLowerCase() === '!ping') {
        await handlePingCommand(message, client);
        return;
      }

      // Cleanup Command
      if (message.content.startsWith('!cleanup')) {
        await handleCleanupCommand(message);
        return;
      }

      // Help Command
      if (message.content.toLowerCase() === '!help') {
        await handleHelpCommand(message);
        return;
      }

      // Bot Mention Response
      if (message.mentions.has(client.user)) {
        await handleMentionResponse(message);
        return;
      }

    } catch (error) {
      console.error(`[CRITICAL ERROR] In message handler (${message.id}):`, {
        error: error.message,
        stack: error.stack,
        content: message.content,
        author: message.author.tag,
        channel: message.channel.name
      });
    }
  }
};

// ========================
// HANDLER FUNCTIONS
// ========================

async function handleRoleRequest(message, client) {
  const { content, author, member, guild, channel } = message;
  
  try {
    console.log(`[ROLE REQUEST] Processing request from ${author.tag}`);

    // Mention Detection
    if (message.mentions.users.size > 0) {
      console.warn(`[INVALID REQUEST] Mention detected from ${author.tag}`);
      await message.react('❌').catch(e => console.error('[REACT ERROR]', e));
      
      const dmEmbed = new EmbedBuilder()
        .setTitle('❌ Invalid Role Request')
        .setDescription('You mentioned a user instead of typing the name.\n\n**Correct Format:**')
        .addFields(
          { name: 'Name', value: 'Your Full Name', inline: true },
          { name: 'ID', value: 'Your ID Number', inline: true },
          { name: 'Rank', value: 'Your Rank', inline: true },
          { name: 'Example', value: 'John Doe\n123456\n3' }
        )
        .setColor(0xFF0000);

      await author.send({ 
        content: `**Your message:**\n\`\`\`${content}\`\`\`\n[Message Link](${message.url})`,
        embeds: [dmEmbed] 
      }).catch(e => console.error('[DM ERROR]', e));
      return;
    }

    // Extract name and ID
    const { name, id } = extractNameAndID(content);
    
    if (!name || !id) {
      console.warn(`[FORMAT ERROR] From ${author.tag}:\n${content}`);
      await message.react('❌').catch(e => console.error('[REACT ERROR]', e));
      
      const dmEmbed = new EmbedBuilder()
        .setTitle('⚠️ Incorrect Format')
        .setDescription('**Required Format:**\nName\nID\nRank\n\n**Example:**\nJohn Doe\n123456\n3')
        .setColor(0xFFA500);

      await author.send({ 
        content: `**Your invalid request:**\n\`\`\`${content}\`\`\`\n[Message Link](${message.url})`,
        embeds: [dmEmbed] 
      }).catch(e => console.error('[DM ERROR]', e));
      return;
    }

    // Permission Checks
    if (member.permissions.has('Administrator')) {
      console.warn(`[ADMIN BLOCK] Admin ${author.tag} attempted nickname change`);
      return;
    }

    if (!guild.members.me.permissions.has('ManageNicknames')) {
      console.error('[PERMISSION ERROR] Bot lacks ManageNicknames permission');
      await logToChannel(guild, `❌ Bot missing "Manage Nicknames" permission`);
      return;
    }

    if (member.roles.highest.position >= guild.members.me.roles.highest.position) {
      console.warn(`[HIERARCHY WARNING] ${author.tag}'s role is above bot`);
      await logToChannel(guild, `⚠️ Failed to change ${author.toString()}'s nickname (role hierarchy)`);
      return;
    }

    // Process Nickname Change
    const sanitizedName = sanitizeName(name);
    const newNickname = `${sanitizedName} | ${id}`;
    const originalNickname = member.nickname || author.username;

    await member.setNickname(newNickname)
      .then(() => console.log(`[SUCCESS] Nickname changed for ${author.tag}: ${originalNickname} → ${newNickname}`))
      .catch(e => {
        console.error('[NICKNAME ERROR]', e);
        throw e;
      });

    // Success DM
    const successEmbed = new EmbedBuilder()
      .setTitle('✅ Nickname Updated')
      .addFields(
        { name: 'Server', value: guild.name },
        { name: 'Old Name', value: originalNickname },
        { name: 'New Name', value: newNickname }
      )
      .setColor(0x00FF00);

    await author.send({ 
      content: `[Original Message](${message.url})`,
      embeds: [successEmbed] 
    }).catch(e => console.warn(`[DM WARNING] Could not notify ${author.tag}:`, e.message));

    // Log to Channel
    await logToChannel(guild, `**Nickname Changed**\nUser: ${author.toString()}\nBefore: ${originalNickname}\nAfter: ${newNickname}`);

  } catch (error) {
    console.error(`[ROLE REQUEST ERROR] In message ${message.id}:`, {
      error: error.message,
      stack: error.stack,
      content: message.content,
      author: message.author.tag
    });
    await logToChannel(message.guild, `❌ Error processing request from ${message.author.toString()}: ${error.message}`);
  }
}

async function handlePingCommand(message, client) {
  try {
    const latency = Date.now() - message.createdTimestamp;
    const apiLatency = client.ws.ping;
    
    await message.reply(`🏓 Pong! Latency: ${latency}ms | API: ${apiLatency}ms`);
    console.log(`[PING] ${message.author.tag} - Bot: ${latency}ms | API: ${apiLatency}ms`);

  } catch (error) {
    console.error('[PING COMMAND ERROR]', {
      error: error.message,
      author: message.author.tag
    });
  }
}

async function handleCleanupCommand(message) {
  if (!message.member.permissions.has('ManageMessages')) {
    console.warn(`[UNAUTHORIZED CLEANUP] Attempt by ${message.author.tag}`);
    return;
  }

  try {
    const amount = Math.min(parseInt(message.content.split(' ')[1]) || 10, 100);
    await message.delete().catch(() => {});
    
    const messages = await message.channel.messages.fetch({ limit: amount + 1 });
    await message.channel.bulkDelete(messages);
    
    const reply = await message.channel.send(`🧹 Deleted ${amount} messages`);
    setTimeout(() => reply.delete().catch(() => {}), 3000);
    
    console.log(`[CLEANUP] ${message.author.tag} deleted ${amount} messages in #${message.channel.name}`);

  } catch (error) {
    console.error('[CLEANUP ERROR]', {
      error: error.message,
      author: message.author.tag,
      channel: message.channel.name
    });
  }
}

async function handleHelpCommand(message) {
  try {
    const helpEmbed = new EmbedBuilder()
      .setTitle('🤖 Bot Commands')
      .setColor(0x7289DA)
      .addFields(
        { name: 'Role Request', value: 'In <#1398888613122674765>:\n`Name\nID\nRank`' },
        { name: 'Mod Commands', value: '`!cleanup [amount]`\n`!verify [user]`' },
        { name: 'Utility', value: '`!ping` - Check bot latency\n`!help` - This menu' }
      );

    await message.reply({ embeds: [helpEmbed] });
    console.log(`[HELP] Sent to ${message.author.tag}`);

  } catch (error) {
    console.error('[HELP COMMAND ERROR]', error);
  }
}

async function handleMentionResponse(message) {
  try {
    await message.reply('👋 Hi! Use `!help` to see my commands.');
    console.log(`[MENTION] Responded to ${message.author.tag}`);

  } catch (error) {
    console.error('[MENTION RESPONSE ERROR]', error);
  }
}

// ========================
// UTILITY FUNCTIONS
// ========================

async function logToChannel(guild, content) {
  try {
    const channel = guild.channels.cache.get(process.env.LOG_CHANNEL);
    if (!channel) {
      console.error('[LOGGING ERROR] Channel not found');
      return;
    }
    await channel.send(content);
  } catch (error) {
    console.error('[LOG CHANNEL ERROR]', error);
  }
  }
