// ===========================================
// Bypass Bot — Full + Queue (copy-paste ready)
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
  console.error('ENV missing: TOKEN, CLIENT_ID, GUILD_ID, CHANNEL_LOG_ID, MOD1_ID, MOD2_ID');
  process.exit(1);
}

// ====== files ======
const HISTORY_FILE = path.join(__dirname, 'history.json');
const QUEUE_FILE = path.join(__dirname, 'queue.json');

function loadHistory(){ try{ return fs.existsSync(HISTORY_FILE)? JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')||'[]') : []; } catch(e){ console.error('loadHistory err',e); return []; } }
function saveHistory(arr){ try{ fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2)) } catch(e){ console.error('saveHistory err', e); } }

function loadQueue(){
  try{
    if (!fs.existsSync(QUEUE_FILE)) {
      // initialize: round-robin between two accounts
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
const PENDING = new Map(); // userId -> { modAccount, amount?, reference?, createdAt }

// ====== client ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ====== queue helpers ======
let QUEUE = loadQueue();
if (!QUEUE) QUEUE = { accounts: ['08170512639','085219498004'], nextIndex: 0, counts: { '08170512639': 0, '085219498004': 0 } };

function getNextModAccount() {
  // round-robin using nextIndex
  const acc = QUEUE.accounts[QUEUE.nextIndex % QUEUE.accounts.length];
  // advance nextIndex
  QUEUE.nextIndex = (QUEUE.nextIndex + 1) % QUEUE.accounts.length;
  // increment count for that account
  QUEUE.counts[acc] = (QUEUE.counts[acc] || 0) + 1;
  saveQueue(QUEUE);
  return acc;
}

function decrementModCount(account) {
  if (!account) return;
  QUEUE.counts[account] = Math.max(0, (QUEUE.counts[account] || 0) - 1);
  saveQueue(QUEUE);
}

// Format queue status for embed fields
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
    const commands = [
      { name: 'bypass', description: 'Tampilkan panel bypass' }
    ];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands deployed to guild', GUILD_ID);
  } catch(e){ console.error('deployCommands err', e); }
}

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

// small sleep helper
function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }

// ----- forward proof to mod (DM only, retry) -----
async function forwardProofToModNoChannel(message, mod) {
  const userId = message.author.id;
  console.log(`[forward] start from ${userId} -> modAccount ${mod.account} (modId ${mod.id})`);

  if (!mod.id) {
    console.error('[forward] missing mod.id for', mod);
    try { await message.reply('Internal error: moderator ID tidak dikonfigurasi. Hubungi admin.'); } catch {}
    return false;
  }

  const forwardEmbed = new EmbedBuilder()
    .setTitle('📎 Bukti Transfer Diterima')
    .setDescription(`User <@${userId}> mengirim bukti untuk rekening **${mod.account}**`)
    .addFields({ name: 'Catatan pengguna', value: message.content ? message.content.slice(0,1024) : '-' })
    .setFooter({ text: `Dikirim oleh ${message.author.tag}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`done_${userId}`).setLabel('Done ✅').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`error_${userId}`).setLabel('Error ⚠️').setStyle(ButtonStyle.Primary)
  );

  // fetch mod user
  let modUser;
  try{
    modUser = await client.users.fetch(mod.id);
    if(!modUser) throw new Error('fetch returned null');
  } catch(fetchErr){
    console.error('[forward] fetch mod user failed:', fetchErr);
    try{ await message.reply('Gagal mengirim bukti: moderator tidak dapat ditemukan. Hubungi moderator langsung.'); } catch {}
    return false;
  }

  // Try DM
  let lastErr = null;
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[forward] attempt ${attempt} -> sending embed to mod ${mod.id}`);
      const sentMsg = await modUser.send({ embeds: [forwardEmbed], components: [row] });

      // forward attachments as files
      for (const [, att] of message.attachments) {
        try { await modUser.send({ content: `File dari <@${userId}>:`, files: [att.url] }); }
        catch(attErr){ console.error('[forward] attachment send failed', attErr); }
      }

      console.log('[forward] success -> DM sent to mod', mod.id);
      try{ await message.reply('Bukti berhasil dikirim ke moderator. Tunggu konfirmasi mereka.'); } catch {}

      // set pending record to track assigned mod for later decrement
      PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString() });

      // decrease nothing here (we incremented when assigned)
      // save history
      const hist = loadHistory();
      hist.push({ type: 'proof_sent', from: userId, toMod: mod.id, attachments: message.attachments.map(a=>({ url: a.url, name: a.name })), content: message.content || '', at: new Date().toISOString() });
      saveHistory(hist);

      return true;
    } catch (dmErr) {
      lastErr = dmErr;
      console.error(`[forward] attempt ${attempt} failed to DM mod ${mod.id}:`, dmErr);
      // DM blocked?
      if (dmErr?.code === 50007 || (dmErr.message && dmErr.message.toLowerCase().includes('cannot send messages to this user'))) {
        console.error('[forward] detected DM blocked or forbidden. Aborting retries.');
        break;
      }
      await sleep(700 * attempt);
    }
  }

  console.error('[forward] all attempts failed. last error:', lastErr);
  try{ await message.reply('Gagal meneruskan bukti ke moderator via DM. Mohon hubungi moderator secara langsung.'); } catch {}
  // if failure, decrement count because we incremented at assignment stage (we will decrement assigned count here)
  // NOTE: we cannot know assigned account here unless we check PROOF_TARGET mapping; but assignment increments count when assigning.
  return false;
}

// ----- initiate proof DM to user and assign mod by queue -----
async function initiateProofDMAssign(user) {
  try {
    // pick next mod via queue
    const assignedAccount = getNextModAccount(); // this increments count and advances nextIndex
    const mod = MODS[assignedAccount];
    if (!mod) {
      console.error('initiateProofDMAssign: mod not found for account', assignedAccount);
      return false;
    }

    const dmEmbed = new EmbedBuilder()
      .setTitle('Kirim Bukti Transfer')
      .setDescription(`Kirim bukti (screenshot/foto/file) sebagai balasan pada pesan ini. Bukti akan diteruskan ke moderator ${mod.tag}.`)
      .addFields({ name: 'Rekening Tujuan', value: mod.account, inline: true })
      .setFooter({ text: 'Hanya kirim bukti transfer (screenshot).' })
      .setTimestamp();

    await user.send({ embeds: [dmEmbed] });

    // store mapping: user -> assigned mod account
    PROOF_TARGET.set(user.id, assignedAccount);

    return { ok: true, assignedAccount };
  } catch (e) {
    console.error('initiateProofDMAssign error', e);
    return { ok: false };
  }
}

// ====== Interaction handler: slash, buttons, modals ======
client.on('interactionCreate', async (interaction) => {
  try {
    // slash /bypass -> embed shows queue status and two blue buttons
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS')
        .setDescription('Tombol berwarna biru untuk fairness — meskipun kamu klik kiri/kanan, bot akan assign ke moderator berikutnya secara bergantian.')
        .setColor(0x2B6CB0) // blue-ish
        .addFields(...queueStatusFields())
        .setTimestamp()
        .setFooter({ text: 'made by @unstoppable_neid' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Primary)
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // Button handling
    if (interaction.isButton()) {
      const cid = interaction.customId;

      // Both assign buttons do the same: assign next mod fairly
      if (cid === 'assign_btn_jojo' || cid === 'assign_btn_whoisnda') {
        // assign via queue
        const res = await initiateProofDMAssign(interaction.user);
        if (!res.ok) {
          return interaction.reply({ content: 'Gagal mengirim DM. Pastikan DM Anda terbuka.', ephemeral: true });
        }

        const assigned = res.assignedAccount;
        const mod = MODS[assigned];
        // reply ephemeral with assigned mod info and Kirim Bukti button (so user can press it again if needed)
        const emb = new EmbedBuilder()
          .setTitle('Moderator Ditugaskan')
          .setDescription(`Kamu dialokasikan ke moderator ${mod.tag}. Silakan cek DM dan kirim bukti sebagai balasan pada DM yang diterima.`)
          .addFields({ name: 'Moderator', value: mod.tag, inline: true }, { name: 'Nomor Rekening', value: mod.account, inline: true })
          .setFooter({ text: 'Jika DM tidak datang, cek pengaturan privacy Anda.' })
          .setTimestamp();

        // ephemeral buttons: optionally let them re-request DM or cancel
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('resend_dm').setLabel('Kirim Ulang DM').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('cancel_assign').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );

        // Save assignment also in history (basic)
        const hist = loadHistory();
        hist.push({ type: 'assigned', userId: interaction.user.id, toAccount: assigned, at: new Date().toISOString() });
        saveHistory(hist);

        return interaction.reply({ embeds: [emb], components: [row], ephemeral: true });
      }

      // ephemeral re-send DM button
      if (cid === 'resend_dm') {
        const mapping = await (async () => {
          // get last assigned mapping from PROOF_TARGET
          // If not exist, instruct to press main buttons
          return PROOF_TARGET.get(interaction.user.id) || null;
        })();
        if (!mapping) return interaction.reply({ content: 'Tidak ada assignment sebelumnya. Tekan tombol di /bypass terlebih dahulu.', ephemeral: true });
        const mod = MODS[mapping];
        if (!mod) return interaction.reply({ content: 'Moderator tidak ditemukan.', ephemeral: true });
        try {
          await (await client.users.fetch(interaction.user.id)).send({ embeds: [ new EmbedBuilder().setTitle('Kirim Bukti Transfer (Ulang)').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
          return interaction.reply({ content: 'DM dikirim ulang. Cek DM kamu.', ephemeral: true });
        } catch (e) {
          console.error('resend_dm failed', e);
          return interaction.reply({ content: 'Gagal mengirim DM ulang. Periksa pengaturan privacy Anda.', ephemeral: true });
        }
      }

      if (cid === 'cancel_assign') {
        // user cancels their assignment — remove mapping and decrement count
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (assigned) {
          PROOF_TARGET.delete(interaction.user.id);
          decrementModCount(assigned);
        }
        return interaction.reply({ content: 'Assignment dibatalkan.', ephemeral: true });
      }

      // Moderator buttons that appear in mod DM to process proof
      if (/^(sendbypass|done|cancel|error)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');

        // sendbypass -> modal (encode mod id)
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

        // done/cancel/error -> post status to user and decrement queue count
        if (['done','cancel','error'].includes(action)) {
          const emoji = action === 'done' ? '✅' : (action === 'cancel' ? '❌' : '⚠️');

          // fetch pending to find assigned account and decrement
          const pending = PENDING.get(userId) || null;
          if (pending && pending.modAccount) decrementModCount(pending.modAccount);
          if (PENDING.has(userId)) PENDING.delete(userId);

          try {
            const user = await client.users.fetch(userId);
            // DM user the status
            try { await user.send({ embeds: [ new EmbedBuilder().setTitle(`Status Transfer: ${action.toUpperCase()} ${emoji}`).setDescription(`Moderator <@${interaction.user.id}> menandai transaksimu sebagai **${action.toUpperCase()}**.`).setTimestamp() ] }); }
            catch (e) { console.warn('Cannot DM user for status', userId, e); }

            // update mod message
            try { await interaction.update({ content: `Status ${action.toUpperCase()} dikonfirmasi.`, embeds: [], components: [] }); } catch { try{ await interaction.reply({ content: `Status ${action.toUpperCase()} dikonfirmasi.`, ephemeral: true }) } catch {} }

            // save history
            const hist = loadHistory();
            hist.push({ type: 'status', userId, action, modId: interaction.user.id, at: new Date().toISOString() });
            saveHistory(hist);
          } catch (e) {
            console.error('status handling error', e);
            try { await interaction.reply({ content: 'Gagal memproses status.', ephemeral: true }); } catch {}
          }
          return;
        }

      } // end moderator button regex

    } // end interaction.isButton()

    // Modal submits: modal_bypass_{userId}_{modId}
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_bypass_')) {
      const parts = interaction.customId.split('_');
      const userId = parts[2];
      const modIdFromModal = parts[3];
      const modClickingId = interaction.user.id;

      if (modClickingId !== modIdFromModal) {
        return interaction.reply({ content: 'Anda tidak berwenang mengirim bypass untuk pesan ini.', ephemeral: true });
      }

      const bypassCode = interaction.fields.getTextInputValue('bypass_code').trim();
      const note = interaction.fields.getTextInputValue('note') || '';

      const userMessage = `copy this bypass : ${bypassCode}`;
      const finalMessage = note ? `${userMessage}\n\n${note}` : userMessage;

      try {
        const user = await client.users.fetch(userId);
        await user.send({ content: finalMessage });

        // Confirm to moderator
        await interaction.reply({ content: 'Bypass code berhasil dikirim ke pengirim bukti.', ephemeral: true });

        // Save history
        const hist = loadHistory();
        hist.push({ type: 'reply_bypass', to: userId, fromMod: modClickingId, bypassCode, note, at: new Date().toISOString() });
        saveHistory(hist);

        // After sending bypass, decrement assigned count (mod handled)
        const pending = PENDING.get(userId) || null;
        if (pending && pending.modAccount) decrementModCount(pending.modAccount);
        if (PENDING.has(userId)) PENDING.delete(userId);

        // Try disable buttons on the forwarded message (best-effort)
        try { await interaction.message?.edit?.({ components: [] }); } catch {}

      } catch (e) {
        console.error('Failed to send bypass DM to user:', e);
        try { await interaction.reply({ content: 'Gagal mengirim bypass ke user (mungkin mereka memblokir DM).', ephemeral: true }); } catch {}
      }
      return;
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
      return message.reply('Tekan tombol di `/bypass` dulu (Contact Jojo/WhoisNda) untuk dialokasikan ke moderator, lalu kirim file sebagai balasan di DM ini.');
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
    const ok = await forwardProo
