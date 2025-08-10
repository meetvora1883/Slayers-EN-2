const { Client, IntentsBitField, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { createObjectCsvWriter } = require('csv-writer');

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

// Cooldown tracking
const nameChangeCooldowns = new Map();
const lastSimilarNameWarning = new Map();

// Static IPs for Render.com
const RENDER_STATIC_IPS = [
    '52.41.36.82',
    '54.191.253.12',
    '44.226.122.3'
];

client.on('ready', () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`🖥️ Server IPs: ${RENDER_STATIC_IPS.join(', ')}`);
    console.log(`📊 Bot is monitoring channel ${process.env.ROLE_REQUEST_CHANNEL_ID} for name change requests`);
});

// Helper function to validate name format
function validateNameFormat(content) {
    const patterns = [
        /Name\s*[:|-]\s*(.+?)\s*(ID|Id|id)\s*[:|-]\s*(\d+)\s*(Rank|rank)\s*[:|-]\s*(\d+)/i,
        /Name\s*[:|-]\s*(.+?)\s*(Rank|rank)\s*[:|-]\s*(\d+)\s*(ID|Id|id)\s*[:|-]\s*(\d+)/i,
        /(.+?)\s*[:|-]\s*(\d+)\s*[:|-]\s*(\d+)/i
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
            // Extract components based on pattern
            let name, id, rank;
            if (match.length === 6) {
                // First two patterns
                name = match[1].trim();
                if (match[2].toLowerCase() === 'id') {
                    id = match[3];
                    rank = match[5];
                } else {
                    rank = match[3];
                    id = match[5];
                }
            } else {
                // Third pattern
                name = match[1].trim();
                id = match[2];
                rank = match[3];
            }
            return { valid: true, name, id, rank };
        }
    }
    return { valid: false };
}

// Helper function to format name
function formatName(name, id) {
    return `${name} | ${id}`;
}

// Check for duplicate IDs
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

// Check for similar names
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

// Process name change request
async function processNameChange(message) {
    // Check cooldown
    if (nameChangeCooldowns.has(message.author.id)) {
        const remaining = nameChangeCooldowns.get(message.author.id) - Date.now();
        if (remaining > 0) {
            await message.react('⏳');
            await message.author.send(`You're on cooldown. Please wait ${Math.ceil(remaining / 60000)} minutes before requesting another name change.`);
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
    const newNickname = formatName(name, id);

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
}

// Slayer role removal command
async function removeSlayerRole(interaction) {
    if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
        await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        return;
    }

    const targetMember = interaction.options.getMember('member');
    if (!targetMember) {
        await interaction.reply({ content: '❌ Member not found.', ephemeral: true });
        return;
    }

    if (!targetMember.roles.cache.has(process.env.SLAYER_ROLE_ID)) {
        await interaction.reply({ content: '❌ This member does not have the Slayer role.', ephemeral: true });
        return;
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

// Name list command
async function listSlayerNames(interaction) {
    try {
        const guild = interation.guild;
        const members = await guild.members.fetch();
        const slayerMembers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));
        
        if (slayerMembers.size === 0) {
            await interaction.reply('No members with the Slayer role found.');
            return;
        }
        
        const nameList = slayerMembers.map(m => {
            const name = m.nickname || m.user.username;
            return `• ${name} (${m.user.tag})`;
        }).join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('Slayer Members List')
            .setDescription(nameList)
            .setColor('#0099FF')
            .setFooter({ text: `Total: ${slayerMembers.size} members` });
            
        await interaction.reply({ embeds: [embed] });
        console.log(`Slayer name list generated by ${interaction.user.tag}`);
    } catch (error) {
        console.error('Error generating name list:', error);
        await interaction.reply('An error occurred while generating the name list.');
    }
}

// DM all command
async function dmAllNameChangeNotice(interaction) {
    if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
        await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        return;
    }

    const message = interaction.options.getString('message');
    const guild = interaction.guild;
    
    try {
        await interaction.reply({ content: '⏳ Sending DMs to all Slayers...', ephemeral: true });
        
        const members = await guild.members.fetch();
        const slayerMembers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));
        
        let successCount = 0;
        let failCount = 0;
        const failedMembers = [];
        
        for (const member of slayerMembers.values()) {
            try {
                await member.send(`📢 Message from High Command:\n${message}`);
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
                { name: 'Total Slayers', value: slayerMembers.size.toString(), inline: true },
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
    } catch (error) {
        console.error('Error in DM all command:', error);
        await interaction.followUp({ content: '❌ An error occurred during the DM campaign.', ephemeral: true });
    }
}

// Generate CSV report
async function generateCSVReport(interaction) {
    if (!interaction.member.roles.cache.has(process.env.HIGH_COMMAND_ROLE_ID)) {
        await interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
        return;
    }

    try {
        await interaction.deferReply({ ephemeral: true });
        
        const guild = interaction.guild;
        const members = await guild.members.fetch();
        const slayerMembers = members.filter(m => m.roles.cache.has(process.env.SLAYER_ROLE_ID));
        
        const csvData = [];
        for (const member of slayerMembers.values()) {
            const name = member.nickname || member.user.username;
            const [slayerName, id] = name.split('|').map(s => s.trim());
            
            csvData.push({
                username: member.user.username,
                discriminator: member.user.discriminator,
                userId: member.id,
                slayerName: slayerName || 'N/A',
                id: id || 'N/A',
                joinedAt: member.joinedAt.toISOString(),
                lastMessage: member.lastMessage ? member.lastMessage.createdAt.toISOString() : 'N/A'
            });
        }
        
        const csvWriter = createObjectCsvWriter({
            path: 'slayers_report.csv',
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
        
        await csvWriter.writeRecords(csvData);
        
        const attachment = new AttachmentBuilder('slayers_report.csv');
        await interaction.followUp({ 
            content: 'Here is the CSV report of all Slayers:',
            files: [attachment],
            ephemeral: true
        });
        
        console.log(`CSV report generated by ${interaction.user.tag}`);
    } catch (error) {
        console.error('Error generating CSV report:', error);
        await interaction.followUp({ content: '❌ An error occurred while generating the report.', ephemeral: true });
    }
}

// Event listeners
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== process.env.ROLE_REQUEST_CHANNEL_ID) return;
    
    try {
        await processNameChange(message);
    } catch (error) {
        console.error('Error in messageCreate event:', error);
    }
});

// Slash commands
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'slayer_role_remove':
                await removeSlayerRole(interaction);
                break;
            case 'name_list':
                await listSlayerNames(interaction);
                break;
            case 'dm_name_change_notice':
                await dmAllNameChangeNotice(interaction);
                break;
            case 'dm_individual':
                // Similar to dmAllNameChangeNotice but for individual members
                break;
            case 'generate_slayer_report':
                await generateCSVReport(interaction);
                break;
            default:
                await interaction.reply('Unknown command.');
        }
    } catch (error) {
        console.error('Error handling interaction:', error);
        if (!interaction.replied) {
            await interaction.reply({ content: '❌ An error occurred while processing your command.', ephemeral: true });
        }
    }
});

// Error handling
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', error => {
    console.error('Uncaught exception:', error);
});

client.login(process.env.TOKEN);
