import { GM } from '$';
import { resolveSiteStateSteamFreeToPlay } from '../steamApp';
import {
  applyRedeemableArpFromDocument,
  mergeArpLogScrape,
  scrapeArpLogFromDocument,
} from './arpLog';
import {
  applyBattlePassEndFromDocument,
  battlePassClaimSignature,
  isBattlePassDocumentReady,
  mergeBattlePassScrape,
  scrapeBattlePass,
  waitForBattlePassDocument,
} from './battlePass';
import {
  applyArpLogActivityCaps,
  isControlCenterDocumentReady,
  scrapeControlCenterCaps,
  scrapeWatchTwitchProgressFromDocument,
} from './caps';
import {
  mergeCommunityEventScrape,
  reconcileCommunityEventWithArpLog,
  scrapeCommunityEventFromDocument,
  scrapeLiveCommunityEventBanner,
} from './communityEvent';
import {
  applyGameVaultDocument,
  scrapeUserArpTierFromDocument,
} from './gameVault';
import {
  applySteamQuestDetailFromDocument,
  applySteamQuestsFromDocument,
  steamQuestsCapFromRows,
} from './steamQuests';
import type {
  ActivityCapState,
  ActivityKey,
  CapStatus,
  SiteState,
} from './types';

const SITE_STATE_KEY = 'artifactSiteState';

const DEFAULT_CAPS: ActivityCapState = {
  timeOnSite: 'unknown',
  steamQuests: 'unknown',
  watchTwitch: 'unknown',
  dailyCalendar: 'unknown',
  discordPoll: 'unknown',
  dailyQuests: 'unknown',
  steamCommunityEvent: 'unknown',
};

function normalizeCaps(raw: unknown): ActivityCapState {
  const caps = (raw ?? {}) as Partial<ActivityCapState> & {
    communityEvent?: CapStatus;
  };
  return {
    ...DEFAULT_CAPS,
    ...caps,
    dailyQuests: caps.dailyQuests ?? caps.communityEvent ?? 'unknown',
    steamCommunityEvent: caps.steamCommunityEvent ?? 'unknown',
  };
}

function isSiteState(value: unknown): value is SiteState {
  return typeof value === 'object' && !!value && 'caps' in value;
}

export async function loadSiteState(): Promise<SiteState | undefined> {
  const raw: string | SiteState | undefined = await GM.getValue(SITE_STATE_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isSiteState(parsed)) {
      return undefined;
    }
    return {
      ...parsed,
      caps: normalizeCaps(parsed.caps),
    };
  } catch {
    return undefined;
  }
}

export async function saveSiteState(state: SiteState): Promise<void> {
  await GM.setValue(SITE_STATE_KEY, JSON.stringify(state));
}

function applyWatchTwitchFromDocument(
  next: SiteState,
  document_: Document,
): void {
  const progress = scrapeWatchTwitchProgressFromDocument(
    document_,
    next.watchTwitch,
  );
  if (progress) {
    next.watchTwitch = progress;
  }
}

function applyControlCenterPage(next: SiteState): void {
  if (!isControlCenterDocumentReady(document)) {
    return;
  }
  Object.assign(next.caps, scrapeControlCenterCaps());
  applySteamQuestsFromDocument(next, document);
  applyWatchTwitchFromDocument(next, document);
  applyBattlePassEndFromDocument(next, document);
  const banner = scrapeLiveCommunityEventBanner(document);
  if (banner) {
    next.caps.steamCommunityEvent = 'available';
    return;
  }
  // Banner miss is not proof the event ended — widgets can paint first.
  // Keep a live cached event; the event-page scrape is what ends it.
  if (!next.communityEvent?.isLive) {
    next.caps.steamCommunityEvent = 'capped';
  }
}

function applyCommunityEventPage(next: SiteState): void {
  const scraped = scrapeCommunityEventFromDocument(document, location.pathname);
  const event = mergeCommunityEventScrape(scraped, next.communityEvent, {
    source: 'visit',
  });
  next.communityEvent = event;
  next.caps.steamCommunityEvent = event.isLive ? 'available' : 'capped';
}

export function applyLiveDocumentToSiteState(next: SiteState): void {
  const path = location.pathname;

  const userArpTier = scrapeUserArpTierFromDocument(document);
  if (userArpTier !== undefined) {
    next.userArpTier = userArpTier;
  }
  applyRedeemableArpFromDocument(next, document);

  if (path.includes('/control-center') && !path.includes('/battle-pass')) {
    applyControlCenterPage(next);
  }

  if (
    path.includes('/steam/questsetup') ||
    path.includes('/rewards/terms') ||
    path.includes('/faq-contact')
  ) {
    applyWatchTwitchFromDocument(next, document);
  }

  if (path.includes('/marketplace') || path.includes('/game-vault')) {
    applyGameVaultDocument(next, document);
  }

  if (path.includes('/battle-pass')) {
    const battlePass = scrapeBattlePass();
    if (battlePass) {
      next.battlePass = mergeBattlePassScrape(battlePass, next.battlePass);
    }
  }

  if (path.includes('/arp-log')) {
    // The page defaults to its 10 most recent rows unless the user added
    // from/to params — merge so a plain visit doesn't clobber a wider
    // background-fetched window.
    next.arpLog = mergeArpLogScrape(
      scrapeArpLogFromDocument(document),
      next.arpLog,
    );
  }

  if (path.includes('/steam/community-event')) {
    applyCommunityEventPage(next);
  }

  if (/\/steam\/quests\/.+/.test(path)) {
    applySteamQuestDetailFromDocument(next, document, path);
  }

  next.caps = applyArpLogActivityCaps(next.caps, next.arpLog);

  if (next.communityEvent) {
    next.communityEvent = reconcileCommunityEventWithArpLog(
      next.communityEvent,
      next.arpLog,
    );
  }
}

export async function refreshSiteStateFromPage(): Promise<SiteState> {
  const previous = (await loadSiteState()) ?? {
    updatedAt: new Date().toISOString(),
    caps: { ...DEFAULT_CAPS },
    gameVault: [],
  };

  const next: SiteState = {
    ...previous,
    updatedAt: new Date().toISOString(),
    caps: { ...previous.caps },
  };
  applyLiveDocumentToSiteState(next);
  await saveSiteState(next);
  return next;
}

/**
 * Keep Battle Pass ready-to-claim counts in sync while the user claims on the
 * live page (CLAIM buttons disappear / COMPLETE markers appear).
 *
 * `onPersist` runs after every persisted refresh (e.g. to also refresh ASCE
 * community-event hours, mirroring what other site-state pages do on visit)
 * — kept as a caller hook instead of an import here to avoid a circular
 * dependency with `asce.ts`, which itself imports from this module.
 */
export function watchBattlePassPage(
  onPersist?: (state: SiteState) => void | Promise<void>,
): void {
  if (!location.pathname.includes('/battle-pass')) {
    return;
  }
  if (document.documentElement.dataset.aoBpWatch === '1') {
    return;
  }
  document.documentElement.dataset.aoBpWatch = '1';

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature = '';
  let isPersisting = false;
  let isPendingAfterPersist = false;

  const persistIfChanged = async (): Promise<void> => {
    if (!isBattlePassDocumentReady(document)) {
      return;
    }
    const signature = battlePassClaimSignature(document);
    if (signature === lastSignature) {
      return;
    }
    if (isPersisting) {
      isPendingAfterPersist = true;
      return;
    }
    isPersisting = true;
    try {
      const state = await refreshSiteStateFromPage();
      lastSignature = signature;
      await onPersist?.(state);
    } finally {
      isPersisting = false;
      if (isPendingAfterPersist) {
        isPendingAfterPersist = false;
        void persistIfChanged();
      }
    }
  };

  const schedule = (): void => {
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void persistIfChanged();
    }, 250);
  };

  void (async () => {
    await waitForBattlePassDocument();
    await persistIfChanged();
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        if (target.closest('.bp-popup__claim-btn')) {
          schedule();
        }
      },
      { capture: true },
    );
  })();
}

export async function applySteamFreeToPlayResolution(
  next: SiteState,
): Promise<void> {
  await resolveSiteStateSteamFreeToPlay(next);
  const cap = steamQuestsCapFromRows(next.steamQuests?.quests ?? []);
  if (cap) {
    next.caps.steamQuests = cap;
  }
}

export function emptySiteState(): SiteState {
  return {
    updatedAt: new Date(0).toISOString(),
    caps: { ...DEFAULT_CAPS },
    gameVault: [],
  };
}

/**
 * Treat unknown as still available (optimistic for planning).
 */
export function isActivityAvailable(
  caps: ActivityCapState,
  key: ActivityKey,
): boolean {
  return caps[key] !== 'capped';
}

/**
 * True when the user still needs to claim/complete this activity soon.
 * Weekly activities default to pending when status is unknown — except Discord
 * Poll, which is often absent from Control Center markup (use ARP Log instead).
 */
export function isActivityPending(
  caps: ActivityCapState,
  key: ActivityKey,
): boolean {
  const status = caps[key];
  if (status === 'available') {
    return true;
  }
  if (status === 'capped') {
    return false;
  }
  return (
    ['steamQuests', 'dailyQuests', 'steamCommunityEvent'] as ActivityKey[]
  ).includes(key);
}

export type {
  ActivityKey,
  ActivityCapState,
  CapStatus,
  SiteState,
} from './types';
export type { WatchTwitchProgress } from './caps';
export {
  scrapeWatchTwitchProgressFromDocument,
  twitchWatchRemainingMs,
  hasVotedCurrentDiscordPoll,
  applyArpLogActivityCaps,
  scrapeControlCenterCapsFromDocument,
  scrapeControlCenterCaps,
  isControlCenterDocumentReady,
  waitForControlCenterDocument,
} from './caps';
export { utcDateString } from './shared';
export type {
  SteamPlayEligibility,
  SteamQuestRow,
  SteamQuestsState,
} from './steamQuests';
export {
  isChooseYourOwnGameQuest,
  scrapeSteamQuestRowsFromDocument,
  steamQuestsCapFromRows,
  remainingSteamQuestRows,
  remainingSteamQuestRewards,
  requiresSteamQuestEligibilityFetch,
  scrapeSteamPlayEligibilityFromDocument,
  applySteamQuestsFromDocument,
  applySteamQuestDetailFromDocument,
} from './steamQuests';
export type {
  CommunityEventMilestone,
  CommunityEventState,
  CommunityHoursSample,
  CommunityEventPendingBreakdown,
  CommunityHoursSampleSource,
  CommunityUnlockEstimate,
  ReachableCommunityUnlock,
  WaitingCommunityArpDescription,
} from './communityEvent';
export {
  canEarnCommunityEventArp,
  scrapeLiveCommunityEventBanner,
  isCommunityEventMilestonePending,
  computePendingCommunityEventArp,
  breakDownCommunityEventPending,
  describeCommunityEventPending,
  describeCommunityEventPendingParts,
  COMMUNITY_HOURS_REMOTE_SAMPLE_MIN_MS,
  markCommunityEventEnded,
  appendCommunityHoursSample,
  mergeCommunityEventScrape,
  nextCommunityUnlockTarget,
  nextWaitingCommunityMilestone,
  waitingCommunityMilestones,
  nextReachableCommunityUnlock,
  formatCommunityEventArp,
  describeWaitingCommunityArp,
  describeWaitingCommunityArpLine,
  estimateCommunityUnlockAt,
  estimateNextCommunityUnlock,
  formatCommunityEta,
  describeWaitingCommunityProgress,
  computeAwardedCommunityEventArp,
  isCommunityEventRewardAction,
  sumCommunityEventRewardsFromArpLog,
  reconcileCommunityEventWithArpLog,
  parseCommunityEventPersonalHours,
  parseCommunityEventProgress,
  scrapeCommunityEventFromDocument,
  scrapeCommunityEvent,
} from './communityEvent';
export type { GameVaultItem } from './gameVault';
export {
  vaultPayArp,
  vaultGamePayArp,
  canAffordVaultPrice,
  isAffordableVaultOffer,
  hasPostedListPriceVaultGames,
  canAffordAnyVaultOffer,
  isClaimableVaultGame,
  isGameVaultStockOpen,
  isGameVaultCurrentlyOpen,
  GAME_VAULT_EQUIP_BUFFER_MS,
  gameVaultCycleId,
  gameVaultOpensAtMs,
  willMissDiscountEquipBeforeOpen,
  gameVaultCatalogPrice,
  scrapeGameVaultTimerMsFromDocument,
  scrapeGameVaultFromDocument,
  scrapeGameVault,
  scrapeUserArpTierFromDocument,
  applyGameVaultDocument,
} from './gameVault';
export type { BattlePassState } from './battlePass';
export {
  scrapeBattlePassFromDocument,
  parseBattlePassCountdownMs,
  battlePassRemainingMs,
  mergeBattlePassScrape,
  applyBattlePassEndFromDocument,
  battlePassClaimableArp,
  scrapeBattlePass,
  isBattlePassDocumentReady,
  waitForBattlePassDocument,
} from './battlePass';
export type { ArpLogEntry, ArpLogState } from './arpLog';
export {
  scrapeRedeemableArpFromDocument,
  applyRedeemableArpFromDocument,
  scrapeArpLogFromDocument,
  mergeArpLogScrape,
} from './arpLog';
