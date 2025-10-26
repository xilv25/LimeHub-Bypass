// ===========================================
// index.js — Final FULL: Rp.3.000, offline/on/off, Already Paid 24h
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
const PAID_FILE = path.join(__dirname, 'paid.json'); // stores paid users: { userId: { modAccount, ts } }

function loadJsonSafe(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return JSON.parse(fs.readFileSync(fp,'utf8')||'{}');
  } catch(e) {
    console.error('loadJsonSafe error', e);
    return fallback;
  }
}
function saveJsonSafe(fp, obj) {
  try { fs.writeFileSync(fp, JSON.stringify(obj, null, 2)); } catch(e) { console.error('saveJsonSafe err', e); }
}

function loadHistory(){ return loadJsonSafe(HISTORY_FILE, []); }
function saveHistory(arr){ saveJsonSafe(HISTORY_FILE, arr); }

function loadQueue(){ return loadJsonSafe(QUEUE_FILE, { accounts: ['08170512639','085219498004'], nextIndex:0, counts: {'08170512639':0,'085219498004':0} }); }
function saveQueue(q){ saveJsonSafe(QUEUE_FILE, q); }

function loadPaid(){ return loadJsonSafe(PAID_FILE, {}); }
function savePaid(obj){ saveJsonSafe(PAID_FILE, obj); }

// ====== moderators mapping (fixed names) ======
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },      // jojo
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }   // whoisnda
};

// reverse map: discordId -> account (bank number)
const MOD_ID_TO_ACCOUNT = {};
for (const acc of Object.keys(MODS)) MOD_ID_TO_ACCOUNT[MODS[acc].id] = acc;

// runtime maps
const PROOF_TARGET = new Map(); // userId -> modAccount
const PENDING = new Map(); // userId -> { modAccount, createdAt, modId }
const BYPASS_EMBEDS = new Map(); // server messageId -> message
const FORWARD_MAP = new Map(); // key `${modId}_${userId}` -> forwardedMessageId

// load data
let QUEUE = loadQueue();
let PAID_USERS = loadPaid(); // { userId: { modAccount, ts: epoch_ms } }

// ONLINE status for accounts (true = available). default true
let ONLINE = {};
for (const acc of Object.keys(MODS)) ONLINE[acc] = true;

// ====== client setup ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// helper: save queue/pending/paid
function persistQueue(){ saveQueue(QUEUE); }
function persistPaid(){ savePaid(PAID_USERS); }

// small sleep
function sleep(ms){ return new Promise(res=>setTimeout(res, ms)); }

// ====== paid logic ======
const PAID_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function markUserPaid(userId, modAccount) {
  PAID_USERS[userId] = { modAccount, ts: Date.now() };
  persistPaid();
}

function getPaidInfo(userId) {
  const rec = PAID_USERS[userId];
  if (!rec) return null;
  if ((Date.now() - (rec.ts || 0)) > PAID_TTL_MS) {
    delete PAID_USERS[userId];
    persistPaid();
    return null;
  }
  return rec; // { modAccount, ts }
}

// ====== queue helpers ======
if (!QUEUE || !QUEUE.accounts) {
  QUEUE = { accounts: ['08170512639','085219498004'], nextIndex:0, counts: {'08170512639':0,'085219498004':0} };
  persistQueue();
}

// choose least-loaded among ONLINE mods
function getLeastLoadedOnlineAccount() {
  const onlineAccounts = QUEUE.accounts.filter(a => ONLINE[a]);
  if (onlineAccounts.length === 0) return null;
  let best = onlineAccounts[0];
  let bestCount = QUEUE.counts[best] || 0;
  for (const acc of onlineAccounts) {
    const c = QUEUE.counts[acc] || 0;
    if (c < bestCount) { best = acc; bestCount = c; }
  }
  // reserve spot
  QUEUE.counts[best] = (QUEUE.counts[best] || 0) + 1;
  persistQueue();
  return best;
}

function decrementModCount(account) {
  if (!account) return;
  QUEUE.counts[account] = Math.max(0, (QUEUE.counts[account] || 0) - 1);
  persistQueue();
}

// build queue fields for embed (MODEL 2, show whoisnda first then jojo)
function queueStatusFields() {
  const accA = '085219498004'; // whoisnda
  const accB = '08170512639'; // jojo
  // determine next display: choose least-loaded online
  const online = QUEUE.accounts.filter(a => ONLINE[a]);
  const nextTag = (() => {
    if (online.length === 0) return 'No moderators online';
    let best = online[0], bestCount = QUEUE.counts[best]||0;
    for (const a of online) { const c = QUEUE.counts[a]||0; if (c < bestCount) { best = a; bestCount = c; } }
    return MODS[best].tag;
  })();
  let offlineNotes = [];
  if (!ONLINE[accB]) offlineNotes.push(`${MODS[accB].tag.replace('@','')} is offline, try contacting ${MODS[accA].tag.replace('@','')}`);
  if (!ONLINE[accA]) offlineNotes.push(`${MODS[accA].tag.replace('@','')} is offline, try contacting ${MODS[accB].tag.replace('@','')}`);
  return [
    { name: `${MODS[accA].tag}`, value: `${QUEUE.counts[accA] || 0} antrian${!ONLINE[accA] ? ' (OFFLINE)' : ''}`, inline: true },
    { name: `${MODS[accB].tag}`, value: `${QUEUE.counts[accB] || 0} antrian${!ONLINE[accB] ? ' (OFFLINE)' : ''}`, inline: true },
    { name: 'Next assignment', value: `${nextTag}`, inline: false },
    ...(offlineNotes.length ? [{ name: 'Notices', value: offlineNotes.join('\n'), inline: false }] : [])
  ];
}

// ====== deploy guild command (only /bypass) ======
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

// refresh all stored /bypass embeds (used when ONLINE or counts change)
async function refreshAllBypassEmbeds() {
  for (const [msgId, msg] of BYPASS_EMBEDS.entries()) {
    try {
      const newEmbed = new EmbedBuilder()
        .setTitle('Bypass Service — Rp. 3.000/hari')
        .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator yang online dan dengan antrian paling sedikit.')
        .setColor(0x2B6CB0)
        .addFields(...queueStatusFields())
        .setFooter({ text: 'made by @unstoppable_neid' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['08170512639']),
        new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['085219498004']),
        new ButtonBuilder().setCustomId('already_paid').setLabel('Already Paid ✅').setStyle(ButtonStyle.Success)
      );

      if (msg && msg.editable) {
        await msg.edit({ embeds: [newEmbed], components: [row] });
      } else {
        // try fetch and edit; if fail, remove from map
        try {
          const channel = msg.channel;
          if (channel && channel.messages) {
            const fetched = await channel.messages.fetch(msgId).catch(()=>null);
            if (fetched && fetched.editable) await fetched.edit({ embeds: [newEmbed], components: [row] });
            else BYPASS_EMBEDS.delete(msgId);
          } else {
            BYPASS_EMBEDS.delete(msgId);
          }
        } catch(e) {
          BYPASS_EMBEDS.delete(msgId);
        }
      }
    } catch(e){
      console.error('refreshAllBypassEmbeds err', e);
      BYPASS_EMBEDS.delete(msgId);
    }
  }
}

// ====== Forward "request" to mod (for proofs or already-paid requests) ======
async function forwardRequestToMod(userId, mod) {
  // send embed to mod notifying user requests contact (no proof required if this is already-paid path)
  const forwardEmbed = new EmbedBuilder()
    .setTitle('📩 Support Request (Paid User)')
    .setDescription(`User <@${userId}> requests support (paid).`)
    .addFields({ name: 'User', value: `<@${userId}>`, inline: true }, { name:'Rekening tujuan', value: mod.account, inline: true })
    .setFooter({ text: 'Click Send Bypass to deliver bypass, or Cancel to decline.' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Primary)
  );

  let modUser;
  try {
    modUser = await client.users.fetch(mod.id);
  } catch (e) {
    console.error('forwardRequestToMod fetch mod error', e);
    return false;
  }

  try {
    const sent = await modUser.send({ embeds: [forwardEmbed], components: [row] });
    FORWARD_MAP.set(`${mod.id}_${userId}`, sent.id);
    // mark pending
    PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString(), modId: mod.id });
    // log
    const hist = loadHistory();
    hist.push({ type: 'paid_request_forwarded', userId, toMod: mod.id, at: new Date().toISOString() });
    saveHistory(hist);
    return true;
  } catch (e) {
    console.error('forwardRequestToMod error', e);
    return false;
  }
}

// ====== assign user DM to least-loaded ONLINE mod (regular flow) ======
async function initiateProofDMAssign(user) {
  try {
    const assignedAccount = getLeastLoadedOnlineAccount();
    if (!assignedAccount) return { ok:false, reason:'No moderators online' };
    const mod = MODS[assignedAccount];
    await user.send({ embeds: [ new EmbedBuilder().setTitle('Bypass Service — Rp. 3.000/hari').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
    PROOF_TARGET.set(user.id, assignedAccount);
    const hist = loadHistory();
    hist.push({ type: 'assigned', userId: user.id, toAccount: assignedAccount, at: new Date().toISOString() });
    saveHistory(hist);
    refreshAllBypassEmbeds().catch(()=>{});
    return { ok:true, assignedAccount };
  } catch (e) {
    console.error('initiateProofDMAssign error', e);
    return { ok:false };
  }
}

// ====== interaction handler ======
client.on('interactionCreate', async (interaction) => {
  try {
    // slash /bypass
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('Bypass Service — Rp. 3.000/hari')
        .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator yang online dan dengan antrian paling sedikit.')
        .setColor(0x2B6CB0)
        .addFields(...queueStatusFields())
        .setFooter({ text: 'made by @unstoppable_neid' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['08170512639']),
        new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['085219498004']),
        new ButtonBuilder().setCustomId('already_paid').setLabel('Already Paid ✅').setStyle(ButtonStyle.Success)
      );

      const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
      BYPASS_EMBEDS.set(reply.id, reply);

      // auto-refresh every 10s
      const interval = setInterval(async () => {
        if (!BYPASS_EMBEDS.has(reply.id)) return clearInterval(interval);
        try {
          const msg = BYPASS_EMBEDS.get(reply.id);
          if (!msg || !msg.editable) return clearInterval(interval);
          const newEmbed = new EmbedBuilder()
            .setTitle('Bypass Service — Rp. 3.000/hari')
            .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator yang online dan dengan antrian paling sedikit.')
            .setColor(0x2B6CB0)
            .addFields(...queueStatusFields())
            .setFooter({ text: 'made by @unstoppable_neid' })
            .setTimestamp();
          const newRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['08170512639']),
            new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['085219498004']),
            new ButtonBuilder().setCustomId('already_paid').setLabel('Already Paid ✅').setStyle(ButtonStyle.Success)
          );
          await msg.edit({ embeds: [newEmbed], components: [newRow] });
        } catch(e){ console.error('Auto-refresh error', e); clearInterval(interval); }
      }, 10000);

      return;
    }

    // Button interactions
    if (interaction.isButton()) {
      const cid = interaction.customId;

      // assign buttons: both trigger same assign flow (auto-assign to least-loaded online mod)
      if (cid === 'assign_btn_jojo' || cid === 'assign_btn_whoisnda') {
        const res = await initiateProofDMAssign(interaction.user);
        if (!res.ok) return interaction.reply({ content: res.reason || 'Gagal mengirim DM — buka DM Anda.', ephemeral: true });
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

      // Already Paid button
      if (cid === 'already_paid') {
        const userId = interaction.user.id;
        const paid = getPaidInfo(userId);
        if (!paid) {
          return interaction.reply({ content: '❌ Kamu belum membayar hari ini. Silakan pilih mod terlebih dahulu.', ephemeral: true });
        }
        // has paid: try to route to the same mod who gave bypass before (if online), else auto-assign to least-loaded online
        const preferred = paid.modAccount;
        let targetAccount = null;
        if (ONLINE[preferred]) {
          // route to preferred mod: forward a paid-request
          targetAccount = preferred;
        } else {
          // preferred offline -> assign least-loaded online
          const alt = getLeastLoadedOnlineAccount();
          if (!alt) return interaction.reply({ content: 'Saat ini tidak ada moderator online. Coba lagi nanti.', ephemeral: true });
          targetAccount = alt;
        }

        const mod = MODS[targetAccount];
        // forward a "paid request" to mod
        const ok = await forwardRequestToMod(userId, mod);
        if (!ok) {
          // if forward failed, attempt to decrement reserved spot if we reserved earlier (getLeastLoadedOnlineAccount reserved)
          // but forwardRequestToMod didn't increment queue — we increment only when getLeast... so safe
          return interaction.reply({ content: 'Gagal menghubungi moderator. Silakan coba lagi.', ephemeral: true });
        }

        // reply to user ephemeral that request sent
        await interaction.reply({ content: `Permintaan dikirim ke ${mod.tag}. Tunggu respon mereka di DM.`, ephemeral: true });
        refreshAllBypassEmbeds().catch(()=>{});
        return;
      }

      // resend_dm
      if (cid === 'resend_dm') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (!assigned) return interaction.reply({ content: 'Tidak ada assignment aktif. Tekan tombol di /bypass dulu.', ephemeral: true });
        const mod = MODS[assigned];
        try {
          await (await client.users.fetch(interaction.user.id)).send({ embeds: [ new EmbedBuilder().setTitle('Bypass Service — Rp. 3.000/hari').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
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
          refreshAllBypassEmbeds().catch(()=>{});
        }
        return interaction.reply({ content: 'Assignment dibatalkan.', ephemeral: true });
      }

      // moderator DM buttons: sendbypass_{userId} and cancel_{userId}
      if (/^(sendbypass|cancel)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');

        // CANCEL flow
        if (action === 'cancel') {
          const pending = PENDING.get(userId) || null;
          if (pending && pending.modAccount) decrementModCount(pending.modAccount);
          if (PENDING.has(userId)) PENDING.delete(userId);

          // remove buttons on forwarded message if possible
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
              try { await interaction.update({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: interaction.message.embeds }); } catch {}
            }
          } catch (e) { console.warn('cancel: remove forwarded message failed', e); }

          // DM original user
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [ new EmbedBuilder().setTitle('Transfer: Canceled ❌').setDescription(`Moderator <@${interaction.user.id}> membatalkan proses. Silakan hubungi moderator untuk info lebih lanjut.`).setTimestamp() ] });
          } catch (e) { console.warn('cannot DM user 
