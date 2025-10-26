// ===========================================
// Bypass Bot — Final: SendBypass modal only hides after send, Cancel works
// Copy-paste ready for Replit
// ===========================================
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  Partials, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType
} = require('discord.js');
require('dotenv').config();

// ====== Replit Secrets (WAJIB) ======
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const CHANNEL_LOG_ID = process.env.CHANNEL_LOG_ID;
const MOD1_ID = process.env.MOD1_ID;
const MOD2_ID = process.env.MOD2_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !CHANNEL_LOG_ID || !MOD1_ID || !MOD2_ID) {
  console.error('ENV missing: set TOKEN, CLIENT_ID, GUILD_ID, CHANNEL_LOG_ID, MOD1_ID, MOD2_ID');
  process.exit(1);
}

// ====== Files ======
const HISTORY_FILE = path.join(__dirname, 'history.json');
const QUEUE_FILE = path.join(__dirname, 'queue.json');

function loadHistory(){ try{ return fs.existsSync(HISTORY_FILE)? JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')||'[]') : []; } catch(e){ console.error('loadHistory err',e); return []; } }
function saveHistory(arr){ try{ fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2)) } catch(e){ console.error('saveHistory err', e); } }

function loadQueue(){
  try{
    if (!fs.existsSync(QUEUE_FILE)) {
      const init = {
        accounts: ['08170512639','085219498004'],
        nextIndex: 0,
        counts: { '08170512639': 0, '085219498004': 0 }
      };
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(init, null, 2));
      return init;
    }
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8') || '{}');
  } catch(e){ console.error('loadQueue err', e); return null; }
}
function saveQueue(q){ try{ fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)) } catch(e){ console.error('saveQueue err', e); } }

// ====== Moderators mapping ======
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

// runtime maps
const PROOF_TARGET = new Map(); // userId -> modAccount
const PENDING = new Map(); // userId -> { modAccount, createdAt }
const BYPASS_EMBEDS = new Map(); // messageId -> message (server embeds)
const FORWARD_MAP = new Map(); // key `${modId}_${userId}` -> forwardedMessageId (so we can edit it later)

// ====== client ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ====== queue helpers ======
let QUEUE = loadQueue();
if (!QUEUE) QUEUE = { accounts: ['08170512639','085219498004'], nextIndex: 0, counts: { '08170512639': 0, '085219498004': 0 } };

function getNextModAccount() {
  const acc = QUEUE.accounts[QUEUE.nextIndex % QUEUE.accounts.length];
  QUEUE.nextIndex = (QUEUE.nextIndex + 1) % QUEUE.accounts.length;
  QUEUE.counts[acc] = (QUEUE.counts[acc] || 0) + 1;
  saveQueue(QUEUE);
  return acc;
}

function decrementModCount(account) {
  if (!account) return;
  QUEUE.counts[account] = Math.max(0, (QUEUE.counts[account] || 0) - 1);
  saveQueue(QUEUE);
}

function queueStatusFields() {
  const a1 = QUEUE.accounts[0], a2 = QUEUE.accounts[1];
  const next = QUEUE.accounts[QUEUE.nextIndex % QUEUE.accounts.length];
  return [
    { name: 'Antrian Jojo', value: `${QUEUE.counts[a1] || 0}`, inline: true },
    { name: 'Antrian WhoisNda', value: `${QUEUE.counts[a2] || 0}`, inline: true },
    { name: 'Next assignment', value: `${next === a1 ? MODS[a1].tag : MODS[a2].tag}`, inline: false }
  ];
}

// ====== deploy commands ======
async function deployCommands(){
  try{
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = [{ name: 'bypass', description: 'Tampilkan panel bypass' }];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands deployed to guild', GUILD_ID);
  } catch(e){ console.error('deployCommands err', e); }
}

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

// small sleep
function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }

// ====== Forward proof to mod (DM) ======
async function forwardProofToMod(message, mod) {
  const userId = message.author.id;
  const forwardEmbed = new EmbedBuilder()
    .setTitle('📎 Bukti Transfer Diterima')
    .setDescription(`User <@${userId}> mengirim bukti untuk rekening **${mod.account}**`)
    .addFields({ name: 'Catatan pengguna', value: message.content ? message.content.slice(0,1024) : '-' })
    .setFooter({ text: `Dikirim oleh ${message.author.tag}` })
    .setTimestamp();

  // Only Send Bypass and Cancel buttons (no Done/Error)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Primary)
  );

  let modUser;
  try{ modUser = await client.users.fetch(mod.id); } catch (e) { console.error('fetch mod user error', e); return message.reply('Gagal DM moderator (fetch).'); }

  try{
    const sent = await modUser.send({ embeds: [forwardEmbed], components: [row] });
    // store mapping so later modal submit can identify and edit this message to remove buttons
    FORWARD_MAP.set(`${mod.id}_${userId}`, sent.id);

    // forward attachments separately
    for (const [, att] of message.attachments) {
      try { await modUser.send({ content: `File dari <@${userId}>:`, files: [att.url] }); } catch(e){ console.error('forward attachment err', e); }
    }

    // mark pending for later decrement once handled
    PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString(), modId: mod.id });

    // save history
    const hist = loadHistory();
    hist.push({ type: 'proof_sent', from: userId, toMod: mod.id, attachments: message.attachments.map(a=>({ url: a.url, name: a.name })), content: message.content || '', at: new Date().toISOString() });
    saveHistory(hist);

    return true;
  } catch(e){
    console.error('forwardProofToMod error', e);
    try { await message.reply('Gagal meneruskan bukti ke moderator.'); } catch {}
    return false;
  }
}

// ----- assign user DM to next mod -----
async function initiateProofDMAssign(user) {
  try {
    const assignedAccount = getNextModAccount();
    const mod = MODS[assignedAccount];
    await user.send({ embeds: [new EmbedBuilder().setTitle('Kirim Bukti Transfer').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account })] });
    PROOF_TARGET.set(user.id, assignedAccount);
    // record assignment history minimal
    const hist = loadHistory();
    hist.push({ type: 'assigned', userId: user.id, toAccount: assignedAccount, at: new Date().toISOString() });
    saveHistory(hist);
    return { ok: true, assignedAccount };
  } catch(e) {
    console.error('initiateProofDMAssign error', e);
    return { ok: false };
  }
}

// ====== Interaction handler (slash, buttons, modal) ======
client.on('interactionCreate', async (interaction) => {
  try {
    // slash /bypass
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS') // no "(Update)"
        .setDescription('Tombol biru untuk fairness, assignment auto round-robin.')
        .setColor(0x2B6CB0)
        .addFields(...queueStatusFields())
        .setFooter({ text: 'made by @unstoppable_neid' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Primary)
      );

      const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
      BYPASS_EMBEDS.set(reply.id, reply);

      // auto-refresh embed tiap 10 detik; title stays clean
      const interval = setInterval(async () => {
        if (!BYPASS_EMBEDS.has(reply.id)) return clearInterval(interval);
        try {
          const msg = BYPASS_EMBEDS.get(reply.id);
          if (!msg || !msg.editable) return clearInterval(interval);
          const newEmbed = new EmbedBuilder()
            .setTitle('🔥 VOLCANO BYPASS') // no "(Update)"
            .setDescription('Tombol biru untuk fairness, assignment auto round-robin.')
            .setColor(0x2B6CB0)
            .addFields(...queueStatusFields())
            .setFooter({ text: 'made by @unstoppable_neid' })
            .setTimestamp();
          await msg.edit({ embeds: [newEmbed] });
        } catch(e){ console.error('Auto-refresh error', e); clearInterval(interval); }
      }, 10000);

      return;
    }

    // Buttons
    if (interaction.isButton()) {
      const cid = interaction.customId;

      // assign buttons (both do same: fair assign)
      if (cid === 'assign_btn_jojo' || cid === 'assign_btn_whoisnda') {
        const res = await initiateProofDMAssign(interaction.user);
        if (!res.ok) return interaction.reply({ content: 'Gagal mengirim DM — buka DM Anda.', ephemeral: true });
        const assigned = res.assignedAccount;
        const mod = MODS[assigned];

        const emb = new EmbedBuilder()
          .setTitle('Moderator Ditugaskan')
          .setDescription(`Kamu dialokasikan ke moderator ${mod.tag}. Silakan cek DM.`)
          .addFields({ name: 'Moderator', value: mod.tag, inline: true }, { name: 'Nomor Rekening', value: mod.account, inline: true }, ...queueStatusFields())
          .setFooter({ text: 'Jika DM tidak datang, cek privacy.' }).setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('resend_dm').setLabel('Kirim Ulang DM').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('cancel_assign').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [emb], components: [row], ephemeral: true });
      }

      // resend DM (ephemeral) -> resend assignment DM
      if (cid === 'resend_dm') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (!assigned) return interaction.reply({ content: 'Tidak ada assignment aktif. Tekan tombol di /bypass dulu.', ephemeral: true });
        const mod = MODS[assigned];
        try {
          await (await client.users.fetch(interaction.user.id)).send({ embeds: [new EmbedBuilder().setTitle('Kirim Bukti Transfer (Ulang)').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account })] });
          return interaction.reply({ content: 'DM dikirim ulang. Cek DM kamu.', ephemeral: true });
        } catch (e) {
          console.error('resend_dm failed', e);
          return interaction.reply({ content: 'Gagal kirim ulang DM. Periksa pengaturan privacy Anda.', ephemeral: true });
        }
      }

      if (cid === 'cancel_assign') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (assigned) {
          PROOF_TARGET.delete(interaction.user.id);
          decrementModCount(assigned);
        }
        return interaction.reply({ content: 'Assignment dibatalkan.', ephemeral: true });
      }

      // Moderator DM buttons: sendbypass_{userId} and cancel_{userId}
      if (/^(sendbypass|cancel)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');
        // only the moderator who received the forwarded message should be able to act:
        // We'll not strictly check here, but modal will ensure the submitter matches mod id.

        // CANCEL flow: immediately remove buttons and notify user + decrement queue
        if (action === 'cancel') {
          // decrement queue for assigned mod (if pending exists)
          const pending = PENDING.get(userId) || null;
          if (pending && pending.modAccount) decrementModCount(pending.modAccount);
          if (PENDING.has(userId)) PENDING.delete(userId);

          // Update mod's forwarded message to remove buttons & mark canceled
          try {
            await interaction.update({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: interaction.message.embeds });
          } catch (e) {
            console.error('interaction.update cancel failed', e);
            try { await interaction.reply({ content: 'Canceled.', ephemeral: true }); } catch {}
          }

          // DM the original user to notify cancel
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [ new EmbedBuilder().setTitle('Transfer: Canceled ❌').setDescription(`Moderator <@${interaction.user.id}> membatalkan proses. Silakan hubungi moderator untuk info lebih lanjut.`).setTimestamp() ] });
          } catch (e) { console.warn('cannot DM user on cancel', e); }

          // Save history
          const hist = loadHistory();
          hist.push({ type: 'cancel_by_mod', userId, modId: interaction.user.id, at: new Date().toISOString() });
          saveHistory(hist);

          // also try to remove FORWARD_MAP entry
          try { FORWARD_MAP.delete(`${interaction.user.id}_${userId}`); } catch {}
          return;
        }

        // SENDBYPASS flow: show modal (do NOT update or remove buttons here)
        if (action === 'sendbypass') {
          const modal = new ModalBuilder()
            .setCustomId(`modal_bypass_${userId}_${interaction.user.id}`) // modal_bypass_{userId}_{modId}
            .setTitle('Kirim Bypass Code');

          const bypassInput = new TextInputBuilder()
            .setCustomId('bypass_code')
            .setLabel('Masukkan bypass code')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('contoh: ABCD-1234');

          const noteInput = new TextInputBuilder()
            .setCustomId('note')
            .setLabel('Pesan tambahan (opsional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('opsional');

          modal.addComponents({ type: 1, components: [bypassInput] }, { type: 1, components: [noteInput] });

          return interaction.showModal(modal);
        }
      }
    }

    // Modal submit handling for bypass
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_bypass_')) {
      const parts = interaction.customId.split('_');
      // parts: ['modal','bypass','{userId}','{modId}']
      const userId = parts[2];
      const modIdFromModal = parts[3];
      const modClickingId = interaction.user.id;

      // ensure the mod submitting is the same encoded mod
      if (modClickingId !== modIdFromModal) {
        return interaction.reply({ content: 'Anda tidak berwenang mengirim bypass untuk pesan ini.', ephemeral: true });
      }

      const bypassCode = interaction.fields.getTextInputValue('bypass_code').trim();
      const note = interaction.fields.getTextInputValue('note') || '';
      const userMessage = `copy this bypass : ${bypassCode}`;
      const finalMessage = note ? `${userMessage}\n\n${note}` : userMessage;

      // send plain text to original user
      try {
        const user = await client.users.fetch(userId);
        await user.send({ content: finalMessage });

        // now remove buttons from the forwarded message in mod's DM:
        try {
          // find forwarded message id stored earlier
          const forwardMsgId = FORWARD_MAP.get(`${modClickingId}_${userId}`);
          if (forwardMsgId) {
            // fetch mod's DM channel and fetch the message, then edit
            const modUser = await client.users.fetch(modClickingId);
            const dmChan = await modUser.createDM();
            try {
              const fmsg = await dmChan.messages.fetch(forwardMsgId);
              if (fmsg) {
                await fmsg.edit({ content: `Bypass sent by <@${modClickingId}>`, components: [], embeds: fmsg.embeds });
              }
            } catch (e) {
              // fetch may fail if message deleted — ignore
              console.warn('Could not fetch or edit forwarded message to remove buttons', e);
            }
            // cleanup map
            FORWARD_MAP.delete(`${modClickingId}_${userId}`);
          } else {
            // fallback: try to remove components from interaction.message if available
            try { await interaction.message?.edit?.({ components: [] }); } catch {}
          }
        } catch (e) {
          console.warn('Error trying to remove buttons after send bypass', e);
        }

        // decrement queue count for this pending
        const pending = PENDING.get(userId) || null;
        if (pending && pending.modAccount) decrementModCount(pending.modAccount);
        if (PENDING.has(userId)) PENDING.delete(userId);

        // confirm to moderator (modal reply)
        await interaction.reply({ content: 'Bypass code berhasil dikirim ke pengirim bukti.', ephemeral: true });

        // save history
        const hist = loadHistory();
        hist.push({ type: 'reply_bypass', to: userId, fromMod: modClickingId, bypassCode, note, at: new Date().toISOString() });
        saveHistory(hist);

        return;
      } catch (e) {
        console.error('Failed to send bypass DM to user:', e);
        try { await interaction.reply({ content: 'Gagal mengirim bypass ke user (mungkin mereka memblokir DM).', ephemeral: true }); } catch {}
        return;
      }
    }

  } catch (err) {
    console.error('interaction handler error', err);
    try { if (interaction && !interaction.replied) await interaction.reply({ content: 'Terjadi error.', ephemeral: true }); } catch {}
  }
});

// ====== DM listener: user sends proof attachments ======
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    const isDM = message.channel?.type === 1 || message.channel?.type === 'DM';
    if (!isDM) return;

    const userId = message.author.id;
    if (!PROOF_TARGET.has(userId)) {
      return message.reply('Tekan tombol di /bypass dulu untuk dialokasikan ke moderator, lalu kirim file sebagai balasan di DM ini.');
    }

    const modAccount = PROOF_TARGET.get(userId);
    const mod = MODS[modAccount];
    if (!mod) {
      PROOF_TARGET.delete(userId);
      return message.reply('Moderator tidak ditemukan — coba ulang dari server.');
    }

    if (!message.attachments || message.attachments.size === 0) {
      return message.reply('Tidak menemukan attachment. Silakan kirim file (screenshot/foto) sebagai attachment.');
    }

    // Forward to mod (DM only)
    const ok = await forwardProofToMod(message, mod);
    if (!ok) {
      // on failure, decrement count for assigned mod so queue stays accurate
      decrementModCount(modAccount);
    }
  } catch (err) {
    console.error('messageCreate error', err);
    try { if (!message.replied) await message.reply('Terjadi error saat mengirim bukti. Coba lagi.'); } catch {}
  }
});

// ====== login ======
client.login(TOKEN).catch(err => { console.error('Login failed - check TOKEN & intents (Message Content Intent enabled?)', err); });
