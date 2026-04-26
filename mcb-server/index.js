import fs from "fs";
import { CMD_PREFIX, CONFIG } from "../../config.js";
import { createPluginT } from "../../i18n/index.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { MC_GROUP_ID, MC_LOG_FILE } = CONFIG;
const { t } = createPluginT(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRATIONS_FILE = join(__dirname, "registrations.json");

let apiRef  = null;
let players = [];
let registrations = {}; // whatsappId -> minecraftName

// Carrega registros existentes
if (fs.existsSync(REGISTRATIONS_FILE)) {
  try {
    registrations = JSON.parse(fs.readFileSync(REGISTRATIONS_FILE, "utf8"));
  } catch (e) {
    registrations = {};
  }
}

function saveRegistrations() {
  fs.writeFileSync(REGISTRATIONS_FILE, JSON.stringify(registrations, null, 2));
}

async function isAdmin(whatsappId, chatId) {
  try {
    const chat = await apiRef.client.getChatById(chatId);
    const participant = chat.participants.find(p => p.id._serialized === whatsappId);
    return participant?.isAdmin || false;
  } catch {
    return false;
  }
}

function handleLine(line) {
  if (!line || !apiRef) return;

  const joinMatch = line.match(/Player Spawned: (.+?) xuid:/);
  if (joinMatch) {
    apiRef.sendTo(MC_GROUP_ID, t("messages.playerConnected", { name: joinMatch[1] }));
    players.push(joinMatch[1]);
    return;
  }

  const leaveMatch = line.match(/Player disconnected: (.+?), xuid:/);
  if (leaveMatch) {
    apiRef.sendTo(MC_GROUP_ID, t("messages.playerDisconnected", { name: leaveMatch[1] }));
    players = players.filter(p => p !== leaveMatch[1]);
  }
}

export async function setup(api) {
  apiRef = api; // define na inicialização, sem esperar mensagem

  if (!fs.existsSync(MC_LOG_FILE)) {
    api.log.error(t("messages.logFileNotFound", { file: MC_LOG_FILE }));
    return;
  }

  fs.watchFile(MC_LOG_FILE, { interval: 1000 }, (curr, prev) => {
    if (curr.size <= prev.size) return;

    const stream = fs.createReadStream(MC_LOG_FILE, {
      start: prev.size, end: curr.size, encoding: "utf8",
    });

    stream.on("data", chunk => {
      chunk.split("\n").forEach(line => handleLine(line.trim()));
    });

    stream.on("error", err => api.log.error(t("messages.streamError", { error: err.message })));
  });

  api.log.info(t("messages.watcherActive", { file: MC_LOG_FILE }));
}

export default async function ({ msg, api }) {
  const body = (msg.body || "").trim();
  const chatId = api.chat.id;
  const senderId = msg.sender;

  // !mcreg <minecraft_name> [@user] - registra username (próprio ou de outro se admin)
  if (body.startsWith(CMD_PREFIX + "mcreg")) {
    const args = body.replace(CMD_PREFIX + "mcreg", "").trim().split(/\s+/);
    if (!args[0]) {
      await msg.reply(t("messages.noNameProvided"));
      return;
    }

    const mcName = args[0];
    let targetId = senderId;

    // Get mentioned users using the proper API
    const mentions = await msg.getMentions();
    if (mentions && mentions.length > 0) {
      // Mentioning someone requires admin
      const admin = await isAdmin(senderId, chatId);
      if (!admin) {
        await msg.reply(t("messages.adminOnly"));
        return;
      }
      targetId = mentions[0].id._serialized;
    }

    // Check if this gamertag is already registered to someone
    const existingEntry = Object.entries(registrations).find(([wid, mc]) => mc === mcName);
    if (existingEntry) {
      const [existingId, existingMc] = existingEntry;
      if (existingId === targetId) {
        // Same person re-registering
        await msg.reply(t("messages.alreadyRegistered", {
          mcName: existingMc,
          whatsappName: targetId === senderId ? msg.senderName : `@${targetId}`
        }));
      } else {
        // Different person - only admins can override
        const admin = await isAdmin(senderId, chatId);
        if (!admin) {
          await msg.reply(t("messages.adminOnly"));
          return;
        }
        // Admin can override - will be handled below
      }
    }

    registrations[targetId] = mcName;
    saveRegistrations();

    if (targetId === senderId) {
      await msg.reply(t("messages.registered", { mcName, whatsappName: msg.senderName }));
    } else {
      await msg.reply(t("messages.adminRegistered", { mcName, whatsappName: `@${targetId}` }));
    }
    return;
  }

  // !mcunreg [@user] - desregistra (próprio ou de outro se admin)
  if (body.startsWith(CMD_PREFIX + "mcunreg")) {
    let targetId = senderId;

    // Get mentioned users using the proper API
    const mentions = await msg.getMentions();
    if (mentions && mentions.length > 0) {
      // Mentioning someone requires admin
      const admin = await isAdmin(senderId, chatId);
      if (!admin) {
        await msg.reply(t("messages.adminOnly"));
        return;
      }
      targetId = mentions[0].id._serialized;
    }

    if (!registrations[targetId]) {
      await msg.reply(t("messages.notRegistered", { mcName: "*" }));
      return;
    }

    const mcName = registrations[targetId];
    delete registrations[targetId];
    saveRegistrations();

    if (targetId === senderId) {
      await msg.reply(t("messages.unregistered", { mcName }));
    } else {
      await msg.reply(t("messages.adminUnregistered", { mcName }));
    }
    return;
  }

  // !mclist - lista registros
  if (body.startsWith(CMD_PREFIX + "mclist")) {
    const entries = Object.entries(registrations);
    if (entries.length === 0) {
      await msg.reply(t("messages.noPlayers"));
      return;
    }
    const list = entries.map(([wid, mc]) => `- ${mc} (@${wid})`).join("\n");
    await msg.reply(t("messages.registrationsList", { count: entries.length, list }));
    return;
  }

  // !players - mostra players online com nomes mapeados
  if (body.startsWith(CMD_PREFIX + "players")) {
    if (players.length === 0) {
      await msg.reply(t("messages.noPlayers"));
      return;
    }

    // Tenta mapear players para usuários registrados
    const reverseMap = {};
    Object.entries(registrations).forEach(([wid, mc]) => {
      reverseMap[mc.toLowerCase()] = wid;
    });

    const playerList = players.map(p => {
      const wid = reverseMap[p.toLowerCase()];
      return wid ? `- ${p} (WhatsApp: @${wid})` : `- ${p}`;
    }).join("\n");

    await msg.reply(t("messages.playersList", { count: players.length, list: playerList }));
    return;
  }
}

