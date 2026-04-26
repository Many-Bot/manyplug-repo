import fs from "fs";
import { CMD_PREFIX, CONFIG } from "../../config.js";
import { createPluginT } from "../../i18n/index.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { MC_GROUP_ID, MC_LOG_FILE } = CONFIG;
const { t } = createPluginT(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRATIONS_FILE = join(__dirname, "registrations.json");

let apiRef = null;
let players = [];
let registrations = {}; // whatsappId -> minecraftName

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

/**
 * Resolve o Contact a partir de um ID (incluindo @lid).
 * Retorna { id, number, name } ou null.
 */
async function resolveContact(rawId) {
  try {
    const contact = await apiRef.client.getContactById(rawId);
    if (contact && contact.id) {
      let serialized = contact.id._serialized;
      let number = contact.id.user;
      if (contact.id.server === "lid") {
        try {
          const pn = await apiRef.client.pupPage.evaluate((lid) => {
            const wid = window.Store.WidFactory.createWid(lid);
            const phone = window.Store.LidUtils.getPhoneNumber(wid);
            return phone?._serialized || null;
          }, serialized);
          if (pn) {
            serialized = pn;
            number = pn.replace("@c.us", "");
          }
        } catch {
          // LidUtils não disponível, mantém o lid
        }
      }
      return {
        id: serialized,
        number,
        name: contact.pushname || contact.name || number,
      };
    }
  } catch { /* contact não encontrado */ }
  return null;
}

/**
 * Extrai menções de uma mensagem via Puppeteer (contorna wrappers do ManyBot).
 */
async function getMentionedContacts(msg) {
  let rawIds = [];

  try {
    const msgId = msg.id?._serialized || msg.id;
    const nativeMsg = await apiRef.client.pupPage.evaluate(async (id) => {
      const m = window.Store.Msg.get(id);
      return m ? window.WWebJS.getMessageModel(m) : null;
    }, msgId);
    if (nativeMsg?.mentionedIds?.length) {
      rawIds = nativeMsg.mentionedIds;
    }
  } catch { /* fallback */ }

  if (!rawIds.length && msg.mentionedIds?.length) {
    rawIds = msg.mentionedIds;
  }

  const contacts = [];
  for (const id of rawIds) {
    const c = await resolveContact(id);
    if (c) contacts.push(c);
  }
  return contacts;
}

async function isAdmin(whatsappId, chatId) {
  try {
    const chat = await apiRef.client.getChatById(chatId);
    const participant = chat.participants.find(p =>
      p.id._serialized === whatsappId ||
      p.id.user === whatsappId.replace(/@.*$/, "")
    );
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
  apiRef = api;

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

  // !mcreg <minecraft_name> [@user]
  if (body.startsWith(CMD_PREFIX + "mcreg")) {
    const args = body.replace(CMD_PREFIX + "mcreg", "").trim().split(/\s+/);
    if (!args[0]) {
      await msg.reply(t("messages.noNameProvided"));
      return;
    }

    const mcName = args[0];
    let targetId = senderId;
    let targetNumber = senderId.replace(/@.*$/, "");
    let targetName = msg.senderName;

    const mentions = await getMentionedContacts(msg);
    if (mentions.length > 0) {
      const admin = await isAdmin(senderId, chatId);
      if (!admin) {
        await msg.reply(t("messages.adminOnly"));
        return;
      }
      targetId = mentions[0].id;
      targetNumber = mentions[0].number;
      targetName = mentions[0].name;
    }

    const existingEntry = Object.entries(registrations).find(([, mc]) => mc === mcName);
    if (existingEntry) {
      const [existingId] = existingEntry;
      if (existingId === targetId) {
        await msg.reply(t("messages.alreadyRegistered", {
          mcName,
          whatsappName: targetId === senderId ? msg.senderName : `@${targetNumber}`,
        }));
        return;
      } else {
        const admin = await isAdmin(senderId, chatId);
        if (!admin) {
          await msg.reply(t("messages.adminOnly"));
          return;
        }
      }
    }

    registrations[targetId] = mcName;
    saveRegistrations();

    if (targetId === senderId) {
      await msg.reply(t("messages.registered", { mcName, whatsappName: msg.senderName }));
    } else {
      try {
        const chat = await apiRef.client.getChatById(chatId);
        await chat.sendMessage(
          t("messages.adminRegistered", { mcName, whatsappName: `@${targetNumber}` }),
          { mentions: [targetId] }
        );
      } catch {
        await msg.reply(t("messages.adminRegistered", { mcName, whatsappName: `@${targetNumber}` }));
      }
    }
    return;
  }

  // !mcunreg [@user]
  if (body.startsWith(CMD_PREFIX + "mcunreg")) {
    let targetId = senderId;

    const mentions = await getMentionedContacts(msg);
    if (mentions.length > 0) {
      const admin = await isAdmin(senderId, chatId);
      if (!admin) {
        await msg.reply(t("messages.adminOnly"));
        return;
      }
      targetId = mentions[0].id;
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

  // !mclist - lista com @menção real
  if (body.startsWith(CMD_PREFIX + "mclist")) {
    const entries = Object.entries(registrations);
    if (entries.length === 0) {
      await msg.reply(t("messages.noPlayers"));
      return;
    }

    const resolved = await Promise.all(
      entries.map(async ([wid, mc]) => {
        const c = await resolveContact(wid);
        return { wid: c?.id || wid, mc, number: c?.number || wid.replace(/@.*$/, "") };
      })
    );

    const text = resolved.map(({ mc, number }) => `- ${mc} → @${number}`).join("\n");
    const mentions = resolved.map(r => r.wid);

    try {
      const chat = await apiRef.client.getChatById(chatId);
      await chat.sendMessage(
        t("messages.registrationsList", { count: entries.length, list: text }),
        { mentions }
      );
    } catch {
      await msg.reply(t("messages.registrationsList", { count: entries.length, list: text }));
    }
    return;
  }

  // !mcwho <minecraft_name> - quem é esse player no WhatsApp
  if (body.startsWith(CMD_PREFIX + "mcwho")) {
    const mcName = body.replace(CMD_PREFIX + "mcwho", "").trim();
    if (!mcName) {
      await msg.reply(`Uso: ${CMD_PREFIX}mcwho <nick_minecraft>`);
      return;
    }

    const entry = Object.entries(registrations).find(
      ([, mc]) => mc.toLowerCase() === mcName.toLowerCase()
    );

    if (!entry) {
      await msg.reply(`❌ Nenhum usuário registrado com o nick *${mcName}*.`);
      return;
    }

    const [wid] = entry;
    const c = await resolveContact(wid);
    const number = c?.number || wid.replace(/@.*$/, "");
    const name = c?.name || number;

    try {
      const chat = await apiRef.client.getChatById(chatId);
      await chat.sendMessage(`⛏️ *${mcName}* é @${number} (${name})`, { mentions: [c?.id || wid] });
    } catch {
      await msg.reply(`⛏️ *${mcName}* é @${number} (${name})`);
    }
    return;
  }

  // !players - players online com menção real
  if (body.startsWith(CMD_PREFIX + "players")) {
    if (players.length === 0) {
      await msg.reply(t("messages.noPlayers"));
      return;
    }

    const reverseMap = {};
    Object.entries(registrations).forEach(([wid, mc]) => {
      reverseMap[mc.toLowerCase()] = wid;
    });

    const resolvedPlayers = await Promise.all(
      players.map(async p => {
        const wid = reverseMap[p.toLowerCase()];
        if (!wid) return { text: `- ${p}`, wid: null };
        const c = await resolveContact(wid);
        const number = c?.number || wid.replace(/@.*$/, "");
        return { text: `- ${p} (@${number})`, wid: c?.id || wid };
      })
    );

    const list = resolvedPlayers.map(r => r.text).join("\n");
    const mentions = resolvedPlayers.map(r => r.wid).filter(Boolean);

    try {
      const chat = await apiRef.client.getChatById(chatId);
      await chat.sendMessage(
        t("messages.playersList", { count: players.length, list }),
        { mentions }
      );
    } catch {
      await msg.reply(t("messages.playersList", { count: players.length, list }));
    }
    return;
  }
}
