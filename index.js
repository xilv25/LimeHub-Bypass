const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds] // minimal untuk slash command
});

// Slash command yang akan di-deploy
const commands = [
  { name: 'bypass', description: 'Tampilkan panel bypass (minimal version)' }
];

// Deploy commands ke server tertentu (guild-only)
async function deployCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Commands deployed to guild', process.env.GUILD_ID);
  } catch (err) {
    console.error('Deploy command error:', err);
  }
}

// Event ready
client.once('ready', async () => {
  console.log(`Bot ready — ${client.user.tag}`);
  await deployCommands();
});

// Event interaction
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isCommand()) return;
    if (interaction.commandName === 'bypass') {
      await interaction.reply('✅ Bot is working! Slash command /bypass detected.');
    }
  } catch (err) {
    console.error(err);
  }
});

client.login(process.env.TOKEN);
