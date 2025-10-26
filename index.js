const { Client, GatewayIntentBits, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TOKEN = process.env.TOKEN;

if (!CLIENT_ID || !GUILD_ID || !TOKEN) {
  console.error('ENV MISSING: set CLIENT_ID, GUILD_ID, TOKEN in secrets.');
  process.exit(1);
}

const HISTORY_FILE = path.join(__dirname, 'history.json');
function loadHistory() {
  try { if (!fs.existsSync(HISTORY_FILE)) return []; return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')||'[]'); }
  catch (e) { console.error('history load err', e); return []; }
}
function saveHistory(h) {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h, null, 2)); } catch (e) { console.error('history save err', e); }
}

const MODS = {
  '08170512639': { tag: '@jojo168', account: '08170512639', id: process.env.MOD1_ID || '971823685595967610' },
  '085219498004': { tag: '@whoisnda_', account: '085219498004', id: process.env.MOD2_ID || '332128597911273473' }
};

const PROOF_TARGET = new Map();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = [{ name: 'bypass', description: 'Tampilkan panel bypass (volcano)' }];
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Commands deployed to guild', GUILD_ID);
  } catch (err) {
    console.error('Failed to deploy commands:', err);
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
      .setDescription(`Kirim bukti (screenshot / foto / file) sebagai balasan *ke pesan ini*. Bot akan meneruskan bukti ke moderator ${mod.tag}.`)
      .addFields(
        { name: 'Rekening Tujuan', value: mod.account, inline: true },
        { name: 'Petunjuk', value: '1) Balas dengan file. 2) Tambahkan pesan jika perlu. 3) Setelah dikirim, moderator akan menerima file tersebut.' }
      )
      .setFooter({ text: 'Jangan kirim data sensitif lain kecuali bukti transfer.' })
      .setTimestamp();

    const sent = await user.send({ embeds: [dmEmbed] });
    
    PROOF_TARGET.set(user.id, modAccount);
    return true;
  } catch (e) {
    console.error('initiateProofDM error:', e);
    return false;
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    
    if (interaction.isCommand() && interaction.commandName === 'bypass') {
      const embed = new EmbedBuilder()
        .setTitle('🔥 VOLCANO BYPASS')
        .setDescription('Pilih moderator untuk melihat nomor rekening.\nJika ingin kirim bukti transfer, gunakan tombol "Kirim Bukti".')
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
      if (interaction.customId === 'btn_jojo' || interaction.customId === 'btn_whoisnda') {
        const isJojo = interaction.customId === 'btn_jojo';
        const mod = isJojo ? MODS['08170512639'] : MODS['085219498004'];
        const embed = new EmbedBuilder()
          .setTitle(`Informasi Moderator — ${mod.tag.replace('@','')}`)
          .addFields(
            { name: 'Username', value: mod.tag, inline: true },
            { name: 'Nomor Rekening', value: mod.account, inline: true }
          )
          .setFooter({ text: 'Pilih "Kirim Bukti" untuk mengirim bukti transfer ke moderator melalui DM.' })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`proof_${mod.account}`).setLabel('Kirim Bukti').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_info').setLabel('Tutup').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      
      if (interaction.customId.startsWith('proof_')) {
        const account = interaction.customId.split('_')[1];
        const user = interaction.user;
        const ok = await initiateProofDM(user, account);
        if (ok) {
          return interaction.reply({ content: 'Cek DM — kirim bukti sebagai balasan pada pesan DM yang dikirim oleh bot.', ephemeral: true });
        } else {
          return interaction.reply({ content: 'Gagal mengirim DM — kemungkinan DM Anda tertutup. Buka pengaturan privacy agar dapat menerima DM dari server members.', ephemeral: true });
        }
      }

      if (interaction.customId === 'close_info') {
        return interaction.reply({ content: 'Ditutup.', ephemeral: true });
      }
    }
  } catch (err) {
    console.error('interaction error', err);
    try { if (!interaction.replied) await interaction.reply({ content: 'Terjadi error.', ephemeral: true }); } catch {}
  }
});

client.on('messageCreate', async (message) => {
  try {
    
    if (message.author.bot) return;
    if (!message.channel || message.channel.type !== 1) return; 
    const userId = message.author.id;

    
    if (!PROOF_TARGET.has(userId)) {
      
      await message.reply('Halo — jika Anda ingin mengirim bukti transfer, silakan tekan tombol "Kirim Bukti" pada message `/bypass` di server dulu.');
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

    
    try {
      const modUser = await client.users.fetch(mod.id);
      
      const forwardEmbed = new EmbedBuilder()
        .setTitle('📎 Bukti Transfer Diterima')
        .setDescription(`User <@${userId}> mengirim bukti untuk rekening **${mod.account}**`)
        .addFields({ name: 'Catatan pengguna', value: message.content ? (message.content.slice(0, 1024) || '-') : '-' })
        .setTimestamp();

      
      await modUser.send({ embeds: [forwardEmbed] });

      
      for (const [, att] of message.attachments) {
        
        await modUser.send({ content: `File dari <@${userId}>:`, files: [att.url] }).catch(e => console.error('forward att error', e));
      }

      
      await message.reply('Bukti berhasil dikirim ke moderator. Terima kasih.');

      
      const hist = loadHistory();
      hist.push({ userId, modAccount, attachments: message.attachments.map(a => ({ url: a.url, name: a.name })), content: message.content || '', at: new Date().toISOString() });
      saveHistory(hist);

      
      PROOF_TARGET.delete(userId);

    } catch (e) {
      console.error('forward to mod failed', e);
      await message.reply('Gagal meneruskan bukti ke moderator. Silakan hubungi moderator secara manual.');
    }

  } catch (err) {
    console.error('messageCreate handler err', err);
  }
});

client.login(TOKEN).catch(err => {
  console.error('Login failed - check TOKEN & intents (enable Message Content Intent if using MessageContent):', err);
});
