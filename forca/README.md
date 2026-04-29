# Forca

Hangman game for Manybot. Classic word guessing game with themed categories.

## Features

- **Multiple categories**: Animals, countries, programming languages, games, and more
- **6 lives**: Classic hangman rules
- **Group-friendly**: Multiple players can participate in the same game
- **Visual progress**: Shows guessed letters and remaining blanks
- **40+ words**: Large word bank across 10+ themes

## Word Categories

- Programming Languages (python, javascript, java)
- Animals (dog, cat, elephant, giraffe)
- Musical Instruments (guitar, piano, drums, violin)
- Sports (soccer, basketball, swimming, tennis)
- Countries (brazil, japan, canada, france)
- Planets (mars, venus, jupiter, saturn)
- Games (minecraft, fortnite, roblox, amongus)
- Flowers (rose, sunflower, tulip, orchid)
- Objects (scissors, notebook, computer, phone)
- Celestial Bodies (moon, sun, star, comet)
- Nature (ocean, mountain)

## Usage

### Start a game

```
!forca start
```

The bot picks a random word and shows the theme and blanks.

### Guess a letter

```
a
```

Send a single letter to guess. The bot will respond with:
- Which letters were revealed (if any)
- Remaining lives
- Current word progress

### Stop a game

```
!forca stop
```

Cancels the active game.

### Show help

```
!forca
```

Displays available commands.

## Commands

| Command | Description |
|---------|-------------|
| `!forca` | Show help menu |
| `!forca start` | Start a new hangman game |
| `!forca stop` | Stop the current game |
| `[a-z]` | Send any letter to guess |

## Game Rules

- 6 lives total
- Wrong guesses lose 1 life
- Game ends when:
  - Word is completely revealed (win)
  - All lives are lost (lose)

## Configuration

No configuration required. The game works out of the box.

## Localization

Available in:
- English (`locale/en.json`)
- Portuguese (`locale/pt.json`)
- Spanish (`locale/es.json`)
