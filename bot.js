const { Client, GatewayIntentBits } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('./config.json');

// ─── ÉTAT DU BOT ──────────────────────────────────────────────────────────────
let botEnabled = true;
let currentPrompt = config.systemPrompt;
let debugChannel = null;

// ─── DEBUG ────────────────────────────────────────────────────────────────────
async function debug(msg) {
  console.log(msg);
  try {
    if (debugChannel) await debugChannel.send(`🔧 \`DEBUG\` ${msg}`);
  } catch (_) {}
}

// ─── ROTATION TOKENS GEMINI ───────────────────────────────────────────────────
let currentTokenIndex = 0;
function getNextGeminiClient() {
  const token = config.geminiTokens[currentTokenIndex];
  currentTokenIndex = (currentTokenIndex + 1) % config.geminiTokens.length;
  return new GoogleGenerativeAI(token);
}

// ─── HISTORIQUE PAR SALON ─────────────────────────────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY = 10;

function getHistory(channelId) {
  if (!conversationHistory.has(channelId)) conversationHistory.set(channelId, []);
  return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, text) {
  const history = getHistory(channelId);
  history.push({ role, parts: [{ text }] });
  if (history.length > MAX_HISTORY * 2) history.splice(0, 2);
}

// ─── APPEL GEMINI ─────────────────────────────────────────────────────────────
async function askGemini(channelId, userMessage) {
  const genAI = getNextGeminiClient();
  const model = genAI.getGenerativeModel({
    model: config.geminiModel || 'gemini-2.0-flash',
    systemInstruction: currentPrompt,
  });

  const chat = model.startChat({
    history: getHistory(channelId),
    generationConfig: { maxOutputTokens: 1500, temperature: 0.8 },
  });

  const result = await chat.sendMessage(userMessage);
  const responseText = result.response.text();

  addToHistory(channelId, 'user', userMessage);
  addToHistory(channelId, 'model', responseText);

  return responseText;
}

// ─── VÉRIFICATION PERMISSION ──────────────────────────────────────────────────
function hasPermission(userId, member) {
  if (config.authorizedUserIds && config.authorizedUserIds.includes(userId)) return true;
  if (config.authorizedRoleIds && member) {
    return member.roles.cache.some(role => config.authorizedRoleIds.includes(role.id));
  }
  return false;
}

// ─── CLIENT DISCORD ───────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);
  console.log(`🔑 ${config.geminiTokens.length} token(s) Gemini`);
  updateActivity();

  try {
    debugChannel = await client.channels.fetch(config.generalChannelId);
    await debugChannel.send(`✅ Bot connecté : **${client.user.tag}**\n🔑 ${config.geminiTokens.length} token(s) Gemini\n📌 Salon ID : \`${config.generalChannelId}\``);
  } catch (err) {
    console.error('❌ Impossible accéder au salon:', err.message);
  }
});

function updateActivity() {
  client.user.setActivity(botEnabled ? '💬 En ligne dans #général' : '🔴 En pause');
}

// ─── MESSAGES DU SALON GÉNÉRAL ────────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!botEnabled) return;

  const isTargetChannel = message.channel.id === config.generalChannelId;
  if (!isTargetChannel) {
    await debug(`Message dans mauvais salon: \`${message.channel.id}\` (attendu: \`${config.generalChannelId}\`)`);
    return;
  }

  const userText = message.content.trim();
  if (!userText) return;

  await debug(`Message de ${message.author.displayName}: "${userText}"`);

  try { await message.channel.sendTyping(); } catch (_) {}

  try {
    const prompt = `[${message.author.displayName}]: ${userText}`;
    const response = await askGemini(message.channel.id, prompt);

    await debug(`Gemini OK (${response.length} chars)`);

    if (response.length <= 2000) {
      await message.reply(response);
    } else {
      const chunks = splitMessage(response, 2000);
      for (const chunk of chunks) await message.channel.send(chunk);
    }
  } catch (err) {
    await debug(`❌ Erreur Gemini: ${err.message}`);
    try { await message.reply('❌ Erreur momentanée, réessaie !'); } catch (_) {}
  }
});

// ─── COMMANDES SLASH ──────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user, member } = interaction;

  if (['on', 'off', 'prompt'].includes(commandName)) {
    if (!hasPermission(user.id, member)) {
      return interaction.reply({
        content: '🚫 Tu n\'as pas la permission d\'utiliser cette commande.',
        ephemeral: true,
      });
    }
  }

  if (commandName === 'on') {
    botEnabled = true;
    updateActivity();
    return interaction.reply({ content: '✅ Bot **activé** !', ephemeral: true });
  }

  if (commandName === 'off') {
    botEnabled = false;
    updateActivity();
    return interaction.reply({ content: '🔴 Bot **désactivé** !', ephemeral: true });
  }

  if (commandName === 'prompt') {
    const newPrompt = interaction.options.getString('texte');
    currentPrompt = newPrompt;
    conversationHistory.clear();
    return interaction.reply({
      content: `✏️ Prompt mis à jour :\n> ${newPrompt}`,
      ephemeral: true,
    });
  }

  if (commandName === 'reset') {
    conversationHistory.clear();
    return interaction.reply({ content: '🔄 Historique effacé !', ephemeral: true });
  }
});

// ─── UTILITAIRE ───────────────────────────────────────────────────────────────
function splitMessage(text, maxLength) {
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, maxLength));
    text = text.slice(maxLength);
  }
  return chunks;
}

client.login(process.env.DISCORD_TOKEN || config.discordToken);
