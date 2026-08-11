import {
  type ArtifactSnapshot,
  loadSnapshot,
  resolveShowroomUrl,
  saveSnapshot,
  scrapeShowroomFromDocument,
} from './scraper';
import { syncSlotLocksFromScrape } from './settings';
import {
  applyArpLogActivityCaps,
  applyBattlePassEndFromDocument,
  applyGameVaultDocument,
  applyRedeemableArpFromDocument,
  applySteamFreeToPlayResolution,
  applySteamQuestsFromDocument,
  emptySiteState,
  loadSiteState,
  markCommunityEventEnded,
  mergeCommunityEventScrape,
  reconcileCommunityEventWithArpLog,
  saveSiteState,
  scrapeArpLogFromDocument,
  mergeBattlePassScrape,
  scrapeBattlePassFromDocument,
  scrapeCommunityEventFromDocument,
  scrapeControlCenterCapsFromDocument,
  scrapeUserArpTierFromDocument,
  isChooseYourOwnGameQuest,
  isControlCenterDocumentReady,
  scrapeLiveCommunityEventBanner,
  scrapeSteamPlayEligibilityFromDocument,
  scrapeWatchTwitchProgressFromDocument,
  steamQuestsCapFromRows,
  requiresSteamQuestEligibilityFetch,
  sumCommunityEventRewardsFromArpLog,
  waitForControlCenterDocument,
  type SiteState,
  type SteamQuestRow,
} from './siteState';
import { applyAsceCommunityHours } from './asce';
import { scrapeSteamAppIdFromDocument } from './steamApp';

/**
Inventory / activity caps refresh cadence.
*/
const STALE_MS = 6 * 60 * 60 * 1000;
/**
ARP Log is enough once per day for trend checks; refresh sooner while a live
event still has unawarded ARP (new Steam Community Event Reward lines appear
as milestones auto-award).
*/
const ARP_LOG_STALE_MS = 24 * 60 * 60 * 1000;
const ARP_LOG_PENDING_EVENT_STALE_MS = 6 * 60 * 60 * 1000;
const BATTLE_PASS_STALE_MS = 60 * 60 * 1000;
/**
Live event page refresh for personal hours / awards. Community-hour rate
comes from ASCE (~hourly), so this can follow the normal 6h cadence.
*/
const COMMUNITY_EVENT_PENDING_STALE_MS = STALE_MS;
const CONTROL_CENTER_PATH = '/control-center';
const BATTLE_PASS_PATH = '/control-center/battle-pass/1';
const GAME_VAULT_PATH = '/marketplace/game-vault';
const ARP_LOG_PATH = '/account/arp-log';
const QUEST_SETUP_PATH = '/steam/questsetup';

function formatDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
Prefer a dated ARP Log window while a community event is live.
*/
function resolveArpLogPath(event: SiteState['communityEvent']): string {
  if (!event?.isLive) {
    return `${ARP_LOG_PATH}?max=50`;
  }
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  return `${ARP_LOG_PATH}?from=${formatDateInput(from)}&to=${formatDateInput(to)}&max=50`;
}

interface LoadedPage {
  document: Document;
  url: string;
}

function pathnameFromUrl(url: string, fallback: string): string {
  try {
    return new URL(url, location.origin).pathname;
  } catch {
    return fallback;
  }
}

async function fetchDocument(path: string): Promise<LoadedPage | undefined> {
  try {
    const response = await fetch(path, {
      headers: { Accept: 'text/html' },
    });
    if (!response.ok) {
      console.warn(
        '[Artifact Optimizer] Failed to fetch',
        path,
        response.status,
      );
      return undefined;
    }
    const html = await response.text();
    return {
      document: new DOMParser().parseFromString(html, 'text/html'),
      url: response.url || path,
    };
  } catch (error) {
    console.warn('[Artifact Optimizer] Fetch error for', path, error);
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCommunityEventHours(document_: Document): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    const hours = document_
      .querySelector('#personal-hours')
      ?.textContent?.trim();
    if (hours) {
      break;
    }
    await delay(250);
  }
}

async function settleIframePage(
  iframe: HTMLIFrameElement,
  path: string,
): Promise<LoadedPage | undefined> {
  const document_ = iframe.contentDocument ?? undefined;
  if (!document_) {
    return undefined;
  }
  if (path.includes('/steam/community-event')) {
    await waitForCommunityEventHours(document_);
  } else if (path.includes('/battle-pass')) {
    await waitForBattlePassUi(document_);
  } else {
    await delay(400);
  }
  return {
    document: document_,
    url: iframe.contentWindow?.location.href ?? path,
  };
}

/**
 * Briefly open a same-origin page in a hidden iframe (fallback when fetch HTML
 * is incomplete), scrape, then remove it.
 */
async function openPageDocument(path: string): Promise<LoadedPage | undefined> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText =
      'position:fixed;width:1px;height:1px;left:-9999px;top:0;opacity:0;pointer-events:none;border:0';
    const cleanup = (): void => {
      iframe.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 15_000);
    iframe.addEventListener('load', () => {
      clearTimeout(timer);
      void settleIframePage(iframe, path).then((page) => {
        cleanup();
        resolve(page);
      });
    });
    iframe.addEventListener('error', () => {
      clearTimeout(timer);
      cleanup();
      resolve(undefined);
    });
    document.body.append(iframe);
    iframe.src = path;
  });
}

function hasBattlePassUi(document_: Document): boolean {
  return Boolean(
    document_.querySelector(
      '.bp-popup[data-milestone-id], .bp-popup__claim-btn',
    ) || /Ready to claim/i.test(document_.body?.textContent ?? ''),
  );
}

async function waitForBattlePassUi(document_: Document): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (hasBattlePassUi(document_)) {
      return;
    }
    await delay(250);
  }
}

function hasPersonalHours(document_: Document): boolean {
  const domHours = document_
    .querySelector('#personal-hours')
    ?.textContent?.trim();
  if (domHours && /\d/.test(domHours)) {
    return true;
  }
  if (/Your Total Hours:\s*[\d.]+/i.test(document_.body?.textContent ?? '')) {
    return true;
  }
  // Fetch HTML leaves #personal-hours empty; minutes are inlined as JS.
  const scripts = [...document_.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent ?? '')
    .join('\n');
  return /personalPlaytime\s*=\s*\d+/i.test(scripts);
}

function requiresIframeFallback(path: string, fetched: Document): boolean {
  if (path.includes('/artifacts') || path.includes('/user-artifacts-room')) {
    return !fetched.body?.querySelector(
      ':scope a.artifact-list-item.change-artifact-modal, :scope .slot img',
    );
  }
  if (path.includes('/arp-log')) {
    return !/ARP Log|Redeemable ARP/i.test(fetched.body?.textContent ?? '');
  }
  if (path.includes('/battle-pass')) {
    return !hasBattlePassUi(fetched);
  }
  if (path.includes('/steam/community-event')) {
    // Hours are filled client-side into #personal-hours; fetch HTML is empty.
    return (
      !fetched.querySelector('.carousel-cell') || !hasPersonalHours(fetched)
    );
  }
  if (/\/steam\/quests\/.+/.test(path)) {
    return !hasSteamPlayEligibilitySignal(fetched);
  }
  return false;
}

function hasSteamPlayEligibilitySignal(document_: Document): boolean {
  if (
    document_.querySelector(
      ".btn-check-owned-games, .btn-start-quest, .alert-steam, a[href^='steam://']",
    )
  ) {
    return true;
  }
  const labels = [...document_.querySelectorAll('a, button')].map((element) =>
    (element.textContent ?? '').replaceAll(/\s+/g, ' ').trim(),
  );
  if (
    labels.some((label) =>
      /^(Check Game|Visit Steam|Sync Games|Launch Game)$/i.test(label),
    )
  ) {
    return true;
  }
  return /completed this quest/i.test(document_.body?.textContent ?? '');
}

async function loadRemotePage(path: string): Promise<LoadedPage | undefined> {
  const fetched = await fetchDocument(path);
  if (fetched?.document.querySelector('a.artifact-list-item, body')) {
    if (requiresIframeFallback(path, fetched.document)) {
      return openPageDocument(path);
    }
    return fetched;
  }
  return openPageDocument(path);
}

async function loadRemoteDocument(path: string): Promise<Document | undefined> {
  const loaded = await loadRemotePage(path);
  return loaded?.document;
}

function isSnapshotFresh(snapshot: ArtifactSnapshot | undefined): boolean {
  if (!snapshot || snapshot.artifacts.length === 0) {
    return false;
  }
  // Older snapshots lack lock data — force a Showroom refresh.
  if (!snapshot.slotLocks) {
    return false;
  }
  const scrapedAt = Date.parse(snapshot.scrapedAt);
  if (Number.isNaN(scrapedAt)) {
    return false;
  }
  return Date.now() - scrapedAt < STALE_MS;
}

function isCapsFresh(state: SiteState | undefined): boolean {
  if (!state) {
    return false;
  }
  const updatedAt = Date.parse(state.updatedAt);
  if (Number.isNaN(updatedAt) || Date.now() - updatedAt > STALE_MS) {
    return false;
  }
  const isCapsUnknown = Object.values(state.caps).every(
    (status) => status === 'unknown',
  );
  if (isCapsUnknown) {
    return false;
  }
  // Pre-1.4.22 state has no per-quest rows — rescan Control Center once.
  if (
    state.caps.steamQuests === 'available' &&
    (state.steamQuests?.quests.length ?? 0) === 0
  ) {
    return false;
  }
  return true;
}

/**
 * Battle Pass claims are JS-rendered. A fetch of the empty shell used to be
 * saved as 0 ready and then skipped for the whole caps TTL.
 */
function shouldRescrapeBattlePass(state: SiteState | undefined): boolean {
  const bp = state?.battlePass;
  if (!bp || typeof bp.readyToClaimArp !== 'number') {
    return true;
  }
  const scrapedAt = Date.parse(bp.scrapedAt ?? '');
  if (Number.isNaN(scrapedAt)) {
    return true;
  }
  return Date.now() - scrapedAt > BATTLE_PASS_STALE_MS;
}

async function refreshBattlePassOnly(next: SiteState): Promise<void> {
  const battleDocument = await loadRemoteDocument(BATTLE_PASS_PATH);
  if (!battleDocument) {
    return;
  }
  const battlePass = scrapeBattlePassFromDocument(battleDocument);
  if (battlePass) {
    next.battlePass = mergeBattlePassScrape(battlePass, next.battlePass);
  }
}

function isArpLogFresh(state: SiteState | undefined): boolean {
  const scrapedAt = state?.arpLog?.scrapedAt;
  if (!scrapedAt) {
    return false;
  }
  const at = Date.parse(scrapedAt);
  if (Number.isNaN(at)) {
    return false;
  }
  const ttl =
    state?.communityEvent?.isLive && (state.communityEvent.pendingArp ?? 0) > 0
      ? ARP_LOG_PENDING_EVENT_STALE_MS
      : ARP_LOG_STALE_MS;
  return Date.now() - at < ttl;
}

function isCommunityEventFresh(state: SiteState | undefined): boolean {
  const event = state?.communityEvent;
  if (!event?.isLive) {
    // No live event cached — refresh with Control Center cadence.
    return isCapsFresh(state);
  }
  const at = Date.parse(event.scrapedAt);
  if (Number.isNaN(at)) {
    return false;
  }
  const ttl =
    event.pendingArp > 0 ? COMMUNITY_EVENT_PENDING_STALE_MS : STALE_MS;
  return Date.now() - at < ttl;
}

export async function ensureArtifactSnapshot(): Promise<
  ArtifactSnapshot | undefined
> {
  const existing = await loadSnapshot();
  if (isSnapshotFresh(existing)) {
    return existing;
  }

  const showroomPath = resolveShowroomUrl(existing?.username);
  const loaded = await loadRemotePage(showroomPath);
  if (!loaded) {
    return existing;
  }

  const snapshot = scrapeShowroomFromDocument(
    loaded.document,
    pathnameFromUrl(loaded.url, showroomPath),
  );
  if (snapshot.artifacts.length > 0) {
    await saveSnapshot(snapshot);
    await syncSlotLocksFromScrape(snapshot.slotLocks ?? {});
    return snapshot;
  }
  return existing;
}

function markCommunityEventUnavailable(next: SiteState): void {
  next.caps.steamCommunityEvent = 'capped';
  if (next.communityEvent) {
    next.communityEvent = markCommunityEventEnded(next.communityEvent);
  }
}

function cachedLiveCommunityEvent(
  next: SiteState,
  banner: { url: string; title?: string },
): NonNullable<SiteState['communityEvent']> {
  const previous = next.communityEvent;
  return {
    scrapedAt: new Date().toISOString(),
    url: banner.url,
    isLive: true,
    personalHours: previous?.personalHours ?? 0,
    milestones: previous?.milestones ?? [],
    pendingArp: previous?.pendingArp ?? 0,
    awardedArp: previous?.awardedArp ?? 0,
    ...(previous?.communityHours !== undefined && {
      communityHours: previous.communityHours,
    }),
    ...(previous?.communityHoursCap !== undefined && {
      communityHoursCap: previous.communityHoursCap,
    }),
    ...(previous?.communityHoursSamples && {
      communityHoursSamples: previous.communityHoursSamples,
    }),
    ...(previous?.communityHoursSource && {
      communityHoursSource: previous.communityHoursSource,
    }),
    ...(banner.title && { title: banner.title }),
    ...(previous?.playEligibility && {
      playEligibility: previous.playEligibility,
    }),
  };
}

async function refreshLiveCommunityEvent(
  next: SiteState,
  controlDocument?: Document,
): Promise<void> {
  const banner = controlDocument
    ? scrapeLiveCommunityEventBanner(controlDocument)
    : undefined;

  if (!banner) {
    if (
      controlDocument === document &&
      !isControlCenterDocumentReady(document)
    ) {
      return;
    }
    markCommunityEventUnavailable(next);
    return;
  }

  const eventDocument = await loadRemoteDocument(banner.url);
  if (!eventDocument) {
    next.caps.steamCommunityEvent = 'available';
    next.communityEvent = cachedLiveCommunityEvent(next, banner);
    return;
  }

  const scraped = scrapeCommunityEventFromDocument(eventDocument, banner.url);
  if (banner.title && !scraped.title) {
    // Banner text includes dates/LIVE noise — only use when page title missing.
    const cleaned = banner.title
      .replaceAll(/\bLIVE\b/gi, '')
      .replace(/Event:\s*[\d./\s-]+/i, '')
      .replaceAll(/\s+/g, ' ')
      .trim();
    if (cleaned) {
      scraped.title = cleaned;
    }
  }
  next.communityEvent = mergeCommunityEventScrape(
    scraped,
    next.communityEvent,
    { source: 'remote' },
  );
  next.caps.steamCommunityEvent = next.communityEvent.isLive
    ? 'available'
    : 'capped';
}

function applyWatchTwitchProgress(next: SiteState, document_: Document): void {
  const twitch = scrapeWatchTwitchProgressFromDocument(
    document_,
    next.watchTwitch,
  );
  if (twitch) {
    next.watchTwitch = twitch;
  }
}

function shouldFetchSteamQuestEligibility(quest: SteamQuestRow): boolean {
  return (
    quest.status !== 'complete' &&
    Boolean(quest.href) &&
    !isChooseYourOwnGameQuest(quest) &&
    quest.eligibility !== 'eligible' &&
    quest.isFree !== false
  );
}

async function enrichSteamQuestRow(
  quest: SteamQuestRow,
): Promise<SteamQuestRow> {
  if (!shouldFetchSteamQuestEligibility(quest) || !quest.href) {
    return quest;
  }
  const questDocument = await loadRemoteDocument(quest.href);
  if (!questDocument) {
    return quest;
  }
  const eligibility = scrapeSteamPlayEligibilityFromDocument(questDocument, {
    href: quest.href,
  });
  const steamAppId =
    scrapeSteamAppIdFromDocument(questDocument) ?? quest.steamAppId;
  const nextQuest: SteamQuestRow = { ...quest, eligibility };
  if (steamAppId !== undefined) {
    nextQuest.steamAppId = steamAppId;
  }
  return nextQuest;
}

async function enrichSteamQuestEligibility(next: SiteState): Promise<void> {
  const quests = next.steamQuests?.quests;
  if (!quests || quests.length === 0) {
    return;
  }
  const updated = await Promise.all(
    quests.map((quest) => enrichSteamQuestRow(quest)),
  );
  next.steamQuests = {
    scrapedAt: new Date().toISOString(),
    quests: updated,
  };
  const cap = steamQuestsCapFromRows(updated);
  if (cap) {
    next.caps.steamQuests = cap;
  }
}

function isLiveControlCenterPage(): boolean {
  let path = location.pathname;
  while (path.endsWith('/') && path.length > 1) {
    path = path.slice(0, -1);
  }
  return path.endsWith('/control-center');
}

async function loadControlCenterDocument(): Promise<Document | undefined> {
  if (!isLiveControlCenterPage()) {
    return loadRemoteDocument(CONTROL_CENTER_PATH);
  }
  if (isControlCenterDocumentReady(document)) {
    return document;
  }
  await waitForControlCenterDocument();
  if (isControlCenterDocumentReady(document)) {
    return document;
  }
  return loadRemoteDocument(CONTROL_CENTER_PATH);
}

function applyControlCenterDocument(
  next: SiteState,
  controlDocument: Document,
): void {
  const userArpTier = scrapeUserArpTierFromDocument(controlDocument);
  if (userArpTier !== undefined) {
    next.userArpTier = userArpTier;
  }
  applyRedeemableArpFromDocument(next, controlDocument);
  Object.assign(
    next.caps,
    scrapeControlCenterCapsFromDocument(controlDocument),
  );
  applySteamQuestsFromDocument(next, controlDocument);
  applyWatchTwitchProgress(next, controlDocument);
  applyBattlePassEndFromDocument(next, controlDocument);
}

async function refreshActivityPages(next: SiteState): Promise<void> {
  const [controlDocument, questDocument, battleDocument, vaultDocument] =
    await Promise.all([
      loadControlCenterDocument(),
      loadRemoteDocument(QUEST_SETUP_PATH),
      loadRemoteDocument(BATTLE_PASS_PATH),
      loadRemoteDocument(GAME_VAULT_PATH),
    ]);

  if (controlDocument) {
    applyControlCenterDocument(next, controlDocument);
  }
  if (questDocument) {
    applyWatchTwitchProgress(next, questDocument);
  }
  if (battleDocument) {
    const battlePass = scrapeBattlePassFromDocument(battleDocument);
    if (battlePass) {
      next.battlePass = mergeBattlePassScrape(battlePass, next.battlePass);
    }
  }
  if (vaultDocument) {
    applyGameVaultDocument(next, vaultDocument);
  }

  await Promise.all([
    controlDocument
      ? refreshLiveCommunityEvent(next, controlDocument)
      : Promise.resolve(),
    enrichSteamQuestEligibility(next),
  ]);
}

function applyArpLogReconciliation(next: SiteState): void {
  next.caps = applyArpLogActivityCaps(next.caps, next.arpLog);
  if (!next.communityEvent) {
    return;
  }
  next.communityEvent = reconcileCommunityEventWithArpLog(
    next.communityEvent,
    next.arpLog,
  );
}

function reconcileCachedSiteState(existing: SiteState): SiteState {
  const caps = applyArpLogActivityCaps(existing.caps, existing.arpLog);
  if (!existing.communityEvent) {
    return { ...existing, caps };
  }
  return {
    ...existing,
    caps,
    communityEvent: reconcileCommunityEventWithArpLog(
      existing.communityEvent,
      existing.arpLog,
    ),
  };
}

async function refreshStaleLiveEvent(next: SiteState): Promise<void> {
  const event = next.communityEvent;
  if (!event?.isLive) {
    return;
  }
  const eventDocument = await loadRemoteDocument(event.url);
  if (!eventDocument) {
    return;
  }
  next.communityEvent = mergeCommunityEventScrape(
    scrapeCommunityEventFromDocument(eventDocument, event.url),
    event,
    { source: 'remote' },
  );
  next.caps.steamCommunityEvent = next.communityEvent.isLive
    ? 'available'
    : 'capped';
}

async function refreshArpLog(
  next: SiteState,
  existing: SiteState,
  options: { refreshLiveEventAfter: boolean },
): Promise<void> {
  const arpDocument = await loadRemoteDocument(
    resolveArpLogPath(next.communityEvent ?? existing.communityEvent),
  );
  if (arpDocument) {
    next.arpLog = scrapeArpLogFromDocument(arpDocument);
  }
  // New log rewards often mean milestones just auto-awarded — refresh event.
  if (options.refreshLiveEventAfter && next.communityEvent?.isLive) {
    const eventDocument = await loadRemoteDocument(next.communityEvent.url);
    if (eventDocument) {
      next.communityEvent = mergeCommunityEventScrape(
        scrapeCommunityEventFromDocument(
          eventDocument,
          next.communityEvent.url,
        ),
        next.communityEvent,
        { source: 'remote' },
      );
    }
  }
}

export function requiresRemoteSnapshotHydrate(
  snapshot: ArtifactSnapshot | undefined,
): boolean {
  return !isSnapshotFresh(snapshot);
}

export function requiresRemoteSiteHydrate(
  state: SiteState | undefined,
  options: { force?: boolean } = {},
): boolean {
  if (!state || options.force) {
    return true;
  }
  return (
    !isCapsFresh(state) ||
    shouldRescrapeBattlePass(state) ||
    !isArpLogFresh(state) ||
    shouldRefreshCommunityEventArpLog(state) ||
    !isCommunityEventFresh(state) ||
    requiresSteamQuestEligibilityFetch(state)
  );
}

function shouldRefreshCommunityEventArpLog(state: SiteState): boolean {
  const event = state.communityEvent;
  if (!event?.isLive || event.pendingArp <= 0) {
    return false;
  }
  const received = sumCommunityEventRewardsFromArpLog(state.arpLog);
  // Open pending but no event rewards in the cached log → wrong/narrow scrape.
  if (received <= 0) {
    return true;
  }
  // Log is behind what the event page already marked awarded.
  return event.awardedArp > 0 && received < event.awardedArp;
}

export async function ensureSiteState(
  options: { force?: boolean } = {},
): Promise<SiteState> {
  const existing = (await loadSiteState()) ?? emptySiteState();
  const requiresCapsRefresh = Boolean(options.force) || !isCapsFresh(existing);
  const requiresBattlePassRefresh =
    requiresCapsRefresh || shouldRescrapeBattlePass(existing);
  const requiresArpLogRefresh =
    Boolean(options.force) ||
    !isArpLogFresh(existing) ||
    shouldRefreshCommunityEventArpLog(existing);
  const requiresEventRefresh =
    Boolean(options.force) || !isCommunityEventFresh(existing);
  const requiresSteamEligibility =
    Boolean(options.force) || requiresSteamQuestEligibilityFetch(existing);

  if (
    !requiresCapsRefresh &&
    !requiresBattlePassRefresh &&
    !requiresArpLogRefresh &&
    !requiresEventRefresh &&
    !requiresSteamEligibility
  ) {
    const next = reconcileCachedSiteState(existing);
    await applyAsceCommunityHours(next);
    await applySteamFreeToPlayResolution(next);
    await saveSiteState(next);
    return next;
  }

  const next: SiteState = {
    ...existing,
    updatedAt: new Date().toISOString(),
    caps: { ...existing.caps },
  };

  if (requiresCapsRefresh) {
    await refreshActivityPages(next);
  } else {
    if (requiresBattlePassRefresh) {
      await refreshBattlePassOnly(next);
    }
    if (requiresEventRefresh) {
      await refreshStaleLiveEvent(next);
    }
    if (requiresSteamEligibility) {
      await enrichSteamQuestEligibility(next);
    }
  }

  if (requiresArpLogRefresh) {
    await refreshArpLog(next, existing, {
      refreshLiveEventAfter: !requiresCapsRefresh && !requiresEventRefresh,
    });
  }

  applyArpLogReconciliation(next);
  await applySteamFreeToPlayResolution(next);
  await applyAsceCommunityHours(next);
  await saveSiteState(next);
  return next;
}
