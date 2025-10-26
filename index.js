/**
 * Discord Bypass Bot - Full (Guild-only)
 * - /bypass -> embed + Contact Jojo / WhoisNda
 * - ephemeral show rekening -> "Saya sudah transfer" -> modal
 * - DM moderator with Done/Cancel/Error buttons
 * - post status to CHANNEL_LOG_ID and DM the user
 * - simple history saved to history.json
 *
 * SET Replit Secrets:
 * TOKEN, CLIENT_ID, GUILD_ID, MOD1_ID, MOD2_ID, CHANNEL_LOG_ID
 */

const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType,
  REST, Routes
} = require('discord.js');
require('dotenv').config();

const HISTORY_FILE = path.join(__dirname, 'history.json');

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error('Failed to load history:', e);
    return [];
  }
}
function saveHistory(arr) {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2)); } catch (e) { console.error('Failed to save history:', e); }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

// Moderator mapping — rekening -> moderator info
const MODS = {
  '08170512639': { id: process.env.MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: process.env.MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

// pending map: userId -> { modAccount, amount, reference, createdAt }
const PENDING = new Map();

// Deploy guild-only commands (so they appear instantly)
async function deployCommands() {
  if (!process.env.CLIENT_ID || !process.env.GUILD_ID || !process.env.TOKEN) {
    console.warn('CLIENT_ID, GUILD_ID or TOKEN missing — skipping deployCommands.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  const commands = [
    { name: 'bypass', description: 'Tampilkan panel bypass (volcano)' },
    { name: 'done', description: 'Tandai transaksi sebagai DONE', options: [{ name: 'user', description: 'User mention', type: 6, required: true }, { name: 'note', description: 'Note (optional)', type: 3, required: false }] },
    { name: 'cancel', description: 'Tandai transaksi sebagai CANCEL', options: [{ name: 'user', description: 'User mention', type: 6, required: true }, { name: 'note', description: 'Note (optional)', type: 3, required: false }] },
    { name: 'error', description: 'Tandai transaksi sebagai ERROR', options: [{ name: 'user', description: 'User mention', type: 6, required: true }, { name: 'note', description: 'Note (optional)', type: 3, required: false }] }
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('Commands deployed to guild', process.env.GUILD_ID);
  } catch (err) {
    console.error('Failed to deploy commands:', err);
  }
}

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  try {
    // Slash commands
    if (interaction.isCommand()) {
      if (interaction.commandName === 'bypass') {
        const embed = new EmbedBuilder()
          .setTitle('🔥 VOLCANO BYPASS')
          .setDescription('Pilih moderator untuk melihat nomor rekening. Transfer manual, lalu konfirmasi.')
          .setColor(0xEA5455)
          .setTimestamp()
          .setFooter({ text: 'made by @unstoppable_neid' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('show_mod_08170512639').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('show_mod_085219498004').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
      }

      // manual slash actions (optional): admin/mod can use these too
      if (['done', 'cancel', 'error'].includes(interaction.commandName)) {
        const action = interaction.commandName;
        const targetUser = interaction.options.getUser('user', true);
        const note = interaction.options.getString('note') || '-';
        const emoji = action === 'done' ? '✅' : (action === 'cancel' ? '❌' : '⚠️');

        const channelLog = await client.channels.fetch(process.env.CHANNEL_LOG_ID).catch(() => null);
        const embed = new EmbedBuilder()
          .setTitle(`STATUS : ${action.toUpperCase()} ${emoji}`)
          .setDescription(`Hello <@${targetUser.id}>\nPlease check your DM.`)
          .addFields(
            { name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Note', value: note, inline: true }
          )
          .setTimestamp();

        if (channelLog && channelLog.isTextBased()) {
          await channelLog.send({ embeds: [embed] }).catch(() => {});
        }
        try { await targetUser.send({ embeds: [embed] }); } catch {}

        await interaction.reply({ content: `Posted status ${action.toUpperCase()}.`, ephemeral: true });

        // save to history
        const hist = loadHistory();
        hist.push({ via: 'slash', action, target: targetUser.id, mod: interaction.user.id, note, at: new Date().toISOString() });
        saveHistory(hist);
        return;
      }
    }

    // Button interactions
    if (interaction.isButton()) {
      const cid = interaction.customId;

      // show moderator ephemeral details
      if (cid.startsWith('show_mod_')) {
        const account = cid.replace('show_mod_', '');
        const mod = MODS[account];
        if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan.', ephemeral: true });

        const emb = new EmbedBuilder()
          .setTitle('Informasi Moderator')
          .addFields(
            { name: 'Moderator', value: mod.tag, inline: true },
            { name: 'Nomor Rekening', value: mod.account, inline: true }
          )
          .setFooter({ text: 'Data sensitif — jangan dibagikan.' })
          .setTimestamp();

        const rowConfirm = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`transfer_${account}`).setLabel('Saya sudah transfer').setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [emb], components: [rowConfirm], ephemeral: true });
      }

      // open modal for confirm transfer
      if (cid.startsWith('transfer_')) {
        const account = cid.split('_')[1];
        const modal = new ModalBuilder()
          .setCustomId(`modal_transfer_${account}_${interaction.user.id}`)
          .setTitle('Konfirmasi Transfer');

        const amountInput = new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('Jumlah (contoh: 150000)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const refInput = new TextInputBuilder()
          .setCustomId('reference')
          .setLabel('Referensi / Catatan (opsional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          { type: 1, components: [amountInput] },
          { type: 1, components: [refInput] }
        );

        return interaction.showModal(modal);
      }

      // moderator pressed done/cancel/error in DM
      if (/^(done|cancel|error)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');
        const emoji = action === 'done' ? '✅' : (action === 'cancel' ? '❌' : '⚠️');
        const pending = PENDING.get(userId) || null;

        const embedChannel = new EmbedBuilder()
          .setTitle(`STATUS : ${action.toUpperCase()} ${emoji}`)
          .setDescription(`Hello <@${userId}>\nPlease check your DM for a private message.`)
          .addFields(
            { name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'User', value: `<@${userId}>`, inline: true }
          )
          .setTimestamp();

        if (pending) {
          embedChannel.addFields(
            { name: 'Jumlah', value: `${pending.amount}`, inline: true },
            { name: 'Ke Rekening', value: pending.modAccount, inline: true },
            { name: 'Referensi', value: pending.reference || '-', inline: false }
          );
        }

        // send to channel log
        const channelLog = await client.channels.fetch(process.env.CHANNEL_LOG_ID).catch(() => null);
        if (channelLog && channelLog.isTextBased()) {
          await channelLog.send({ embeds: [embedChannel] }).catch((e) => console.error('Send to channel failed', e));
        }

        // DM user
        try {
          const user = await client.users.fetch(userId);
          const userEmbed = new EmbedBuilder()
            .setTitle(`Status Transfer: ${action.toUpperCase()} ${emoji}`)
            .setDescription(`Moderator <@${interaction.user.id}> menandai transaksi Anda sebagai **${action.toUpperCase()}**.`)
            .addFields(
              { name: 'Jumlah', value: pending ? `${pending.amount}` : '-' },
              { name: 'Referensi', value: pending ? pending.reference || '-' : '-' }
            )
            .setTimestamp();
          await user.send({ embeds: [userEmbed] }).catch(() => {});
        } catch (e) {
          console.warn('Failed to DM user:', e);
        }

        // disable buttons on mod message (update the DM message)
        try {
          await interaction.update({ content: `Status ${action.toUpperCase()} dikonfirmasi.`, embeds: [], components: [] });
        } catch (e) {
          try { await interaction.reply({ content: `Status ${action.toUpperCase()} dikonfirmasi.`, ephemeral: true }); } catch {}
        }

        // save to history and clear pending
        const hist = loadHistory();
        hist.push({
          userId,
          action,
          modId: interaction.user.id,
          timestamp: new Date().toISOString(),
          pending: pending || null
        });
        saveHistory(hist);
        if (PENDING.has(userId)) PENDING.delete(userId);

        return;
      }
    }

    // Modal submitted by user after clicking "Saya sudah transfer"
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_transfer_')) {
      const parts = interaction.customId.split('_');
      const account = parts[2];
      const userId = parts[3];

      const amountRaw = interaction.fields.getTextInputValue('amount') || '';
      const amount = amountRaw.replace(/[^\d.,]/g, '').replace(',', '.'); // sanitize
      const reference = interaction.fields.getTextInputValue('reference') || '-';

      const mod = MODS[account];
      if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan (account mismatch).', ephemeral: true });

      // Save pending
      PENDING.set(userId, { modAccount: account, amount, reference, createdAt: new Date().toISOString() });

      // DM moderator
      try {
        const modUser = await client.users.fetch(mod.id);
        const dmEmbed = new EmbedBuilder()
          .setTitle('📥 Transfer Masuk — Konfirmasi Diperlukan')
          .setDescription(`User <@${userId}> mengonfirmasi transfer ke rekening **${account}**`)
          .addFields(
            { name: 'Dari', value: `<@${userId}>`, inline: true },
            { name: 'Jumlah', value: `${amount}`, inline: true },
            { name: 'Referensi', value: `${reference}`, inline: false }
          )
          .setFooter({ text: 'Klik tombol di bawah untuk update status' })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`done_${userId}`).setLabel('Done ✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`error_${userId}`).setLabel('Error ⚠️').setStyle(ButtonStyle.Secondary)
        );

        await modUser.send({ embeds: [dmEmbed], components: [row] });

        // confirm to user ephemeral
        await interaction.reply({ content: `Konfirmasi dikirim ke moderator ${mod.tag}. Tunggu konfirmasi mereka.`, ephemeral: true });

        // save to history
        const hist = loadHistory();
        hist.push({ userId, modAccount: account, amount, reference, createdAt: new Date().toISOString() });
        saveHistory(hist);

      } catch (e) {
        console.error('Failed to DM mod:', e);
        return interaction.reply({ content: 'Gagal mengirim DM ke moderator (mereka mungkin menonaktifkan DM).', ephemeral: true });
      }

      return;
    }

  } catch (err) {
    console.error('Interaction handler error:', err);
    try { if (interaction && !interaction.replied) await interaction.reply({ content: 'Terjadi error internal.', ephemeral: true }); } catch {}
  }
});

// login
client.login(process.env.TOKEN).catch(err => {
  console.error('Failed login - check TOKEN:', err);
});
