# RPG Tinder Bot — AI Briefing

## Architecture Snapshot
- Discord bot and Express panel share a single entry point (index.js); keep both concerns in sync when touching shared helpers (slugifyNome, persistDiscordAttachment, parseTags, logFriendlyEvent, etc.).
- Discord state lives entirely in flat JSON under /data plus npcs.json; mutations must call saveJson/saveNpcsFile immediately to avoid stale process memory diverging from disk.
- Swiping uses userSessions and likesSessions Maps for ephemeral flow; always clean sessions with endTinderLogSession/cleanupLikesSession after exhausting queues or timing out (TTL 5 min).
- NPC media handling differentiates between remote URLs and local uploads/attachments saved under /uploads; AttachmentBuilder only receives local paths that exist.

## Discord Command Layer
- All slash command definitions live in Deploy-commands.js using discord.js v14 builders; keep option names synced with interaction handlers in index.js.
- Admin-only commands are gated by hasElevatedAccess plus ADMIN_COMMANDS; update both when adding privileged actions.
- /tinder and button handlers expect registrarSwipes flag plus registrarNpcVisto tracking; ensure new flows respect this to keep seen.json consistent.
- Likes/matches rely on swipes.json, matches.json, and npcLikes.json with { userId, npcId, tipo, ts }; mutations must append friendly logs via logFriendlyEvent/logTinderInteraction for auditability.

## Web/Admin Layer
- Express routes expose /api/npcs (GET, POST) and serve /admin/public/admin.html; any schema change in NPC objects must be reflected in panel form fields and POST parsing (nota*, gostos, image fields).
- Multer upload pipeline writes to /uploads and cleans temp files via cleanupUpload; mirror this behavior when adding new multipart routes.
- Front-end fetches /api/npcs and expects { nome, id }; preserve this contract when evolving the API.

## Operational Workflows
- Required env vars: DISCORD_TOKEN (bot login), CLIENT_ID (command deploy), GUILD_IDS_TO_CLEAR (comma list for cleanup), MATCH_CHANNEL_ID (announce matches), PORT (Express). Document new vars inside README/.env.sample if introduced.
- Local dev: `npm install`, `npm run deploy-commands` (after editing Deploy-commands.js), then `npm start` to boot both Discord client and HTTP server.
- Bulk image updates go through bulk-import-images.js <folder>; filenames must slugify to NPC ids, and script auto-cleans previous uploads via cleanupOldImage.
- Logs accumulate in data/logs.txt with daily headers; extend logging via logFriendlyEvent/appendLogBlock instead of console.log to keep chronological summaries tidy.

## Implementation Conventions
- Use helper builders (criarEmbedNpc, montarPayloadNpc, criarBotoesSwipe, asEphemeral) instead of custom embeds/replies so the UX stays consistent.
- PersistDiscordAttachment/fetchBufferFromUrl already follow redirect-safe HTTPS+fetch logic; reuse them when handling new media inputs.
- Favor parseTags/slugifyNome for any new NPC-facing input to maintain naming/tag consistency across commands, admin panel, and bulk import.
- When adding new persisted datasets under /data, mirror loadJson/saveJson usage and ensure files are created during startup if missing.
