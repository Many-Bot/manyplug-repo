import { CMD_PREFIX } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

export default async function ({ msg, api }) {
  if (!msg.is(CMD_PREFIX + "many")) return;

  await api.send(
    `${t("title")}\n\n` +
    `🎬 \`${CMD_PREFIX}video <link>\` — ${t("video")}\n` +
    `🎵 \`${CMD_PREFIX}audio <link>\` — ${t("audio")}\n` +
    `🖼️ \`${CMD_PREFIX}figurinha\` — ${t("sticker")}\n` +
    `🎮 \`${CMD_PREFIX}adivinhação começar|parar\` — ${t("guess")}\n` +
    `🎮 \`${CMD_PREFIX}forca começar|parar\` — ${t("hangman")}\n`
  );
}