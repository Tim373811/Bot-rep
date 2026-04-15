const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config.json');

const commands = [
  new SlashCommandBuilder()
    .setName('on')
    .setDescription('Active le bot dans le salon général'),

  new SlashCommandBuilder()
    .setName('off')
    .setDescription('Désactive le bot dans le salon général'),

  new SlashCommandBuilder()
    .setName('prompt')
    .setDescription("Modifie le comportement de l'IA")
    .addStringOption(opt =>
      opt.setName('texte')
        .setDescription('Le nouveau prompt système')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription("Efface l'historique de conversation"),

].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(config.discordToken);

(async () => {
  try {
    console.log('📡 Enregistrement des commandes slash...');
    const app = await rest.get(Routes.oauth2CurrentApplication());
    await rest.put(Routes.applicationCommands(app.id), { body: commands });
    console.log('✅ Commandes enregistrées :');
    console.log('  /on     — activer le bot');
    console.log('  /off    — désactiver le bot');
    console.log('  /prompt — changer le comportement IA');
    console.log('  /reset  — effacer l\'historique');
  } catch (err) {
    console.error('❌ Erreur:', err);
  }
})();
