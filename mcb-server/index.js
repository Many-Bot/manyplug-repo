/**
 * plugins/mcb-server/index.js
 *
 * Monitors a Minecraft Bedrock server log file and
 * notifies a WhatsApp group when players connect/disconnect.
 */

import fs from "fs";

const PLAYERS_FILE = "mcplayers.json";

function loadPlayers() {
  try {
    if (!fs.existsSync(PLAYERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(PLAYERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function savePlayers(players) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
}

let ctxRef  = null;
let tRef    = null;
let players = loadPlayers();

function handleLine(line) {
  if (!line || !ctxRef) return;

  const joinMatch = line.match(/Player Spawned: (.+?) xuid:/);
  if (joinMatch) {
    const groupId = ctxRef.config.get("MC_GROUP_ID");
    ctxRef.sendTo(groupId, tRef("messages.playerConnected", { name: joinMatch[1] }));
    players.push(joinMatch[1]);
    savePlayers(players);
    return;
  }

  const leaveMatch = line.match(/Player disconnected: (.+?), xuid:/);
  if (leaveMatch) {
    const groupId = ctxRef.config.get("MC_GROUP_ID");
    ctxRef.sendTo(groupId, tRef("messages.playerDisconnected", { name: leaveMatch[1] }));
    players = players.filter(p => p !== leaveMatch[1]);
    savePlayers(players);
  }
}

export async function setup(ctx) {
  ctxRef = ctx;
  const { t } = ctx.i18n.createT(import.meta.url);
  tRef = t;

  const logFile = ctx.config.get("MC_LOG_FILE");

  if (!fs.existsSync(logFile)) {
    ctx.log.error(t("messages.logFileNotFound", { file: logFile }));
    return;
  }

  fs.watchFile(logFile, { interval: 1000 }, (curr, prev) => {
    if (curr.size <= prev.size) return;
    const stream = fs.createReadStream(logFile, {
      start: prev.size, end: curr.size, encoding: "utf8",
    });
    stream.on("data", chunk => {
      chunk.split("\n").forEach(line => handleLine(line.trim()));
    });
    stream.on("error", err =>
      ctx.log.error(t("messages.streamError", { error: err.message }))
    );
  });
}

export default async function (ctx) {
  const { msg } = ctx;
  const prefix  = ctx.config.get("CMD_PREFIX");
  const { t }   = ctx.i18n.createT(import.meta.url);

  if (msg.is(prefix + "players")) {
    const list = players.length
      ? players.join("\n")
      : t("messages.noPlayers");
    await msg.reply(`🎮 Players online (${players.length}):\n${list}`);
  }
}
