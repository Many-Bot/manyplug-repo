/**
 * plugins/counting/index.js
 *
 * Counting game plugin with isolated i18n.
 * Users take turns sending the next integer in sequence.
 *
 * Rules:
 *  - Must send the next integer in sequence (current + 1)
 *  - Same user cannot continue their own count (but can restart from 1)
 *  - Any mistake resets the counter to 0
 *
 * Config:
 *  COUNTING_CHATS=[] — list of chat IDs where the game is active.
 *                      If empty, the plugin is silent in all chats.
 */

// Game state isolated per chat
const chatState = new Map(); // chatId -> { number, lastFrom }

function getState(chatId) {
  if (!chatState.has(chatId)) {
    chatState.set(chatId, { number: 0, lastFrom: null });
  }
  return chatState.get(chatId);
}

export default async function (ctx) {
  const { msg, chat } = ctx;
  const prefix        = ctx.config.get("CMD_PREFIX");
  const { t }         = ctx.i18n.createT(import.meta.url);

  // ── Chat filter ───────────────────────────────────────────

  const allowedChats = ctx.config.get("COUNTING_CHATS", []);
  if (allowedChats.length > 0 && !allowedChats.includes(chat.id)) return;

  // ── Info command ──────────────────────────────────────────

  if (msg.is(prefix + "counting")) {
    const state = getState(chat.id);
    await ctx.send(
      `*${t("title")}*\n\n` +
      `${t("rulesLine1")}\n` +
      `${t("rulesLine2")}\n` +
      `${t("rulesLine3")}\n\n` +
      t("current", { number: state.number })
    );
    return;
  }

  // ── Game logic ────────────────────────────────────────────

  const n = Number(msg.body.trim());
  if (!Number.isInteger(n) || n === 0) return;

  const state = getState(chat.id);
  const from  = msg.sender;

  // regra 1: não pode continuar sozinho (mas pode recomeçar do 1)
  if (from === state.lastFrom && n !== 1) {
    state.number   = 0;
    state.lastFrom = null;
    await msg.react("❌").catch(() => {});
    return;
  }

  // regra 2: sequência numérica
  if (n === state.number + 1) {
    state.number   = n;
    state.lastFrom = from;
    await msg.react("✅").catch(() => {});
  } else {
    state.number   = 0;
    state.lastFrom = null;
    await msg.react("❌").catch(() => {});
  }
}
