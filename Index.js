require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  Events,
} = require('discord.js');

const fs = require('node:fs');
const path = require('node:path');

// ====== PERSISTÊNCIA EM ARQUIVO ======
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function loadJson(name) {
  const filePath = path.join(DATA_DIR, name);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('Erro carregando', name, err);
    return [];
  }
}

function saveJson(name, data) {
  const filePath = path.join(DATA_DIR, name);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Erro salvando', name, err);
  }
}

// Carregar NPCs de arquivo
const npcs = JSON.parse(fs.readFileSync('./npcs.json', 'utf-8'));

// Sessões de swipe: userId -> { filaNpcIds, indexAtual }
const userSessions = new Map();

// Dados persistentes
let swipes = loadJson('swipes.json');      // likes/pass dos jogadores
let matches = loadJson('matches.json');    // matches oficiais
let npcLikes = loadJson('npcLikes.json');  // likes iniciados pelos NPCs

// Helper: embaralhar array
function shuffle(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

// Cria embed do perfil (sem setImage pra arquivo local)
function criarEmbedNpc(npc, posicao, total) {
  const embed = new EmbedBuilder()
    .setTitle(`?? Perfil ${posicao}/${total} – ${npc.nome}`)
    .setDescription(npc.bio)
    .addFields(
      { name: 'Idade', value: npc.idade || '??', inline: true },
      {
        name: 'Tags',
        value: npc.tags?.map(t => `#${t}`).join(' ') || '---',
        inline: true,
      },
    );

  // Se for URL http/https, usa setImage normalmente
  if (typeof npc.image === 'string' && npc.image.startsWith('http')) {
    embed.setImage(npc.image);
  }

  return embed;
}

// Cria linha de botões
function criarBotoesSwipe() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tinder_pass')
      .setLabel('Passar')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('tinder_like')
      .setLabel('Like ??')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('tinder_super')
      .setLabel('Super Like ?')
      .setStyle(ButtonStyle.Primary),
  );
}

// Monta payload com embed + botões + arquivo de imagem local (se existir)
function montarPayloadNpc(npc, posicao, total) {
  const embed = criarEmbedNpc(npc, posicao, total);
  const row = criarBotoesSwipe();

  const payload = {
    embeds: [embed],
    components: [row],
  };

  if (npc.image) {
    const filePath = path.join(__dirname, npc.image); // ex: ./Curto Circuito.jpg

    if (fs.existsSync(filePath)) {
      const attachment = new AttachmentBuilder(filePath).setName(npc.image);
      payload.files = [attachment];
    } else {
      console.warn(`Imagem não encontrada para NPC ${npc.nome}: ${filePath}`);
    }
  }

  return payload;
}

// Mostrar o perfil atual
async function mostrarPerfil(interaction, userId, isButton = false) {
  const sessao = userSessions.get(userId);
  const total = sessao.filaNpcIds.length;

  if (sessao.indexAtual >= total) {
    const payload = {
      content: 'Você já viu todos os perfis disponíveis por enquanto. ??',
      embeds: [],
      components: [],
    };

    if (isButton) {
      return interaction.update(payload);
    } else {
      return interaction.reply({ ...payload, ephemeral: true });
    }
  }

  const npcId = sessao.filaNpcIds[sessao.indexAtual];
  const npc = npcs.find(n => n.id === npcId);

  const payload = montarPayloadNpc(npc, sessao.indexAtual + 1, total);

  if (isButton) {
    return interaction.update(payload);
  } else {
    return interaction.reply({ ...payload, ephemeral: true });
  }
}

// Criar client do Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, c => {
  console.log(`Logado como ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      // /tinder
      if (interaction.commandName === 'tinder') {
        const userId = interaction.user.id;

        const filaNpcIds = shuffle(npcs.map(n => n.id));
        userSessions.set(userId, {
          filaNpcIds,
          indexAtual: 0,
        });

        await mostrarPerfil(interaction, userId, false);
      }

      // /tinder-gm-likes
      if (interaction.commandName === 'tinder-gm-likes') {
        const jogador = interaction.options.getUser('jogador');

        const likesFiltrados = swipes.filter(s => {
          const ehLike = s.tipo === 'like' || s.tipo === 'super';
          if (!ehLike) return false;
          if (!jogador) return true;
          return s.userId === jogador.id;
        });

        if (likesFiltrados.length === 0) {
          return interaction.reply({
            content: jogador
              ? `Nenhum like/super like encontrado para ${jogador}.`
              : 'Nenhum like/super like registrado ainda.',
            ephemeral: true,
          });
        }

        const linhas = likesFiltrados.map(s => {
          const npc = npcs.find(n => n.id === s.npcId);
          const nomeNpc = npc ? npc.nome : s.npcId;
          const tipoEmoji = s.tipo === 'super' ? '? Super Like' : '?? Like';
          return `• <@${s.userId}> ? **${nomeNpc}** (${tipoEmoji})`;
        });

        const texto = linhas.join('\n');

        return interaction.reply({
          content: `Likes registrados:\n${texto}`,
          ephemeral: true,
        });
      }

      // /tinder-gm-match
      if (interaction.commandName === 'tinder-gm-match') {
        const jogador = interaction.options.getUser('jogador');
        const npcId = interaction.options.getString('npc_id');

        const npc = npcs.find(n => n.id === npcId);

        if (!npc) {
          return interaction.reply({
            content: `NPC com id \`${npcId}\` não foi encontrado no npcs.json.`,
            ephemeral: true,
          });
        }

        matches.push({
          userId: jogador.id,
          npcId: npc.id,
          ts: Date.now(),
          via: 'gm',
        });
        saveJson('matches.json', matches);

        const guild = interaction.guild;
        const canalId = process.env.MATCH_CHANNEL_ID;
        let canalDestino = interaction.channel;

        if (canalId) {
          const c = guild.channels.cache.get(canalId);
          if (c) canalDestino = c;
        }

        await canalDestino.send(
          `?? **MATCH!**\n<@${jogador.id}> deu match com ?? **${npc.nome}**!`,
        );

        return interaction.reply({
          content: `Match registrado entre ${jogador} e **${npc.nome}**.`,
          ephemeral: true,
        });
      }

      // /tinder-gm-npc-like
      if (interaction.commandName === 'tinder-gm-npc-like') {
        const npcId = interaction.options.getString('npc_id');
        const jogador = interaction.options.getUser('jogador');
        const tipo = interaction.options.getString('tipo') || 'like';

        const npc = npcs.find(n => n.id === npcId);
        if (!npc) {
          return interaction.reply({
            content: `NPC com id \`${npcId}\` não foi encontrado no npcs.json.`,
            ephemeral: true,
          });
        }

        // Registrar like do NPC
        npcLikes.push({
          npcId,
          userId: jogador.id,
          tipo,
          ts: Date.now(),
        });
        saveJson('npcLikes.json', npcLikes);

        // Ver se o jogador já tinha curtido esse NPC antes
        const playerLiked = swipes.some(
          s =>
            s.userId === jogador.id &&
            s.npcId === npcId &&
            (s.tipo === 'like' || s.tipo === 'super'),
        );

        if (playerLiked) {
          // Virou MATCH automático
          matches.push({
            userId: jogador.id,
            npcId,
            ts: Date.now(),
            via: 'mutuo',
          });
          saveJson('matches.json', matches);

          const guild = interaction.guild;
          const canalId = process.env.MATCH_CHANNEL_ID;
          let canalDestino = interaction.channel;
          if (canalId) {
            const c = guild.channels.cache.get(canalId);
            if (c) canalDestino = c;
          }

          await canalDestino.send(
            `?? **MATCH!**\n?? **${npc.nome}** também deu like em <@${jogador.id}>!`,
          );

          return interaction.reply({
            content:
              `Like do NPC registrado e virou MATCH, porque o jogador já tinha curtido ${npc.nome}.`,
            ephemeral: true,
          });
        }

        // Por enquanto é crush só do NPC
        return interaction.reply({
          content: `Like do NPC **${npc.nome}** em ${jogador} registrado (crush de mão única por enquanto ??).`,
          ephemeral: true,
        });
      }
    }

    // Botões de swipe
    if (interaction.isButton()) {
      const userId = interaction.user.id;

      if (!userSessions.has(userId)) {
        return interaction.reply({
          content: 'Use `/tinder` primeiro pra começar a dar swipe. ??',
          ephemeral: true,
        });
      }

      const sessao = userSessions.get(userId);
      const npcId = sessao.filaNpcIds[sessao.indexAtual];

      if (interaction.customId === 'tinder_like') {
        swipes.push({ userId, npcId, tipo: 'like', ts: Date.now() });
        saveJson('swipes.json', swipes);
      } else if (interaction.customId === 'tinder_pass') {
        swipes.push({ userId, npcId, tipo: 'pass', ts: Date.now() });
        saveJson('swipes.json', swipes);
      } else if (interaction.customId === 'tinder_super') {
        swipes.push({ userId, npcId, tipo: 'super', ts: Date.now() });
        saveJson('swipes.json', swipes);
      }

      // avança pro próximo
      sessao.indexAtual += 1;
      userSessions.set(userId, sessao);

      await mostrarPerfil(interaction, userId, true);
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable?.()) {
      interaction
        .reply({
          content:
            'Deu um erro aqui no Tinder do RPG, fala com o mestre. ??',
          ephemeral: true,
        })
        .catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
