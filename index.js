// ===========================================
// Bypass Bot — Full Copy-Paste Version (HP friendly)
// ===========================================
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  Partials, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType
} = require('discord.js');
require('dotenv').config();

// ====== Replit Secrets ======
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

// ====== History File ======
const HISTORY_FILE = path.join(__dirname,'history.json');
function loadHistory(){try{return fs.existsSync(HISTORY_FILE)?JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8')||'[]'):[]}catch(e){return[]}}
function saveHistory(arr){try{fs.writeFileSync(HISTORY_FILE,JSON.stringify(arr,null,2))}catch(e){console.error(e)}}

// ====== Moderator mapping ======
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};

// ====== Runtime maps ======
const PROOF_TARGET = new Map(); // userId -> modAccount

// ====== Client setup ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

// ====== Deploy slash commands ======
async function deployCommands(){
  try{
    const rest = new REST({version:'10'}).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID), {body:[{name:'bypass',description:'Tampilkan panel bypass'}]});
    console.log('Commands deployed');
  }catch(e){console.error('deployCommands error',e);}
}

client.once('ready', async()=>{
  console.log(`Bot ready: ${client.user.tag}`);
  await deployCommands();
});

// ====== Sleep helper ======
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

// ====== Forward proof to mod (DM only, retry 3x) ======
async function forwardProofToModNoChannel(message, mod){
  const userId = message.author.id;
  console.log(`[forward] start -> from ${userId} to modAccount ${mod.account} (modId ${mod.id})`);
  if(!mod.id){console.error('[forward] mod.id missing'); try{await message.reply('Error internal (mod ID). Hubungi admin.')}catch{}; return false;}
  
  const forwardEmbed = new EmbedBuilder()
    .setTitle('📎 Bukti Transfer Diterima')
    .setDescription(`User <@${userId}> mengirim bukti untuk rekening **${mod.account}**`)
    .addFields({name:'Catatan pengguna', value: message.content?message.content.slice(0,1024):'-'})
    .setFooter({text:`Kirim oleh ${message.author.tag}`})
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reply_${userId}`).setLabel('Reply to Sender').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`done_${userId}`).setLabel('Done ✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`error_${userId}`).setLabel('Error ⚠️').setStyle(ButtonStyle.Secondary)
  );

  let modUser;
  try{modUser=await client.users.fetch(mod.id); if(!modUser)throw new Error('fetch returned null');}catch(fetchErr){
    console.error('[forward] fetch mod user failed:',fetchErr);
    try{await message.reply('Gagal mengirim bukti: moderator tidak dapat ditemukan. Hubungi moderator langsung.')}catch{}; return false;
  }

  const maxRetries=3; let lastErr=null;
  for(let attempt=1; attempt<=maxRetries; attempt++){
    try{
      console.log(`[forward] attempt ${attempt} -> sending embed to mod ${mod.id}`);
      await modUser.send({embeds:[forwardEmbed],components:[row]});
      for(const [,att] of message.attachments){try{await modUser.send({content:`File dari <@${userId}>:`,files:[att.url]})}catch(attErr){console.error('[forward] attachment send failed',attErr);}}
      console.log('[forward] success -> DM sent to mod',mod.id);
      try{await message.reply('Bukti berhasil dikirim ke moderator. Tunggu konfirmasi mereka.')}catch{}
      PROOF_TARGET.delete(userId);
      const hist=loadHistory(); hist.push({type:'proof_sent',from:userId,toMod:mod.id,attachments:message.attachments.map(a=>({url:a.url,name:a.name})),content:message.content||'',at:new Date().toISOString()}); saveHistory(hist);
      return true;
    }catch(dmErr){lastErr=dmErr; console.error(`[forward] attempt ${attempt} failed:`,dmErr); if(dmErr?.code===50007||(dmErr.message&&dmErr.message.toLowerCase().includes('cannot send messages to this user'))){console.error('[forward] DM blocked. Stop retry.'); break;} await sleep(700*attempt);}
  }
  console.error('[forward] all attempts failed. last error:',lastErr);
  try{await message.reply('Gagal meneruskan bukti ke moderator via DM. Hubungi moderator secara langsung.')}catch{}
  return false;
}

// ====== Send DM to user instructing proof ======
async function initiateProofDM(user, modAccount){
  try{
    const mod=MODS[modAccount]; if(!mod) return false;
    const dmEmbed=new EmbedBuilder()
      .setTitle('Kirim Bukti Transfer')
      .setDescription(`Kirim bukti sebagai balasan ke pesan ini. Moderator: ${mod.tag}`)
      .addFields({name:'Rekening Tujuan',value:mod.account,inline:true})
      .setFooter({text:'Hanya kirim bukti transfer (screenshot).'})
      .setTimestamp();
    await user.send({embeds:[dmEmbed]});
    PROOF_TARGET.set(user.id,modAccount);
    return true;
  }catch(e){console.error('initiateProofDM error',e); return false;}
}

// ====== Slash + Buttons + Modal ======
client.on('interactionCreate',async(interaction)=>{
  try{
    if(interaction.isCommand() && interaction.commandName==='bypass'){
      const embed=new EmbedBuilder().setTitle('🔥 VOLCANO BYPASS').setDescription('Pilih moderator untuk melihat nomor rekening.\nGunakan "Kirim Bukti" untuk mengirim bukti transfer ke moderator.').setColor(0xEA5455).setTimestamp().setFooter({text:'made by @unstoppable_neid'});
      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({embeds:[embed],components:[row]});
    }

    if(interaction.isButton()){
      const cid=interaction.customId;
      if(cid==='btn_jojo'||cid==='btn_whoisnda'){
        const modAccount=cid==='btn_jojo'?'08170512639':'085219498004';
        const mod=MODS[modAccount]; if(!mod)return interaction.reply({content:'Moderator tidak ditemukan.',ephemeral:true});
        const emb=new EmbedBuilder().setTitle(`Informasi Moderator — ${mod.tag.replace('@','')}`).addFields(
          {name:'Moderator',value:mod.tag,inline:true},{name:'Nomor Rekening',value:mod.account,inline:true}
        ).setFooter({text:'Pilih "Kirim Bukti" untuk mengirim bukti transfer via DM.'}).setTimestamp();
        const row=new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`proof_${mod.account}`).setLabel('Kirim Bukti').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_info').setLabel('Tutup').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({embeds:[emb],components:[row],ephemeral:true});
      }

      if(cid.startsWith('proof_')){
        const account=cid.split('_')[1];
        const ok=await initiateProofDM(interaction.user,account);
        return interaction.reply({content:ok?'Cek DM — kirim bukti sebagai balasan':'Gagal mengirim DM — cek pengaturan privacy Anda.',ephemeral:true});
      }

      if(cid==='close_info') return interaction.reply({content:'Ditutup.',ephemeral:true});
    }

    if(interaction.type===InteractionType.ModalSubmit && interaction.customId.startsWith('modal_reply_')){
      const parts=interaction.customId.split('_'); const userId=parts[2]; const modClickingId=interaction.user.id;
      const bypassCode=interaction.fields.getTextInputValue('bypass_code').trim();
      const extraNote=interaction.fields.getTextInputValue('extra_note')||'';
      const finalMessage=extraNote?`copy this bypass : ${bypassCode}\n\n${extraNote}`:`copy this bypass : ${bypassCode}`;
      try{
        const user=await client.users.fetch(userId);
        await user.send({content:finalMessage});
        await interaction.reply({content:'Bypass code berhasil dikirim ke pengirim bukti.',ephemeral:true});
        const hist=loadHistory();
        hist.push({type:'reply_bypass',to:userId,fromMod:modClickingId,bypassCode,extraNote,at:new Date().toISOString()});
        saveHistory(hist);
      }catch(e){console.error('Failed send bypass DM:',e); await interaction.reply({content:'Gagal mengirim pesan ke user.',ephemeral:true});}
    }

  }catch(err){console.error('interaction handler error',err);}
});

// ====== DM message listener ======
client.on('messageCreate',async(message)=>{
  try{
    if(message.author.bot) return;
    const isDM=message.channel?.type===1||message.channel?.type==='DM';
    if(!isDM) return;
    const userId=message.author.id;
    if(!PROOF_TARGET.has(userId)) return message.reply('Tekan tombol "Kirim Bukti" di server dulu sebelum kirim file.');
    const modAccount=PROOF_TARGET.get(userId); const mod=MODS[modAccount]; if(!mod)return message.reply('Moderator tidak ditemukan. Coba lagi.');
    if(!message.attachments||message.attachments.size===0) return message.reply('Tidak menemukan attachment. Kirim
