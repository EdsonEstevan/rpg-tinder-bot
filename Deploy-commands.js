require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  // /tinder
  new SlashCommandBuilder()
    .setName('tinder')
    .setDescription('Abre o app de encontros dos NPCs do RPG.'),

  // /tinder-viewnpc
  new SlashCommandBuilder()
    .setName('tinder-viewnpc')
    .setDescription('Mostra o card de um NPC específico.')
    .addStringOption(option =>
      option
        .setName('npc')
        .setDescription('Selecione o NPC pelo nome')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  // /tinder-likes
  new SlashCommandBuilder()
    .setName('tinder-likes')
    .setDescription('Lista os likes/super likes registrados.')
    .addUserOption(option =>
      option
        .setName('jogador')
        .setDescription('Filtrar por um jogador específico')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(null),

  // /tinder-match
  new SlashCommandBuilder()
    .setName('tinder-match')
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
        .setRequired(true)
        .setAutocomplete(true),
    )
    .setDefaultMemberPermissions(null),

  // /tinder-reset
  new SlashCommandBuilder()
    .setName('tinder-reset')
    .setDescription('Limpa swipes e matches de um jogador para ele recomeçar.')
    .addUserOption(option =>
      option
        .setName('jogador')
        .setDescription('Jogador que terá o histórico zerado')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(null),

  // /tinder-npc-like
  new SlashCommandBuilder()
    .setName('tinder-npc-like')
    .setDescription('Registrar que um NPC deu like em um jogador.')
    .addStringOption(option =>
      option
        .setName('npc_id')
        .setDescription('ID do NPC (campo "id" no npcs.json)')
        .setRequired(true)
        .setAutocomplete(true),
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
    )
    .setDefaultMemberPermissions(null),

  // /tinder-addnpc
  new SlashCommandBuilder()
    .setName('tinder-addnpc')
    .setDescription('Cadastra um novo NPC no Tinder do RPG.')
    .addStringOption(option =>
      option
        .setName('nome')
        .setDescription('Nome público do NPC')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('idade')
        .setDescription('Idade mostrada no card')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('descricao')
        .setDescription('Bio/descrição exibida no card')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('gostos')
        .setDescription('Tags separados por vírgula ou espaço')
        .setRequired(false),
    )
    .addIntegerOption(option =>
      option
        .setName('nota')
        .setDescription('Nota do NPC (1 a 5 estrelas)')
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(false),
    )
    .addStringOption(option =>
      option
        .setName('nota_motivo')
        .setDescription('Motivo/resumo para a nota atribuída')
        .setRequired(false),
    )
    .addStringOption(option =>
      option
        .setName('imagem_url')
        .setDescription('URL direta da imagem do NPC')
        .setRequired(false),
    )
    .addAttachmentOption(option =>
      option
        .setName('imagem')
        .setDescription('Anexe a imagem do NPC aqui')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(null),

  // /tinder-foto
  new SlashCommandBuilder()
    .setName('tinder-foto')
    .setDescription('Atualiza a imagem salva de um NPC.')
    .addStringOption(option =>
      option
        .setName('npc')
        .setDescription('Selecione o NPC que terá a imagem atualizada')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption(option =>
      option
        .setName('imagem_url')
        .setDescription('URL pública para a nova imagem')
        .setRequired(false),
    )
    .addAttachmentOption(option =>
      option
        .setName('imagem')
        .setDescription('Envie a nova imagem do NPC')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(null),

  // /tinder-nota
  new SlashCommandBuilder()
    .setName('tinder-nota')
    .setDescription('Atualiza a nota e o motivo de um NPC existente.')
    .addStringOption(option =>
      option
        .setName('npc_id')
        .setDescription('ID do NPC (campo "id" no npcs.json)')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addIntegerOption(option =>
      option
        .setName('nota')
        .setDescription('Nota (1 a 5 estrelas)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(5),
    )
    .addStringOption(option =>
      option
        .setName('motivo')
        .setDescription('Motivo/resumo explicando a nota atribuída')
        .setRequired(true),
    )
    .setDefaultMemberPermissions(null),

  // /tinder-removenpc
  new SlashCommandBuilder()
    .setName('tinder-removenpc')
    .setDescription('Remove um NPC existente e limpa registros relacionados.')
    .addStringOption(option =>
      option
        .setName('npc_id')
        .setDescription('ID do NPC a ser removido (campo "id" no npcs.json)')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .setDefaultMemberPermissions(null),

  // /tinder-teste
  new SlashCommandBuilder()
    .setName('tinder-teste')
    .setDescription('Modo admin para testar todos os NPCs sem registrar swipes.')
    .setDefaultMemberPermissions(null),

  // /tinder-npcs
  new SlashCommandBuilder()
    .setName('tinder-npcs')
    .setDescription('Lista todos os NPCs cadastrados (nome + ID).'),

  // /tinder-ajuda
  new SlashCommandBuilder()
    .setName('tinder-ajuda')
    .setDescription('Mostra a lista de comandos do Tinder do RPG.'),
];


const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

const clientId = process.env.CLIENT_ID;

if (!clientId) {
  throw new Error('Defina CLIENT_ID no .env antes de registrar os comandos.');
}

const guildsToClear = (process.env.GUILD_IDS_TO_CLEAR || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

(async () => {
  try {
    console.log('Registrando comandos globais...');

    await rest.put(Routes.applicationCommands(clientId), { body: commands });

    if (guildsToClear.length > 0) {
      console.log(`Limpando comandos específicos das guilds: ${guildsToClear.join(', ')}`);
      for (const guildId of guildsToClear) {
        await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });
      }
    }

    console.log('Comandos registrados com sucesso!');
  } catch (error) {
    console.error(error);
  }
})();
