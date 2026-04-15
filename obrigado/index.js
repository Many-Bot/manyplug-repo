import { CMD_PREFIX } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

const triggers = ["obrigado", "valeu", "brigado", "obrigada", "thx", "thanks"];

export default async function ({ msg }) {
  if (!triggers.some(g => msg.is(CMD_PREFIX + g))) return;

  await msg.reply(t("reply"));
}