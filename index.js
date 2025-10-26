// ===========================================
// index.js — Bypass Bot (final: fair-assign, realtime queue, MODEL 2 price)
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
const MOD1_ID = process.env.MOD1_ID; // jojo
const MOD2_ID = process.env.MOD2_ID; // whoisnda

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !CHANNEL_LOG_ID || !MOD1_ID || !MOD2_ID) {
  console.error('ENV missing: set TOKEN, CLIENT_ID, GUILD_ID, CHANNEL_LOG_ID, MOD1_ID, MOD2_ID');
  process.exit(1);
}

// ====== file paths ======
const HISTORY_FILE = path.join(__dirname, 'history.json');
const QUEUE_FILE = path.join(__dirname, 'queue.json');

function loadHistory(){ try{ return fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')||'[]') : []; } catch(e){ console.error('loadHistory err',e); return []; } }
function saveHistory(arr){ try{ fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2)); } catch(e){ console.error('saveHistory err', e); } }

function loadQueue(){
  try{
    if (!fs.existsSync(QUEUE_FILE)) {
      const init = {
        // use the account numbers as keys (these are the mod bank numbers)
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
function saveQueue(q){ try{ fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)); } catch(e){ console.error('saveQueue err', e); } }

// ====== moderators mapping (unchanged names) ======
// mapping account -> { id: discordId, tag, account }
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

// runtime maps
const PROOF_TARGET = new Map(); // userId -> modAccount
const PENDING = new Map(); // userId -> { modAccount, createdAt, modId }
const BYPASS_EMBEDS = new Map(); // server messageId -> message (for auto-refresh)
const FORWARD_MAP = new Map(); // key `${modId}_${userId}` -> forwardedMessageId

// ====== client setup ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ====== queue helpers (choose least-loaded mod) ======
let QUEUE = loadQueue();
if (!QUEUE) QUEUE = { accounts: ['08170512639','085219498004'], nextIndex: 0, counts: { '08170512639': 0, '085219498004': 0 } };

// return account (bank number) with the smallest queue count (tie -> pick first in accounts order)
function getLeastLoadedModAccount() {
  let best = QUEUE.accounts[0];
  let bestCount = QUEUE.counts[best] || 0;
  for (const acc of QUEUE.accounts) {
    const c = QUEUE.counts[acc] || 0;
    if (c < bestCount) { best = acc; bestCount = c; }
  }
  // increment assigned count immediately to reserve spot
  QUEUE.counts[best] = (QUEUE.counts[best] || 0) + 1;
  saveQueue(QUEUE);
  return best;
}

function decrementModCount(account) {
  if (!account) return;
  QUEUE.counts[account] = Math.max(0, (QUEUE.counts[account] || 0) - 1);
  saveQueue(QUEUE);
}

// build queue fields for embed (MODEL 2: title contains price)
function queueStatusFields() {
  // show whoisnda first as you requested earlier (but reflect real counts)
  const accA = '085219498004'; // whoisnda
  const accB = '08170512639'; // jojo
  return [
    { name: `${MODS[accA].tag}`, value: `${QUEUE.counts[accA] || 0} antrian`, inline: true },
    { name: `${MODS[accB].tag}`, value: `${QUEUE.counts[accB] || 0} antrian`, inline: true },
    { name: 'Next assignment', value: `${(QUEUE.accounts.find(a => (QUEUE.counts[a]||0) === Math.min(...QUEUE.accounts.map(x => QUEUE.counts[x]||0))) === accA) ? MODS[accA].tag : MODS[accB].tag}`, inline: false }
  ];
}

// ====== deploy guild command ======
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

// small sleep helper
function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

// ====== Forward proof to mod (DM) ======
async function forwardProofToMod(message, mod) {
  const userId = message.author.id;

  const forwardEmbed = new EmbedBuilder()
    .setTitle('📎 Bukti Transfer Diterima')
    .setDescription(`User <@${userId}> mengirim bukti untuk rekening **${mod.account}**`)
    .addFields({ name: 'Catatan pengguna', value: message.content ? message.content.slice(0,1024) : '-' })
    .setFooter({ text: `Dikirim oleh ${message.author.tag}` })
    .setTimestamp();

  // Buttons: Send Bypass & Cancel only
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Primary)
  );

  let modUser;
  try {
    modUser = await client.users.fetch(mod.id);
  } catch (e) {
    console.error('fetch mod user error', e);
    try { await message.reply('Gagal DM moderator (fetch).'); } catch {}
    // decrement since assignment failed? We'll decrement in caller after false return
    return false;
  }

  try {
    const sent = await modUser.send({ embeds: [forwardEmbed], components: [row] });
    // store forwarded message id so we can edit/remove buttons after send bypass
    FORWARD_MAP.set(`${mod.id}_${userId}`, sent.id);

    // forward attachments
    for (const [, att] of message.attachments) {
      try { await modUser.send({ content: `File dari <@${userId}>:`, files: [att.url] }); } catch(e){ console.warn('forward attachment err', e); }
    }

    // mark pending (store modAccount and modId)
    PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString(), modId: mod.id });

    // history
    const hist = loadHistory();
    hist.push({ type: 'proof_sent', from: userId, toMod: mod.id, attachments: message.attachments.map(a => ({ url: a.url, name: a.name })), content: message.content || '', at: new Date().toISOString() });
    saveHistory(hist);

    return true;
  } catch (e) {
    console.error('forwardProofToMod error', e);
    try { await message.reply('Gagal meneruskan bukti ke moderator.'); } catch {}
    return false;
  }
}

// ----- assign user DM to least-loaded mod -----
async function initiateProofDMAssign(user) {
  try {
    const assignedAccount = getLeastLoadedModAccount(); // picks least-loaded and increments count
    const mod = MODS[assignedAccount];
    await user.send({ embeds: [ new EmbedBuilder().setTitle('Kirim Bukti Transfer').setDescription(`Bypass Service — Rp. 5.000/hari\n\nKirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
    PROOF_TARGET.set(user.id, assignedAccount);

    // record assignment
    const hist = loadHistory();
    hist.push({ type: 'assigned', userId: user.id, toAccount: assignedAccount, at: new Date().toISOString() });
    saveHistory(hist);

    return { ok: true, assignedAccount };
  } catch (e) {
    console.error('initiateProofDMAssign error', e);
    return { ok: false };
  }
}

// ====== interaction handler ======
client.on('interactionCreate', async (interaction) => {
  try {
    // slash /bypass (server embed) — MODEL 2: title contains price
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('Bypass Service — Rp. 5.000/hari')
        .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator dengan antrian paling sedikit.')
        .setColor(0x2B6CB0)
        .addFields(...queueStatusFields())
        .setFooter({ text: 'made by @unstoppable_neid' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('assign_btn_a').setLabel('Contact Jojo/WhoisNda').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('assign_btn_b').setLabel('Contact Jojo/WhoisNda').setStyle(ButtonStyle.Primary)
      );

      // send and store for auto-refresh
      const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
      BYPASS_EMBEDS.set(reply.id, reply);

      // auto-refresh every 10s to update counts
      const interval = setInterval(async () => {
        if (!BYPASS_EMBEDS.has(reply.id)) return clearInterval(interval);
        try {
          const msg = BYPASS_EMBEDS.get(reply.id);
          if (!msg || !msg.editable) return clearInterval(interval);
          const newEmbed = new EmbedBuilder()
            .setTitle('Bypass Service — Rp. 5.000/hari')
            .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator dengan antrian paling sedikit.')
            .setColor(0x2B6CB0)
            .addFields(...queueStatusFields())
            .setFooter({ text: 'made by @unstoppable_neid' })
            .setTimestamp();
          await msg.edit({ embeds: [newEmbed] });
        } catch(e){ console.error('Auto-refresh error', e); clearInterval(interval); }
      }, 10000);

      return;
    }

    // buttons
    if (interaction.isButton()) {
      const cid = interaction.customId;

      // both assign buttons do same: assign to least-loaded mod
      if (cid === 'assign_btn_a' || cid === 'assign_btn_b') {
        const res = await initiateProofDMAssign(interaction.user);
        if (!res.ok) return interaction.reply({ content: 'Gagal mengirim DM — buka DM Anda.', ephemeral: true });
        const assigned = res.assignedAccount;
        const mod = MODS[assigned];

        const emb = new EmbedBuilder()
          .setTitle('Moderator Ditugaskan')
          .setDescription(`Kamu dialokasikan ke moderator ${mod.tag}. Silakan cek DM.`)
          .addFields({ name: 'Moderator', value: mod.tag, inline: true }, { name: 'Nomor Rekening', value: mod.account, inline: true }, ...queueStatusFields())
          .setFooter({ text: 'Jika DM tidak datang, cek pengaturan privacy Anda.' })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('resend_dm').setLabel('Kirim Ulang DM').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('cancel_assign').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [emb], components: [row], ephemeral: true });
      }

      // resend DM
      if (cid === 'resend_dm') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (!assigned) return interaction.reply({ content: 'Tidak ada assignment aktif. Tekan tombol di /bypass dulu.', ephemeral: true });
        const mod = MODS[assigned];
        try {
          await (await client.users.fetch(interaction.user.id)).send({ embeds: [ new EmbedBuilder().setTitle('Kirim Bukti Transfer (Ulang)').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
          return interaction.reply({ content: 'DM dikirim ulang. Cek DM kamu.', ephemeral: true });
        } catch (e) {
          console.error('resend_dm failed', e);
          return interaction.reply({ content: 'Gagal kirim ulang DM. Periksa pengaturan privacy Anda.', ephemeral: true });
        }
      }

      // cancel_assign
      if (cid === 'cancel_assign') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (assigned) {
          PROOF_TARGET.delete(interaction.user.id);
          decrementModCount(assigned);
        }
        return interaction.reply({ content: 'Assignment dibatalkan.', ephemeral: true });
      }

      // moderator DM buttons: sendbypass_{userId} and cancel_{userId}
      if (/^(sendbypass|cancel)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');

        // CANCEL: immediately remove buttons, notify user, decrement queue
        if (action === 'cancel') {
          const pending = PENDING.get(userId) || null;
          if (pending && pending.modAccount) decrementModCount(pending.modAccount);
          if (PENDING.has(userId)) PENDING.delete(userId);

          // remove buttons on forwarded message (best-effort)
          try {
            const forwardId = FORWARD_MAP.get(`${interaction.user.id}_${userId}`);
            if (forwardId) {
              const modUser = await client.users.fetch(interaction.user.id);
              const dm = await modUser.createDM();
              try {
                const fmsg = await dm.messages.fetch(forwardId);
                if (fmsg) await fmsg.edit({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: fmsg.embeds });
              } catch (e) { /* ignore */ }
              FORWARD_MAP.delete(`${interaction.user.id}_${userId}`);
            } else {
              // fallback: edit interaction.message
              try { await interaction.update({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: interaction.message.embeds }); } catch {}
            }
          } catch (e) { console.warn('cancel: remove forwarded message failed', e); }

          // DM original user
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [ new EmbedBuilder().setTitle('Transfer: Canceled ❌').setDescription(`Moderator <@${interaction.user.id}> membatalkan proses. Silakan hubungi moderator untuk info lebih lanjut.`).setTimestamp() ] });
          } catch (e) { console.warn('cannot DM user on cancel', e); }

          // history
          const hist = loadHistory();
          hist.push({ type: 'cancel_by_mod', userId, modId: interaction.user.id, at: new Date().toISOString() });
          saveHistory(hist);

          return;
        }

        // SENDBYPASS: open modal (do NOT remove buttons now)
        if (action === 'sendbypass') {
          const modal = new ModalBuilder()
            .setCustomId(`modal_bypass_${userId}_${interaction.user.id}`)
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

    // Modal submits: modal_bypass_{userId}_{modId}
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_bypass_')) {
      const parts = interaction.customId.split('_');
      const userId = parts[2];
      const modIdFromModal = parts[3];
      const modClickingId = interaction.user.id;

      // security: ensure modal submitter is same mod encoded
      if (modClickingId !== modIdFromModal) {
        return interaction.reply({ content: 'Anda tidak berwenang mengirim bypass untuk pesan ini.', ephemeral: true });
      }

      const bypassCode = interaction.fields.getTextInputValue('bypass_code').trim();
      const note = interaction.fields.getTextInputValue('note') || '';
      const msgPlain = `copy this bypass : ${bypassCode}`;
      const finalMessage = note ? `${msgPlain}\n\n${note}` : msgPlain;

      // send plain text to original user
      try {
        const user = await client.users.fetch(userId);
        await user.send({ content: finalMessage });

        // now remove buttons from forwarded message in mod's DM (only after successful send)
        try {
          const forwardMsgId = FORWARD_MAP.get(`${modClickingId}_${userId}`);
          if (forwardMsgId) {
            const modUser = await client.users.fetch(modClickingId);
            const dm = await modUser.createDM();
            try {
              const fmsg = await dm.messages.fetch(forwardMsgId);
              if (fmsg) await fmsg.edit({ content: `Bypass sent by <@${modClickingId}>`, components: [], embeds: fmsg.embeds });
            } catch (e) {
              console.warn('Could not fetch/edit forwarded message', e);
            }
            FORWARD_MAP.delete(`${modClickingId}_${userId}`);
          } else {
            // fallback: edit current interaction.message
            try { await interaction.message?.edit?.({ components: [] }); } catch {}
          }
        } catch (e) { console.warn('Error removing buttons after send', e); }

        // decrement assigned queue count
        const pending = PENDING.get(userId) || null;
        if (pending && pending.modAccount) decrementModCount(pending.modAccount);
        if (PENDING.has(userId)) PENDING.delete(userId);

        // confirm to moderator
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
      // if forward failed, decrement the c
