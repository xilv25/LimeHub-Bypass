/**
 * Discord Bypass Bot — Polished Replit-ready
 * Features:
 *  - /bypass -> embed + 2 buttons (Jojo, WhoisNda)
 *  - show ephemeral rekening -> "Saya sudah transfer" -> modal (amount + ref)
 *  - mod DM with Done / Cancel / Error buttons
 *  - posting status embed to CHANNEL_LOG_ID and DM user
 *  - simple history saved to history.json
 *
 * SET SECRETS in Replit:
 * TOKEN, CLIENT_ID, GUILD_ID (optional), MOD1_ID, MOD2_ID, CHANNEL_LOG_ID
 */

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, REST, Routes } = require('discord.js');
require('dotenv').config();

const HISTORY_FILE = path.join(__dirname, 'history.json');

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    console.error('Failed load history:', e);
    return [];
  }
}
function saveHistory(arr) {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2)); } catch (e) { console.error('Failed save history:', e); }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

// Moderators (rekening -> info). Tweak display names if perlu.
const MODS = {
  '08170512639': { id: process.env.MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: process.env.MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

const PENDING = new Map(); // userId -> {account, amount, reference, timestamp}

async function deployCommandsIfNeeded() {
  try {
    if (!process.env.CLIENT_ID || !process.env.TOKEN) {
      console.log('CLIENT_ID or TOKEN not set — skipping command deploy.');
      return;
    }
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = [
      { name: 'bypass', description: 'Tampilkan panel bypass (volcano)' },
      { name: 'done', description: 'Tandai transaksi sebagai DONE', options: [{ name: 'user', description: 'User mention or id', type: 6, required: true }, { name: 'note', description: 'Optional note', type: 3, required: false }] },
      { name: 'cancel', description: 'Tandai transaksi sebagai CANCEL', options: [{ name: 'user', description: 'User mention or id', type: 6, required: true }, { name: 'note', description: 'Optional note', type: 3, required: false }] },
      { name: 'error', description: 'Tandai transaksi sebagai ERROR', options: [{ name: 'user', description: 'User mention or id', type: 6, required: true }, { name: 'note', description: 'Optional note', type: 3, required: false }] }
    ];

    console.log('Deploying slash commands...');
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
      console.log('Commands deployed to guild', process.env.GUILD_ID);
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('Commands deployed globally (may take up to 1 hour).');
    }
  } catch (err) {
    console.error('deployCommands error:', err);
  }
}

client.on('interactionCreate', async interaction => {
  try {
    // ---- Slash command: /bypass ----
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS')
        .setDescription('Pilih moderator untuk melihat nomor rekening. Transfer manual, lalu konfirmasi menggunakan tombol.')
        .setColor(0xEA5455) // merah hangat
        .setThumbnail('https://i.imgur.com/7yUvePI.png') // small icon (hosting public)
        .addFields(
          { name: 'Langkah singkat', value: '1) Pilih moderator\n2) Transfer manual\n3) Klik "Saya sudah transfer" -> isi jumlah & referensi\n4) Moderator konfirmasi (Done / Cancel / Error)' }
        )
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('show_mod_08170512639').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('show_mod_085219498004').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Secondary)
        );

      await interaction.reply({ embeds: [embed], components: [row] });
      return;
    }

    // ---- Button interactions ----
    if (interaction.isButton()) {
      // show moderator ephemeral info
      if (interaction.customId.startsWith('show_mod_')) {
        const account = interaction.customId.replace('show_mod_', '');
        const mod = MODS[account];
        if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan.', ephemeral: true });

        const emb = new EmbedBuilder()
          .setTitle('Informasi Moderator')
          .addFields(
            { name: 'Moderator', value: mod.tag, inline: true },
            { name: 'Nomor Rekening', value: mod.account, inline: true },
            { name: 'Note', value: 'Pastikan nominal & referensi benar sebelum konfirmasi.' }
          )
          .setFooter({ text: 'Data ini bersifat sensitif — jangan dishare.' })
          .setTimestamp();

        const rowConfirm = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`transfer_${account}`).setLabel('Saya sudah transfer').setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [emb], components: [rowConfirm], ephemeral: true });
      }

      // open modal to confirm transfer
      if (interaction.customId.startsWith('transfer_')) {
        const account = interaction.customId.split('_')[1];
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

      // moderator clicked status button in DM (done/cancel/error)
      if (/^(done|cancel|error)_\d+$/.test(interaction.customId)) {
        const [action, userId] = interaction.customId.split('_');
        const statusText = action.toUpperCase();
        const emoji = action === 'done' ? '✅' : (action === 'cancel' ? '❌' : '⚠️');

        // find pending info
        const pending = PENDING.get(userId) || null;
        const channelLog = await client.channels.fetch(process.env.CHANNEL_LOG_ID).catch(() => null);

        // build status embed for channel
        const embed = new EmbedBuilder()
          .setTitle(`STATUS : ${statusText} ${emoji}`)
          .setDescription(`Hello <@${userId}>\nPlease check your DM for a private message.`)
          .addFields(
            { name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'User', value: `<@${userId}>`, inline: true }
          )
          .setTimestamp();

        if (pending) {
          embed.addFields(
            { name: 'Jumlah', value: pending.amount.toString(), inline: true },
            { name: 'Rekening Tujuan', value: pending.modAccount, inline: true },
            { name: 'Referensi', value: pending.reference || '-', inline: false }
          );
        }

        // post to channel log
        if (channelLog && channelLog.isTextBased()) {
          await channelLog.send({ embeds: [embed] }).catch(e => console.error('send log err', e));
        }

        // DM user about the status
        try {
          const user = await client.users.fetch(userId);
          await user.send({ embeds: [ new EmbedBuilder()
            .setTitle(`Status Transfer: ${statusText} ${emoji}`)
            .setDescription(`Moderator <@${interaction.user.id}> menandai transaksimu sebagai **${statusText}**.`)
            .addFields(
              { name: 'Note', value: pending && pending.reference ? pending.reference : '-' },
              { name: 'Jumlah', value: pending ? pending.amount.toString() : '-' }
            )
            .setFooter({ text: `Handled by ${interaction.user.tag}` })
            .setTimestamp()
          ]});
        } catch (e) {
          console.warn('Cannot DM user', userId);
        }

        // disable the buttons (update mod DM message)
        try {
          await interaction.update({ content: `Status ${statusText} dikonfirmasi.`, embeds: [], components: [] });
        } catch (e) {
          try { await interaction.reply({ content: `Status ${statusText} dikonfirmasi.`, ephemeral: true }); } catch {}
        }

        // push to history and clear pending
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

    // ---- Modal submit: user confirmed transfer ----
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_transfer_')) {
      const parts = interaction.customId.split('_');
      const account = parts[2];
      const userId = parts[3];

      const amount = interaction.fields.getTextInputValue('amount').replace(/\D/g, '') || interaction.fields.getTextInputValue('amount');
      const reference = interaction.fields.getTextInputValue('reference') || '-';

      const mod = MODS[account];
      if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan (account mismatch).', ephemeral: true });

      // save pending
      PENDING.set(userId, { modAccount: account, amount, reference, timestamp: new Date().toISOString() });

      // DM moderator
      try {
        const modUser = await client.users.fetch(mod.id);
        const dmEmbed = new EmbedBuilder()
          .setTitle('📥 Transfer Diproses')
          .setDescription(`Ada konfirmasi transfer untuk moderator ${mod.tag}`)
          .addFields(
            { name: 'Dari', value: `<@${userId}>`, inline: true },
            { name: 'Jumlah', value: amount.toString(), inline: true },
            { name: 'Ke Rekening', value: account, inline: true },
            { name: 'Referensi', value: reference, inline: false }
          )
          .setFooter({ text: `Klik salah satu tombol untuk update status • ${new Date().toLocaleString()}` })
          .setTimestamp();

        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId(`done_${userId}`).setLabel('Done ✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`error_${userId}`).setLabel('Error ⚠️').setStyle(ButtonStyle.Secondary)
          );

        await modUser.send({ embeds: [dmEmbed], components: [row] });

        // confirm to user ephemerally
        await interaction.reply({ content: `Konfirmasi terkirim ke moderator ${mod.tag}. Tunggu konfirmasi dari moderator.`, ephemeral: true });

        // save to history basic record
        const hist = loadHistory();
        hist.push({ userId, modAccount: account, amount, reference, createdAt: new Date().toISOString() });
        saveHistory(hist);

      } catch (e) {
        console.error('Failed DM mod:', e);
        return interaction.reply({ content: 'Gagal mengirim DM ke moderator — mereka mungkin memblokir DM.', ephemeral: true });
      }

      return;
    }

    // ---- manual slash commands done/cancel/error (optional) ----
    if (interaction.isCommand() && ['done','cancel','error'].includes(interaction.commandName)) {
      const cmd = interaction.commandName;
      const targetUser = interaction.options.getUser('user', true);
      const note = interaction.options.getString('note') || '-';
      const action = cmd;
      const statusText = action.toUpperCase();
      const emoji = action === 'done' ? '✅' : (action === 'cancel' ? '❌' : '⚠️');

      const channelLog = await client.channels.fetch(process.env.CHANNEL_LOG_ID).catch(()=>null);
      const embed = new EmbedBuilder()
        .setTitle(`STATUS : ${statusText} ${emoji}`)
        .setDescription(`Hello <@${targetUser.id}>\nPlease check your DM for a private message.`)
        .addFields(
          { name: 'Handled by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Note', value: note, inline: true }
        )
        .setTimestamp();

      if (channelLog && channelLog.isTextBased()) await channelLog.send({ embeds: [embed] }).catch(()=>{});
      try { await targetUser.send({ embeds: [ new EmbedBuilder().setTitle(`Status Transfer: ${statusText} ${emoji}`).setDescription(`Moderator <@${interaction.user.id}>: ${note}`).setTimestamp() ]}); } catch {}
      await interaction.reply({ content: `Posted status ${statusText}.`, ephemeral: true });

      // save to history
      const hist = loadHistory();
      hist.push({ via: 'slash', action, target: targetUser.id, mod: interaction.user.id, note, at: new Date().toISOString() });
      saveHistory(hist);
    }

  } catch (err) {
    console.error('Interaction handler error:', err);
    try {
      if (interaction && !interaction.replied) await interaction.reply({ content: 'Terjadi error internal.', ephemeral: true });
    } catch {}
  }
});

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommandsIfNeeded();
});

client.login(process.env.TOKEN);
