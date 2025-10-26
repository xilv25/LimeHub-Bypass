// Step-2: Lightweight version — embed + ephemeral buttons only
const { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
require('dotenv').config();

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;

if (!CLIENT_ID || !GUILD_ID || !TOKEN) {
  console.error('ENV MISSING: set CLIENT_ID, GUILD_ID, TOKEN in secrets.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds] // minimal
});

// moderator info (display only)
const MODS = {
  jojo: { tag: '@jojo168', account: '08170512639', id: process.env.MOD1_ID || '971823685595967610' },
  whoisnda: { tag: '@whoisnda_', account: '085219498004', id: process.env.MOD2_ID || '332128597911273473' }
};

// deploy commands (guild-only)
async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = [
    { name: 'bypass', description: 'Tampilkan panel bypass (volcano)' }
  ];
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands deployed to guild', GUILD_ID);
  } catch (err) {
    console.error('Failed to deploy commands:', err);
  }
}

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

// interaction handler
client.on('interactionCreate', async (interaction) => {
  try {
    // slash command
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS')
        .setDescription('Pilih moderator untuk melihat nomor rekening.\nTransfer manual lalu tunggu konfirmasi moderator.')
        .setColor(0xEA5455)
        .setTimestamp()
        .setFooter({ text: 'made by @unstoppable_neid' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // button interactions -> ephemeral info only
    if (interaction.isButton()) {
      if (interaction.customId === 'btn_jojo') {
        const mod = MODS.jojo;
        const e = new EmbedBuilder()
          .setTitle('Informasi Moderator — Jojo')
          .addFields(
            { name: 'Username', value: mod.tag, inline: true },
            { name: 'Nomor Rekening', value: mod.account, inline: true }
          )
          .setFooter({ text: 'Jangan sebarkan data ini ke publik.' })
          .setTimestamp();
        return interaction.reply({ embeds: [e], ephemeral: true });
      }

      if (interaction.customId === 'btn_whoisnda') {
        const mod = MODS.whoisnda;
        const e = new EmbedBuilder()
          .setTitle('Informasi Moderator — WhoisNda')
          .addFields(
            { name: 'Username', value: mod.tag, inline: true },
            { name: 'Nomor Rekening', value: mod.account, inline: true }
          )
          .setFooter({ text: 'Jangan sebarkan data ini ke publik.' })
          .setTimestamp();
        return interaction.reply({ embeds: [e], ephemeral: true });
      }

      // unknown button
      return interaction.reply({ content: 'Unknown button.', ephemeral: true });
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    try { if (!interaction.replied) await interaction.reply({ content: 'Terjadi error internal.', ephemeral: true }); } catch {}
  }
});

client.login(TOKEN).catch(err => {
  console.error('Login failed — check TOKEN:', err);
});
