# RPG Tinder Bot

Bot de Discord com painel web que permite cadastrar NPCs inspirados em RPG, exibi-los como cartas e oferecer uma experiência de "swipe" semelhante ao Tinder para os jogadores do servidor. Todo o estado persistente fica em arquivos JSON dentro de `data/`, enquanto os uploads de imagens de NPCs são guardados em `uploads/`.

## Principais recursos
- **Comandos Slash (`/tinder`, `/npc`, etc.)** construídos com `discord.js` v14, incluindo botões de like/dislike e registro de matches em `data/matches.json`.
- **Sessões efêmeras de swipe** com controle de TTL e limpeza automática via helpers (`userSessions`, `likesSessions`).
- **Painel administrativo Express** (`/admin/public/admin.html`) para listar e cadastrar NPCs via API REST (`/api/npcs`). Uploads usam `multer` e são salvos localmente.
- **Persistência em JSON**: `npcs.json`, `swipes.json`, `npcLikes.json`, `seen.json` e `data/logs.txt`, sempre sincronizados com disco através de `saveJson`/`saveNpcsFile`.
- **Importação em lote de imagens** com `bulk-import-images.js`, que popular `uploads/` a partir da pasta `imports/`.

## Pré-requisitos
- Node.js 18+ (recomendado para suporte estável ao `discord.js` v14 e `express@5`).
- Acesso a um servidor Discord onde você possa registrar comandos slash.

## Variáveis de ambiente
Crie um arquivo `.env` na raiz (ou configure variáveis no ambiente) com:

```
DISCORD_TOKEN=seu_token_do_bot
CLIENT_ID=id_da_aplicacao_do_bot
GUILD_IDS_TO_CLEAR=123456789012345678,987654321098765432
MATCH_CHANNEL_ID=canal_para_anunciar_matches
PORT=3000
```

> Atualize `README.md` e `.env.sample` sempre que adicionar novas variáveis obrigatórias.

## Instalação
1. Instale dependências:
   ```bash
   npm install
   ```
2. Registre os comandos slash no(s) servidor(es) informado(s) em `GUILD_IDS_TO_CLEAR`:
   ```bash
   npm run deploy-commands
   ```
3. Inicie o bot (Discord + painel Express):
   ```bash
   npm start
   ```

## Uso
- **Discord**: Execute `/tinder` em um canal permitido. O bot mostrará cartas de NPCs com botões de like/dislike; matches são anunciados no canal `MATCH_CHANNEL_ID` e registrados nos arquivos JSON em `data/`.
- **Painel web**: Com o processo rodando, acesse `http://localhost:PORT/admin/` para abrir `admin.html`. Use o formulário para cadastrar novos NPCs (nome, tags, gostos, imagem). Arquivos enviados vão para `uploads/` e são limpos do diretório temporário automaticamente.
- **Logs**: Todos os eventos importantes são adicionados a `data/logs.txt` via `logFriendlyEvent`. Prefira essas helpers a `console.log` para manter a linha do tempo organizada.
- **Importação em lote**: coloque novas imagens em `imports/` e execute `node bulk-import-images.js <pasta>` para gerar uploads otimizados, respeitando o `slugifyNome`.

## Estrutura do projeto
```
├── index.js              # Entrada principal: inicializa Discord e Express
├── Deploy-commands.js    # Registro dos comandos slash
├── bulk-import-images.js # Pipeline para importar imagens em lote
├── public/admin.html     # Painel administrativo
├── data/                 # Persistência (logs, swipes, matches, etc.)
├── uploads/              # Anexos salvos localmente
├── imports/              # Fontes para importações em lote
└── npcs.json             # Lista mestre de NPCs
```

## Boas práticas
- Sempre chame `saveJson`/`saveNpcsFile` após modificar qualquer estrutura carregada em memória para evitar divergência com os arquivos em disco.
- Ao manipular sessões de swipe, finalize com `endTinderLogSession` ou `cleanupLikesSession` para liberar memória.
- Prefira `parseTags`, `slugifyNome` e `persistDiscordAttachment` para manter consistência de dados e nomenclaturas em todo o sistema.
- Quando adicionar datasets em `data/`, inicialize o arquivo no startup para evitar erros em produção.

## Licença
Consulte o repositório original para obter informações de licença ou adicione uma seção específica caso publique publicamente.
