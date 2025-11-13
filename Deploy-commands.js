require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  // /tinder
  new SlashCommandBuilder()
    .setName('tinder')
    .setDescription('Abre o app de encontros dos NPCs do RPG.'),

  // /tinder-gm-likes
  new SlashCommandBuilder()
    .setName('tinder-gm-likes')
    .setDescription('Lista os likes/super likes registrados.')
    .addUserOption(option =>
      option
        .setName('jogador')
        .setDescription('Filtrar por um jogador específico')
        .setRequired(false),
    ),

  // /tinder-gm-match
  new SlashCommandBuilder()
    .setName('tinder-gm-match')
    .setDescription('Força um match entre um jogador e um NPC.')
    .addUserOption(option =>
      option
        .setName('jogador')
        .setDescription('Jogador que vai dar match')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('npc_id')
        .setDescription('ID do NPC (campo "id" no npcs.json, ex: lya)')
        .setRequired(true),
    ),

  // /tinder-gm-npc-like  <-- NOVO
  new SlashCommandBuilder()
    .setName('tinder-gm-npc-like')
    .setDescription('Registrar que um NPC deu like em um jogador.')
    .addStringOption(option =>
      option
        .setName('npc_id')
        .setDescription('ID do NPC (campo "id" no npcs.json)')
        .setRequired(true),
    )
    .addUserOption(option =>
      option
        .setName('jogador')
        .setDescription('Jogador que o NPC curtiu')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('tipo')
        .setDescription('Tipo de like')
        .setRequired(false)
        .addChoices(
          { name: 'Like normal', value: 'like' },
          { name: 'Super like', value: 'super' },
        ),
    ),
];


const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registrando comandos (guild)...');

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      { body: commands },
    );

    console.log('Comandos registrados com sucesso!');
  } catch (error) {
    console.error(error);
  }
})();
