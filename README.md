# Userscripts Collection

A collection of userscripts for various websites, built with TypeScript.

All scripts are targeted for [ViolentMonkey](https://violentmonkey.github.io/) browser extension and [Zen Browser](https://zen-browser.app/)

## Scripts

<!-- scripts-list:start -->
- **[Gamescom Epix Tools](src/gamescom-epix-tools/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/gamescom-epix-tools.user.js)) — Tools for Gamescom Epix 2024 event website
- **[Humble Bundle Key Sort](src/humblebundle-key-sort/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/humblebundle-key-sort.user.js)) — Sort Humble Bundle by claimed status
- **[Kingshot Troop Formation %](src/kingshot-troop-calculator/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/kingshot-troop-calculator.user.js)) — Bear table: subtractive simulation; Calculated % = composition per march vs preset goal warnings. Vikings: uniform best-fit. Training Focus.
- **[Price Per Unit](src/price-per-unit/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/price-per-unit.user.js)) — Adds price per unit to product pages and enables sorting by unit price
- **[SteamTrade Matcher Userscript](src/steam-trade/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/steam-trade.user.js)) — Allows quicker trade offers by automatically adding cards as matched by SteamTrade Matcher
- **[SteamGifts Enter Giveaways](src/steamgifts-com/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/steamgifts-com.user.js)) — Auto-enter visible SteamGifts giveaways via quick-entry buttons (ESGST scroll/filters)
- **[TVDB Episode Input Automation](src/tvdb-episode-automation/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/tvdb-episode-automation.user.js)) — Automates episode input process on TVDB
- **[Twitch Drops Page Tools](src/twitch-drops/README.md)** ([Install](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/twitch-drops.user.js)) — Sort Twitch drops by end date, auto-claim inventory, and hide ended in-progress campaigns
<!-- scripts-list:end -->

- **[AWA Toolkit](https://github.com/UpDownLeftDie/AWA-Toolkit)** ([Install](https://github.com/UpDownLeftDie/AWA-Toolkit/raw/refs/heads/main/dist/awa-toolkit.user.js)) — Artifact Optimizer, Control Center tasks, giveaway/vault filters, and UCF reading mode (now in its own repository)

## Development

### Prerequisites

- Node.js (v22 or higher)
- [pnpm](https://pnpm.io/installation) (enable with [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`)

### Setup

1. Clone the repository
2. Run `pnpm install` to install dependencies
3. Run `pnpm build` to build the scripts and refresh the **Scripts** list in this file (from each package’s `meta.ts`)
