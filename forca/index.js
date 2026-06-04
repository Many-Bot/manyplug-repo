/**
 * plugins/forca/index.js
 *
 * Hangman game plugin with isolated i18n.
 * Game state is stored internally per chat.
 */

// Game states
const activeGames        = new Map(); // chatId -> { word, theme, lives, progress }
const activeParticipants = new Map(); // chatId -> Set of users who reacted
export let hangmanActive = false;

// Sample words
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const words = JSON.parse(
  await readFile(join(__dirname, "words.json"), "utf8")
);

// Generate word with underscores
const generateProgress = word => word.replace(/[a-zA-Z]/g, "_");

export default async function (ctx) {
  const { msg } = ctx;
  const chatId  = ctx.chat.id;
  const prefix  = ctx.config.get("CMD_PREFIX");
  const { t }   = ctx.i18n.createT(import.meta.url);

  const sub = msg.args[1];

  // ── Main game command ─────────────────────────────────────
  if (msg.is(prefix + "forca")) {
    if (!sub) {
      await ctx.send(
        `${t("title")}\n\n` +
        `\`${prefix}forca ${t(startCommand)}\` — ${t("startCommandHelp")}\n` +
        `\`${prefix}forca ${t(stopCommand)}\` — ${t("stopCommandHelp")}`
      );
      return;
    }
   
    const lang = ctx.config.get("LANGUAGE");
    const WORDS = words[lang] ?? words.en;
    
    if (sub === "start") {
      hangmanActive = true;

      const random = WORDS[Math.floor(Math.random() * WORDS.length)];

      activeGames.set(chatId, {
        word:     random.word.toLowerCase(),
        theme:    random.theme,
        lives:    6,
        progress: generateProgress(random.word),
      });

      activeParticipants.set(chatId, new Set());

      await ctx.send(
        t("started", {
          theme: random.theme,
          word:  generateProgress(random.word),
          lives: 6,
        })
      );
      return;
    }

    if (sub === "stop") {
      activeGames.delete(chatId);
      activeParticipants.delete(chatId);
      await ctx.send(t("stopped"));
      return;
    }

    await ctx.send(
      `${t("invalidCommand", { sub })} \`${prefix}forca start\` ${t("or")} \`${prefix}forca stop\`.`
    );
    return;
  }

  // ── Game attempts ─────────────────────────────────────────
  const game = activeGames.get(chatId);
  if (!game) return;

  const attempt = msg.body.trim().toLowerCase();
  if (!/^[a-z]$/.test(attempt)) return;

  let hit = false;
  let newProgress = game.progress.split("");
  for (let i = 0; i < game.word.length; i++) {
    if (game.word[i] === attempt) {
      newProgress[i] = attempt;
      hit = true;
    }
  }
  game.progress = newProgress.join("");

  if (!hit) game.lives--;

  if (game.progress === game.word) {
    await msg.reply(t("won", { word: game.word }));
    activeGames.delete(chatId);
    activeParticipants.delete(chatId);
    return;
  }

  if (game.lives <= 0) {
    await msg.reply(t("lost", { word: game.word }));
    activeGames.delete(chatId);
    activeParticipants.delete(chatId);
    return;
  }

  await msg.reply(
    `${t("status", { word: game.progress, lives: game.lives })}\n` +
    (hit ? t("correct") : t("wrong"))
  );
}
