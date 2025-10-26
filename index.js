// ===========================================
// index.js — FINAL BUILD
// Private-only flow: /bypass, Already Paid, DM bot -> forward to mod DM,
// mod DM has SEND BYPASS + CANCEL, mod /off & /on via DM.
// ===========================================
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  Partials, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType
} = require('discord.js');
require('dotenv').config();

// ===== Replit / Env required =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const MOD1_ID = process.env.MOD1_ID; // jojo
const MOD2_ID = process.env.MOD2_ID; // whoisnda

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !MOD1_ID || !MOD2_ID) {
  console.error('ENV missing: set TOKEN, CLIENT_ID, GUILD_ID, MOD1_ID, MOD2_ID');
  process.exit(1);
}

// ===== file persistence =====
const DATA_DIR = __dirname;
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const PAID_FILE = path.join(DATA_DIR, 'paid.json');

function loadJsonSafe(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    return JSON.parse(fs.readFileSync(fp, 'utf8') || JSON.stringify(fallback));
  } catch (e) {
    console.error('loadJsonSafe error', e);
    return fallback;
  }
}
function saveJsonSafe(fp, obj) {
  try { fs.writeFileSync(fp, JSON.stringify(obj, null, 2)); } catch (e) { console.error('saveJsonSafe err', e); }
}
function loadHistory(){ return loadJsonSafe(HISTORY_FILE, []); }
function saveHistory(h){ saveJsonSafe(HISTORY_FILE, h); }
function loadQueue(){ return loadJsonSafe(QUEUE_FILE, { accounts: ['08170512639','085219498004'], counts: {'08170512639':0,'085219498004':0} }); }
function saveQueue(q){ saveJsonSafe(QUEUE_FILE, q); }
function loadPaid(){ return loadJsonSafe(PAID_FILE, {}); }
function savePaid(p){ saveJsonSafe(PAID_FILE, p); }

// ===== moderators mapping (fixed) =====
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },      // jojo
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }   // whoisnda
};
// reverse map discordId -> account
const MOD_ID_TO_ACCOUNT = {};
for (const acc of Object.keys(MODS)) MOD_ID_TO_ACCOUNT[MODS[acc].id] = acc;

// runtime maps
const PROOF_TARGET = new Map(); // userId -> modAccount (reserved assignment)
const PENDING = new Map(); // userId -> { modAccount, createdAt, modId }
const BYPASS_EMBEDS = new Map(); // messageId -> message (server embeds to refresh)
const FORWARD_MAP = new Map(); // `${modId}_${userId}` -> forwardedMessageId

// load persistent data
let QUEUE = loadQueue();
let PAID_USERS = loadPaid(); // { userId: { modAccount, ts } }

// default online status
let ONLINE = {};
for (const acc of Object.keys(MODS)) ONLINE[acc] = true;

// ===== client =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// helpers
const PAID_TTL_MS = 24 * 60 * 60 * 1000;

function markUserPaid(userId, modAccount) {
  PAID_USERS[userId] = { modAccount, ts: Date.now() };
  savePaid(PAID_USERS);
}
function getPaidInfo(userId) {
  const rec = PAID_USERS[userId];
  if (!rec) return null;
  if (Date.now() - (rec.ts || 0) > PAID_TTL_MS) {
    delete PAID_USERS[userId];
    savePaid(PAID_USERS);
    return null;
  }
  return rec;
}

// queue helpers
if (!QUEUE || !QUEUE.accounts) {
  QUEUE = { accounts: ['08170512639','085219498004'], counts: {'08170512639':0,'085219498004':0} };
  saveQueue(QUEUE);
}

function getLeastLoadedOnlineAccount() {
  const online = QUEUE.accounts.filter(a => ONLINE[a]);
  if (online.length === 0) return null;
  let best = online[0];
  let bestCount = QUEUE.counts[best] || 0;
  for (const a of online) {
    const c = QUEUE.counts[a] || 0;
    if (c < bestCount) { best = a; bestCount = c; }
  }
  QUEUE.counts[best] = (QUEUE.counts[best] || 0) + 1; // reserve spot
  saveQueue(QUEUE);
  return best;
}
function decrementModCount(acc) {
  if (!acc) return;
  QUEUE.counts[acc] = Math.max(0, (QUEUE.counts[acc] || 0) - 1);
  saveQueue(QUEUE);
}

// embed fields
function queueStatusFields() {
  const who = '085219498004'; // whoisnda
  const jo = '08170512639';   // jojo
  // next assignment display
  const online = QUEUE.accounts.filter(a => ONLINE[a]);
  let nextTag = 'No moderators online';
  if (online.length) {
    let b = online[0], bc = QUEUE.counts[b]||0;
    for (const a of online) { const c = QUEUE.counts[a]||0; if (c < bc) { b = a; bc = c; } }
    nextTag = MODS[b].tag;
  }
  let notices = [];
  if (!ONLINE[jo]) notices.push(`${MODS[jo].tag.replace('@','')} is offline, try contacting ${MODS[who].tag.replace('@','')}`);
  if (!ONLINE[who]) notices.push(`${MODS[who].tag.replace('@','')} is offline, try contacting ${MODS[jo].tag.replace('@','')}`);
  return [
    { name: `${MODS[who].tag}`, value: `${QUEUE.counts[who] || 0} antrian${!ONLINE[who] ? ' (OFFLINE)' : ''}`, inline: true },
    { name: `${MODS[jo].tag}`, value: `${QUEUE.counts[jo] || 0} antrian${!ONLINE[jo] ? ' (OFFLINE)' : ''}`, inline: true },
    { name: 'Next assignment', value: `${nextTag}`, inline: false },
    ...(notices.length ? [{ name: 'Notices', value: notices.join('\n'), inline: false }] : [])
  ];
}

// deploy slash command
async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = [{ name: 'bypass', description: 'Tampilkan panel bypass' }];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands deployed');
  } catch (e) { console.error('deployCommands err', e); }
}

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

// refresh server embeds (no server logging anywhere)
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
        try {
          const channel = msg.channel;
          if (channel && channel.messages) {
            const fetched = await channel.messages.fetch(msgId).catch(()=>null);
            if (fetched && fetched.editable) await fetched.edit({ embeds: [newEmbed], components: [row] });
            else BYPASS_EMBEDS.delete(msgId);
          } else BYPASS_EMBEDS.delete(msgId);
        } catch (e) { BYPASS_EMBEDS.delete(msgId); }
      }
    } catch (e) {
      BYPASS_EMBEDS.delete(msgId);
    }
  }
}

// forward a request (paid or proof) to mod DM; mod receives embed with two buttons: SEND BYPASS & CANCEL
async function forwardRequestToMod(userId, mod, titleSuffix = '') {
  const forwardEmbed = new EmbedBuilder()
    .setTitle(`📩 Support Request ${titleSuffix}`.trim())
    .setDescription(`User <@${userId}> requests support.`)
    .addFields({ name: 'User', value: `<@${userId}>`, inline: true }, { name: 'Rekening tujuan', value: mod.account, inline: true })
    .setFooter({ text: 'Click Send Bypass to deliver bypass, or Cancel to decline.' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
  );

  try {
    const modUser = await client.users.fetch(mod.id);
    const sent = await modUser.send({ embeds: [forwardEmbed], components: [row] });
    FORWARD_MAP.set(`${mod.id}_${userId}`, sent.id);
    PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString(), modId: mod.id });
    const hist = loadHistory(); hist.push({ type: 'request_forwarded', userId, toMod: mod.id, at: new Date().toISOString() }); saveHistory(hist);
    return true;
  } catch (e) {
    return false;
  }
}

// assign (regular flow)
async function initiateProofDMAssign(user) {
  try {
    const assignedAccount = getLeastLoadedOnlineAccount();
    if (!assignedAccount) return { ok:false, reason:'No moderators online' };
    const mod = MODS[assignedAccount];
    await user.send({ embeds: [ new EmbedBuilder().setTitle('Bypass Service — Rp. 3.000/hari').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
    PROOF_TARGET.set(user.id, assignedAccount);
    const hist = loadHistory(); hist.push({ type: 'assigned', userId: user.id, toAccount: assignedAccount, at: new Date().toISOString() }); saveHistory(hist);
    refreshAllBypassEmbeds().catch(()=>{});
    return { ok:true, assignedAccount };
  } catch (e) { return { ok:false }; }
}

// interactions: slash, buttons, modal
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

      // auto-refresh embed
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
        } catch (e) { clearInterval(interval); }
      }, 10000);

      return;
    }

    // Buttons
    if (interaction.isButton()) {
      const cid = interaction.customId;

      // assign buttons -> same flow
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

      // Already Paid
      if (cid === 'already_paid') {
        const userId = interaction.user.id;
        const paid = getPaidInfo(userId);
        if (!paid) return interaction.reply({ content: '❌ Kamu belum membayar hari ini. Silakan pilih mod terlebih dahulu.', ephemeral: true });
        const preferred = paid.modAccount;
        let target = null;
        if (ONLINE[preferred]) target = preferred;
        else {
          const alt = getLeastLoadedOnlineAccount();
          if (!alt) return interaction.reply({ content: 'Saat ini tidak ada moderator online. Coba lagi nanti.', ephemeral: true });
          target = alt;
        }
        const mod = MODS[target];
        const ok = await forwardRequestToMod(userId, mod, '(Already Paid)');
        if (!ok) return interaction.reply({ content: 'Gagal menghubungi moderator. Silakan coba lagi.', ephemeral: true });
        await interaction.reply({ content: `Permintaan dikirim ke ${mod.tag}. Tunggu respon mereka di DM.`, ephemeral: true });
        refreshAllBypassEmbeds().catch(()=>{});
        return;
      }

      // resend & cancel assign for ephemeral menu
      if (cid === 'resend_dm') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (!assigned) return interaction.reply({ content: 'Tidak ada assignment aktif. Tekan tombol di /bypass dulu.', ephemeral: true });
        const mod = MODS[assigned];
        try {
          await (await client.users.fetch(interaction.user.id)).send({ embeds: [ new EmbedBuilder().setTitle('Bypass Service — Rp. 3.000/hari').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
          return interaction.reply({ content: 'DM dikirim ulang. Cek DM kamu.', ephemeral: true });
        } catch (e) { return interaction.reply({ content: 'Gagal kirim ulang DM. Periksa pengaturan privacy Anda.', ephemeral: true }); }
      }
      if (cid === 'cancel_assign') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (assigned) { PROOF_TARGET.delete(interaction.user.id); decrementModCount(assigned); refreshAllBypassEmbeds().catch(()=>{}); }
        return interaction.reply({ content: 'Assignment dibatalkan.', ephemeral: true });
      }

      // MOD DM buttons: sendbypass_{userId} & cancel_{userId}
      if (/^(sendbypass|cancel)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');

        // CANCEL: remove forwarded message, notify user, decrement queue
        if (action === 'cancel') {
          const pending = PENDING.get(userId) || null;
          if (pending && pending.modAccount) decrementModCount(pending.modAccount);
          if (PENDING.has(userId)) PENDING.delete(userId);
          try {
            const forwardId = FORWARD_MAP.get(`${interaction.user.id}_${userId}`);
            if (forwardId) {
              const modUser = await client.users.fetch(interaction.user.id);
              const dm = await modUser.createDM();
              try {
                const fmsg = await dm.messages.fetch(forwardId);
                if (fmsg) await fmsg.edit({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: fmsg.embeds });
              } catch(e){}
              FORWARD_MAP.delete(`${interaction.user.id}_${userId}`);
            } else {
              try { await interaction.update({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: interaction.message.embeds }); } catch {}
            }
          } catch(e){}
          try {
            const user = await client.users.fetch(userId);
            await user.send({ embeds: [ new EmbedBuilder().setTitle('Transfer: Canceled ❌').setDescription(`Moderator <@${interaction.user.id}> membatalkan proses. Silakan hubungi moderator untuk info lebih lanjut.`).setTimestamp() ] });
          } catch(e){}
          const hist = loadHistory(); hist.push({ type: 'cancel_by_mod', userId, modId: interaction.user.id, at: new Date().toISOString() }); saveHistory(hist);
          refreshAllBypassEmbeds().catch(()=>{});
          return;
        }

        // SENDBYPASS: show modal
        if (action === 'sendbypass') {
          const modal = new ModalBuilder().setCustomId(`modal_bypass_${userId}_${interaction.user.id}`).setTitle('Kirim Bypass Code');
          const bypassInput = new TextInputBuilder().setCustomId('bypass_code').setLabel('Masukkan bypass code').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('contoh: ABCD-1234');
          const noteInput = new TextInputBuilder().setCustomId('note').setLabel('Pesan tambahan (opsional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('opsional');
          modal.addComponents({ type: 1, components: [bypassInput] }, { type: 1, components: [noteInput] });
          return interaction.showModal(modal);
        }
      }
    }

    // Modal submit handling
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('modal_bypass_')) {
      const parts = interaction.customId.split('_');
      const userId = parts[2];
      const modIdFromModal = parts[3];
      const modClickingId = interaction.user.id;
      if (modClickingId !== modIdFromModal) return interaction.reply({ content: 'Anda tidak berwenang.', ephemeral: true });

      const bypassCode = interaction.fields.getTextInputValue('bypass_code').trim();
      const note = interaction.fields.getTextInputValue('note') || '';
      const plain = `copy this bypass : ${bypassCode}`;
      const finalMsg = note ? `${plain}\n\n${note}` : plain;

      try {
        const user = await client.users.fetch(userId);
        await user.send({ content: finalMsg });

        // mark paid to mod that sent it
        const modAcc = MOD_ID_TO_ACCOUNT[modClickingId];
        if (modAcc) markUserPaid(userId, modAcc);

        // remove buttons from forwarded message in mod DM (if stored)
        try {
          const forwardMsgId = FORWARD_MAP.get(`${modClickingId}_${userId}`);
          if (forwardMsgId) {
            const modUser = await client.users.fetch(modClickingId);
     
