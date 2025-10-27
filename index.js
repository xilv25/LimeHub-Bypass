// index.js — Bypass Bot (final)
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  Partials, InteractionType, ChannelType
} = require('discord.js');
require('dotenv').config();

// ===== env =====
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const MOD1_ID = process.env.MOD1_ID; // jojo
const MOD2_ID = process.env.MOD2_ID; // whoisnda

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !MOD1_ID || !MOD2_ID) {
  console.error('ENV missing: set TOKEN, CLIENT_ID, GUILD_ID, MOD1_ID, MOD2_ID');
  process.exit(1);
}

// ===== persistence files =====
const DATA_DIR = __dirname;
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const PAID_FILE = path.join(DATA_DIR, 'paid.json');

function loadJsonSafe(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) { fs.writeFileSync(fp, JSON.stringify(fallback, null, 2)); return fallback; }
    const raw = fs.readFileSync(fp, 'utf8') || JSON.stringify(fallback);
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function saveJsonSafe(fp, obj) { try { fs.writeFileSync(fp, JSON.stringify(obj, null, 2)); } catch (e) {} }

function loadHistory(){ return loadJsonSafe(HISTORY_FILE, []); }
function saveHistory(h){ saveJsonSafe(HISTORY_FILE, h); }
function loadQueue(){ return loadJsonSafe(QUEUE_FILE, { accounts: ['08170512639','085219498004'], counts: {'08170512639':0,'085219498004':0} }); }
function saveQueue(q){ saveJsonSafe(QUEUE_FILE, q); }
function loadPaid(){ return loadJsonSafe(PAID_FILE, {}); }
function savePaid(p){ saveJsonSafe(PAID_FILE, p); }

// ===== moderators (fixed) =====
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};
const MOD_ID_TO_ACCOUNT = {};
for (const acc of Object.keys(MODS)) MOD_ID_TO_ACCOUNT[MODS[acc].id] = acc;

// ===== runtime maps =====
const PROOF_TARGET = new Map(); // userId -> modAccount (assignment while user preparing)
const PENDING = new Map(); // userId -> { modAccount, createdAt, modId }
const BYPASS_EMBEDS = new Map(); // msgId -> intervalId for refresh cleanup (we store msg)
const FORWARD_MAP = new Map(); // `${modId}_${userId}` -> forwardedMessageId
const TEMP_ATTACH = new Map(); // userId -> { url, name } (latest attachment user sent in DM)
let QUEUE = loadQueue(); // persistent
let PAID_USERS = loadPaid(); // persistent
let HISTORY = loadHistory();

// default online status
let ONLINE = {};
for (const acc of Object.keys(MODS)) ONLINE[acc] = true;

// ===== client =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ===== helpers =====
const PAID_TTL_MS = 24 * 60 * 60 * 1000;
function markUserPaid(userId, modAccount) { PAID_USERS[userId] = { modAccount, ts: Date.now() }; savePaid(PAID_USERS); }
function getPaidInfo(userId) {
  const rec = PAID_USERS[userId];
  if (!rec) return null;
  if (Date.now() - (rec.ts || 0) > PAID_TTL_MS) { delete PAID_USERS[userId]; savePaid(PAID_USERS); return null; }
  return rec;
}

function recomputeQueueCounts() {
  if (!QUEUE || !QUEUE.accounts) return;
  for (const a of QUEUE.accounts) QUEUE.counts[a] = 0;
  for (const [, p] of PENDING.entries()) {
    if (p && p.modAccount && QUEUE.counts.hasOwnProperty(p.modAccount)) {
      QUEUE.counts[p.modAccount] = (QUEUE.counts[p.modAccount] || 0) + 1;
    }
  }
  saveQueue(QUEUE);
}

function getLeastLoadedOnlineAccount() {
  const online = QUEUE.accounts.filter(a => ONLINE[a]);
  if (!online.length) return null;
  let best = online[0], bestCount = QUEUE.counts[best] || 0;
  for (const a of online) {
    const c = QUEUE.counts[a] || 0;
    if (c < bestCount) { best = a; bestCount = c; }
  }
  return best;
}

function queueStatusFields() {
  const jo = '08170512639', who = '085219498004';
  const online = QUEUE.accounts.filter(a => ONLINE[a]);
  let nextTag = 'No moderators online';
  if (online.length) {
    let b = online[0], bc = QUEUE.counts[b] || 0;
    for (const a of online) { const c = QUEUE.counts[a] || 0; if (c < bc) { b = a; bc = c; } }
    nextTag = MODS[b].tag;
  }
  let notices = [];
  if (!ONLINE[jo]) notices.push(`${MODS[jo].tag.replace('@','')} is offline`);
  if (!ONLINE[who]) notices.push(`${MODS[who].tag.replace('@','')} is offline`);
  return [
    { name: `${MODS[who].tag}`, value: `${QUEUE.counts[who] || 0} antrian${!ONLINE[who] ? ' (OFFLINE)' : ''}`, inline: true },
    { name: `${MODS[jo].tag}`, value: `${QUEUE.counts[jo] || 0} antrian${!ONLINE[jo] ? ' (OFFLINE)' : ''}`, inline: true },
    { name: 'Next assignment', value: `${nextTag}`, inline: false },
    ...(notices.length ? [{ name: 'Notices', value: notices.join('\n'), inline: false }] : [])
  ];
}

// ===== deploy commands =====
async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = [
      { name: 'bypass', description: 'Tampilkan panel bypass' },
      { name: 'on', description: 'Turn ON (Moderator only)' },
      { name: 'off', description: 'Turn OFF (Moderator only)' },
      { name: 'status', description: 'Check moderator availability/status' }
    ];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands deployed');
  } catch (e) { console.error('deployCommands err', e); }
}

client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

// ===== refresh embed helper (5s) =====
async function startEmbedRefresher(message) {
  if (!message || !message.id) return;
  if (BYPASS_EMBEDS.has(message.id)) return;
  BYPASS_EMBEDS.set(message.id, message);
  const interval = setInterval(async () => {
    try {
      if (!BYPASS_EMBEDS.has(message.id)) return clearInterval(interval);
      const msg = BYPASS_EMBEDS.get(message.id);
      if (!msg) return clearInterval(interval);
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
      // try edit; if fail, remove from map and clear interval
      if (msg.editable) await msg.edit({ embeds: [newEmbed], components: [row] });
      else {
        try {
          const fetched = await msg.channel.messages.fetch(msg.id).catch(()=>null);
          if (fetched && fetched.editable) await fetched.edit({ embeds: [newEmbed], components: [row] });
          else { BYPASS_EMBEDS.delete(message.id); clearInterval(interval); }
        } catch (e) { BYPASS_EMBEDS.delete(message.id); clearInterval(interval); }
      }
    } catch (e) { /* ignore */ }
  }, 5000);
}

// ===== forward request to mod (creates PENDING) =====
async function forwardRequestToMod(userId, mod, titleSuffix = '', link = '') {
  const forwardEmbed = new EmbedBuilder()
    .setTitle(`📩 Support Request ${titleSuffix}`.trim())
    .setDescription(`User <@${userId}> requests support.`)
    .addFields({ name: 'User', value: `<@${userId}>`, inline: true }, { name: 'Rekening tujuan', value: mod.account, inline: true })
    .setFooter({ text: 'Click Send Bypass to deliver bypass, or Cancel to decline.' })
    .setTimestamp();
  if (link && typeof link === 'string' && link.length > 0) {
    forwardEmbed.addFields({ name: 'Link / Data', value: link.length > 1024 ? link.slice(0, 1021) + '...' : link, inline: false });
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
  );
  try {
    const modUser = await client.users.fetch(mod.id);
    const sent = await modUser.send({ embeds: [forwardEmbed], components: [row] });
    FORWARD_MAP.set(`${mod.id}_${userId}`, sent.id);
    PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString(), modId: mod.id });
    recomputeQueueCounts();
    HISTORY.push({ type: 'request_forwarded', userId, toMod: mod.id, link: link || '', at: new Date().toISOString() });
    saveHistory(HISTORY);
    return true;
  } catch (e) {
    return false;
  }
}

// ===== interactions =====
client.on('interactionCreate', async (interaction) => {
  try {
    // slash commands
    if (interaction.isChatInputCommand && interaction.commandName) {
      const cmd = interaction.commandName;
      if (cmd === 'bypass') {
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
        startEmbedRefresher(reply);
        return;
      }
      if (cmd === 'on' || cmd === 'off') {
        if (!MOD_ID_TO_ACCOUNT[interaction.user.id]) return interaction.reply({ content: 'Khusus moderator.', ephemeral: true });
        const acc = MOD_ID_TO_ACCOUNT[interaction.user.id];
        ONLINE[acc] = (cmd === 'on');
        // if mod back online, nothing else; embed refresher will show enabled button
        return interaction.reply({ content: `Statusmu sekarang: ${ONLINE[acc] ? 'ONLINE' : 'OFFLINE'}`, ephemeral: true });
      }
      if (cmd === 'status') {
        const who = '085219498004', jo = '08170512639';
        const lines = [`${MODS[who].tag}: ${ONLINE[who] ? 'ONLINE' : 'OFFLINE'} (${QUEUE.counts[who]||0} antrian)`, `${MODS[jo].tag}: ${ONLINE[jo] ? 'ONLINE' : 'OFFLINE'} (${QUEUE.counts[jo]||0} antrian)`];
        return interaction.reply({ content: lines.join('\n'), ephemeral: true });
      }
    }

    // button interactions
    if (interaction.isButton && interaction.customId) {
      const cid = interaction.customId;

      // Contact Jojo / WhoisNda — NO modal at server click. Bot DM immediately with embed + SUBMIT button.
      if (cid === 'assign_btn_jojo' || cid === 'assign_btn_whoisnda') {
        const assigned = (cid === 'assign_btn_jojo') ? '08170512639' : '085219498004';
        const mod = MODS[assigned];
        try {
          // set assignment so user's DM flows know target
          PROOF_TARGET.set(interaction.user.id, assigned);

          // DM embed instruct user to attach screenshot and press SUBMIT (submit opens modal for link)
          const dmEmbed = new EmbedBuilder()
            .setTitle('Bypass Service — Rp. 3.000/hari')
            .setDescription(`Kirim **screenshot** bukti transfer di DM ini, lalu tekan **SUBMIT**. Bot akan meneruskannya ke ${mod.tag}.`)
            .addFields({ name: 'Rekening Tujuan', value: mod.account, inline: true })
            .setFooter({ text: 'Attach 1 foto bukti TF lalu tekan SUBMIT' })
            .setTimestamp();
          const dmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('submit_proof').setLabel('SUBMIT').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cancel_proof').setLabel('CANCEL').setStyle(ButtonStyle.Danger)
          );
          const dmUser = await client.users.fetch(interaction.user.id);
          await dmUser.send({ embeds: [dmEmbed], components: [dmRow] });

          await interaction.reply({ content: `DM terkirim. Silakan cek DM dan upload screenshot lalu tekan SUBMIT.`, ephemeral: true });
          return;
        } catch (e) {
          PROOF_TARGET.delete(interaction.user.id);
          return interaction.reply({ content: 'Gagal mengirim DM — pastikan DM terbuka untuk server ini.', ephemeral: true });
        }
      }

      // Already Paid — show modal to input link (ephemeral)
      if (cid === 'already_paid') {
        const paid = getPaidInfo(interaction.user.id);
        if (!paid) return interaction.reply({ content: '❌ Kamu belum ditandai bayar hari ini. Gunakan Contact untuk kirim bukti.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_alreadypaid_${paid.modAccount}_${interaction.user.id}`).setTitle('Already Paid — Link bypass');
        const linkInput = new TextInputBuilder().setCustomId('link').setLabel('Link / Data yang ingin dibypass').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('contoh: https://...');
        modal.addComponents({ type: 1, components: [linkInput] });
        return interaction.showModal(modal);
      }

      // SUBMIT in DM (member-side) -> open modal for link
      if (cid === 'submit_proof') {
        // only in DM
        const ch = interaction.channel;
        if (!ch || ch.type !== ChannelType.DM) return interaction.reply({ content: 'Tombol ini hanya bekerja di DM bot.', ephemeral: true });
        const uid = interaction.user.id;
        if (!PROOF_TARGET.has(uid)) return interaction.reply({ content: 'Kamu belum memulai permintaan via Contact. Tekan tombol Contact di server dulu.', ephemeral: true });

        // show modal to collect link
        const modal = new ModalBuilder().setCustomId(`modal_submitlink_${uid}`).setTitle('Masukkan Link yang ingin di-bypass');
        const linkInput = new TextInputBuilder().setCustomId('link').setLabel('Link / Data').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('contoh: https://...');
        modal.addComponents({ type: 1, components: [linkInput] });
        return interaction.showModal(modal);
      }

      // CANCEL in DM (member cancels preparation)
      if (cid === 'cancel_proof') {
        const uid = interaction.user.id;
        if (PROOF_TARGET.has(uid)) PROOF_TARGET.delete(uid);
        TEMP_ATTACH.delete(uid);
        return interaction.reply({ content: 'Proses dibatalkan.', ephemeral: true });
      }

      // Mod actions: sendbypass_{userId} or cancel_{userId}
      if (/^(sendbypass|cancel)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');
        if (action === 'cancel') {
          // remove pending
          if (PENDING.has(userId)) { PENDING.delete(userId); recomputeQueueCounts(); }
          // edit forwarded message where possible
          try {
            const forwardId = FORWARD_MAP.get(`${interaction.user.id}_${userId}`);
            if (forwardId) {
              const modUser = await client.users.fetch(interaction.user.id);
              const dm = await modUser.createDM();
              const fmsg = await dm.messages.fetch(forwardId).catch(()=>null);
              if (fmsg) await fmsg.edit({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: fmsg.embeds });
              FORWARD_MAP.delete(`${interaction.user.id}_${userId}`);
            } else {
              try { await interaction.update({ content: `Canceled by <@${interaction.user.id}>`, components: [], embeds: interaction.message.embeds }); } catch {}
            }
          } catch (e) {}
          // notify user
          try { const targetUser = await client.users.fetch(userId); await targetUser.send({ embeds: [ new EmbedBuilder().setTitle('Transfer: Canceled ❌').setDescription(`Moderator <@${interaction.user.id}> membatalkan proses.`).setTimestamp() ] }); } catch(e){}
          recomputeQueueCounts();
          refreshAll(); // refresh embed counts
          return;
        }
        if (action === 'sendbypass') {
          // show modal to mod to input bypass code
          const modal = new ModalBuilder().setCustomId(`modal_bypass_${userId}_${interaction.user.id}`).setTitle('Kirim Bypass Code');
          const bypassInput = new TextInputBuilder().setCustomId('bypass_code').setLabel('Masukkan bypass code').setStyle(TextInputStyle.Short).setRequired(true);
          const noteInput = new TextInputBuilder().setCustomId('note').setLabel('Pesan tambahan (opsional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
          modal.addComponents({ type: 1, components: [bypassInput] }, { type: 1, components: [noteInput] });
          return interaction.showModal(modal);
        }
      }
    }

    // modal submits
    if (interaction.type === InteractionType.ModalSubmit && interaction.customId) {
      const cid = interaction.customId;

      // modal when member submitted link after uploading screenshot in DM
      if (cid.startsWith('modal_submitlink_')) {
        const userId = cid.split('_')[2];
        if (interaction.user.id !== userId) return interaction.reply({ content: 'Modal tidak cocok dengan pengguna.', ephemeral: true });

        // retrieve attachment saved earlier
        const att = TEMP_ATTACH.get(userId);
        if (!att || !att.url) return interaction.reply({ content: 'Tidak menemukan screenshot bukti. Silakan upload screenshot di DM lalu tekan SUBMIT lagi.', ephemeral: true });

        const link = interaction.fields.getTextInputValue('link').trim();
        const assigned = PROOF_TARGET.get(userId) || getLeastLoadedOnlineAccount();
        if (!assigned) return interaction.reply({ content: 'Tidak ada moderator online saat ini. Coba lagi nanti.', ephemeral: true });
        const mod = MODS[assigned];

        // forward to mod
        const ok = await forwardRequestToMod(userId, mod, '(Proof with screenshot)', link);
        if (!ok) return interaction.reply({ content: 'Gagal menghubungi moderator. Coba lagi nanti.', ephemeral: true });

        // send attachment to mod
        try {
          const modUser = await client.users.fetch(mod.id);
          await modUser.send({ content: `File bukti dari <@${userId}>:`, files: [att.url] }).catch(()=>{});
        } catch (e) {}

        // save link/note history
        HISTORY.push({ type: 'proof_forwarded', userId, toMod: mod.id, link, attachment: att, at: new Date().toISOString() });
        saveHistory(HISTORY);

        // clear temp & PROOF_TARGET (we keep PENDING until mod send/cancel)
        TEMP_ATTACH.delete(userId);
        PROOF_TARGET.delete(userId);

        recomputeQueueCounts();
        refreshAll();

        return interaction.reply({ content: `Bukti dan link berhasil dikirim ke ${mod.tag}. Tunggu balasan mereka di DM.`, ephemeral: true });
      }

        // Already Paid modal -> forward immediately (no screenshot)
      if (cid.startsWith('modal_alreadypaid_')) {
        const parts = cid.split('_'); // modal_alreadypaid_<modAccount>_<userId>
        const preferred = parts[2];
        const userId = parts[3] || interaction.user.id;
        if (interaction.user.id !== userId) return interaction.reply({ content: 'Modal tidak cocok dengan pengguna.', ephemeral: true });
        const link = interaction.fields.getTextInputValue('link').trim();
        let target = preferred;
        if (!ONLINE[preferred]) {
          const alt = getLeastLoadedOnlineAccount();
          if (!alt) return interaction.reply({ content: 'Tidak ada moderator online sekarang.', ephemeral: true });
          target = alt;
        }
        const mod = MODS[target];
        const ok = await forwardRequestToMod(userId, mod, '(Already Paid)', link);
        if (!ok) return interaction.reply({ content: 'Gagal menghubungi moderator. Coba lagi nanti.', ephemeral: true });
        HISTORY.push({ type: 'already_paid_forwarded', userId, toMod: mod.id, link, at: new Date().toISOString() });
        saveHistory(HISTORY);
        recomputeQueueCounts();
        refreshAll();
        return interaction.reply({ content: `Permintaan kamu sudah dikirim ke ${mod.tag}.`, ephemeral: true });
      }

      // mod sending bypass code
      if (cid.startsWith('modal_bypass_')) {
        const parts = cid.split('_'); // modal_bypass_<userId>_<modId>
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
          await user.send({ content: finalMsg }).catch(()=>{});
          // mark paid and remove pending
          const modAcc = MOD_ID_TO_ACCOUNT[modClickingId];
          if (modAcc) markUserPaid(userId, modAcc);
          if (PENDING.has(userId)) { PENDING.delete(userId); recomputeQueueCounts(); }
          // update forwarded message to remove buttons if possible
          const forwardMsgId = FORWARD_MAP.get(`${modClickingId}_${userId}`);
          if (forwardMsgId) {
            const modUser = await client.users.fetch(modClickingId);
            const dm = await modUser.createDM();
            const fmsg = await dm.messages.fetch(forwardMsgId).catch(()=>null);
            if (fmsg) await fmsg.edit({ content: `Bypass sent by <@${modClickingId}>`, components: [], embeds: fmsg.embeds });
            FORWARD_MAP.delete(`${modClickingId}_${userId}`);
          }
          HISTORY.push({ type: 'bypass_sent', to: userId, fromMod: modClickingId, code: bypassCode, note, at: new Date().toISOString() });
          saveHistory(HISTORY);
          refreshAll();
          return interaction.reply({ content: 'Bypass code dikirim ke user.', ephemeral: true });
        } catch (e) {
          return interaction.reply({ content: 'Gagal mengirim bypass ke user (mungkin DM terblokir).', ephemeral: true });
        }
      }
    }
  } catch (err) {
    console.error('interactionCreate err', err);
    try { if (interaction && !interaction.replied) await interaction.reply({ content: 'Terjadi error.', ephemeral: true }); } catch(e){}
  }
});

// helper refresh all (edits all active bypass embeds)
function refreshAll() {
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
      (async () => {
        try {
          if (msg.editable) await msg.edit({ embeds: [newEmbed], components: [row] });
          else {
            const fetched = await msg.channel.messages.fetch(msg.id).catch(()=>null);
            if (fetched && fetched.editable) await fetched.edit({ embeds: [newEmbed], components: [row] });
            else BYPASS_EMBEDS.delete(msgId);
          }
        } catch (e) { BYPASS_EMBEDS.delete(msgId); }
      })();
    } catch (e) { BYPASS_EMBEDS.delete(msgId); }
  }
}

// ===== capture attachments sent by users in DM =====
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    // only handle DM attachments for proof flow
    if (message.channel && message.channel.type === ChannelType.DM) {
      const uid = message.author.id;
      if (message.attachments && message.attachments.size > 0) {
        // save the first attachment (url + name)
        const a = message.attachments.first();
        TEMP_ATTACH.set(uid, { url: a.url, name: a.name || '' });
        // optionally notify user
        try { await message.reply({ content: 'Screenshot terdeteksi dan disimpan. Tekan SUBMIT untuk mengirim ke moderator.', ephemeral: true }); } catch(e){}
      }
    }
  } catch (e) { /* ignore */ }
});

// ===== handle messages from users in guild DMs? (not needed) =====

// ===== startup =====
client.login(TOKEN).catch(err => console.error('Login failed', err));
