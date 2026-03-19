# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Bazr (بازر)** — Online multiplayer team-based quiz buzzer game. Two teams compete, players buzz in and type answers that are auto-judged with fuzzy matching (~70% similarity threshold). Built with Node.js + Express + Socket.io.

## Setup & Run

```bash
npm install
npm start        # http://localhost:3000
```

## Architecture

### Backend (`server/`)
- **`index.js`** — Express + Socket.io server. All socket events: room creation, player join/kick, buzzer, answer submission, host controls.
- **`gameManager.js`** — Server-authoritative game logic. Fuzzy string matching (Levenshtein + Arabic normalization), race condition-protected buzzer, category filtering, question shuffling, host override.
- **`questions/`** — 4,920 unique Arabic questions across 20 categories. `index.js` combines and deduplicates all category files.

### Frontend (`public/`)
- **`index.html`** — Landing page. Host selects categories + question count; player enters code + name + team.
- **`host.html`** + `js/host.js` — Host dashboard. Lobby with kick buttons, game view with question+answer, auto-judge results, host override (correct/wrong), skip question, next question.
- **`player.html`** + `js/player.js` — Player screen. Buzzer button (also spacebar), text input for answers (appears after buzzing, submit with Enter), timer, scores.
- **`results.html`** + `js/results.js` — Final scores with confetti.
- **`css/style.css`** — Shared design system. Dark theme, RTL Arabic, Cairo font, CSS variables.

### Game Flow
1. Host creates room (selects categories, question count) → 6-digit code
2. Players join with code + name + team (A or B)
3. Host starts game → shuffled questions from selected categories
4. Per question: host opens buzzer → first player to buzz types answer → auto-judged with fuzzy matching → host can override
5. 15-second timer per buzz. Timer expiry = auto-wrong.
6. Game over → results page with winner + player leaderboard

### Key Design Decisions
- **Fuzzy answer matching**: Levenshtein distance with Arabic normalization (diacritics, alef/taa variants). 70% threshold. Substring containment = 95% match.
- **Server-authoritative buzzer**: Atomic `buzzerOpen && !buzzedPlayer` check in single-threaded Node.js
- **Host override**: After auto-judge, host can correct wrong judgments
- **Reconnection**: Players rejoin by name; host reconnects via `host-reconnect` event

## Legacy

`archive/` contains deprecated files (old PeerJS version, FARES97 single-player game).
