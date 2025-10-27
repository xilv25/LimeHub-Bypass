// index.js - Bypass Bot Full Build
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType,
  Partials
} = require('discord.js');
require('dotenv').config();

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const MOD1_ID = process.env.MOD1_ID; // jojo
const MOD2_ID = process.env.MOD2_ID; // whoisnda

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !MOD1_ID || !MOD2_ID) process.exit(1);

// persistence files
const DATA_DIR = __dirname;
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const PAID_FILE = path.join(DATA_DIR, 'paid.json');

function loadJsonSafe(fp, fallback){ try { if(!fs.existsSync(fp)){fs.writeFileSync(fp,JSON.stringify(fallback,null,2));return fallback;} return JSON.parse(fs.readFileSync(fp,'utf8')||JSON.stringify(fallback));} catch(e){return fallback;} }
function saveJsonSafe(fp,obj){try{fs.writeFileSync(fp,JSON.stringify(obj,null,2));}catch(e){console.error(e);}}
function loadHistory(){return loadJsonSafe(HISTORY_FILE,[]);}
function saveHistory(h){saveJsonSafe(HISTORY_FILE,h);}
function loadQueue(){return loadJsonSafe(QUEUE_FILE,{accounts:['08170512639','085219498004'],counts:{'08170512639':0,'085219498004':0}});}
function saveQueue(q){saveJsonSafe(QUEUE_FILE,q);}
function loadPaid(){return loadJsonSafe(PAID_FILE,{});}
function savePaid(p){saveJsonSafe(PAID_FILE,p);}

// moderator mapping
const MODS = {
  '08170512639': { id: MOD1_ID, tag: '@jojo168', account: '08170512639' },
  '085219498004': { id: MOD2_ID, tag: '@whoisnda_', account: '085219498004' }
};
const MOD_ID_TO_ACCOUNT = {};
for(const acc of Object.keys(MODS)) MOD_ID_TO_ACCOUNT[MODS[acc].id]=acc;

// runtime maps
const PROOF_TARGET = new Map(); // userId -> modAccount
const PENDING = new Map(); // userId -> {modAccount, createdAt, modId}
const BYPASS_EMBEDS = new Map(); // messageId -> message
const FORWARD_MAP = new Map(); // `${modId}_${userId}` -> forwardedMessageId

// persistent data
let QUEUE = loadQueue();
let PAID_USERS = loadPaid(); // userId -> {modAccount, ts}

// online status
let ONLINE = {};
for(const acc of Object.keys(MODS)) ONLINE[acc]=true;

// client
const client = new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.DirectMessages,GatewayIntentBits.MessageContent],partials:[Partials.Channel]});

// helpers
const PAID_TTL_MS = 24*60*60*1000;
function markUserPaid(userId,modAccount){PAID_USERS[userId]={modAccount,ts:Date.now()};savePaid(PAID_USERS);}
function getPaidInfo(userId){const rec=PAID_USERS[userId];if(!rec)return null;if(Date.now()-rec.ts>PAID_TTL_MS){delete PAID_USERS[userId];savePaid(PAID_USERS);return null;}return rec;}

// queue helpers
function recomputeQueueCounts(){
  if(!QUEUE||!QUEUE.accounts)return;
  for(const acc of QUEUE.accounts) QUEUE.counts[acc]=0;
  for(const [,pending] of PENDING.entries()){ if(pending?.modAccount && QUEUE.counts.hasOwnProperty(pending.modAccount)) QUEUE.counts[pending.modAccount]=(QUEUE.counts[pending.modAccount]||0)+1;}
  saveQueue(QUEUE);
}
function getLeastLoadedOnlineAccount(){const online=QUEUE.accounts.filter(a=>ONLINE[a]);if(!online.length)return null;let best=online[0],bestCount=QUEUE.counts[best]||0;for(const a of online){const c=QUEUE.counts[a]||0;if(c<bestCount){best=a;bestCount=c;}}return best;}
function decrementModCount(acc){if(!acc)return;QUEUE.counts[acc]=Math.max(0,(QUEUE.counts[acc]||0)-1);saveQueue(QUEUE);}
function queueStatusFields(){
  const who='085219498004', jo='08170512639';
  const online=QUEUE.accounts.filter(a=>ONLINE[a]);
  let nextTag='No moderators online';
  if(online.length){let b=online[0],bc=QUEUE.counts[b]||0;for(const a of online){const c=QUEUE.counts[a]||0;if(c<bc){b=a;bc=c;}}nextTag=MODS[b].tag;}
  let notices=[];
  if(!ONLINE[jo]) notices.push(`${MODS[jo].tag.replace('@','')} is offline, try contacting ${MODS[who].tag.replace('@','')}`);
  if(!ONLINE[who]) notices.push(`${MODS[who].tag.replace('@','')} is offline, try contacting ${MODS[jo].tag.replace('@','')}`);
  return [
    {name:MODS[who].tag,value:`${QUEUE.counts[who]||0} antrian${!ONLINE[who]?' (OFFLINE)':''}`,inline:true},
    {name:MODS[jo].tag,value:`${QUEUE.counts[jo]||0} antrian${!ONLINE[jo]?' (OFFLINE)':''}`,inline:true},
    {name:'Next assignment',value:`${nextTag}`,inline:false},
    ...(notices.length?[{name:'Notices',value:notices.join('\n'),inline:false}]:[])
  ];
}

// deploy command
async function deployCommands(){
  try{const rest=new REST({version:'10'}).setToken(TOKEN);await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:[{name:'bypass',description:'Tampilkan panel bypass'}]});console.log('Commands deployed');}catch(e){console.error(e);}
}
client.once('ready',async()=>{console.log(`Bot ready — ${client.user.tag}`);await deployCommands();});
async function refreshAllBypassEmbeds(){
  for(const [msgId,msg] of BYPASS_EMBEDS.entries()){
    try{
      const newEmbed=new EmbedBuilder()
        .setTitle('Bypass Service — Rp. 3.000/hari')
        .setDescription('Layanan bypass. Tombol biru — sistem akan mengarahkan Anda ke moderator yang online dan dengan antrian paling sedikit.')
        .setColor(0x2B6CB0)
        .addFields(...queueStatusFields())
        .setFooter({text:'made by @unstoppable_neid'}).setTimestamp();
      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('assign_btn_jojo').setLabel('Contact Jojo').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['08170512639']),
        new ButtonBuilder().setCustomId('assign_btn_whoisnda').setLabel('Contact WhoisNda').setStyle(ButtonStyle.Primary).setDisabled(!ONLINE['085219498004']),
        new ButtonBuilder().setCustomId('already_paid').setLabel('Already Paid ✅').setStyle(ButtonStyle.Success)
      );
      if(msg && msg.editable){await msg.edit({embeds:[newEmbed],components:[row]});}else BYPASS_EMBEDS.delete(msgId);
    }catch(e){BYPASS_EMBEDS.delete(msgId);}
  }
}

async function forwardRequestToMod(userId,mod,titleSuffix=''){
  const forwardEmbed=new EmbedBuilder()
    .setTitle(`📩 Support Request ${titleSuffix}`.trim())
    .setDescription(`User <@${userId}> requests support.`)
    .addFields({name:'User',value:`<@${userId}>`,inline:true},{name:'Rekening tujuan',value:mod.account,inline:true})
    .setFooter({text:'Click Send Bypass to deliver bypass, or Cancel to decline.'}).setTimestamp();
  const row=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`sendbypass_${userId}`).setLabel('Send Bypass').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`cancel_${userId}`).setLabel('Cancel ❌').setStyle(ButtonStyle.Danger)
  );
  try{
    const modUser=await client.users.fetch(mod.id);
    const sent=await modUser.send({embeds:[forwardEmbed],components:[row]});
    FORWARD_MAP.set(`${mod.id}_${userId}`,sent.id);
    PENDING.set(userId,{modAccount:mod.account,createdAt:new Date().toISOString(),modId:mod.id});
    recomputeQueueCounts();
    const hist=loadHistory();hist.push({type:'request_forwarded',userId,toMod:mod.id,at:new Date().toISOString()});saveHistory(hist);
    return true;
  }catch(e){return false;}
}

// ... lanjutkan event interactionCreate, tombol assign / already_paid / sendbypass / cancel / modal handling ...
// Pastikan di setiap PENDING.set(...) / delete(...) memanggil recomputeQueueCounts() + refreshAllBypassEmbeds()
