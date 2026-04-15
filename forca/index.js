/**
 * plugins/forca/index.js
 *
 * Hangman game plugin with isolated i18n.
 * Game state is stored internally per chat.
 */

import { CMD_PREFIX } from "../../config.js";
import { createPluginI18n } from "../../utils/pluginI18n.js";

const { t } = createPluginI18n(import.meta.url);

// Game states
const activeGames = new Map();         // chatId -> { word, theme, lives, progress }
const activeParticipants = new Map();  // chatId -> Set of users who reacted
export let hangmanActive = false;


// Sample words
const WORDS = [
    { word: "python", theme: "Programming Language" },
    { word: "javascript", theme: "Programming Language" },
    { word: "java", theme: "Programming Language" },
    { word: "dog", theme: "Animal" },
    { word: "cat", theme: "Animal" },
    { word: "elephant", theme: "Animal" },
    { word: "giraffe", theme: "Animal" },
    { word: "guitar", theme: "Musical Instrument" },
    { word: "piano", theme: "Musical Instrument" },
    { word: "drums", theme: "Musical Instrument" },
    { word: "violin", theme: "Musical Instrument" },
    { word: "soccer", theme: "Sport" },
    { word: "basketball", theme: "Sport" },
    { word: "swimming", theme: "Sport" },
    { word: "tennis", theme: "Sport" },
    { word: "brazil", theme: "Country" },
    { word: "japan", theme: "Country" },
    { word: "canada", theme: "Country" },
    { word: "france", theme: "Country" },
    { word: "mars", theme: "Planet" },
    { word: "venus", theme: "Planet" },
    { word: "jupiter", theme: "Planet" },
    { word: "saturn", theme: "Planet" },
    { word: "minecraft", theme: "Game" },
    { word: "fortnite", theme: "Game" },
    { word: "roblox", theme: "Game" },
    { word: "amongus", theme: "Game" },
    { word: "rose", theme: "Flower" },
    { word: "sunflower", theme: "Flower" },
    { word: "tulip", theme: "Flower" },
    { word: "orchid", theme: "Flower" },
    { word: "scissors", theme: "Object" },
    { word: "notebook", theme: "Object" },
    { word: "computer", theme: "Object" },
    { word: "phone", theme: "Object" },
    { word: "moon", theme: "Celestial Body" },
    { word: "sun", theme: "Celestial Body" },
    { word: "star", theme: "Celestial Body" },
    { word: "comet", theme: "Celestial Body" },
    { word: "ocean", theme: "Nature" },
    { word: "mountain", theme: "Nature" },
];

// Generate word with underscores
const generateProgress = word =>
    word.replace(/[a-zA-Z]/g, "_");

export default async function ({ msg, api }) {
    const chatId = api.chat.id;
    const sub = msg.args[1];

    // ── Main game command
    if (msg.is(CMD_PREFIX + "forca")) {
        if (!sub) {
            await api.send(
                `${t("title")}\n\n` +
                `\`${CMD_PREFIX}forca start\` — ${t("startCommand")}\n` +
                `\`${CMD_PREFIX}forca stop\` — ${t("stopCommand")}`
            );
            return;
        }

        if (sub === "start") {
            hangmanActive = true;
            // Get random word
            const random = WORDS[Math.floor(Math.random() * WORDS.length)];

            // Initialize game
            activeGames.set(chatId, {
                word: random.word.toLowerCase(),
                theme: random.theme,
                lives: 6,
                progress: generateProgress(random.word)
            });

            activeParticipants.set(chatId, new Set()); // reset participants

            await api.send(
                t("started", {
                    theme: random.theme,
                    word: generateProgress(random.word),
                    lives: 6
                })
            );
            return;
        }

        if (sub === "stop") {
            activeGames.delete(chatId);
            activeParticipants.delete(chatId);
            await api.send(t("stopped"));
            return;
        }

        await api.send(
            `${t("invalidCommand", { sub })} \`${CMD_PREFIX}forca start\` ${t("or")} \`${CMD_PREFIX}forca stop\`.`
        );
        return;
    }

    // ── Game attempts
    const game = activeGames.get(chatId);
    if (!game) return; // No active game

    const attempt = msg.body.trim().toLowerCase();
    if (!/^[a-z]$/.test(attempt)) return; // single letters only

    // Check if letter is in word
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

    // Feedback for group
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
