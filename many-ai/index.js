// src/plugins/many-ai/index.js
// Plugin-serviço: roda em background, Many decide quando responder.
// Requer no manybot.conf:
//   GROQ_API_KEY=gsk_...
//   TAVILY_API_KEY=tvly-...      (opcional)
//   SERPER_API_KEY=...           (opcional)

import { CMD_PREFIX, CONFIG } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

const { GROQ_API_KEY, TAVILY_API_KEY, SERPER_API_KEY, MANYAI_LID, LANGUAGE = "pt" } = CONFIG;
import { doSearch } from "./search.js";
import { memRead, memWrite, initMemory } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";

// Histórico por chat — Map<chatId, Message[]>
const histories = new Map();

const MAX_HISTORY = 20;
const MAX_HISTORY_SEND = 10;
const MAX_TOKENS = 150;
const MODEL = "llama-3.3-70b-versatile";

function getHistory(chatId) {
  if (!histories.has(chatId)) histories.set(chatId, []);
  return histories.get(chatId);
}

function trimHistory(history) {
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

async function callGroq(history, systemPrompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.slice(-MAX_HISTORY_SEND),
      ],
      max_tokens: MAX_TOKENS,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

// Processa a resposta do modelo — pode emitir commands ou MSG:"..."
// Retorna { type: "msg"|"command"|"silent", value?, command?, arg? }
function parseReply(reply, api) {
  const searchMatch = reply.match(/^SEARCH\((.+)\)$/);
  if (searchMatch) {
    api.log.info(t("logs.commandDetected", { command: "SEARCH", arg: searchMatch[1] }));
    return { type: "command", command: "SEARCH", arg: searchMatch[1] };
  }

  const memReadMatch = reply.match(/^MEM_READ\((.+)\)$/);
  if (memReadMatch) {
    api.log.info(t("logs.commandDetected", { command: "MEM_READ", arg: memReadMatch[1] }));
    return { type: "command", command: "MEM_READ", arg: memReadMatch[1] };
  }

  const memWriteMatch = reply.match(/^MEM_WRITE\((.+)\)$/);
  if (memWriteMatch) {
    api.log.info(t("logs.commandDetected", { command: "MEM_WRITE", arg: memWriteMatch[1] }));
    return { type: "command", command: "MEM_WRITE", arg: memWriteMatch[1] };
  }

  const msgMatch = reply.match(/^MSG:"([\s\S]+)"$/);
  if (msgMatch) {
    const value = msgMatch[1].trim();
    if (!value) return { type: "silent" };
    return { type: "msg", value };
  }

  if (reply && !reply.startsWith("OUT:")) return { type: "msg", value: reply };

  return { type: "silent" };
}

// Loop de resolução: modelo → command → OUT: → modelo → ... → MSG:"..."
async function resolveReply(chatId, history, systemPrompt, api, maxIterations = 5) {
  api.log.info(t("logs.historyStart", { count: history.length }));
  for (let i = 0; i < maxIterations; i++) {
    const raw = await callGroq(history, systemPrompt);
    api.log.debug(t("logs.groqResponse", raw.substring(0, 100)));
    history.push({ role: "assistant", content: raw });
    trimHistory(history);

    const parsed = parseReply(raw, api);

    if (parsed.type === "msg") {
      return parsed.value;
    }

    if (parsed.type === "silent") {
      return null;
    }

    if (parsed.type === "command") {
      let result;

      if (parsed.command === "SEARCH") {
        api.log.info(t("logs.searchExecuting", { query: parsed.arg }));
        result = await doSearch(parsed.arg, { TAVILY_API_KEY, SERPER_API_KEY });
      } else if (parsed.command === "MEM_READ") {
        api.log.info(t("logs.memoryReadExecuting", { query: parsed.arg }));
        try {
          result = await memRead(parsed.arg);
        } catch (err) {
          api.log.error(err.message);
          result = t("errors.memoryReadError");
        }
      } else if (parsed.command === "MEM_WRITE") {
        api.log.info(t("logs.memoryWriteExecuting", { arg: parsed.arg }));
        try {
          await memWrite(parsed.arg);
          history.push({ role: "user", content: `[${t("memory.saved")}]` });
        } catch (err) {
          api.log.error(err.message);
          history.push({ role: "user", content: `[${t("errors.memoryWriteError", { error: err.message })}]` });
        }
        continue;
      }

      history.push({ role: "user", content: `[Resultado da busca]: ${result}` });
    }
  }

  api.log.warn(t("logs.maxIterationsReached"));
  return null;
}

async function shouldRespond(msg, api) {
  if (msg.fromMe) return false;

  const body = msg.body || "";
  if (body.trim().startsWith(CMD_PREFIX)) return false;

  const botId = MANYAI_LID;
  if (!botId) {
    api.log.debug(t("logs.shouldRespond.noBotId"));
    return false;
  }

  if (!api.chat.isGroup) {
    api.log.debug(t("logs.shouldRespond.privateChat"));
    return true;
  }

  const lowerBody = body.toLowerCase();

  const mentioned = Array.isArray(msg.mentionedIds) && msg.mentionedIds.includes(botId);
  if (mentioned) {
    api.log.debug(t("logs.shouldRespond.mention"));
    return true;
  }

  if (msg.reply_to_message?.author?.id === botId) {
    api.log.debug(t("logs.shouldRespond.replyToMessage"));
    return true;
  }

  if (body.includes(`@${botId}`)) {
    api.log.debug(t("logs.shouldRespond.atIdInText"));
    return true;
  }

  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted?.from === botId) {
        api.log.debug(t("logs.shouldRespond.quotedMessage"));
        return true;
      } else {
        api.log.debug(t("logs.shouldRespond.quotedMessageOther"));
      }
    } catch (err) {
      api.log.debug(t("logs.shouldRespond.quotedError"));
    }
  }

  const triggerPhrases = [`@${botId}`];
  const matchedTrigger = triggerPhrases.find(p => lowerBody.includes(p));
  if (matchedTrigger) {
    api.log.debug(t("logs.shouldRespond.triggerPhrase", { phrase: matchedTrigger }));
    return true;
  }

  api.log.debug(t("logs.shouldRespond.noCondition"));
  return false;
}

export default async function ({ msg, api }) {
  if (msg.fromMe) return;

  initMemory(api);

  const chatId = api.chat.id;
  const history = getHistory(chatId);
  const now = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);

  // Check for media types the bot can't handle
  const mediaTypes = ["img", "sticker", "audio", "video", "document", "voice", "gif"];
  const msgType = (msg.type || "").toLowerCase();
  if (mediaTypes.includes(msgType)) {
    if (await shouldRespond(msg, api)) {
      await msg.reply(t("logs.noMediaResponse"));
    }
    return;
  }

  const body = msg.body || "";

  if (body.trim().startsWith(CMD_PREFIX)) {
    const formatted = `command|${msg.senderName}|${now}|${body}`;
    history.push({ role: "system", content: formatted });
    api.log.debug(t("logs.commandAdded", { cmd: body.substring(0, 30) }));
  } else {
    const chatType = api.chat.isGroup ? "group" : "private";
    const formatted = `${chatType}|member|${msg.senderName}|${now}|${body}`;
    history.push({ role: "user", content: formatted });
  }
  trimHistory(history);

  api.log.debug(t("logs.historyLength", { chatId, count: history.length }));

  if (!(await shouldRespond(msg, api))) return;

  const systemPrompt = buildSystemPrompt(LANGUAGE);

  try {
    const reply = await resolveReply(chatId, history, systemPrompt, api);
    if (reply) await msg.reply(reply);
  } catch (err) {
    api.log.error(`[many-ai] erro: ${err.message}`);
    await msg.reply(t("errors.generic"));
  }
}
