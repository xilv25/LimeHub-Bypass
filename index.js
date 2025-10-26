const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, REST, Routes } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

// ----- Moderator Info -----
const MODS = {
  '08170512639': { id: process.env.MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: process.env.MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

const PENDING = new Map();

// ----- Deploy Guild Commands -----
async function deployCommands() {
  const commands = [
    { name: 'bypass', description: 'Tampilkan panel bypass (volcano)' },
    { name: 'done', description: 'Tandai transaksi sebagai DONE', options: [{ name: 'user', description: 'User mention', type: 6, required: true }] },
    { name: 'cancel', description: 'Tandai transaksi sebagai CANCEL', options: [{ name: 'user', description: 'User mention', type: 6, required: true }] },
    { name: 'error', description: 'Tandai transaksi sebagai ERROR', options: [{ name: 'user', description: 'User mention', type: 6, required: true }] }
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
  console.log('Commands deployed to guild', process.env.GUILD_ID);
}

// ----- Interaction Handler -----
client.on('interactionCreate', async interaction => {
  try {
    // --- Slash command /bypass ---
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS')
        .setDescription('Pilih moderator untuk melihat rekening dan transfer.')
        .setColor(0xEA5455)
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('show_mod_08170512639').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('show_mod_085219498004').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Secondary)
        );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // --- Button interactions ---
    if (interaction.isButton()) {
      // Show moderator ephemeral info
      if (interaction.customId.startsWith('show_mod_')) {
        const account = interaction.customId.replace('show_mod_', '');
        const mod = MODS[account];
        if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan.', ephemeral: true });

        const emb = new EmbedBuilder()
          .setTitle('Informasi Moderator')
          .addFields(
            { name: 'Moderator', value: mod.tag, inline: true },
            { name: 'Nomor Rekening', value: mod.account, inline: true }
          )
          .setFooter({ text: 'Jangan sebarkan ke publik.' })
          .setTimestamp();

        const rowConfirm = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`transfer_${account}`).setLabel('Saya sudah transfer').setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [emb], components: [rowConfirm], ephemeral: true });
      }

      // Open modal to confirm transfer
      if (interaction.customId.startsWith('transfer_')) {
        const account = interaction.customId.split('_')[1];
        const modal = new ModalBuilder()
          .setCustomId(`modal_transfer_${account}_${interaction.user.id}`)
          .setTitle('Konfirmasi Transfer');

        modal.addComponents(
          { type: 1, components: [{ type: 4, custom_id: 'amount', style: 1, label: 'Jumlah Transfer', required: true }] },
          { type: 1, components: [{ type: 4, custom_id: 'reference', style: 1, label: 'Referensi / Catatan', required: false }] }
        );

        return interaction.showModal(modal);
      }

      // Moderator clicked Done / Cancel / Error
      if (/^(done|cancel|error)_\d+$/.test(interaction.customId)) {
        const [action, userId] = interaction.customId.split('_');
        const emoji = action === 'done' ? '✅' : (action === 'cancel' ? '❌' : '⚠️');

        const channelLog = await client.channels.fetch(process.env.CHANNEL_LOG_ID).catch(()=>null);

        const embed = new EmbedBuilder()
          .setTitle(`STATUS : ${action.toUpperCase()} ${emoji}`)
          .setDescription(`Hello <@${userId}>\nPlease check your DM.`)
          .addFields({ name: 'Handled by', value: `<@${interaction.user.id}>` })
          .setTimestamp();

        if (channelLog && channelLog.isTextBased()) await channelLog.send({ embeds: [embed] });

        // DM user
        try {
          const user = await client.users.fetch(userId);
          await user.send({ embeds: [embed] });
        } catch {}

        await interaction.update({ content: `Status ${action.toUpperCase()} dikonfirmasi.`, embeds: [], components: [] });

        if (PENDING.has(userId)) PENDING.delete(userId);
        return;
      }
    }

    // --- Modal submit ---
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_transfer_')) {
      const parts = interaction.customId.split('_');
      const account = parts[2];
      const userId = parts[3];
      const amount = interaction.fields.getTextInputValue('amount');
      const reference = interaction.fields.getTextInputValue('reference') || '-';
      const mod = MODS[account];
      if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan.', ephemeral: true });

      PENDING.set(userId, { modAccount: account, amount, reference });

      const modUser = await client.users.fetch(mod.id);
      const dmEmbed = new EmbedBuilder()
        .setTitle('📥 Transfer Masuk')
        .addFields(
          { name: 'Dari', value: `<@${userId}>`, inline: true },
          { name: 'Jumlah', value: amount, inline: true },
          { name: 'Ke Rekening', value: account, inline: true },
          { name: 'Referensi', value: reference }
        )
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId(`done_${userId}`).setLabel('Done ✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`error_${userId}`).setLabel('Error ⚠️').setStyle(ButtonStyle.Secondary)
        );

      await modUser.send({ embeds: [dmEmbed], components: [row] });
      await interaction.reply({ content: `Konfirmasi terkirim ke moderator ${mod.tag}`, ephemeral: true });
      return;
    }

  } catch (err) {
    console.error(err);
    if (interaction && !interaction.replied) await interaction.reply({ content: 'Terjadi error.', ephemeral: true });
  }
});

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

client.login(process.env.TOKEN);
