/**
 * plugins/adivinhacao/index.js
 *
 * Game state lives here — isolated in the plugin.
 * Multiple groups can play simultaneously without conflict.
 */

import { CMD_PREFIX } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

const RANGE = { min: 1, max: 100 };
const jogosAtivos = new Map();

const sorteio = () =>
  Math.floor(Math.random() * (RANGE.max - RANGE.min + 1)) + RANGE.min;

export default async function ({ msg, api }) {
  const chatId = api.chat.id;

  // ── !adivinhação ─────────────────────────────────────────
  if (msg.is(CMD_PREFIX + "adivinhação")) {
    const sub = msg.args[1];

    if (!sub) {
      await api.send(
        `${t("title")}\n\n` +
        `\`${CMD_PREFIX}adivinhação começar\` — ${t("startCommand")}\n` +
        `\`${CMD_PREFIX}adivinhação parar\` — ${t("stopCommand")}`
      );
      return;
    }

    if (sub === "começar") {
      jogosAtivos.set(chatId, sorteio());
      await api.send(t("started"));
      api.log.info(t("gameLog.started"));
      return;
    }

    if (sub === "parar") {
      jogosAtivos.delete(chatId);
      await api.send(t("stopped"));
      api.log.info(t("gameLog.stopped"));
      return;
    }

    await api.send(
      `${t("invalidCommand", { sub })} \`${CMD_PREFIX}adivinhação começar\` ${t("or")} \`${CMD_PREFIX}adivinhação parar\`.`
    );
    return;
  }

  // ── Guesses during active game ────────────────────────────
  const numero = jogosAtivos.get(chatId);
  if (numero === undefined) return;

  const tentativa = msg.body.trim();
  if (!/^\d+$/.test(tentativa)) return;

  const num = parseInt(tentativa, 10);

  if (num < RANGE.min || num > RANGE.max) {
    await msg.reply(t("range", { min: RANGE.min, max: RANGE.max }));
    return;
  }

  if (num === numero) {
    await msg.reply(
      `${t("correct", { number: numero })} \`${CMD_PREFIX}adivinhação começar\` ${t("playAgain")}`
    );
    jogosAtivos.delete(chatId);
  } else {
    await api.send(num > numero ? t("lower") : t("higher"));
  }
}
