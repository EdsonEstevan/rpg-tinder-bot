require('dotenv').config();
const express = require('express');
const { randomUUID } = require('node:crypto');


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
  PermissionsBitField,
  MessageFlags,
} = require('discord.js');
const multer = require('multer');
const https = require('node:https');

const fs = require('node:fs');
const path = require('node:path');

// ====== PERSISTÊNCIA EM ARQUIVO ======
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const LOG_FILE = path.join(DATA_DIR, 'logs.txt');
const ADMIN_COMMANDS = new Set([
  'tinder-teste',
  'tinder-addnpc',
  'tinder-removenpc',
  'tinder-likes',
  'tinder-match',
  'tinder-npc-like',
  'tinder-nota',
  'tinder-reset',
  'tinder-foto',
]);
const NPC_AUTOCOMPLETE_COMMANDS = new Set([
  'tinder-viewnpc',
  'tinder-foto',
  'tinder-match',
  'tinder-npc-like',
  'tinder-nota',
  'tinder-removenpc',
]);
const SUPER_USERS = new Set(['464965118174953482']);
const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
const tinderLogSessions = new Map();
const likesSessions = new Map();
const LIKES_PAGE_SIZE = 10;
const LIKES_SESSION_TTL_MS = 5 * 60 * 1000;
let currentLogDateKey = null;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '', 'utf-8');
currentLogDateKey = getLastLoggedDateKey();

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
let npcs = JSON.parse(fs.readFileSync('./npcs.json', 'utf-8'));

function saveNpcsFile() {
  const filePath = path.join(__dirname, 'npcs.json');
  fs.writeFileSync(filePath, JSON.stringify(npcs, null, 2), 'utf-8');
}

function hasElevatedAccess(interaction) {
  if (!interaction) return false;
  if (SUPER_USERS.has(interaction.user?.id)) {
    return true;
  }
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
}

// Sessões de swipe: userId -> { filaNpcIds, indexAtual }
const userSessions = new Map();

// Dados persistentes
let swipes = loadJson('swipes.json');      // likes/pass dos jogadores
let matches = loadJson('matches.json');    // matches oficiais
let npcLikes = loadJson('npcLikes.json');  // likes iniciados pelos NPCs
let seen = loadJson('seen.json');          // NPCs já vistos por jogador

function getSeenSetForUser(userId) {
  return new Set(seen.filter(entry => entry.userId === userId).map(entry => entry.npcId));
}

function getNpcQueueForUser(userId) {
  const vistos = getSeenSetForUser(userId);
  return npcs.filter(npc => !vistos.has(npc.id)).map(npc => npc.id);
}

function registrarNpcVisto(userId, npcId) {
  if (seen.some(entry => entry.userId === userId && entry.npcId === npcId)) return;
  seen.push({ userId, npcId });
  saveJson('seen.json', seen);
}

function slugifyNome(nome) {
  return nome
    .normalize('NFD')
     .replace(/[\u0000-\u001F]/g, '')
     .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseTags(input) {
  if (!input) return [];
  return input
    .split(/[,;\n]+|\s+/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(tag => tag.replace(/\s+/g, '_').toLowerCase());
}

function buildNpcAutocompleteChoices(input) {
  const query = (input || '').toLowerCase();
  return npcs
    .filter(npc => {
      if (!query) return true;
      const nomeMatch = npc.nome?.toLowerCase().includes(query);
      const idMatch = npc.id?.toLowerCase().includes(query);
      return nomeMatch || idMatch;
    })
    .slice(0, 25)
    .map(npc => {
      const labelBase = npc.nome ? `${npc.nome} (${npc.id})` : npc.id;
      const displayName = labelBase.length > 100 ? `${labelBase.slice(0, 97)}...` : labelBase;
      return {
        name: displayName,
        value: npc.id,
      };
    });
}

function inferAttachmentExtension(attachment) {
  const nameExt = path.extname(attachment?.name || '').toLowerCase();
  if (nameExt) return nameExt;
  const contentType = attachment?.contentType || '';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('webp')) return '.webp';
  return '.jpg';
}

function fetchBufferThroughHttps(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchBufferThroughHttps(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Falha ao baixar arquivo (status ${res.statusCode})`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function fetchBufferFromUrl(url) {
  if (!url) throw new Error('URL inválida para download.');
  if (typeof fetch === 'function') {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falha ao baixar arquivo (status ${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  return fetchBufferThroughHttps(url);
}

async function persistDiscordAttachment(attachment) {
  if (!attachment?.url) return null;
  try {
    const ext = inferAttachmentExtension(attachment);
    const baseName = slugifyNome(path.basename(attachment.name || 'npc', ext)) || 'npc';
    const finalName = `${baseName}-${Date.now()}${ext}`;
    const destination = path.join(UPLOAD_DIR, finalName);
    const buffer = await fetchBufferFromUrl(attachment.url);
    fs.writeFileSync(destination, buffer);
    return path.relative(__dirname, destination).replace(/\\/g, '/');
  } catch (err) {
    console.error('Erro ao salvar imagem enviada pelo comando:', err);
    return null;
  }
}

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const original = file.originalname || 'npc';
    const ext = path.extname(original) || '.jpg';
    const base = slugifyNome(path.basename(original, ext)) || 'npc';
    cb(null, `${base}-${Date.now()}${ext.toLowerCase()}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Envie apenas arquivos de imagem.'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

function asEphemeral(payload = {}) {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

function respondWithPayload(interaction, payload, { isButton = false, ephemeral = true } = {}) {
  if (isButton) {
    return interaction.update(payload);
  }

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  return interaction.reply(ephemeral ? asEphemeral(payload) : payload);
}

function formatUserName(user) {
  if (!user) return 'usuário desconhecido';
  return user.tag || user.username || 'usuário desconhecido';
}

function formatGuildName(guild) {
  if (!guild) return 'DM/desconhecido';
  return guild.name || 'servidor desconhecido';
}

function formatDateHeader(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const monthName = MONTHS_PT[date.getMonth()] || 'mês desconhecido';
  const year = date.getFullYear();
  return `Dia ${day} de ${monthName} de ${year}`;
}

function ensureLogHeader(date = new Date()) {
  const key = date.toISOString().slice(0, 10);
  if (currentLogDateKey === key) return;

  const header = formatDateHeader(date);
  let prefix = '';
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > 0) {
      prefix = '\n';
    }
  } catch (err) {
    console.warn('Não foi possível verificar o tamanho do log:', err);
  }

  fs.appendFileSync(LOG_FILE, `${prefix}${header}\n\n`);
  currentLogDateKey = key;
}

function appendLogBlock(lines = [], { extraBlankLine = true } = {}) {
  const payload = lines.length ? lines.join('\n') : '';
  const suffix = extraBlankLine ? '\n\n' : '\n';
  fs.appendFile(LOG_FILE, `${payload}${suffix}`, err => {
    if (err) console.error('Erro ao escrever log', err);
  });
}

function logFriendlyEvent(description, options = {}) {
  const {
    user = null,
    guild = null,
    timestamp = new Date(),
    extraLines = [],
    customFirstLine = null,
    extraBlankLine = true,
  } = options;

  ensureLogHeader(timestamp);
  const timeStr = timestamp.toLocaleTimeString('pt-BR', { hour12: false });
  const userName = formatUserName(user);
  const guildName = formatGuildName(guild);

  const firstLine =
    customFirstLine ||
    `Às ${timeStr} o usuário ${userName} no servidor ${guildName} ${description}`;

  appendLogBlock([firstLine, ...extraLines], { extraBlankLine });
}

function formatRatingBlock(rating, reason) {
  if (typeof rating !== 'number' || Number.isNaN(rating)) return null;
  const normalized = Math.max(1, Math.min(5, Math.round(rating)));
  const filled = '⭐'.repeat(normalized);
  const empty = '☆'.repeat(5 - normalized);
  let text = `${filled}${empty} (${normalized}/5)`;
  if (reason) {
    text += `\nMotivo: ${reason}`;
  }
  return text;
}

function cleanupLikesSession(sessionId) {
  const session = likesSessions.get(sessionId);
  if (!session) return;
  if (session.timeout) clearTimeout(session.timeout);
  likesSessions.delete(sessionId);
}

function buildLikesEmbed(session) {
  const start = session.currentPage * LIKES_PAGE_SIZE;
  const slice = session.likes.slice(start, start + LIKES_PAGE_SIZE);
  const lines = slice.map((entry, idx) => {
    const npc = npcs.find(n => n.id === entry.npcId);
    const npcName = npc ? npc.nome : entry.npcId;
    const tipoEmoji = entry.tipo === 'super' ? '💥 Super Like' : '💖 Like';
    const absoluteIndex = start + idx + 1;
    const timestamp = entry.ts
      ? new Date(entry.ts).toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : 'sem data';
    return `${absoluteIndex}. ${tipoEmoji} • <@${entry.userId}> → **${npcName}** · ${timestamp}`;
  });

  const description = lines.join('\n') || 'Nenhum registro nesta página.';

  return new EmbedBuilder()
    .setTitle('💌 Likes registrados')
    .setDescription(description)
    .setColor(0xf472b6)
    .setFooter({ text: `Página ${session.currentPage + 1}/${session.totalPages}` });
}

function buildLikesNavigationRow(session) {
  const prevButton = new ButtonBuilder()
    .setCustomId(`likes:${session.id}:prev`)
    .setLabel('Anterior')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(session.currentPage === 0);

  const nextButton = new ButtonBuilder()
    .setCustomId(`likes:${session.id}:next`)
    .setLabel('Próxima')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(session.currentPage >= session.totalPages - 1);

  const closeButton = new ButtonBuilder()
    .setCustomId(`likes:${session.id}:close`)
    .setLabel('Fechar')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder().addComponents(prevButton, nextButton, closeButton);
}

function buildLikesPayload(session) {
  const filtroLinha = session.filterLabel
    ? `Filtro aplicado: ${session.filterLabel}`
    : 'Filtro aplicado: todos os jogadores';
  const resumo = `Likes encontrados: ${session.likes.length}`;

  return {
    content: `${resumo}\n${filtroLinha}`,
    embeds: [buildLikesEmbed(session)],
    components: [buildLikesNavigationRow(session)],
  };
}

async function handleLikesNavigation(interaction) {
  const [, sessionId, action] = interaction.customId.split(':');
  const session = likesSessions.get(sessionId);

  if (!session) {
    return interaction.update({
      content: 'Sessão expirada. Use /tinder-likes novamente para gerar uma nova lista.',
      embeds: [],
      components: [],
    });
  }

  if (session.requesterId !== interaction.user.id) {
    return interaction.reply(
      asEphemeral({
        content: 'Somente quem abriu a lista pode navegar por ela.',
      }),
    );
  }

  if (action === 'close') {
    cleanupLikesSession(sessionId);
    return interaction.update({
      content: 'Sessão encerrada. Use /tinder-likes para consultar novamente.',
      embeds: [],
      components: [],
    });
  }

  if (action === 'prev' && session.currentPage > 0) {
    session.currentPage -= 1;
  } else if (action === 'next' && session.currentPage < session.totalPages - 1) {
    session.currentPage += 1;
  }

  return interaction.update(buildLikesPayload(session));
}

function startTinderLogSession(interaction, npcCount) {
  const timestamp = new Date();
  const userName = formatUserName(interaction.user);
  const guildName = formatGuildName(interaction.guild);
  const customLine = `O usuário ${userName} às ${timestamp.toLocaleTimeString('pt-BR', {
    hour12: false,
  })} usou /tinder no servidor ${guildName} e teve as seguintes interações (NPCs disponíveis: ${npcCount}):`;

  logFriendlyEvent('', {
    user: interaction.user,
    guild: interaction.guild,
    timestamp,
    customFirstLine: customLine,
    extraBlankLine: false,
  });

  tinderLogSessions.set(interaction.user.id, { guildId: interaction.guildId });
}

function logTinderInteraction(interaction, npcLabel, actionText) {
  const timestamp = new Date();
  ensureLogHeader(timestamp);

  if (!tinderLogSessions.has(interaction.user.id)) {
    logFriendlyEvent(`${actionText} ${npcLabel} durante uma sessão do /tinder.`, {
      user: interaction.user,
      guild: interaction.guild,
      timestamp,
    });
    return;
  }

  appendLogBlock([`  • ${npcLabel}: ${actionText}`], { extraBlankLine: false });
}

function endTinderLogSession(userId) {
  if (!tinderLogSessions.has(userId)) return;
  tinderLogSessions.delete(userId);
  appendLogBlock([], { extraBlankLine: true });
}

function getLastLoggedDateKey() {
  try {
    if (!fs.existsSync(LOG_FILE)) return null;
    const data = fs.readFileSync(LOG_FILE, 'utf-8').trimEnd();
    if (!data) return null;
    const lines = data.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      const match = line.match(/^Dia (\d{2}) de ([^ ]+) de (\d{4})$/i);
      if (!match) continue;
      const [, day, monthNameRaw, year] = match;
      const monthIndex = MONTHS_PT.findIndex(name => name === monthNameRaw.toLowerCase());
      if (monthIndex === -1) continue;
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day}`;
    }
  } catch (err) {
    console.warn('Não foi possível identificar a última data registrada no log:', err);
  }
  return null;
}

function cleanupUpload(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('Erro removendo upload temporário', err);
  }
}

function removeNpcAndReferences(npcId) {
  const npc = npcs.find(n => n.id === npcId);
  if (!npc) return null;

  npcs = npcs.filter(n => n.id !== npcId);
  saveNpcsFile();

  const filterByNpc = list => list.filter(entry => entry.npcId !== npcId);

  const newSwipes = filterByNpc(swipes);
  if (newSwipes.length !== swipes.length) {
    swipes = newSwipes;
    saveJson('swipes.json', swipes);
  }

  const newMatches = filterByNpc(matches);
  if (newMatches.length !== matches.length) {
    matches = newMatches;
    saveJson('matches.json', matches);
  }

  const newNpcLikes = filterByNpc(npcLikes);
  if (newNpcLikes.length !== npcLikes.length) {
    npcLikes = newNpcLikes;
    saveJson('npcLikes.json', npcLikes);
  }

  const newSeen = filterByNpc(seen);
  if (newSeen.length !== seen.length) {
    seen = newSeen;
    saveJson('seen.json', seen);
  }

  userSessions.forEach((sessao, userId) => {
    const novaFila = sessao.filaNpcIds.filter(id => id !== npcId);
    if (novaFila.length === 0) {
      userSessions.delete(userId);
      endTinderLogSession(userId);
      return;
    }

    if (novaFila.length !== sessao.filaNpcIds.length) {
      const novoIndex = Math.min(sessao.indexAtual, novaFila.length - 1);
      userSessions.set(userId, {
        ...sessao,
        filaNpcIds: novaFila,
        indexAtual: Math.max(novoIndex, 0),
      });
    }
  });

  return npc;
}

// Helper: embaralhar array
function shuffle(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

// Cria embed do perfil (sem setImage pra arquivo local)
function criarEmbedNpc(npc, posicao, total) {
  const embed = new EmbedBuilder()
    .setTitle(`💘 Perfil ${posicao}/${total} – ${npc.nome}`)
    .setDescription(npc.bio)
    .addFields(
      { name: 'Idade', value: npc.idade || '❔', inline: true },
      {
        name: 'Tags',
        value: npc.tags?.map(t => `#${t}`).join(' ') || '---',
        inline: true,
      },
    );

  const ratingBlock = formatRatingBlock(npc.rating, npc.ratingReason);
  if (ratingBlock) {
    embed.addFields({ name: 'Nota', value: ratingBlock, inline: false });
  }

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
      .setLabel('Like 💖')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('tinder_super')
      .setLabel('Super Like 💥')
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

  if (npc.image && typeof npc.image === 'string' && !npc.image.startsWith('http')) {
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
  if (!sessao) {
    endTinderLogSession(userId);
    const payload = {
      content: 'Use `/tinder` para começar uma nova sessão.',
      embeds: [],
      components: [],
    };
    return respondWithPayload(interaction, payload, { isButton });
  }

  const total = sessao.filaNpcIds.length;

  if (sessao.indexAtual >= total) {
    const payload = {
      content: 'Você já viu todos os perfis disponíveis por enquanto. 😴',
      embeds: [],
      components: [],
    };
    userSessions.delete(userId);
    endTinderLogSession(userId);
    return respondWithPayload(interaction, payload, { isButton });
  }

  const npcId = sessao.filaNpcIds[sessao.indexAtual];
  const npc = npcs.find(n => n.id === npcId);

  if (!npc) {
    console.warn(`NPC com id ${npcId} não foi encontrado ao montar sessão.`);
    sessao.indexAtual += 1;
    userSessions.set(userId, sessao);
    return mostrarPerfil(interaction, userId, isButton);
  }

  const payload = montarPayloadNpc(npc, sessao.indexAtual + 1, total);

  return respondWithPayload(interaction, payload, { isButton });
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
    if (interaction.isAutocomplete()) {
      if (NPC_AUTOCOMPLETE_COMMANDS.has(interaction.commandName)) {
        const focused = interaction.options.getFocused() || '';
        const choices = buildNpcAutocompleteChoices(focused);
        await interaction.respond(choices);
      } else {
        await interaction.respond([]);
      }
      return;
    }

    // Slash commands
    if (interaction.isChatInputCommand()) {

      if (ADMIN_COMMANDS.has(interaction.commandName) && !hasElevatedAccess(interaction)) {
        logFriendlyEvent(`tentou usar o comando /${interaction.commandName} sem permissão.`, {
          user: interaction.user,
          guild: interaction.guild,
        });
        return interaction.reply(
          asEphemeral({
            content: 'Somente administradores podem usar esse comando.',
          }),
        );
      }

      // /tinder
      if (interaction.commandName === 'tinder') {
        const userId = interaction.user.id;
        await interaction.deferReply({ ephemeral: true });
        const filaNpcIds = shuffle(getNpcQueueForUser(userId));

        if (filaNpcIds.length === 0) {
          logFriendlyEvent('tentou usar /tinder, mas não havia NPCs inéditos.', {
            user: interaction.user,
            guild: interaction.guild,
          });
          endTinderLogSession(userId);
          await respondWithPayload(
            interaction,
            {
              content: 'Você já viu todos os perfis disponíveis por enquanto. 😴',
              embeds: [],
              components: [],
            },
          );
          return;
        }

        endTinderLogSession(userId);
        userSessions.set(userId, {
          filaNpcIds,
          indexAtual: 0,
          registrarSwipes: true,
        });

        startTinderLogSession(interaction, filaNpcIds.length);

        await mostrarPerfil(interaction, userId, false);
      }

      if (interaction.commandName === 'tinder-viewnpc') {
        const npcId = interaction.options.getString('npc', true);
        const npc = npcs.find(n => n.id === npcId);

        if (!npc) {
          logFriendlyEvent(`tentou visualizar o NPC ${npcId}, mas ele não existe.`, {
            user: interaction.user,
            guild: interaction.guild,
          });
          return interaction.reply(
            asEphemeral({
              content: `NPC com id \`${npcId}\` não foi encontrado.`,
            }),
          );
        }

        logFriendlyEvent(`visualizou o NPC ${npc.nome} via /tinder-viewnpc.`, {
          user: interaction.user,
          guild: interaction.guild,
        });

        const payload = montarPayloadNpc(npc, 1, 1);
        payload.components = [];
        payload.content = `Mostrando ${npc.nome}:`;

        return interaction.reply(asEphemeral(payload));
      }

      if (interaction.commandName === 'tinder-ajuda') {
        const comandos = [
          '**/tinder** – abre o app e mostra apenas NPCs que você ainda não viu.',
          '**/tinder-viewnpc** – mostra o card de um NPC específico.',
          '**/tinder-teste** – (admin) percorre todos os NPCs sem registrar likes/passes.',
          '**/tinder-addnpc** – (admin) cadastra um novo NPC direto pelo Discord.',
          '**/tinder-nota** – (admin) ajusta nota e motivo de um NPC já existente.',
          '**/tinder-removenpc** – (admin) remove um NPC existente e limpa registros.',
          '**/tinder-foto** – (admin) atualiza a imagem salva de um NPC.',
          '**/tinder-likes** – lista todos os likes e super likes registrados.',
          '**/tinder-match** – (admin) força um match entre jogador e NPC.',
          '**/tinder-npc-like** – (admin) registra que um NPC deu like em um jogador.',
          '**/tinder-reset** – (admin) limpa swipes/matches de um jogador para recomeçar.',
          '**/tinder-npcs** – mostra todos os NPCs cadastrados com nome e ID.',
          '**/tinder-ajuda** – mostra esta lista de comandos.',
        ].join('\n');

        logFriendlyEvent('solicitou a lista de comandos do Tinder do RPG.', {
          user: interaction.user,
          guild: interaction.guild,
        });

        return interaction.reply(
          asEphemeral({
            content: `Comandos disponíveis:\n${comandos}`,
          }),
        );
      }

      if (interaction.commandName === 'tinder-npcs') {
        if (npcs.length === 0) {
          logFriendlyEvent('consultou a lista de NPCs, mas não há nenhum cadastro.', {
            user: interaction.user,
            guild: interaction.guild,
          });
          return interaction.reply(
            asEphemeral({
              content: 'Ainda não há NPCs cadastrados.',
            }),
          );
        }

        const linhas = npcs
          .slice()
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
          .map(npc => `• **${npc.nome}** — id: \`${npc.id}\``);

        const texto = linhas.join('\n');

        logFriendlyEvent(`consultou a lista de NPCs (${npcs.length} registros).`, {
          user: interaction.user,
          guild: interaction.guild,
        });

        return interaction.reply(
          asEphemeral({
            content: `NPCs cadastrados:\n${texto}`,
          }),
        );
      }

      if (interaction.commandName === 'tinder-teste') {
        if (!hasElevatedAccess(interaction)) {
          return interaction.reply(
            asEphemeral({
              content: 'Somente administradores podem usar o modo de teste.',
            }),
          );
        }

        if (npcs.length === 0) {
          logFriendlyEvent('tentou usar /tinder-teste, mas não há NPCs cadastrados.', {
            user: interaction.user,
            guild: interaction.guild,
          });
          return interaction.reply(
            asEphemeral({
              content: 'Nenhum NPC cadastrado ainda para testar.',
            }),
          );
        }

        const userId = interaction.user.id;
        const filaNpcIds = shuffle(npcs.map(n => n.id));

        userSessions.set(userId, {
          filaNpcIds,
          indexAtual: 0,
          registrarSwipes: false,
        });

        logFriendlyEvent(`iniciou /tinder-teste com ${filaNpcIds.length} NPCs.`, {
          user: interaction.user,
          guild: interaction.guild,
        });

        await mostrarPerfil(interaction, userId, false);
      }

      if (interaction.commandName === 'tinder-addnpc') {
        if (!hasElevatedAccess(interaction)) {
          return interaction.reply(
            asEphemeral({
              content: 'Somente administradores podem cadastrar novos NPCs.',
            }),
          );
        }

        const nome = interaction.options.getString('nome', true).trim();
        const idade = interaction.options.getString('idade', true).trim();
        const descricao = interaction.options.getString('descricao', true).trim();
        const gostosInput = interaction.options.getString('gostos');
        const imagemUrl = interaction.options.getString('imagem_url');
        const imagemAttachment = interaction.options.getAttachment('imagem');
        const notaValor = interaction.options.getInteger('nota');
        const notaMotivoRaw = interaction.options.getString('nota_motivo');
        const notaMotivo = notaMotivoRaw?.trim() || null;

        const npcId = slugifyNome(nome);

        if (!npcId) {
          return interaction.reply(
            asEphemeral({
              content: 'Não consegui gerar um ID válido para esse nome. Tente outro.',
            }),
          );
        }

        if (npcs.some(n => n.id === npcId)) {
          return interaction.reply(
            asEphemeral({
              content: `Já existe um NPC com o id \`${npcId}\`.`,
            }),
          );
        }

        if (notaValor !== null && (notaValor < 1 || notaValor > 5)) {
          return interaction.reply(
            asEphemeral({
              content: 'Informe uma nota entre 1 e 5 estrelas.',
            }),
          );
        }

        if (notaValor !== null && !notaMotivo) {
          return interaction.reply(
            asEphemeral({
              content: 'Descreva o motivo da nota atribuída ao NPC.',
            }),
          );
        }

        if (notaValor === null && notaMotivo) {
          return interaction.reply(
            asEphemeral({
              content: 'Para registrar um motivo, informe também a nota (1 a 5).',
            }),
          );
        }

        const tags = parseTags(gostosInput);
        let imageSource = null;

        if (imagemAttachment) {
          imageSource = await persistDiscordAttachment(imagemAttachment);
          if (!imageSource) {
            return interaction.reply(
              asEphemeral({
                content:
                  'Não consegui salvar a imagem enviada. Tente novamente ou forneça uma URL pública.',
              }),
            );
          }
        } else if (imagemUrl && imagemUrl.trim()) {
          imageSource = imagemUrl.trim();
        }

        const novoNpc = {
          id: npcId,
          nome,
          idade,
          bio: descricao,
          tags,
        };

        if (imageSource) {
          novoNpc.image = imageSource;
        }

        if (notaValor !== null) {
          novoNpc.rating = notaValor;
          if (notaMotivo) {
            novoNpc.ratingReason = notaMotivo;
          }
        }

        npcs.push(novoNpc);
        saveNpcsFile();

        const extraLines = [
          `Nome do NPC: ${nome}`,
          `ID do NPC: ${npcId}`,
          `Idade do NPC: ${idade}`,
          `Descrição: ${descricao}`,
          `Tags: ${tags.length ? tags.join(', ') : 'Nenhuma'}`,
          `Imagem: ${imageSource || 'Sem imagem'}`,
        ];

        if (notaValor !== null) {
          extraLines.push(`Nota: ${notaValor}/5`);
          if (notaMotivo) extraLines.push(`Motivo da nota: ${notaMotivo}`);
        } else {
          extraLines.push('Nota: Não informada');
        }

        logFriendlyEvent('criou um NPC usando /tinder-addnpc:', {
          user: interaction.user,
          guild: interaction.guild,
          extraLines,
        });

        const previewEmbed = criarEmbedNpc(novoNpc, 1, 1);

        return interaction.reply(
          asEphemeral({
            content: `NPC **${nome}** criado com sucesso!`,
            embeds: [previewEmbed],
          }),
        );
      }

      if (interaction.commandName === 'tinder-nota') {
        if (!hasElevatedAccess(interaction)) {
          return interaction.reply(
            asEphemeral({
              content: 'Somente administradores podem atualizar notas de NPCs.',
            }),
          );
        }

        const npcId = interaction.options.getString('npc_id', true).trim().toLowerCase();
        const nota = interaction.options.getInteger('nota', true);
        const motivoRaw = interaction.options.getString('motivo', true);
        const motivo = motivoRaw?.trim();

        if (!motivo) {
          return interaction.reply(
            asEphemeral({
              content: 'Descreva o motivo da nota atribuída.',
            }),
          );
        }

        if (nota < 1 || nota > 5) {
          return interaction.reply(
            asEphemeral({
              content: 'Informe uma nota entre 1 e 5 estrelas.',
            }),
          );
        }

        const npc = npcs.find(n => n.id === npcId);

        if (!npc) {
          return interaction.reply(
            asEphemeral({
              content: `NPC com id \`${npcId}\` não foi encontrado.`,
            }),
          );
        }

        npc.rating = nota;
        npc.ratingReason = motivo;
        saveNpcsFile();

        logFriendlyEvent(`atualizou a nota do NPC ${npc.nome}.`, {
          user: interaction.user,
          guild: interaction.guild,
          extraLines: [`Nova nota: ${nota}/5`, `Motivo: ${motivo}`],
        });

        const previewEmbed = criarEmbedNpc(npc, 1, 1);

        return interaction.reply(
          asEphemeral({
            content: `Nota do NPC **${npc.nome}** atualizada para ${nota}/5.`,
            embeds: [previewEmbed],
          }),
        );
      }

      if (interaction.commandName === 'tinder-foto') {
        if (!hasElevatedAccess(interaction)) {
          return interaction.reply(
            asEphemeral({
              content: 'Somente administradores podem atualizar imagens de NPCs.',
            }),
          );
        }

        const npcId = interaction.options.getString('npc', true).trim().toLowerCase();
        const imagemUrl = interaction.options.getString('imagem_url');
        const imagemAttachment = interaction.options.getAttachment('imagem');

        if (!imagemAttachment && !imagemUrl) {
          return interaction.reply(
            asEphemeral({
              content: 'Envie uma nova imagem (anexo) ou informe uma URL pública.',
            }),
          );
        }

        const npc = npcs.find(n => n.id === npcId);
        if (!npc) {
          return interaction.reply(
            asEphemeral({
              content: `NPC com id \`${npcId}\` não foi encontrado.`,
            }),
          );
        }

        let novaImagem = null;
        if (imagemAttachment) {
          novaImagem = await persistDiscordAttachment(imagemAttachment);
          if (!novaImagem) {
            return interaction.reply(
              asEphemeral({
                content:
                  'Não consegui salvar a nova imagem enviada. Tente novamente ou forneça uma URL pública.',
              }),
            );
          }
        } else if (imagemUrl && imagemUrl.trim()) {
          novaImagem = imagemUrl.trim();
        }

        if (!novaImagem) {
          return interaction.reply(
            asEphemeral({
              content: 'Não consegui processar a nova imagem. Verifique o arquivo/URL e tente novamente.',
            }),
          );
        }

        const imagemAnterior = npc.image;
        npc.image = novaImagem;
        saveNpcsFile();

        if (
          imagemAnterior &&
          typeof imagemAnterior === 'string' &&
          !imagemAnterior.startsWith('http') &&
          imagemAnterior.startsWith('uploads/')
        ) {
          cleanupUpload(path.join(__dirname, imagemAnterior));
        }

        const extraLines = [
          `NPC: ${npc.nome} (${npc.id})`,
          `Fonte antiga: ${imagemAnterior || 'não tinha'}`,
          `Nova fonte: ${novaImagem}`,
        ];

        logFriendlyEvent(`atualizou a imagem do NPC ${npc.nome} via /tinder-foto.`, {
          user: interaction.user,
          guild: interaction.guild,
          extraLines,
        });

        const previewEmbed = criarEmbedNpc(npc, 1, 1);

        return interaction.reply(
          asEphemeral({
            content: `Imagem do NPC **${npc.nome}** atualizada com sucesso.`,
            embeds: [previewEmbed],
          }),
        );
      }

      if (interaction.commandName === 'tinder-removenpc') {
        if (!hasElevatedAccess(interaction)) {
          return interaction.reply(
            asEphemeral({
              content: 'Somente administradores podem remover NPCs.',
            }),
          );
        }

        const npcId = interaction.options.getString('npc_id', true).trim().toLowerCase();
        const removido = removeNpcAndReferences(npcId);

        if (!removido) {
          logFriendlyEvent(`tentou remover o NPC ${npcId}, mas ele não existe.`, {
            user: interaction.user,
            guild: interaction.guild,
          });
          return interaction.reply(
            asEphemeral({
              content: `NPC com id \`${npcId}\` não foi encontrado.`,
            }),
          );
        }

        logFriendlyEvent(`removeu o NPC ${removido.nome} usando /tinder-removenpc.`, {
          user: interaction.user,
          guild: interaction.guild,
          extraLines: [`ID do NPC: ${npcId}`],
        });

        return interaction.reply(
          asEphemeral({
            content: `NPC **${removido.nome}** removido e dados relacionados limpos.`,
          }),
        );
      }

      // /tinder-likes
      if (interaction.commandName === 'tinder-likes') {
        await interaction.deferReply({ ephemeral: true });
        const jogador = interaction.options.getUser('jogador');

        const likesFiltrados = swipes.filter(s => {
          const ehLike = s.tipo === 'like' || s.tipo === 'super';
          if (!ehLike) return false;
          if (!jogador) return true;
          return s.userId === jogador.id;
        });

        logFriendlyEvent(
          jogador
            ? `consultou os likes filtrando pelo jogador ${formatUserName(jogador)}.`
            : 'consultou todos os likes registrados.',
          {
            user: interaction.user,
            guild: interaction.guild,
            extraLines: [`Likes encontrados: ${likesFiltrados.length}`],
          },
        );

        if (likesFiltrados.length === 0) {
          await respondWithPayload(
            interaction,
            {
              content: jogador
                ? `Nenhum like/super like encontrado para ${jogador}.`
                : 'Nenhum like/super like registrado ainda.',
              embeds: [],
              components: [],
            },
          );
          return;
        }

        for (const [sessionId, session] of likesSessions.entries()) {
          if (session.requesterId === interaction.user.id) {
            cleanupLikesSession(sessionId);
          }
        }

        const sessionId = randomUUID();
        const totalPages = Math.max(1, Math.ceil(likesFiltrados.length / LIKES_PAGE_SIZE));
        const session = {
          id: sessionId,
          likes: likesFiltrados,
          requesterId: interaction.user.id,
          filterLabel: jogador ? `${formatUserName(jogador)} (${jogador})` : null,
          createdAt: Date.now(),
          totalPages,
          currentPage: 0,
        };

        session.timeout = setTimeout(() => {
          cleanupLikesSession(sessionId);
        }, LIKES_SESSION_TTL_MS);

        likesSessions.set(sessionId, session);

        await respondWithPayload(interaction, buildLikesPayload(session));
        return;
      }

      // /tinder-match
      if (interaction.commandName === 'tinder-match') {
        const jogador = interaction.options.getUser('jogador');
        const npcId = interaction.options.getString('npc_id');

        const npc = npcs.find(n => n.id === npcId);

        if (!npc) {
          logFriendlyEvent(
            `tentou forçar um match com o NPC ${npcId}, mas ele não existe no arquivo.`,
            {
              user: interaction.user,
              guild: interaction.guild,
            },
          );
          return interaction.reply(
            asEphemeral({
              content: `NPC com id \`${npcId}\` não foi encontrado no npcs.json.`,
            }),
          );
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
          `💞 **MATCH!**\n<@${jogador.id}> deu match com 💞 **${npc.nome}**!`,
        );

        logFriendlyEvent(`forçou um match entre ${formatUserName(jogador)} e ${npc.nome}.`, {
          user: interaction.user,
          guild: interaction.guild,
          extraLines: [`NPC ID: ${npc.id}`],
        });

        return interaction.reply(
          asEphemeral({
            content: `Match registrado entre ${jogador} e **${npc.nome}**.`,
          }),
        );
      }

      if (interaction.commandName === 'tinder-reset') {
        const jogador = interaction.options.getUser('jogador', true);
        const userId = jogador.id;

        const newSwipes = swipes.filter(entry => entry.userId !== userId);
        const removedSwipes = swipes.length - newSwipes.length;
        if (removedSwipes) {
          swipes = newSwipes;
          saveJson('swipes.json', swipes);
        }

        const newMatches = matches.filter(entry => entry.userId !== userId);
        const removedMatches = matches.length - newMatches.length;
        if (removedMatches) {
          matches = newMatches;
          saveJson('matches.json', matches);
        }

        const newSeen = seen.filter(entry => entry.userId !== userId);
        const removedSeen = seen.length - newSeen.length;
        if (removedSeen) {
          seen = newSeen;
          saveJson('seen.json', seen);
        }

        let sessionCleared = false;
        if (userSessions.has(userId)) {
          userSessions.delete(userId);
          sessionCleared = true;
        }
        endTinderLogSession(userId);

        const summaryLines = [
          `Swipes removidos: ${removedSwipes}`,
          `Matches removidos: ${removedMatches}`,
          `NPCs resetados: ${removedSeen}`,
        ];
        if (sessionCleared) {
          summaryLines.push('Sessão ativa encerrada.');
        }

        logFriendlyEvent(
          `resetou o histórico do jogador ${formatUserName(jogador)} usando /tinder-reset.`,
          {
            user: interaction.user,
            guild: interaction.guild,
            extraLines: summaryLines,
          },
        );

        return interaction.reply(
          asEphemeral({
            content: `Histórico de ${jogador} limpo.\n${summaryLines.join('\n')}`,
          }),
        );
      }

      // /tinder-npc-like
      if (interaction.commandName === 'tinder-npc-like') {
        const npcId = interaction.options.getString('npc_id');
        const jogador = interaction.options.getUser('jogador');
        const tipo = interaction.options.getString('tipo') || 'like';

        const npc = npcs.find(n => n.id === npcId);
        if (!npc) {
          return interaction.reply(
            asEphemeral({
              content: `NPC com id \`${npcId}\` não foi encontrado no npcs.json.`,
            }),
          );
        }

        // Registrar like do NPC
        npcLikes.push({
          npcId,
          userId: jogador.id,
          tipo,
          ts: Date.now(),
        });
        saveJson('npcLikes.json', npcLikes);

        logFriendlyEvent(`registrou que o NPC ${npc.nome} curtiu ${formatUserName(jogador)} (${tipo === 'super' ? 'super like' : 'like'}).`, {
          user: interaction.user,
          guild: interaction.guild,
          extraLines: [`NPC ID: ${npc.id}`],
        });

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
            `💞 **MATCH!**\n💘 **${npc.nome}** também deu like em <@${jogador.id}>!`,
          );

          logFriendlyEvent(
            `gerou um match automático entre ${formatUserName(jogador)} e ${npc.nome} após registrar o like do NPC.`,
            {
              user: interaction.user,
              guild: interaction.guild,
              extraLines: [`NPC ID: ${npc.id}`],
            },
          );

          return interaction.reply(
            asEphemeral({
              content:
                `Like do NPC registrado e virou MATCH, porque o jogador já tinha curtido ${npc.nome}.`,
            }),
          );
        }

        // Por enquanto é crush só do NPC
        return interaction.reply(
          asEphemeral({
            content: `Like do NPC **${npc.nome}** em ${jogador} registrado (crush de mão única por enquanto 😳).`,
          }),
        );
      }
    }

    // Botões de swipe
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('likes:')) {
        await handleLikesNavigation(interaction);
        return;
      }
      const userId = interaction.user.id;

      if (!userSessions.has(userId)) {
        endTinderLogSession(userId);
        return interaction.reply(
          asEphemeral({
            content: 'Use `/tinder` primeiro pra começar a dar swipe. 😉',
          }),
        );
      }

      const sessao = userSessions.get(userId);
      if (!sessao || sessao.indexAtual >= sessao.filaNpcIds.length) {
        userSessions.delete(userId);
        endTinderLogSession(userId);
        return interaction.reply(
          asEphemeral({
            content: 'Não há mais perfis nessa sessão. Use `/tinder` novamente.',
          }),
        );
      }

      const npcId = sessao.filaNpcIds[sessao.indexAtual];
      const npc = npcs.find(n => n.id === npcId);
      const npcLabel = npc ? `${npc.nome} (id ${npc.id})` : `NPC ${npcId}`;

      if (!npcId) {
        userSessions.delete(userId);
        endTinderLogSession(userId);
        return interaction.reply(
          asEphemeral({
            content: 'Não encontrei o perfil atual. Abra uma nova sessão com `/tinder`.',
          }),
        );
      }

      const deveRegistrar = sessao.registrarSwipes !== false;

      if (interaction.customId === 'tinder_like') {
        if (deveRegistrar) {
          swipes.push({ userId, npcId, tipo: 'like', ts: Date.now() });
          saveJson('swipes.json', swipes);
          logTinderInteraction(interaction, npcLabel, 'Deu like');
        }
      } else if (interaction.customId === 'tinder_pass') {
        if (deveRegistrar) {
          swipes.push({ userId, npcId, tipo: 'pass', ts: Date.now() });
          saveJson('swipes.json', swipes);
          logTinderInteraction(interaction, npcLabel, 'Passou');
        }
      } else if (interaction.customId === 'tinder_super') {
        if (deveRegistrar) {
          swipes.push({ userId, npcId, tipo: 'super', ts: Date.now() });
          saveJson('swipes.json', swipes);
          logTinderInteraction(interaction, npcLabel, 'Deu super like');
        }
      }

      if (deveRegistrar) {
        registrarNpcVisto(userId, npcId);
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
        .reply(
          asEphemeral({
            content:
              'Deu um erro aqui no Tinder do RPG, fala com o mestre. ⚠️',
          }),
        )
        .catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
// ===== Servidor HTTP simples para a Render (Web Service) =====
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/admin', express.static(PUBLIC_DIR, { index: 'admin.html' }));

app.get('/api/npcs', (_req, res) => {
  res.json(npcs);
});

app.post('/api/npcs', upload.single('imagemArquivo'), (req, res) => {
  try {
    const { nome, idade, descricao, gostos, imagemUrl } = req.body || {};

    if (!nome || !idade || !descricao) {
      if (req.file) cleanupUpload(req.file.path);
      return res.status(400).json({ error: 'Nome, idade e descrição são obrigatórios.' });
    }

    const npcId = slugifyNome(nome);
    if (!npcId) {
      if (req.file) cleanupUpload(req.file.path);
      return res.status(400).json({ error: 'Não foi possível gerar um ID válido para o NPC.' });
    }

    if (npcs.some(n => n.id === npcId)) {
      if (req.file) cleanupUpload(req.file.path);
      return res.status(409).json({ error: 'Já existe um NPC com esse nome/id.' });
    }

    const tags = parseTags(gostos);

    const notaInput = req.body?.nota ?? req.body?.notaValor ?? null;
    const notaDescricaoInput = req.body?.notaDescricao ?? req.body?.nota_motivo ?? null;

    let notaValor = null;
    if (notaInput !== null && notaInput !== undefined && String(notaInput).trim() !== '') {
      const parsed = Number(notaInput);
      if (Number.isNaN(parsed)) {
        if (req.file) cleanupUpload(req.file.path);
        return res.status(400).json({ error: 'Nota inválida: use números entre 1 e 5.' });
      }
      notaValor = parsed;
    }

    if (notaValor !== null && (notaValor < 1 || notaValor > 5)) {
      if (req.file) cleanupUpload(req.file.path);
      return res.status(400).json({ error: 'Nota inválida: informe valores entre 1 e 5.' });
    }

    const notaDescricao = typeof notaDescricaoInput === 'string' ? notaDescricaoInput.trim() : '';

    if (notaValor !== null && !notaDescricao) {
      if (req.file) cleanupUpload(req.file.path);
      return res.status(400).json({ error: 'Descreva o motivo ao cadastrar a nota do NPC.' });
    }

    if (notaValor === null && notaDescricao) {
      if (req.file) cleanupUpload(req.file.path);
      return res.status(400).json({ error: 'Informe a nota (1 a 5) antes de adicionar o motivo.' });
    }

    let imageValue = null;
    if (req.file) {
      imageValue = path.relative(__dirname, req.file.path).replace(/\\/g, '/');
    } else if (imagemUrl && imagemUrl.trim()) {
      imageValue = imagemUrl.trim();
    }

    const novoNpc = {
      id: npcId,
      nome: nome.trim(),
      idade: idade.trim(),
      bio: descricao.trim(),
      tags,
    };

    if (imageValue) {
      novoNpc.image = imageValue;
    }

    if (notaValor !== null) {
      novoNpc.rating = notaValor;
      novoNpc.ratingReason = notaDescricao;
    }

    npcs.push(novoNpc);
    saveNpcsFile();

    return res.status(201).json({ message: 'NPC criado com sucesso.', npc: novoNpc });
  } catch (err) {
    console.error('Erro criando NPC via painel', err);
    if (req.file) cleanupUpload(req.file.path);
    return res.status(500).json({ error: 'Erro interno ao salvar NPC.' });
  }
});

app.use((err, req, res, next) => {
  if (!err) return next();
  console.error('Erro na API', err);
  if (req?.file) cleanupUpload(req.file.path);
  const status = err instanceof multer.MulterError ? 400 : 500;
  const message = err.message || 'Erro ao processar requisição.';
  return res.status(status).json({ error: message });
});

app.get('/', (req, res) => {
  res.send('RPG Tinder bot está rodando. 💘');
});

app.get('/healthz', (req, res) => {
  res.send('ok');
});

app.listen(PORT, () => {
  console.log(`Servidor HTTP ouvindo na porta ${PORT}`);
});

