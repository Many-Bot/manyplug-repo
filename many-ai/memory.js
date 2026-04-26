// src/plugins/many-ai/memory.js
// Memória persistente da Many — independente do many-ai original.
// Arquivo: src/plugins/many-ai/memory.db

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const sqlite3 = require("sqlite3").verbose();

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "memory.db");

let apiRef = null;

export function initMemory(api) {
  apiRef = api;
}

function logInfo(msg) {
  if (apiRef) apiRef.log.info(msg);
}

function logError(msg) {
  if (apiRef) apiRef.log.error(msg);
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    logError(`[memory] Erro ao abrir banco: ${err.message}`);
  } else {
    logInfo(`[memory] Banco aberto: ${DB_PATH}`);
  }
});

db.run("PRAGMA journal_mode = WAL;", (err) => {
  if (err) logError(`[memory] Erro WAL mode: ${err.message}`);
});

db.run(
  `CREATE TABLE IF NOT EXISTS memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  (err) => {
    if (err) {
      logError(`[memory] Erro ao criar tabela: ${err.message}`);
    } else {
      logInfo("[memory] Tabela 'memory' pronta");
    }
  }
);

export function memWrite(content) {
  return new Promise((resolve, reject) => {
    db.run("INSERT INTO memory (content) VALUES (?)", [content], function(err) {
      if (err) {
        logError(`[memory] INSERT falhou: ${err.message}`);
        return reject(err);
      }
      logInfo(`[memory] INSERT sucesso, id=${this.lastID}`);
      resolve(`Memória salva (id=${this.lastID})`);
    });
  });
}

export function memRead(query) {
  return new Promise((resolve, reject) => {
    const isAll = query === "*" || query.toLowerCase() === "all" || query.toLowerCase() === "tudo";
    const sql = isAll
      ? "SELECT content FROM memory ORDER BY created_at DESC LIMIT 20"
      : "SELECT content FROM memory WHERE content LIKE ? ORDER BY created_at DESC LIMIT 10";
    const params = isAll ? [] : [`%${query}%`];

    db.all(sql, params, (err, rows) => {
      if (err) {
        logError(`[memory] SELECT falhou: ${err.message}`);
        return reject(err);
      }
      if (!rows.length) return resolve("Nenhum resultado.");
      resolve(rows.map(r => `[${r.content}]`).join(" | "));
    });
  });
}

// Teste inicial
console.log("[memory] Módulo carregado");
