// index.js — FULL PATCHED PART 1
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  Partials, InteractionType
} = require('discord.js');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const MOD1_ID = process.env.MOD1_ID;
const MOD2_ID = process.env.MOD2_ID;

if (!TOKEN||!CLIENT_ID||!GUILD_ID||!MOD1_ID||!MOD2_ID){console.error('ENV missing'); process.exit(1);}

// ===== persistence =====
const DATA_DIR = __dirname;
const QUEUE_FILE = path.join(DATA_DIR,'queue.json');
const PAID_FILE = path.join(DATA_DIR,'paid.json');

function loadJson(fp, fallback){ try{ if(!fs.existsSync(fp)){ fs.writeFileSync(fp,JSON.stringify(fallback,null,2)); return fallback;} return JSON.parse(fs.readFileSync(fp,'utf8')||JSON.stringify(fallback)); } catch(e){ return fallback; } }
function saveJson(fp,obj){ try{fs.writeFileSync(fp,JSON.stringify(obj,null,2));} catch(e){} }

let QUEUE = loadJson(QUEUE_FILE,{accounts:['08170512639','085219498004'],counts:{'08170512639':0,'085219498004':0}});
let PAID_USERS = loadJson(PAID_FILE,{});

function saveQueue(){ saveJson(QUEUE_FILE, QUEUE); }
function savePaid(){ saveJson(PAID_FILE, PAID_USERS); }

// ===== moderators =====
const MODS = {
  '08170512639': { id: MOD1_ID, tag:'@jojo168', account:'08170512639' },
  '085219498004': { id: MOD2_ID, tag:'@whoisnda_', account:'085219498004' }
};
const MOD_ID_TO_ACCOUNT = {};
for(const acc of Object.keys(MODS)) MOD_ID_TO_ACCOUNT[MODS[acc].id]=acc;

// runtime maps
const PROOF_TARGET = new Map(); // userId -> modAccount
const TEMP_ATTACH = new Map(); // temp storage for modal input
const ONLINE = {}; for(const a of Object.keys(MODS)) ONLINE[a]=true;

const client = new Client({
  intents:[GatewayIntentBits.Guilds,GatewayIntentBits.DirectMessages,GatewayIntentBits.MessageContent],
  partials:[Partials.Channel]
});

// ===== helpers =====
const PAID_TTL_MS = 24*60*60*1000;
function markUserPaid(userId,modAccount){ PAID_USERS[userId]={modAccount,ts:Date.now()}; savePaid(); }
function getPaidInfo(userId){ const rec=PAID_USERS[userId]; if(!rec) return null; if(Date.now()-(rec.ts||0)>PAID_TTL_MS){ delete PAID_USERS[userId]; savePaid(); return null; } return rec; }

function getLeastLoadedOnlineAccount(){
  const online = QUEUE.accounts.filter(a=>ONLINE[a]);
  if(!online.length) return null;
  let best=online[0], bestC=QUEUE.counts[best]||0;
  for(const a of online){ const c=QUEUE.counts[a]||0; if(c<bestC){ best=a; bestC=c; } }
  QUEUE.counts[best]=(QUEUE.counts[best]||0)+1;
  saveQueue(); return best;
}
function decrementModCount(acc){ if(!acc) return; QUEUE.counts[acc]=Math.max(0,(QUEUE.counts[acc]||0)-1); saveQueue(); }

function queueStatusFields(){
  const jo='08170512639', who='085219498004';
  const online=QUEUE.accounts.filter(a=>ONLINE[a]);
  let nextTag='No moderators online';
  if(online.length){
    let b=online[0], bc=QUEUE.counts[b]||0;
    for(const a of online){ const c=QUEUE.counts[a]||0; if(c<bc){ b=a; bc=c; } } nextTag=MODS[b].tag;
  }
  let notices=[];
  if(!ONLINE[jo]) notices.push(`${MODS[jo].tag.replace('@','')} is offline, try contacting ${MODS[who].tag.replace('@','')}`);
  if(!ONLINE[who]) notices.push(`${MODS[who].tag.replace('@','')} is offline, try contacting ${MODS[jo].tag.replace('@','')}`);
  return [
    { name:`${MODS[who].tag}`, value:`${QUEUE.counts[who]||0} antrian${!ONLINE[who]?' (OFFLINE)':''}`, inline:true },
    { name:`${MODS[jo].tag}`, value:`${QUEUE.counts[jo]||0} antrian${!ONLINE[jo]?' (OFFLINE)':''}`, inline:true },
    { name:'Next assignment', value:nextTag, inline:false },
    ...(notices.length?[{name:'Notices',value:notices.join('\n'),inline:false}]:[])
  ];
}

// deploy /bypass
async function deployCommands(){
  const rest = new REST({version:'10'}).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:[{name:'bypass',description:'Tampilkan panel bypass'}]});
}

client.once('ready',async()=>{
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});
// ===== interactions =====
client.on('interactionCreate',async(interaction)=>{
  try{
    // slash /bypass
    if(interaction.isCommand()&&interaction.commandName==='bypass'){
      const embed=new EmbedBuilder()
        .setTitle('Bypass Service — Rp. 3.000/hari')
        .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator yang online dan dengan antrian paling sedikit.')
        .setColor(0x2B6CB0)
        .addFields(...queueStatusFields())
        .setFooter({text:'made by @unstoppable_neid'})
        .setTimestamp();
      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['08170512639']),
        new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact Whoisnda').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['085219498004']),
        new ButtonBuilder().setCustomId('already_paid').setLabel('Already Paid ✅').setStyle(ButtonStyle.Success)
      );
      const reply=await interaction.reply({embeds:[embed],components:[row],fetchReply:true});
      setInterval(async()=>{
        try{
          const newEmbed=new EmbedBuilder()
            .setTitle('Bypass Service — Rp. 3.000/hari')
            .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator yang online dan dengan antrian paling sedikit.')
            .setColor(0x2B6CB0)
            .addFields(...queueStatusFields())
            .setFooter({text:'made by @unstoppable_neid'})
            .setTimestamp();
          const newRow=new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['08170512639']),
            new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact Whoisnda').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['085219498004']),
            new ButtonBuilder().setCustomId('already_paid').setLabel('Already Paid ✅').setStyle(ButtonStyle.Success)
          );
          if(reply.editable) await reply.edit({embeds:[newEmbed],components:[newRow]});
        }catch(e){}
      },5000);
      return;
    }

    // buttons
    if(interaction.isButton()){
      const cid=interaction.customId;
      if(cid==='assign_btn_jojo'||cid==='assign_btn_whoisnda'){
        const assigned=cid==='assign_btn_jojo'?'08170512639':'085219498004';
        PROOF_TARGET.set(interaction.user.id,assigned);
        const mod=MODS[assigned];
        const emb=new EmbedBuilder()
          .setTitle('Bypass DM')
          .setDescription(`Kirim bukti transfer disini, bot akan otomatis meneruskannya ke ${mod.tag}`)
          .addFields({name:'Rekening Tujuan',value:mod.account})
          .setColor(0x2B6CB0)
          .setFooter({text:'Isi bukti + link lalu submit'})
          .setTimestamp();
        const modal=new ModalBuilder().setCustomId(`modal_proof_${interaction.user.id}`).setTitle('Kirim Bukti + Link');
        const proofInput=new TextInputBuilder().setCustomId('proof').setLabel('Link bukti TF').setStyle(TextInputStyle.Short).setRequired(true);
        const linkInput=new TextInputBuilder().setCustomId('link').setLabel('Link Bypass').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents({type:1,components:[proofInput]},{type:1,components:[linkInput]});
        await interaction.user.send({embeds:[emb]});
        return interaction.showModal(modal);
      }

      if(cid==='already_paid'){
        const modal=new ModalBuilder().setCustomId(`modal_paid_${interaction.user.id}`).setTitle('Already Paid — Link bypass');
        const linkInput=new TextInputBuilder().setCustomId('link').setLabel('Link Bypass').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents({type:1,components:[linkInput]});
        return interaction.showModal(modal);
      }
    }

    // modal submit
    if(interaction.type===InteractionType.ModalSubmit){
      const cid=interaction.customId;
      if(cid.startsWith('modal_proof_')||cid.startsWith('modal_paid_')){
        const userId=interaction.user.id;
        const proof=interaction.fields.getTextInputValue('proof')||'';
        const link=interaction.fields.getTextInputValue('link');
        let assigned=PROOF_TARGET.get(userId);
        if(!assigned){
          assigned=getLeastLoadedOnlineAccount();
          PROOF_TARGET.set(userId,assigned);
        }
        const mod=MODS[assigned];
        try{
          const modUser=await client.users.fetch(mod.id);
          const fwdEmbed=new EmbedBuilder()
            .setTitle('📩 New Bypass Request')
            .setDescription(`User <@${userId}> mengirim bukti TF dan link bypass.`)
            .addFields(
              {name:'User',value:`<@${userId}>`,inline:true},
              {name:'Bukti TF',value:proof||'—',inline:true},
              {name:'Link Bypass',value:link,inline:true}
            )
            .setFooter({text:'Moderator bisa tekan Cancel jika dibatalkan'})
            .setTimestamp();
          const row=new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
          );
          await modUser.send({embeds:[fwdEmbed],components:[row]});
          decrementModCount(assigned);
          PROOF_TARGET.delete(userId);
          return interaction.reply({content:`Request berhasil dikirim ke ${mod.tag}`,ephemeral:true});
        }catch(e){
          return interaction.reply({content:'Gagal mengirim ke moderator.',ephemeral:true});
        }
      }
    }

  }catch(e){console.error('interactionCreate err',e);}
});

client.login(TOKEN);
