// ===========================================
// Bypass Bot — Full + Queue Realtime + Auto-refresh + DM Buttons Hide
// ===========================================
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  Partials
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
  console.error('ENV missing');
  process.exit(1);
}

// ====== files ======
const HISTORY_FILE = path.join(__dirname, 'history.json');
const QUEUE_FILE = path.join(__dirname, 'queue.json');

function loadHistory(){ try{ return fs.existsSync(HISTORY_FILE)? JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')||'[]') : []; } catch(e){ console.error(e); return []; } }
function saveHistory(arr){ try{ fs.writeFileSync(HISTORY_FILE, JSON.stringify(arr, null, 2)) } catch(e){ console.error(e); } }

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
  } catch(e){ console.error(e); return null; }
}
function saveQueue(q){ try{ fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)) } catch(e){ console.error(e); } }

// ====== Moderators mapping ======
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

// runtime maps
const PROOF_TARGET = new Map(); // userId -> modAccount
const PENDING = new Map(); // userId -> { modAccount, createdAt }
const BYPASS_EMBEDS = new Map(); // interactionId -> message

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

// ====== forward proof to mod (DM) ======
async function forwardProofToMod(message, mod) {
  const userId = message.author.id;
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

  let modUser;
  try{ modUser = await client.users.fetch(mod.id); } catch { return message.reply('Gagal DM mod.'); }

  try{
    await modUser.send({ embeds: [forwardEmbed], components: [row] });
    for (const [, att] of message.attachments) {
      try { await modUser.send({ content: `File dari <@${userId}>:`, files: [att.url] }); } catch{}
    }
    PENDING.set(userId, { modAccount: mod.account, createdAt: new Date().toISOString() });
    const hist = loadHistory();
    hist.push({ type: 'proof_sent', from: userId, toMod: mod.id, attachments: message.attachments.map(a=>({ url: a.url, name: a.name })), content: message.content || '', at: new Date().toISOString() });
    saveHistory(hist);
    return true;
  } catch(e){ console.error(e); message.reply('Gagal meneruskan bukti ke mod.'); return false; }
}

// ----- assign user DM to next mod -----
async function initiateProofDMAssign(user) {
  try {
    const assignedAccount = getNextModAccount();
    const mod = MODS[assignedAccount];
    await user.send({ embeds: [new EmbedBuilder().setTitle('Kirim Bukti Transfer').setDescription(`Kirim bukti ke moderator ${mod.tag} sebagai balasan pesan ini.`).addFields({ name: 'Rekening Tujuan', value: mod.account })] });
    PROOF_TARGET.set(user.id, assignedAccount);
    return { ok: true, assignedAccount };
  } catch(e) { console.error(e); return { ok: false }; }
}

// ====== interaction handler ======
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS')
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

      // auto-refresh embed tiap 10 detik
      const interval = setInterval(async () => {
        if (!BYPASS_EMBEDS.has(reply.id)) return clearInterval(interval);
        try {
          const msg = BYPASS_EMBEDS.get(reply.id);
          if (!msg.editable) return clearInterval(interval);
          const newEmbed = new EmbedBuilder()
            .setTitle('🔥 VOLCANO BYPASS (Update)')
            .setDescription('Tombol biru untuk fairness, assignment auto round-robin.')
            .setColor(0x2B6CB0)
            .addFields(...queueStatusFields())
            .setFooter({ text: 'made by @unstoppable_neid' })
            .setTimestamp();
          await msg.edit({ embeds: [newEmbed] });
        } catch(e){ console.error('Auto-refresh error', e); clearInterval(interval); }
      }, 10000);
    }

    if (interaction.isButton()) {
      const cid = interaction.customId;
      // tombol assign
      if (cid === 'assign_btn_jojo' || cid === 'assign_btn_whoisnda') {
        const res = await initiateProofDMAssign(interaction.user);
        if (!res.ok) return interaction.reply({ content: 'Gagal DM, buka DM anda.', ephemeral: true });
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

        const hist = loadHistory();
        hist.push({ type: 'assigned', userId: interaction.user.id, toAccount: assigned, at: new Date().toISOString() });
        saveHistory(hist);
        return interaction.reply({ embeds: [emb], components: [row], ephemeral: true });
      }

      // tombol mod DM (Send Bypass / Done / Cancel / Error)
      if (/^(sendbypass|done|cancel|error)_\d+$/.test(cid)) {
        const [action, userId] = cid.split('_');
        const pending = PENDING.get(userId) || null;
        if (pending && pending.modAccount) decrementModCount(pending.modAccount);
        if (PENDING.has(userId)) PENDING.delete(userId);

        // hapus tombol agar mod tau sudah dikerjakan
        await interaction.update({
          content: `Tombol ${action.toUpperCase()} ditekan oleh <@${interaction.user.id}>`,
          components: [],
          embeds: interaction.message.embeds
        });

        // DM user jika bukan Send Bypass
        if (action !== 'sendbypass') {
          try{
            const user = await client.users.fetch(userId);
            const emoji = action==='done'?'✅':(action==='cancel'?'❌':'⚠️');
            await user.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle(`Status Transfer: ${action.toUpperCase()} ${emoji}`)
                  .setDescription(`Moderator <@${interaction.user.id}> menandai transaksimu sebagai **${action.toUpperCase()}**`)
                  .setTimestamp()
              ]
            });
          } catch(e){ console.error(e); }
        }
        return;
      }
    }
  } catch(e){ console.error(e); if (interaction&&!interaction.replied) interaction.reply({ content:'Error', ephemeral:true }); }
});

// ====== DM listener ======
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.channel || (message.channel.type !== 1 && message.channel.type !== 'DM')) return;

  const userId = message.author.id;
  if (!PROOF_TARGET.has(userId)) return message.reply('Tekan tombol di /bypass dulu.');
  const modAccount = PROOF_TARGET.get(userId);
  const mod = MODS[modAccount];
  if (!mod) { PROOF_TARGET.delete(userId); return message.reply('Moderator tidak ditemukan, ulangi dari server.'); }
  if (!message.attachments || message.attachments.size===0) return message.reply('Tidak menemukan attachment.');

  const ok = await forwardProofToMod(message, mod);
  if (!ok) decrementModCount(modAccount);
});

// ====== login ======
client.login(TOKEN).catch(e=>console.error('Login gagal:',e));
