# Alienware Arena Filters (legacy URL)

Keeps the historical [`dist/alienware-arena-filters.user.js`](https://github.com/jaredcat/userscripts/raw/refs/heads/main/dist/alienware-arena-filters.user.js) update URL working.

Existing **Alienware Arena Filters** installs (v1.2.0) still check that file. The 2.0.0 payload is the [Toolkit](../alienware-arena/README.md) userscript, with `@updateURL` / `@downloadURL` rewritten to `dist/alienware-arena.user.js`. After that one update, the manager stores the new name and checks the Toolkit URL from then on.

New installs should use the [Toolkit install link](../alienware-arena/README.md#install).
