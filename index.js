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
const GUILD_ID = process.env.GUILD_ID || '1380909989073391666';
const MOD1_ID = process.env.MOD1_ID;
const MOD2_ID = process.env.MOD2_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !MOD1_ID || !MOD2_ID) {
  console.error('ENV missing: set TOKEN, CLIENT_ID, GUILD_ID, MOD1_ID, MOD2_ID');
  process.exit(1);
}

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
    return fallback;
  }
}
function saveJsonSafe(fp, obj) {
  try { fs.writeFileSync(fp, JSON.stringify(obj, null, 2)); } catch {}
}
function loadHistory(){ return loadJsonSafe(HISTORY_FILE, []); }
function saveHistory(h){ saveJsonSafe(HISTORY_FILE, h); }
function loadQueue(){ return loadJsonSafe(QUEUE_FILE, { accounts: ['08170512639','085219498004'], counts: {'08170512639':0,'085219498004':0} }); }
function saveQueue(q){ saveJsonSafe(QUEUE_FILE, q); }
function loadPaid(){ return loadJsonSafe(PAID_FILE, {}); }
function savePaid(p){ saveJsonSafe(PAID_FILE, p); }

const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};
const MOD_ID_TO_ACCOUNT = {};
for (const acc of Object.keys(MODS)) MOD_ID_TO_ACCOUNT[MODS[acc].id] = acc;

const PROOF_TARGET = new Map();
const PENDING = new Map();
const BYPASS_EMBEDS = new Map();
const FORWARD_MAP = new Map();

let QUEUE = loadQueue();
let PAID_USERS = loadPaid();

let ONLINE = {};
for (const acc of Object.keys(MODS)) ONLINE[acc] = true;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const PAID_TTL_MS = 24 * 60 * 60 * 1000;

function markUserPaid(userId, modAccount) { PAID_USERS[userId] = { modAccount, ts: Date.now() }; savePaid(PAID_USERS); }
function getPaidInfo(userId) {
  const rec = PAID_USERS[userId];
  if (!rec) return null;
  if (Date.now() - (rec.ts || 0) > PAID_TTL_MS) { delete PAID_USERS[userId]; savePaid(PAID_USERS); return null; }
  return rec;
}

if (!QUEUE || !QUEUE.accounts) {
  QUEUE = { accounts: ['08170512639','085219498004'], counts: {'08170512639':0,'085219498004':0} };
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
  QUEUE.counts[best] = (QUEUE.counts[best] || 0) + 1;
  saveQueue(QUEUE);
  return best;
}
function decrementModCount(acc) { if (!acc) return; QUEUE.counts[acc] = Math.max(0, (QUEUE.counts[acc] || 0) - 1); saveQueue(QUEUE); }

function queueStatusFields() {
  const who = '085219498004';
  const jo = '08170512639';
  const online = QUEUE.accounts.filter(a => ONLINE[a]);
  let nextTag = 'No moderators online';
  if (online.length) {
    let b = online[0], bc = QUEUE.counts[b]||0;
    for (const a of online) { const c = QUEUE.counts[a]||0; if (c < bc) { b = a; bc = c; } }
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

async function deployGuildCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    const commands = [
      { name: 'bypass', description: 'Tampilkan panel bypass' },
      { name: 'on', description: 'Turn ON (Moderator only)' },
      { name: 'off', description: 'Turn OFF (Moderator only)' },
      { name: 'status', description: 'Check moderator availability/status' }
    ];
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  } catch (e) { console.error('deploy commands error', e); }
}

client.once('ready', async () => {
  await deployGuildCommands();
});

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
    } catch (e) { BYPASS_EMBEDS.delete(msgId); }
  }
}

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
    const hist = loadHistory(); hist.push({ type: 'request_forwarded', userId, toMod: mod.id, link: link || '', at: new Date().toISOString() }); saveHistory(hist);
    return true;
  } catch (e) { return false; }
}

async function initiateProofDMAssign(user) {
  try {
    const assignedAccount = getLeastLoadedOnlineAccount();
    if (!assignedAccount) return { ok:false, reason:'No moderators online' };
    const mod = MODS[assignedAccount];
    await user.send({ embeds: [ new EmbedBuilder().setTitle('Bypass Service — Rp. 3.000/hari').setDescription(`Kirim bukti transfer disini, bot akan meneruskannya ke ${mod.tag}.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
    PROOF_TARGET.set(user.id, assignedAccount);
    const hist = loadHistory(); hist.push({ type: 'assigned', userId: user.id, toAccount: assignedAccount, at: new Date().toISOString() }); saveHistory(hist);
    refreshAllBypassEmbeds().catch(()=>{});
    return { ok:true, assignedAccount };
  } catch (e) { return { ok:false }; }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand && interaction.isChatInputCommand()) {
      const cmd = interaction.commandName;
      const user = interaction.user;
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
        BYPASS_EMBEDS.set(reply.id, reply);
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
      if (cmd === 'on' || cmd === 'off') {
        if (!MOD_ID_TO_ACCOUNT[user.id]) return interaction.reply({ content: 'Khusus moderator.', ephemeral: true });
        const acc = MOD_ID_TO_ACCOUNT[user.id];
        ONLINE[acc] = (cmd === 'on');
        refreshAllBypassEmbeds().catch(()=>{});
        return interaction.reply({ content: `Statusmu sekarang: ${ONLINE[acc] ? 'ONLINE' : 'OFFLINE'}`, ephemeral: true });
      }
      if (cmd === 'status') {
        const who = '085219498004', jo = '08170512639';
        const lines = [`${MODS[who].tag}: ${ONLINE[who] ? 'ONLINE' : 'OFFLINE'} (${QUEUE.counts[who]||0} antrian)`, `${MODS[jo].tag}: ${ONLINE[jo] ? 'ONLINE' : 'OFFLINE'} (${QUEUE.counts[jo]||0} antrian)`];
        return interaction.reply({ content: lines.join('\n'), ephemeral: true });
      }
    }

    if (interaction.isButton && interaction.isButton()) {
      const cid = interaction.customId;

      // Assign buttons
      if (cid === 'assign_btn_jojo' || cid === 'assign_btn_whoisnda') {
        const res = await initiateProofDMAssign(interaction.user);
        if (!res.ok) return interaction.reply({ content: res.reason || 'Gagal mengirim DM — buka DM Anda.', ephemeral: true });
        const assigned = res.assignedAccount;
        const mod = MODS[assigned];
        const replyEmb = new EmbedBuilder()
          .setTitle('Moderator Ditugaskan')
          .setDescription(`Kamu dialokasikan ke moderator ${mod.tag}. Silakan cek DM.`)
          .addFields({ name: 'Moderator', value: mod.tag, inline: true }, { name: 'Nomor Rekening', value: mod.account, inline: true }, ...queueStatusFields())
          .setFooter({ text: 'Jika DM tidak datang, cek pengaturan privacy Anda.' })
          .setTimestamp();
        const replyRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('resend_dm').setLabel('Kirim Ulang DM').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('cancel_assign').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({ embeds: [replyEmb], components: [replyRow], ephemeral: true });
      }

      // Already Paid: show modal to input link
      if (cid === 'already_paid') {
        const userId = interaction.user.id;
        const paid = getPaidInfo(userId);
        if (!paid) return interaction.reply({ content: '❌ Kamu belum membayar hari ini. Silakan pilih mod terlebih dahulu.', ephemeral: true });
        const modal = new ModalBuilder()
          .setCustomId(`modal_alreadypaid_${paid.modAccount}`)
          .setTitle('Already Paid — Masukkan Link / Data');
        const linkInput = new TextInputBuilder()
          .setCustomId('bypass_link')
          .setLabel('Masukkan link atau data yang ingin dibypass')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('contoh: https://... atau detail akun / order id');
        modal.addComponents({ type: 1, components: [linkInput] });
        return interaction.showModal(modal);
      }

      if (cid === 'resend_dm') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (!assigned) return interaction.reply({ content: 'Tidak ada assignment aktif. Tekan tombol di /bypass dulu.', ephemeral: true });
        const mod = MODS[assigned];
        try {
          await (await client.users.fetch(interaction.user.id)).send({ embeds: [ new EmbedBuilder().setTitle('Bypass Service — Rp. 3.000/hari').setDescription(`Kirim bukti transfer disini, bot akan meneruskannya ke ${mod.tag}.`).addFields({ name: 'Rekening Tujuan', value: mod.account }) ] });
          return interaction.reply({ content: 'DM dikirim ulang. Cek DM kamu.', ephemeral: true });
        } catch (e) { return interaction.reply({ content: 'Gagal kirim ulang DM. Periksa pengaturan privacy Anda.', ephemeral: true }); }
      }

      if (cid === 'cancel_assign') {
        const assigned = PROOF_TARGET.get(interaction.user.id);
        if (assigned) { PROOF_TARGET.delete(interaction.user.id); decrementModCount(assigned); refreshAllBypassEmbeds().catch(()=>{}); }
        return interaction.reply({ content: 'Assignment dibatalkan.', ephemeral: true });
      }

      if (/^(sendbypass|cancel)_\d+$/.test(cid)) {
        const parts = cid.split('_');
        const action = parts[0];
        const userId = parts[1];

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

        if (action === 'sendbypass') {
          const modal = new ModalBuilder().setCustomId(`modal_bypass_${userId}_${interaction.user.id}`).setTitle('Kirim Bypass Code');
          const bypassInput = new TextInputBuilder().setCustomId('bypass_code').setLabel('Masukkan bypass code').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('contoh: ABCD-1234');
          const noteInput = new TextInputBuilder().setCustomId('note').setLabel('Pesan tambahan (opsional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder('opsional');
          modal.addComponents({ type: 1, components: [bypassInput] }, { type: 1, components: [noteInput] });
          return interaction.showModal(modal);
        }
      }
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId && interaction.customId.startsWith('modal_alreadypaid_')) {
      const parts = interaction.customId.split('_');
      const preferredAccount = parts[2];
      const userId = interaction.user.id;
      const link = interaction.fields.getTextInputValue('bypass_link').trim();
      let targetAccount = preferredAccount;
      if (!ONLINE[preferredAccount]) {
        const alt = getLeastLoadedOnlineAccount();
        if (!alt) {
          await interaction.reply({ content: 'Saat ini tidak ada moderator online. Coba lagi nanti.', ephemeral: true });
          return;
        }
        targetAccount = alt;
      }
      const mod = MODS[targetAccount];
      const ok = await forwardRequestToMod(userId, mod, '(Already Paid)', link);
      if (!ok) {
        await interaction.reply({ content: 'Gagal menghubungi moderator. Silakan coba lagi nanti.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: `Permintaan kamu sudah dikirim ke ${mod.tag}. Tunggu respon mereka di DM.`, ephemeral: true });
      refreshAllBypassEmbeds().catch(()=>{});
      return;
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId && interaction.customId.startsWith('modal_bypass_')) {
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
        const modAcc = MOD_ID_TO_ACCOUNT[modClickingId];
        if (modAcc) markUserPaid(userId, modAcc);
        try {
          const forwardMsgId = FORWARD_MAP.get(`${modClickingId}_${userId}`);
          if (forwardMsgId) {
            const modUser = await client.users.fetch(modClickingId);
            const dm = await modUser.createDM();
            const fmsg = await dm.messages.fetch(forwardMsgId).catch(()=>null);
            if (fmsg) await fmsg.edit({ content: `Bypass sent by <@${modClickingId}>`, components: [], embeds: fmsg.embeds });
            FORWARD_MAP.delete(`${modClickingId}_${userId}`);
          } else {
            try { await interaction.message?.edit?.({ components: [] }); } catch(e){}
          }
          const pending = PENDING.get(userId) || null;
          if (pending && pending.modAccount) decrementModCount(pending.modAccount);
          if (PENDING.has(userId)) PENDING.delete(userId);
          await interaction.reply({ content: 'Bypass code berhasil dikirim. User marked PAID 24h.', ephemeral: true });
          const hist = loadHistory(); hist.push({ type: 'reply_bypass', to: userId, fromMod: modClickingId, bypassCode, note, at: new Date().toISOString() }); saveHistory(hist);
          refreshAllBypassEmbeds().catch(()=>{});
          return;
        } catch (e) {
          const pending = PENDING.get(userId) || null;
          if (pending && pending.modAccount) decrementModCount(pending.modAccount);
          if (PENDING.has(userId)) PENDING.delete(userId);
          try { await interaction.reply({ content: 'Bypass dikirim, tapi gagal update forwarded message. User marked PAID 24h.', ephemeral: true }); } catch(e){}
          const hist = loadHistory(); hist.push({ type: 'reply_bypass_partial', to: userId, fromMod: modClickingId, bypassCode, note, at: new Date().toISOString() }); saveHistory(hist);
          refreshAllBypassEmbeds().catch(()=>{});
          return;
        }
      } catch (e) {
        try { await interaction.reply({ content: 'Gagal mengirim bypass ke user (mungkin mereka memblokir DM).', ephemeral: true }); } catch(e){}
        return;
      }
    }

  } catch (err) { try { if (interaction && !interaction.replied) await interaction.reply({ content: 'Terjadi error.', ephemeral: true }); } catch(e){} }
});

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot) return;
    const isDM = message.channel?.type === 1 || message.channel?.type === 'DM';
    if (!isDM) return;
    const txt = (message.content || '').trim();
    if (txt === '/off' || txt === '/on') {
      const discordId = message.author.id;
      const account = MOD_ID_TO_ACCOUNT[discordId];
      if (!account) return message.reply('Perintah ini hanya untuk moderator.');
      ONLINE[account] = (txt === '/on');
      await message.reply(`Status: you are now ${ONLINE[account] ? 'ONLINE' : 'OFFLINE'}.`);
      refreshAllBypassEmbeds().catch(()=>{});
      return;
    }
    const userId = message.author.id;
    if (!PROOF_TARGET.has(userId)) {
      return message.reply('Tekan tombol di /bypass dulu untuk dialokasikan ke moderator, atau klik Already Paid jika kamu sudah bayar dalam 24 jam terakhir.');
    }
    const modAccount = PROOF_TARGET.get(userId);
    const mod = MODS[modAccount];
    if (!mod) { PROOF_TARGET.delete(userId); return message.reply('Moderator tidak ditemukan — coba ulang dari server.'); }
    if (!message.attachments || message.attachments.size === 0) return message.reply('Tidak menemukan attachment. Silakan kirim file (screenshot/foto) sebagai attachment.');
    if (!ONLINE[modAccount]) {
      const reassigned = getLeastLoadedOnlineAccount();
      if (!reassigned) return message.reply('Saat ini tidak ada moderator online. Coba lagi nanti.');
      PROOF_TARGET.set(userId, reassigned);
      const newMod = MODS[reassigned];
      const ok2 = await forwardRequestToMod(userId, newMod, '(Reassigned)');
      if (!ok2) decrementModCount(reassigned);
      refreshAllBypassEmbeds().catch(()=>{});
      return;
    }
    try {
      const forwardEmbed = new EmbedBuilder()
        .setTitle('📎 Bukti Transfer Diterima')
        .setDescription(`User <@${userId}> mengirim bukti untuk rekening **${mod.account}**`)
        .addFields({ name: 'Catatan pengguna', value: message.content ? message.content.slice(0,1024) : '-' })
        .setFooter({ text: `Dikirim oleh ${message.author.tag}` })
        .setTimestamp();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
      );
      const modUser = await client.users.fetch(mod.id);
      const sent = await modUser.send({ embeds: [forwardEmbed], components: [row] });
      FORWARD_MAP.set(`${mod.id}_${userId}`, sent.id);
      for (const [, att] of message.attachments) {
        try { await modUser.send({ content: `File dari <@${userId}>:`, files: [att.url] }); } catch(e){}
      }
      PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString(), modId: mod.id });
      const hist = loadHistory(); hist.push({ type: 'proof_sent', from: userId, toMod: mod.id, attachments: message.attachments.map(a=>({url:a.url,name:a.name})), content: message.content||'', at: new Date().toISOString() }); saveHistory(hist);
      return;
    } catch (e) {
      decrementModCount(modAccount);
      refreshAllBypassEmbeds().catch(()=>{});
      return message.reply('Gagal meneruskan bukti ke moderator. Silakan coba lagi.');
    }
  } catch (err) {
    try { if (!message.replied) await message.reply('Terjadi error.'); } catch(e){}
  }
});

client.login(TOKEN).catch(err => console.error('Login failed', err));
                                                 
      
