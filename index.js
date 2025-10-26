const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  Partials, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType
} = require('discord.js');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_LOG_ID = process.env.CHANNEL_LOG_ID;

const HISTORY_FILE = path.join(__dirname, 'history.json');

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !CHANNEL_LOG_ID) {
  console.error('ENV missing: TOKEN, CLIENT_ID, GUILD_ID, CHANNEL_LOG_ID required.');
  process.exit(1);
}

function loadHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8') || '[]');
  } catch (e) {
    console.error('loadHistory error', e);
    return [];
  }
}
function saveHistory(arr) {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2)); } catch (e) { console.error('saveHistory error', e); }
}

const MODS = {
  '08170512639': { id: process.env.MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: process.env.MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

const PROOF_TARGET = new Map();
const PENDING = new Map();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = [
      { name: 'bypass', description: 'Tampilkan panel bypass (volcano)' }
    ];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands deployed to guild', GUILD_ID);
  } catch (err) {
    console.error('deployCommands error', err);
  }
}

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

async function initiateProofDM(user, modAccount) {
  try {
    const mod = MODS[modAccount];
    if (!mod) return false;
    const dmEmbed = new EmbedBuilder()
      .setTitle('Kirim Bukti Transfer')
      .setDescription(`Kirim bukti (screenshot/foto/file) sebagai balasan *ke pesan ini*. Bot akan meneruskan bukti ke moderator ${mod.tag}.`)
      .addFields(
        { name: 'Rekening Tujuan', value: mod.account, inline: true },
        { name: 'Petunjuk', value: '1) Balas dengan file\n2) Tambah pesan jika perlu\n3) Setelah dikirim, moderator akan menerima file' }
      )
      .setFooter({ text: 'Hanya kirim bukti transfer (screenshot).' })
      .setTimestamp();

    await user.send({ embeds: [dmEmbed] });
    PROOF_TARGET.set(user.id, modAccount);
    return true;
  } catch (e) {
    console.error('initiateProofDM error', e);
    return false;
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS')
        .setDescription('Pilih moderator untuk melihat nomor rekening.\nGunakan "Kirim Bukti" untuk mengirim bukti transfer ke moderator.')
        .setColor(0xEA5455)
        .setTimestamp()
        .setFooter({ text: 'made by @unstoppable_neid' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.isButton()) {
      const cid = interaction.customId;

      if (cid === 'btn_jojo' || cid === 'btn_whoisnda') {
        const modAccount = cid === 'btn_jojo' ? '08170512639' : '085219498004';
        const mod = MODS[modAccount];
        if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan.', ephemeral: true });

        const emb = new EmbedBuilder()
          .setTitle(`Informasi Moderator — ${mod.tag.replace('@','')}`)
          .addFields(
            { name: 'Moderator', value: mod.tag, inline: true },
            { name: 'Nomor Rekening', value: mod.account, inline: true }
          )
          .setFooter({ text: 'Pilih "Kirim Bukti" untuk mengirim bukti transfer via DM.' })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`proof_${mod.account}`).setLabel('Kirim Bukti').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_info').setLabel('Tutup').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [emb], components: [row], ephemeral: true });
      }

      if (cid.startsWith('proof_')) {
        const account = cid.split('_')[1];
        const ok = await initiateProofDM(interaction.user, account);
        if (ok) {
          return interaction.reply({ content: 'Cek DM — kirim bukti sebagai balasan pesan yang dikirim oleh bot.', ephemeral: true });
        } else {
          return interaction.reply({ content: 'Gagal mengirim DM — cek pengaturan privacy Anda.', ephemeral: true });
        }
      }

      if (cid === 'close_info') {
        return interaction.reply({ content: 'Ditutup.', ephemeral: true });
      }

      if (/^(reply|done|cancel|error)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');

        if (action === 'reply') {
          const modal = new ModalBuilder()
            .setCustomId(`modal_reply_${userId}_${interaction.user.id}`) 
            .setTitle('Kirim Bypass Code ke Pengirim');

          const bypassInput = new TextInputBuilder()
            .setCustomId('bypass_code')
            .setLabel('Masukkan bypass code (contoh: ABCD-1234)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('Masukkan bypass code');

          const extraInput = new TextInputBuilder()
            .setCustomId('extra_note')
            .setLabel('Pesan tambahan (opsional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Optional: pesan tambahan');

          modal.addComponents(
            { type: 1, components: [bypassInput] },
            { type: 1, components: [extraInput] }
          );

          return interaction.showModal(modal);
        }

        
        if (['done','cancel','error'].includes(action)) {
          const emoji = action === 'done' ? '✅' : (action === 'cancel' ? '❌' : '⚠️');
          const pending = PENDING.get(userId) || null;
          const channelLog = await client.channels.fetch(CHANNEL_LOG_ID).catch(()=>null);

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

          if (channelLog && channelLog.isTextBased()) {
            await channelLog.send({ embeds: [embedChannel] }).catch(e => console.error('send log err', e));
          }

          
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [ new EmbedBuilder()
              .setTitle(`Status Transfer: ${action.toUpperCase()} ${emoji}`)
              .setDescription(`Moderator <@${interaction.user.id}> menandai transaksimu sebagai **${action.toUpperCase()}**.`)
              .setTimestamp()
            ]});
          } catch (e) {
            console.warn('Cannot DM user', userId);
          }

          
          try { await interaction.update({ content: `Status ${action.toUpperCase()} dikonfirmasi.`, embeds: [], components: [] }); } catch {}

          
          const hist = loadHistory();
          hist.push({ type: 'status', userId, action, modId: interaction.user.id, at: new Date().toISOString(), pending: pending || null });
          saveHistory(hist);
          if (PENDING.has(userId)) PENDING.delete(userId);

          return;
        }
      }

    } 

    
    if (interaction.type === InteractionType.ModalSubmit) {
      
      if (interaction.customId.startsWith('modal_reply_')) {
        const parts = interaction.customId.split('_');
        const userId = parts[2];
        const modIdFromModal = parts[3]; 
        const modClickingId = interaction.user.id;

        
        if (modClickingId !== modIdFromModal) {
          return interaction.reply({ content: 'Anda tidak berwenang mengirim pesan ini (modal mismatch).', ephemeral: true });
        }

        const bypassCode = interaction.fields.getTextInputValue('bypass_code').trim();
        const extraNote = interaction.fields.getTextInputValue('extra_note') || '';

        const userMessage = `copy this bypass : ${bypassCode}`;
        const finalMessage = extraNote ? `${userMessage}\n\n${extraNote}` : userMessage;

        
        try {
          const user = await client.users.fetch(userId);
          await user.send({ content: finalMessage });

          
          await interaction.reply({ content: 'Bypass code berhasil dikirim ke pengirim bukti.', ephemeral: true });

          
          const hist = loadHistory();
          hist.push({ type: 'reply_bypass', to: userId, fromMod: modClickingId, bypassCode, extraNote, at: new Date().toISOString() });
          saveHistory(hist);

          
          const channelLog = await client.channels.fetch(CHANNEL_LOG_ID).catch(()=>null);
          if (channelLog && channelLog.isTextBased()) {
            const logEmbed = new EmbedBuilder()
              .setTitle('Bypass Code Sent')
              .setDescription(`<@${modClickingId}> mengirim bypass code ke <@${userId}>`)
              .addFields({ name: 'Bypass', value: `\`${bypassCode}\`` })
              .setTimestamp();
            await channelLog.send({ embeds: [logEmbed] }).catch(()=>{});
          }

        } catch (e) {
          console.error('Failed send bypass DM to user:', e);
          try { await interaction.reply({ content: 'Gagal mengirim pesan ke user (mungkin mereka memblokir DM).', ephemeral: true }); } catch {}
        }

        return;
      }
    }

  } catch (err) {
    console.error('interaction handler error', err);
    try { if (interaction && !interaction.replied) await interaction.reply({ content: 'Terjadi error internal.', ephemeral: true }); } catch {}
  }
});

// messageCreate: listen to DMs for proof attachments and forward to mod with Reply + status buttons
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    const isDM = message.channel?.type === 1 || message.channel?.type === 'DM';
    if (!isDM) return;

    const userId = message.author.id;
    if (!PROOF_TARGET.has(userId)) {
      await message.reply('Untuk mengirim bukti, tekan tombol "Kirim Bukti" pada message `/bypass` di server, lalu kirim balasan ke pesan ini.');
      return;
    }

    const modAccount = PROOF_TARGET.get(userId);
    const mod = MODS[modAccount];
    if (!mod) {
      await message.reply('Target moderator tidak ditemukan. Coba lagi dari server.');
      PROOF_TARGET.delete(userId);
      return;
    }

    if (!message.attachments || message.attachments.size === 0) {
      await message.reply('Tidak menemukan attachment. Silakan kirim file (screenshot/foto) sebagai attachment.');
      return;
    }

    
    const forwardEmbed = new EmbedBuilder()
      .setTitle('📎 Bukti Transfer Diterima')
      .setDescription(`User <@${userId}> mengirim bukti untuk rekening **${mod.account}**`)
      .addFields(
        { name: 'Catatan pengguna', value: message.content ? (message.content.slice(0, 1024)) : '-' }
      )
      .setFooter({ text: `Kirim oleh ${message.author.tag}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`reply_${userId}`).setLabel('Reply to Sender').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`done_${userId}`).setLabel('Done ✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`error_${userId}`).setLabel('Error ⚠️').setStyle(ButtonStyle.Secondary)
    );

    try {
      const modUser = await client.users.fetch(mod.id);
      
      await modUser.send({ embeds: [forwardEmbed], components: [row] });

      
      for (const [, att] of message.attachments) {
        await modUser.send({ content: `File dari <@${userId}>:`, files: [att.url] }).catch(e => console.error('forward att error', e));
      }

      
      await message.reply('Bukti berhasil dikirim ke moderator. Tunggu konfirmasi mereka.');

      
      const hist = loadHistory();
      hist.push({ type: 'proof_sent', from: userId, toMod: mod.id, attachments: message.attachments.map(a => ({ url: a.url, name: a.name })), content: message.content || '', at: new Date().toISOString() });
      saveHistory(hist);

      
      PROOF_TARGET.delete(userId);

    } catch (e) {
      console.error('Forward to mod failed:', e);
      await message.reply('Gagal meneruskan bukti ke moderator. Silakan hubungi moderator secara manual.');
    }

  } catch (err) {
    console.error('messageCreate error', err);
  }
});

client.login(TOKEN).catch(err => {
  console.error('Login failed - check TOKEN & Message Content Intent enabled?', err);
});
