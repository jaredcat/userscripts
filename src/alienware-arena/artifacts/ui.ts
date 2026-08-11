import { applyLoadout, upgradeArtifact } from './api';
import {
  applyAsceCommunityHours,
  didRefreshAsceCommunityHours,
  hasPendingAsceRefresh,
} from './asce';
import {
  ARTIFACT_CREDITS,
  ArtifactEffectType,
  ARTIFACTS,
  type ArtifactTier,
  BASE_ACTIVITY,
  getArtifactById,
  isUtcWeekday,
  msUntilNextDiscordPollPost,
  TIER_LABELS,
} from './data';
import {
  type ActivityLoadoutStats,
  activityStatsForArtifacts,
  type BreakdownLine,
  buildContext,
  optimize,
  type OptimizerResult,
  type ScoredCombo,
  type UpgradeSuggestion,
} from './optimizer';
import {
  ensureArtifactSnapshot,
  ensureSiteState,
  requiresRemoteSiteHydrate,
  requiresRemoteSnapshotHydrate,
} from './remoteScrape';
import {
  applySnapshotUpgrade,
  type ArtifactSnapshot,
  isArtifactsShowroomPage,
  loadSnapshot,
  scrapeAndPersist,
  waitForShowroomDocument,
} from './scraper';
import {
  type ArtifactOptimizerSettings,
  cooldownRemainingMs,
  getArtifactSettings,
  isSlotOnCooldown,
  saveArtifactSettings,
} from './settings';
import {
  type ActivityKey,
  applyLiveDocumentToSiteState,
  battlePassClaimableArp,
  battlePassRemainingMs,
  breakDownCommunityEventPending,
  canEarnCommunityEventArp,
  describeCommunityEventPending,
  describeWaitingCommunityProgress,
  emptySiteState,
  isActivityAvailable,
  isActivityPending,
  loadSiteState,
  refreshSiteStateFromPage,
  remainingSteamQuestRows,
  saveSiteState,
  type SiteState,
  twitchWatchRemainingMs,
  waitForControlCenterDocument,
} from './siteState';
import {
  requiresSteamFreeHydrate,
  STEAM_LIBRARY_PENDING_HINT,
} from './steamApp';

const MODAL_ID = 'alienware-artifact-optimizer';
const INLINE_ID = 'alienware-artifact-optimizer-inline';
const CC_PANEL_ID = 'alienware-artifact-optimizer-cc';
const STYLE_ID = 'alienware-artifact-optimizer-styles';
const BACKDROP_ID = 'alienware-artifact-optimizer-backdrop';
const DIALOG_ID = 'alienware-artifact-optimizer-dialog';
const TOAST_ID = 'alienware-artifact-optimizer-toast';
const TOAST_MS = 2200;

type ActionTone = 'default' | 'muted' | 'warn';

interface ActionTodoReason {
  text: string;
  /**
  Secondary line under this reason (e.g. community progress / ETA).
  */
  detail?: string;
}

interface ActionTodo {
  text: string;
  /**
  Artifact names on their own line under the headline.
  */
  loadout?: string;
  /**
  Why / what this step is for — rendered as a short list.
  */
  reasons?: ActionTodoReason[];
  tone?: ActionTone;
  /**
  Unnumbered warning above the list (don't-do-this), not a step.
  */
  kind?: 'caution';
  /**
  Affordable META upgrade — renders a confirm+Upgrade button on this step.
  */
  upgradeInstanceId?: number;
}

function formatMs(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return '<1m';
}

/**
Daily AWA activities (calendar, Twitch, etc.) reset at 00:00 UTC.
*/
function msUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(0, next - now.getTime());
}

function utcResetDeadlineLabel(now = new Date()): string {
  return `${formatMs(msUntilUtcMidnight(now))} left until 00:00 UTC reset`;
}

function sortArtifactsForDisplay<T extends { displayName: string }>(
  artifacts: T[],
): T[] {
  return artifacts.toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: 'base',
    }),
  );
}

function loadoutLabel(
  artifacts: { displayName: string }[] | undefined,
): string {
  if (!artifacts || artifacts.length === 0) {
    return '—';
  }
  return sortArtifactsForDisplay(artifacts)
    .map((artifact) => artifact.displayName)
    .join(' + ');
}

function comboLabel(result: OptimizerResult['best']): string {
  if (!result) {
    return '—';
  }
  return loadoutLabel(result.artifacts);
}

function isSameLoadout(
  left: { instanceId: number }[] | undefined,
  right: { instanceId: number }[] | undefined,
): boolean {
  if (!left || !right || left.length === 0 || right.length === 0) {
    return false;
  }
  const leftIds = new Set(left.map((artifact) => artifact.instanceId));
  const rightIds = new Set(right.map((artifact) => artifact.instanceId));
  return (
    leftIds.size === rightIds.size &&
    [...leftIds].every((id) => rightIds.has(id))
  );
}

function maxSlotCooldownMs(settings: ArtifactOptimizerSettings): number {
  return Math.max(
    0,
    ...([1, 2, 3] as const).map((position) =>
      cooldownRemainingMs(settings, position),
    ),
  );
}

function hasAnySlotOnCooldown(settings: ArtifactOptimizerSettings): boolean {
  return ([1, 2, 3] as const).some((position) =>
    isSlotOnCooldown(settings, position),
  );
}

type ArtifactSlot = 1 | 2 | 3;

function isSlotLockedForEquip(
  settings: ArtifactOptimizerSettings,
  current: ScoredCombo | undefined,
  position: ArtifactSlot,
): boolean {
  if (isSlotOnCooldown(settings, position)) {
    return true;
  }
  return (
    current?.artifacts.some(
      (artifact) =>
        artifact.equippedPosition === position && artifact.slotLocked === true,
    ) === true
  );
}

interface LoadoutChangePlan {
  now: {
    artifactId: number;
    position: ArtifactSlot;
    displayName: string;
  }[];
  later: {
    artifactId: number;
    displayName: string;
  }[];
  laterNames: string[];
  lockedSlots: ArtifactSlot[];
  waitMs: number;
}

/**
 * Keep combo pieces already in place (including locked slots we cannot touch).
 * Fill remaining recommended pieces into unlocked slots only so their 24h
 * cooldown starts now instead of waiting for every slot to unlock.
 */
function planLoadoutChanges(
  combo: ScoredCombo['artifacts'],
  current: ScoredCombo | undefined,
  settings: ArtifactOptimizerSettings,
): LoadoutChangePlan {
  const slots: ArtifactSlot[] = [1, 2, 3];
  const lockedSlots = slots.filter((position) =>
    isSlotLockedForEquip(settings, current, position),
  );
  const currentBySlot = new Map<
    ArtifactSlot,
    ScoredCombo['artifacts'][number]
  >();
  const equippedArtifacts = current?.artifacts ?? [];
  for (const artifact of equippedArtifacts) {
    if (artifact.equippedPosition !== undefined) {
      currentBySlot.set(artifact.equippedPosition, artifact);
    }
  }

  const comboIds = new Set(combo.map((artifact) => artifact.instanceId));
  const placedIds = new Set<number>();
  const reservedSlots = new Set<ArtifactSlot>();
  const keptSlots = new Set<ArtifactSlot>();

  for (const position of slots) {
    const equipped = currentBySlot.get(position);
    if (equipped && comboIds.has(equipped.instanceId)) {
      placedIds.add(equipped.instanceId);
      reservedSlots.add(position);
      keptSlots.add(position);
      continue;
    }
    if (lockedSlots.includes(position)) {
      reservedSlots.add(position);
    }
  }

  const remaining = combo.filter(
    (artifact) => !placedIds.has(artifact.instanceId),
  );
  const freeSlots = slots.filter(
    (position) =>
      !reservedSlots.has(position) && !lockedSlots.includes(position),
  );

  const now: LoadoutChangePlan['now'] = [];
  for (const artifact of remaining) {
    const position = freeSlots.shift();
    if (position === undefined) {
      break;
    }
    now.push({
      artifactId: artifact.instanceId,
      position,
      displayName: artifact.displayName,
    });
    placedIds.add(artifact.instanceId);
  }

  const later = combo
    .filter((artifact) => !placedIds.has(artifact.instanceId))
    .map((artifact) => ({
      artifactId: artifact.instanceId,
      displayName: artifact.displayName,
    }));
  const waitMs =
    later.length === 0
      ? 0
      : Math.max(
          0,
          ...lockedSlots
            .filter((position) => !keptSlots.has(position))
            .map((position) => cooldownRemainingMs(settings, position)),
        );
  return {
    now,
    later,
    laterNames: later.map((item) => item.displayName),
    lockedSlots,
    waitMs,
  };
}

function artifactsAfterImmediateEquip(
  current: OptimizerResult['current'],
  best: NonNullable<OptimizerResult['best']>,
  plan: LoadoutChangePlan,
): ScoredCombo['artifacts'] {
  const bySlot = new Map<ArtifactSlot, ScoredCombo['artifacts'][number]>();
  const equipped = current?.artifacts ?? [];
  for (const artifact of equipped) {
    if (artifact.equippedPosition !== undefined) {
      bySlot.set(artifact.equippedPosition, artifact);
    }
  }
  for (const change of plan.now) {
    const incoming = best.artifacts.find(
      (artifact) => artifact.instanceId === change.artifactId,
    );
    if (!incoming) {
      continue;
    }
    bySlot.set(change.position, {
      ...incoming,
      equippedPosition: change.position,
    });
  }
  return bySlot.values().toArray();
}

type ActivityTodoRule = {
  key: ActivityKey;
  isDue: (caps: SiteState['caps']) => boolean;
};

const ACTIVITY_TODO_RULES: readonly ActivityTodoRule[] = [
  {
    key: 'steamQuests',
    isDue: (caps) => isActivityPending(caps, 'steamQuests'),
  },
  {
    key: 'dailyQuests',
    isDue: (caps) => isActivityPending(caps, 'dailyQuests'),
  },
  {
    key: 'dailyCalendar',
    isDue: (caps) => isActivityAvailable(caps, 'dailyCalendar'),
  },
  {
    key: 'discordPoll',
    isDue: (caps) => isActivityPending(caps, 'discordPoll'),
  },
  {
    key: 'watchTwitch',
    isDue: (caps) => isActivityAvailable(caps, 'watchTwitch'),
  },
  {
    key: 'timeOnSite',
    isDue: (caps) => isActivityAvailable(caps, 'timeOnSite'),
  },
];

function isActivityEnabled(
  settings: ArtifactOptimizerSettings,
  key: ActivityKey,
): boolean {
  return settings.activities[key]?.enabled;
}

function pushCommunityEventTodo(
  todos: ActionTodo[],
  siteState: SiteState,
  settings: ArtifactOptimizerSettings,
): void {
  const event = siteState.communityEvent;
  if (
    !isActivityEnabled(settings, 'steamCommunityEvent') ||
    !event?.isLive ||
    event.pendingArp <= 0 ||
    !canEarnCommunityEventArp(event)
  ) {
    return;
  }
  const todo: ActionTodo = {
    text: `Community Event: ${describeCommunityEventPending(event)}`,
  };
  if (event.libraryPending) {
    todo.reasons = [
      {
        text: STEAM_LIBRARY_PENDING_HINT,
      },
    ];
  }
  todos.push(todo);
}

function pushBattlePassTodo(
  todos: ActionTodo[],
  siteState: SiteState,
  options: {
    ownsAllArp: boolean;
    hasAllArpEquipped: boolean;
    /**
    Claim comes after a planned All-ARP% equip step — don't restate unlock timing.
    */
    afterAllArpEquipped?: boolean;
    /**
    Season ends before All-ARP% can be equipped — claim on the current set.
    */
    seasonEndsBeforeAllArp?: boolean;
  },
): void {
  const readyArp = battlePassClaimableArp(siteState.battlePass);
  if (readyArp <= 0) {
    return;
  }

  const {
    ownsAllArp,
    hasAllArpEquipped,
    afterAllArpEquipped = false,
    seasonEndsBeforeAllArp = false,
  } = options;
  const countLabel =
    readyArp === 1
      ? '1 Battle Pass ARP Boost'
      : `${readyArp} Battle Pass ARP Boosts`;

  if (hasAllArpEquipped) {
    todos.push({
      text: `Claim ${countLabel} now — All-ARP% is equipped`,
    });
    return;
  }

  if (ownsAllArp && seasonEndsBeforeAllArp) {
    const left = battlePassRemainingMs(siteState.battlePass);
    const todo: ActionTodo = {
      tone: 'warn',
      text: `Claim ${countLabel} now — Battle Pass ends before All-ARP% can be equipped`,
    };
    if (left !== undefined) {
      todo.reasons = [{ text: `Ends in ${formatMs(left)}` }];
    }
    todos.push(todo);
    return;
  }

  if (ownsAllArp) {
    // Guard item already warns not to claim yet; after a planned All-ARP% swap, claim then.
    if (afterAllArpEquipped) {
      todos.push({
        text: `Claim ${countLabel} after All-ARP% is on`,
      });
    }
    return;
  }

  todos.push({
    text: `Claim ${countLabel}`,
  });
}

function comboBonusForActivity(
  combo:
    ActivityLoadoutStats | OptimizerResult['best'] | OptimizerResult['current'],
  key: ActivityKey,
): number {
  if (!combo) {
    return 0;
  }
  switch (key) {
    case 'steamQuests': {
      return combo.steamQuestsFlat;
    }
    case 'watchTwitch': {
      return combo.watchTwitchFlat;
    }
    case 'dailyCalendar': {
      return combo.dailyCalendarFlat;
    }
    case 'discordPoll': {
      return combo.discordPollFlat;
    }
    default: {
      return 0;
    }
  }
}

function twitchActivityLabel(options: {
  beforeSwap: boolean;
  utcDeadline: boolean;
  phase: ActivityPhase;
  waitMs: number;
  watchRemainingMs: number;
}): string {
  if (options.phase === 'after' || options.phase === 'afterNow') {
    return 'Watch Twitch';
  }
  if (
    options.phase === 'before' &&
    options.waitMs > 0 &&
    !canFinishTwitchAfterUnlock(options.waitMs, options.watchRemainingMs)
  ) {
    return 'Watch Twitch now';
  }
  if (options.utcDeadline) {
    return `Watch Twitch (${utcResetDeadlineLabel()})`;
  }
  return `Watch Twitch${options.beforeSwap ? ' before swapping' : ''}`;
}

function twitchArpReason(options: {
  phase: ActivityPhase;
  waitMs: number;
  watchRemainingMs: number;
  allArpPct: number;
}): ActionTodoReason | undefined {
  const arp = Math.round(
    (options.watchRemainingMs / 60_000) * (1 + options.allArpPct),
  );
  if (arp <= 0) {
    return undefined;
  }
  if (options.phase === 'after' && options.waitMs > 0) {
    const left = formatMs(msAfterUnlockBeforeReset(options.waitMs));
    return { text: `+${arp} ARP (fits in ${left} before reset)` };
  }
  if (
    options.phase === 'before' &&
    options.waitMs > 0 &&
    !canFinishTwitchAfterUnlock(options.waitMs, options.watchRemainingMs)
  ) {
    const left = formatMs(msAfterUnlockBeforeReset(options.waitMs));
    return {
      text: `+${arp} ARP (~${formatMs(options.watchRemainingMs)} needed, only ${left} after unlock)`,
    };
  }
  return { text: `+${arp} ARP` };
}

function discordPollActivityLabel(
  bonus: number,
  options: {
    beforeSwap: boolean;
    phase: ActivityPhase;
    waitMs: number;
  },
): string {
  const bonusPart = bonus > 0 ? ` (+${bonus} equipped bonus)` : '';
  const nextPost = formatMs(msUntilNextDiscordPollPost());
  if (options.phase === 'after' && options.waitMs > 0) {
    return `Vote Discord Poll after unlock (${formatMs(options.waitMs)} wait, next post in ${nextPost})${bonusPart}`;
  }
  if (options.phase === 'before') {
    return `Vote Discord Poll now — next post in ${nextPost}${bonusPart}`;
  }
  return `Vote Discord Poll${options.beforeSwap ? ' before swapping' : ''}${bonusPart}`;
}

function activityLabel(
  key: ActivityKey,
  bonus: number,
  options: {
    beforeSwap: boolean;
    utcDeadline: boolean;
    phase: ActivityPhase;
    waitMs: number;
    watchRemainingMs: number;
  },
): string {
  const bonusPart = bonus > 0 ? ` (+${bonus} equipped bonus)` : '';
  const beforePart = options.beforeSwap ? ' before swapping' : '';
  switch (key) {
    case 'steamQuests': {
      return `Complete Steam Quests (equip bonus before starting)${beforePart}${bonusPart}`;
    }
    case 'watchTwitch': {
      return twitchActivityLabel(options);
    }
    case 'dailyCalendar': {
      return options.utcDeadline
        ? `Claim Daily Login Calendar before 00:00 UTC (${utcResetDeadlineLabel()})${bonusPart}`
        : `Claim Daily Login Calendar${beforePart}${bonusPart}`;
    }
    case 'dailyQuests': {
      const questsName = isUtcWeekday(new Date())
        ? 'Daily quest(s)'
        : 'Weekend quest(s)';
      return options.utcDeadline
        ? `Complete ${questsName} (${utcResetDeadlineLabel()})`
        : `Complete ${questsName}${beforePart}`;
    }
    case 'discordPoll': {
      return discordPollActivityLabel(bonus, options);
    }
    case 'timeOnSite': {
      return `Earn Time on Site ARP (equip ToS bonus before 5 ARP)${beforePart}`;
    }
    default: {
      return key;
    }
  }
}

type ActivityPhase = 'before' | 'afterNow' | 'after' | 'other';

// Don't treat a razor-thin post-unlock window as enough for Twitch quests
const TWITCH_UNLOCK_BUFFER_MS = 5 * 60 * 1000;

function msAfterUnlockBeforeReset(waitMs: number, now = new Date()): number {
  return Math.max(0, msUntilUtcMidnight(now) - waitMs);
}

function canFinishTwitchAfterUnlock(
  waitMs: number,
  watchRemainingMs: number,
  now = new Date(),
): boolean {
  return (
    msAfterUnlockBeforeReset(waitMs, now) >=
    watchRemainingMs + TWITCH_UNLOCK_BUFFER_MS
  );
}

/**
 * ARP from one UTC-reset activity on a loadout, including All-ARP%.
 * Used to decide whether waiting for a swap is actually better for that task.
 */
function activityWindowArp(
  combo:
    ActivityLoadoutStats | OptimizerResult['best'] | OptimizerResult['current'],
  key: ActivityKey,
): number {
  let base = 0;
  switch (key) {
    case 'watchTwitch': {
      base = BASE_ACTIVITY.watchTwitchBasePerDay;
      break;
    }
    case 'dailyCalendar': {
      base = BASE_ACTIVITY.dailyCalendarBasePerDay;
      break;
    }
    case 'dailyQuests': {
      base = BASE_ACTIVITY.dailyQuestBase;
      break;
    }
    case 'discordPoll': {
      base = BASE_ACTIVITY.discordPollBase;
      break;
    }
    default: {
      break;
    }
  }
  const flat = comboBonusForActivity(combo, key);
  return (base + flat) * (1 + (combo?.allArpPct ?? 0));
}

function resolveUtcDailyPhase(options: {
  key: ActivityKey;
  needsSwap: boolean;
  waitMs: number;
  canEquipBeforeReset: boolean;
  current: OptimizerResult['current'];
  best: OptimizerResult['best'];
  afterNow: ActivityLoadoutStats | undefined;
  hasImmediateEquip: boolean;
  watchRemainingMs: number;
}): ActivityPhase {
  const {
    key,
    needsSwap,
    waitMs,
    canEquipBeforeReset,
    current,
    best,
    afterNow,
    hasImmediateEquip,
    watchRemainingMs,
  } = options;
  const currentArp = activityWindowArp(current, key);
  const afterNowArp = activityWindowArp(afterNow ?? current, key);
  // Filling a free slot (or replacing a piece that doesn't help this activity)
  // doesn't cost ARP — start the 24h cooldown first, then do the daily.
  if (needsSwap && hasImmediateEquip && afterNowArp >= currentArp) {
    return 'afterNow';
  }
  const bestArp = activityWindowArp(best, key);
  // Quests/calendar are quick: wait if the better set unlocks before midnight.
  // Twitch waits only if the recommended set's sit (base cap + Twitch flat,
  // 1 ARP/min) still fits before 00:00 UTC.
  if (!needsSwap || !canEquipBeforeReset || bestArp <= currentArp) {
    return 'before';
  }
  if (
    key === 'watchTwitch' &&
    !canFinishTwitchAfterUnlock(waitMs, watchRemainingMs)
  ) {
    return 'before';
  }
  return 'after';
}

function resolveActivityPhase(options: {
  key: ActivityKey;
  needsSwap: boolean;
  expiresBeforeUnlock: boolean;
  currentBonus: number;
  bestBonus: number;
  afterNowBonus: number;
  waitMs: number;
  canEquipBeforeReset: boolean;
  isUtcDaily: boolean;
  current: OptimizerResult['current'];
  best: OptimizerResult['best'];
  afterNow: ActivityLoadoutStats | undefined;
  hasImmediateEquip: boolean;
  watchRemainingMs: number;
}): ActivityPhase {
  const {
    key,
    needsSwap,
    expiresBeforeUnlock,
    currentBonus,
    bestBonus,
    afterNowBonus,
    waitMs,
    canEquipBeforeReset,
    isUtcDaily,
    current,
    best,
    afterNow,
    hasImmediateEquip,
    watchRemainingMs,
  } = options;

  if (isUtcDaily) {
    return resolveUtcDailyPhase({
      key,
      needsSwap,
      waitMs,
      canEquipBeforeReset,
      current,
      best,
      afterNow,
      hasImmediateEquip,
      watchRemainingMs,
    });
  }

  if (!needsSwap) {
    return 'other';
  }

  if (hasImmediateEquip && afterNowBonus >= currentBonus) {
    return 'afterNow';
  }

  // Must do today with whatever is equipped — can't wait for the swap.
  if (expiresBeforeUnlock || currentBonus > bestBonus) {
    return 'before';
  }

  if (bestBonus > currentBonus && (waitMs === 0 || canEquipBeforeReset)) {
    return 'after';
  }

  if (currentBonus > 0 && currentBonus >= bestBonus) {
    return 'before';
  }

  if (bestBonus <= 0) {
    return 'other';
  }

  return !canEquipBeforeReset && waitMs > 0 ? 'other' : 'after';
}

function allArpPctForPhase(
  phase: ActivityPhase,
  current: OptimizerResult['current'],
  best: OptimizerResult['best'],
  afterNow: ActivityLoadoutStats | undefined,
): number {
  if (phase === 'after') {
    return best?.allArpPct ?? 0;
  }
  if (phase === 'afterNow') {
    return afterNow?.allArpPct ?? current?.allArpPct ?? 0;
  }
  return current?.allArpPct ?? 0;
}

function bonusForActivityPhase(
  phase: ActivityPhase,
  currentBonus: number,
  bestBonus: number,
  afterNowBonus = 0,
): number {
  if (phase === 'after') {
    return bestBonus;
  }
  if (phase === 'afterNow') {
    return afterNowBonus;
  }
  if (phase === 'before') {
    return currentBonus;
  }
  return 0;
}

function buildActivityTodo(options: {
  key: ActivityKey;
  phase: ActivityPhase;
  needsSwap: boolean;
  currentBonus: number;
  bestBonus: number;
  afterNowBonus: number;
  isUtcDaily: boolean;
  waitMs: number;
  watchRemainingMs: number;
  allArpPct: number;
  siteState: SiteState;
}): ActionTodo {
  const {
    key,
    phase,
    needsSwap,
    currentBonus,
    bestBonus,
    afterNowBonus,
    isUtcDaily,
    waitMs,
    watchRemainingMs,
    allArpPct,
    siteState,
  } = options;
  const bonusForText = bonusForActivityPhase(
    phase,
    currentBonus,
    bestBonus,
    afterNowBonus,
  );
  const todo: ActionTodo = {
    text: activityLabel(key, bonusForText, {
      beforeSwap: phase === 'before' && needsSwap && currentBonus > 0,
      utcDeadline: isUtcDaily,
      phase,
      waitMs,
      watchRemainingMs,
    }),
  };

  if (key === 'watchTwitch') {
    const twitchReason = twitchArpReason({
      phase,
      waitMs,
      watchRemainingMs,
      allArpPct,
    });
    if (twitchReason) {
      todo.reasons = [twitchReason];
    }
  } else if (key === 'steamQuests') {
    const pending = remainingSteamQuestRows(siteState);
    const pendingNames = pending
      .map((quest) => quest.name)
      .filter((name) => name.length > 0);
    const reasons: ActionTodoReason[] = [];
    if (pendingNames.length > 0) {
      reasons.push({ text: pendingNames.join(', ') });
    }
    if (pending.some((quest) => quest.libraryPending === true)) {
      reasons.push({
        text: STEAM_LIBRARY_PENDING_HINT,
      });
    }
    if (reasons.length > 0) {
      todo.reasons = reasons;
    }
  }

  const isUtcUrgent = isUtcDaily && msUntilUtcMidnight() <= 2 * 3_600_000;
  if (isUtcUrgent) {
    todo.tone = 'warn';
  }

  return todo;
}

function pushTodoByPhase(
  buckets: {
    beforeSwap: ActionTodo[];
    afterNow: ActionTodo[];
    afterSwap: ActionTodo[];
    other: ActionTodo[];
  },
  phase: ActivityPhase,
  todo: ActionTodo,
): void {
  if (phase === 'before') {
    buckets.beforeSwap.push(todo);
    return;
  }
  if (phase === 'afterNow') {
    buckets.afterNow.push(todo);
    return;
  }
  if (phase === 'after') {
    buckets.afterSwap.push(todo);
    return;
  }
  buckets.other.push(todo);
}

function utcResetTodoRank(todo: ActionTodo): number {
  if (/(Daily|Weekend) quest/i.test(todo.text)) {
    return 0;
  }
  if (/Daily Login Calendar/i.test(todo.text)) {
    return 1;
  }
  if (/Watch Twitch/i.test(todo.text)) {
    return 2;
  }
  return 3;
}

function sortTodosByUtcDeadline(items: ActionTodo[]): ActionTodo[] {
  return items.toSorted((left, right) => {
    const leftUrgent = /00:00 UTC/i.test(left.text) ? 0 : 1;
    const rightUrgent = /00:00 UTC/i.test(right.text) ? 0 : 1;
    if (leftUrgent !== rightUrgent) {
      return leftUrgent - rightUrgent;
    }
    return utcResetTodoRank(left) - utcResetTodoRank(right);
  });
}

/**
 * Place due activities before or after the recommended swap.
 * Do current-loadout strengths first when a swap would drop that activity's
 * ARP; filling a free slot (or replacing a piece that doesn't help) goes
 * first so the 24h cooldown starts now. After unlock, do activities the new
 * set is better for. UTC-deadline dailies that expire before slots unlock
 * must be done now even if the bonus isn't optimal.
 */
function isSequencedActivityDue(
  rule: ActivityTodoRule,
  settings: ArtifactOptimizerSettings,
  siteState: SiteState,
  watchRemainingMs: number,
): boolean {
  if (rule.key === 'discordPoll' || !isActivityEnabled(settings, rule.key)) {
    return false;
  }
  if (rule.key === 'watchTwitch') {
    return (
      watchRemainingMs > 0 || isActivityAvailable(siteState.caps, 'watchTwitch')
    );
  }
  return rule.isDue(siteState.caps);
}

function buildSequencedActivityTodos(
  result: OptimizerResult,
  settings: ArtifactOptimizerSettings,
  siteState: SiteState,
  options: {
    needsSwap: boolean;
    waitMs: number;
  },
): {
  beforeSwap: ActionTodo[];
  afterNow: ActionTodo[];
  afterSwap: ActionTodo[];
  other: ActionTodo[];
} {
  const buckets = {
    beforeSwap: [] as ActionTodo[],
    afterNow: [] as ActionTodo[],
    afterSwap: [] as ActionTodo[],
    other: [] as ActionTodo[],
  };
  const { needsSwap, waitMs: fallbackWaitMs } = options;
  const current = result.current;
  const best = result.best;
  const plan = best
    ? planLoadoutChanges(best.artifacts, current, settings)
    : undefined;
  const waitMs = plan?.waitMs ?? fallbackWaitMs;
  const canEquipBeforeReset = waitMs <= msUntilUtcMidnight();
  const hasImmediateEquip = (plan?.now.length ?? 0) > 0;
  const afterNow =
    best && plan
      ? activityStatsForArtifacts(
          artifactsAfterImmediateEquip(current, best, plan),
        )
      : undefined;
  const twitchFlatForDue = Math.max(
    comboBonusForActivity(current, 'watchTwitch'),
    comboBonusForActivity(afterNow ?? current, 'watchTwitch'),
    comboBonusForActivity(best, 'watchTwitch'),
  );
  const watchAfterMs = twitchWatchRemainingMs(siteState, twitchFlatForDue);

  for (const rule of ACTIVITY_TODO_RULES) {
    if (!isSequencedActivityDue(rule, settings, siteState, watchAfterMs)) {
      continue;
    }

    const currentBonus = comboBonusForActivity(current, rule.key);
    const bestBonus = comboBonusForActivity(best, rule.key);
    const afterNowBonus = comboBonusForActivity(afterNow ?? current, rule.key);
    const isUtcDaily = ['watchTwitch', 'dailyCalendar', 'dailyQuests'].includes(
      rule.key,
    );
    const isExpiresBeforeUnlock =
      isUtcDaily && !canEquipBeforeReset && waitMs > 0;
    const phase = resolveActivityPhase({
      key: rule.key,
      needsSwap,
      expiresBeforeUnlock: isExpiresBeforeUnlock,
      currentBonus,
      bestBonus,
      afterNowBonus,
      waitMs,
      canEquipBeforeReset,
      isUtcDaily,
      current,
      best,
      afterNow,
      hasImmediateEquip,
      watchRemainingMs: watchAfterMs,
    });
    const watchRemainingMs =
      rule.key === 'watchTwitch'
        ? twitchWatchRemainingMs(
            siteState,
            bonusForActivityPhase(
              phase,
              currentBonus,
              bestBonus,
              afterNowBonus,
            ),
          )
        : watchAfterMs;

    pushTodoByPhase(
      buckets,
      phase,
      buildActivityTodo({
        key: rule.key,
        phase,
        needsSwap,
        currentBonus,
        bestBonus,
        afterNowBonus,
        isUtcDaily,
        waitMs: phase === 'afterNow' ? 0 : waitMs,
        watchRemainingMs,
        allArpPct: allArpPctForPhase(phase, current, best, afterNow),
        siteState,
      }),
    );
  }

  pushCommunityEventTodo(buckets.other, siteState, settings);

  return {
    beforeSwap: sortTodosByUtcDeadline(buckets.beforeSwap),
    afterNow: sortTodosByUtcDeadline(buckets.afterNow),
    afterSwap: sortTodosByUtcDeadline(buckets.afterSwap),
    other: sortTodosByUtcDeadline(buckets.other),
  };
}

function flatBonusReason(
  amount: number,
  label: string,
  waitMs: number,
): string {
  const isAfterUnlock = waitMs > msUntilUtcMidnight();
  return isAfterUnlock
    ? `+${amount} ${label} after unlock`
    : `+${amount} ${label}`;
}

function pushAllArpEquipReasons(
  reasons: ActionTodoReason[],
  best: NonNullable<OptimizerResult['best']>,
  siteState: SiteState,
): void {
  if (best.allArpPct <= 0) {
    return;
  }

  const event = siteState.communityEvent;
  const pending =
    event && canEarnCommunityEventArp(event)
      ? breakDownCommunityEventPending(event)
      : undefined;
  if (pending && event?.isLive) {
    if (pending.waitingPersonalArp > 0) {
      reasons.push({
        text: `All-ARP% before personal Community Event hours (~${pending.waitingPersonalArp} ARP)`,
      });
    } else if (pending.waitingCommunityArp > 0) {
      const progress = describeWaitingCommunityProgress(event);
      reasons.push({
        text: `All-ARP% before community unlock (~${pending.waitingCommunityArp} ARP)`,
        ...(progress && { detail: progress }),
      });
    }
  }
  // Battle Pass claim is its own follow-up action item — don't restate it here.
}

function collectEquipReasons(
  best: NonNullable<OptimizerResult['best']>,
  siteState: SiteState,
  waitMs: number,
): ActionTodoReason[] {
  const reasons: ActionTodoReason[] = [];
  const caps = siteState.caps;

  pushAllArpEquipReasons(reasons, best, siteState);

  if (best.steamQuestsFlat > 0 && isActivityPending(caps, 'steamQuests')) {
    reasons.push({ text: `+${best.steamQuestsFlat} Steam Quests` });
  }
  if (best.discordPollFlat > 0 && isActivityPending(caps, 'discordPoll')) {
    reasons.push({
      text: flatBonusReason(best.discordPollFlat, 'Discord Poll', waitMs),
    });
  }
  if (
    best.dailyCalendarFlat > 0 &&
    isActivityAvailable(caps, 'dailyCalendar')
  ) {
    reasons.push({
      text: flatBonusReason(best.dailyCalendarFlat, 'Daily Calendar', waitMs),
    });
  }
  if (waitMs > 0 && isArtifactsShowroomPage()) {
    reasons.push({
      text: 'Stuck 24h lock? Upgrade a maxed artifact (Warrior Script works) — 0 fragments',
    });
  }

  return reasons;
}

function buildEquipTodo(options: {
  headline: string;
  loadout: string;
  reasons: ActionTodoReason[];
  tone?: ActionTone;
}): ActionTodo {
  const { headline, loadout, reasons, tone } = options;
  const todo: ActionTodo = {
    text: `${headline} - ${loadout}`,
  };
  if (reasons.length > 0) {
    todo.reasons = reasons;
  }
  if (tone) {
    todo.tone = tone;
  }
  return todo;
}

function pushAllArpGuardTodos(
  todos: ActionTodo[],
  siteState: SiteState,
  options: {
    ownsAllArp: boolean;
    hasAllArpEquipped: boolean;
    isLocked: boolean;
    deferBattlePassClaims: boolean;
    hasPlannedAllArp?: boolean;
  },
): void {
  const { ownsAllArp, hasAllArpEquipped, isLocked, deferBattlePassClaims } =
    options;
  if (!ownsAllArp || hasAllArpEquipped) {
    return;
  }
  if (
    deferBattlePassClaims &&
    battlePassClaimableArp(siteState.battlePass) > 0
  ) {
    const arpReady = battlePassClaimableArp(siteState.battlePass);
    const hasPlannedAllArp = options.hasPlannedAllArp === true;
    todos.push({
      kind: 'caution',
      tone: hasPlannedAllArp ? 'warn' : 'muted',
      text: `Don't claim Battle Pass ARP Boost yet (${arpReady} ready)`,
      reasons: [
        {
          text: hasPlannedAllArp
            ? 'Claim after All-ARP% is on'
            : 'More boosts may unlock — claim when All-ARP% is already on, not by swapping just for BP',
        },
      ],
    });
  }
  const pending =
    siteState.communityEvent &&
    canEarnCommunityEventArp(siteState.communityEvent)
      ? breakDownCommunityEventPending(siteState.communityEvent)
      : undefined;
  if (!pending || isLocked) {
    return;
  }
  // Strong: community unlocked — equip before grinding personal hours.
  if (pending.waitingPersonalArp > 0) {
    todos.push({
      tone: 'warn',
      text: `Equip All-ARP% before playing more Community Event hours (~${pending.waitingPersonalArp} ARP community-unlocked)`,
    });
    return;
  }
  // Soft: personal done — community unlock awards automatically.
  if (pending.waitingCommunityArp > 0 && siteState.communityEvent) {
    const progress = describeWaitingCommunityProgress(siteState.communityEvent);
    todos.push({
      tone: 'muted',
      text: progress
        ? `Consider All-ARP% before community unlock (~${pending.waitingCommunityArp} ARP · ${progress})`
        : `Consider All-ARP% before community unlock (~${pending.waitingCommunityArp} ARP)`,
    });
  }
}

function nowEquipHeadline(plan: LoadoutChangePlan): string {
  const nowNames = plan.now.map((change) => change.displayName).join(' + ');
  const slots = plan.now.map((change) => `slot ${change.position}`).join(', ');
  return `Equip: ${nowNames} now (${slots} free)`;
}

function buildPartialEquipTodos(
  plan: LoadoutChangePlan,
  fullLabel: string,
  reasons: ActionTodoReason[],
): ActionTodo[] | undefined {
  if (plan.now.length === 0) {
    return undefined;
  }
  const nowTodo: ActionTodo = { text: nowEquipHeadline(plan) };
  if (plan.laterNames.length > 0) {
    return [
      nowTodo,
      buildEquipTodo({
        headline: `Equip in ${formatMs(plan.waitMs)}`,
        loadout: plan.laterNames.join(' + '),
        reasons,
      }),
    ];
  }
  if (plan.lockedSlots.length > 0) {
    return [
      buildEquipTodo({
        headline: nowTodo.text,
        loadout: fullLabel,
        reasons,
      }),
    ];
  }
  return undefined;
}

function buildSwapEquipTodos(options: {
  best: NonNullable<OptimizerResult['best']>;
  current: OptimizerResult['current'];
  settings: ArtifactOptimizerSettings;
  siteState: SiteState;
  isLocked: boolean;
  waitMs: number;
  beforeSwapCount: number;
  upgrades: UpgradeSuggestion[];
}): { immediate: ActionTodo[]; later: ActionTodo[] } {
  const {
    best,
    current,
    settings,
    siteState,
    isLocked,
    waitMs,
    beforeSwapCount,
    upgrades,
  } = options;
  const plan = planLoadoutChanges(best.artifacts, current, settings);
  const swapWaitMs = plan.waitMs > 0 ? plan.waitMs : waitMs;
  const reasons = collectEquipReasons(best, siteState, swapWaitMs);
  const label = loadoutLabel(best.artifacts);
  const nowUpgrades = upgradeTodosFor(
    upgrades,
    new Set(plan.now.map((change) => change.artifactId)),
  );
  const laterUpgrades = upgradeTodosFor(
    upgrades,
    new Set(plan.later.map((change) => change.artifactId)),
  );
  const partial = buildPartialEquipTodos(plan, label, reasons);
  if (partial && partial.length >= 2) {
    const [nowTodo, ...rest] = partial;
    return {
      immediate: nowTodo ? [...nowUpgrades, nowTodo] : nowUpgrades,
      later: [...laterUpgrades, ...rest],
    };
  }
  if (partial) {
    return {
      immediate: [...nowUpgrades, ...partial],
      later: laterUpgrades,
    };
  }
  if (isLocked) {
    const laterLabel =
      plan.laterNames.length > 0 ? plan.laterNames.join(' + ') : label;
    return {
      immediate: nowUpgrades,
      later: [
        ...laterUpgrades,
        buildEquipTodo({
          headline: `Equip in ${formatMs(swapWaitMs)}`,
          loadout: laterLabel,
          reasons,
        }),
      ],
    };
  }
  return {
    immediate: [
      ...nowUpgrades,
      buildEquipTodo({
        headline: beforeSwapCount > 0 ? 'Then equip' : 'Equip this set',
        loadout: label,
        reasons,
      }),
    ],
    later: laterUpgrades,
  };
}

function pushEquipPlanTodos(
  todos: ActionTodo[],
  options: {
    best: NonNullable<OptimizerResult['best']> | undefined;
    current: OptimizerResult['current'];
    settings: ArtifactOptimizerSettings;
    siteState: SiteState;
    needsSwap: boolean;
    isMatchingLoadout: boolean;
    isLocked: boolean;
    waitMs: number;
    beforeSwapCount: number;
    hasOwnedAllArp: boolean;
    hasAllArpEquipped: boolean;
    upgrades: UpgradeSuggestion[];
  },
): void {
  const {
    best,
    current,
    settings,
    siteState,
    needsSwap,
    isMatchingLoadout,
    isLocked,
    waitMs,
    beforeSwapCount,
    hasOwnedAllArp,
    hasAllArpEquipped,
    upgrades,
  } = options;

  if (best && needsSwap) {
    const swap = buildSwapEquipTodos({
      best,
      current,
      settings,
      siteState,
      isLocked,
      waitMs,
      beforeSwapCount,
      upgrades,
    });
    todos.push(...swap.immediate, ...swap.later);
    return;
  }

  if (best && isMatchingLoadout) {
    const equippedIds = new Set(
      best.artifacts.map((artifact) => artifact.instanceId),
    );
    todos.push(...upgradeTodosFor(upgrades, equippedIds));
    return;
  }

  const pending =
    siteState.communityEvent &&
    canEarnCommunityEventArp(siteState.communityEvent)
      ? breakDownCommunityEventPending(siteState.communityEvent)
      : undefined;
  if (
    hasOwnedAllArp &&
    !hasAllArpEquipped &&
    isLocked &&
    pending &&
    pending.waitingPersonalArp > 0
  ) {
    todos.push({
      tone: 'warn',
      text: `Slots on cooldown (${formatMs(waitMs)} left)`,
      reasons: [
        {
          text: `Equip All-ARP% before playing Community Event hours (~${pending.waitingPersonalArp} ARP community-unlocked)`,
        },
      ],
    });
    return;
  }
  if (
    hasOwnedAllArp &&
    !hasAllArpEquipped &&
    isLocked &&
    pending &&
    siteState.communityEvent &&
    pending.waitingCommunityArp > 0
  ) {
    const progress = describeWaitingCommunityProgress(siteState.communityEvent);
    todos.push({
      tone: 'muted',
      text: `Slots on cooldown (${formatMs(waitMs)} left)`,
      reasons: [
        {
          text: `Consider All-ARP% before community unlock (~${pending.waitingCommunityArp} ARP)`,
          ...(progress && { detail: progress }),
        },
      ],
    });
  }
}

function upgradeTodosFor(
  upgrades: UpgradeSuggestion[],
  instanceIds: ReadonlySet<number>,
): ActionTodo[] {
  const todos: ActionTodo[] = [];
  const seenAffordable = new Set<number>();
  for (const upgrade of upgrades) {
    if (!upgrade.isAffordable) {
      break;
    }
    const instanceId = upgrade.artifact.instanceId;
    if (!instanceIds.has(instanceId)) {
      continue;
    }
    const todo: ActionTodo = {
      text: `Upgrade ${upgrade.artifact.displayName} to ${TIER_LABELS[upgrade.toTier]} (${upgrade.fragmentCost} frag)`,
    };
    if (!seenAffordable.has(instanceId)) {
      seenAffordable.add(instanceId);
      todo.upgradeInstanceId = instanceId;
    }
    todos.push(todo);
  }
  return todos;
}

type DiscordPollSlot = 'before' | 'afterNow' | 'afterFull' | 'other';

function isImmediateDiscordUpgrade(
  plan: LoadoutChangePlan,
  best: NonNullable<OptimizerResult['best']>,
): boolean {
  return plan.now.some((change) => {
    const owned = best.artifacts.find(
      (artifact) => artifact.instanceId === change.artifactId,
    );
    const definition = owned ? getArtifactById(owned.familyId) : undefined;
    return (
      definition?.effectType === ArtifactEffectType.DiscordPoll ||
      definition?.effectType === ArtifactEffectType.AllArpPct
    );
  });
}

function discordPollSlot(options: {
  needsSwap: boolean;
  waitMs: number;
  nextPostMs: number;
  isPollBetterAfterSwap: boolean;
  canNowEquipHelpPoll: boolean;
}): DiscordPollSlot {
  const {
    needsSwap,
    waitMs,
    nextPostMs,
    isPollBetterAfterSwap,
    canNowEquipHelpPoll,
  } = options;
  if (needsSwap && isPollBetterAfterSwap && waitMs > 0 && waitMs < nextPostMs) {
    return 'afterFull';
  }
  if (needsSwap && canNowEquipHelpPoll) {
    return 'afterNow';
  }
  if (needsSwap && isPollBetterAfterSwap) {
    return 'before';
  }
  return 'other';
}

function discordPollTodoText(options: {
  slot: DiscordPollSlot;
  bonus: number;
  waitMs: number;
  nextPostMs: number;
  nowNames: string;
}): string {
  const { slot, bonus, waitMs, nextPostMs, nowNames } = options;
  const bonusPart = bonus > 0 ? ` (+${bonus} equipped bonus)` : '';
  const nextPost = formatMs(nextPostMs);
  if (slot === 'afterFull') {
    return `Vote Discord Poll after unlock (${formatMs(waitMs)} wait, next post in ${nextPost})${bonusPart}`;
  }
  if (slot === 'afterNow') {
    return `Vote Discord Poll after equipping ${nowNames}${bonusPart}`;
  }
  if (slot === 'before') {
    return `Vote Discord Poll now — next post in ${nextPost}${bonusPart}`;
  }
  return `Vote Discord Poll${bonusPart}`;
}

function buildDiscordPollAction(options: {
  result: OptimizerResult;
  settings: ArtifactOptimizerSettings;
  siteState: SiteState;
  needsSwap: boolean;
  waitMs: number;
}): { slot: DiscordPollSlot; todo: ActionTodo } | undefined {
  const { result, settings, siteState, needsSwap, waitMs } = options;
  if (
    !isActivityEnabled(settings, 'discordPoll') ||
    !isActivityPending(siteState.caps, 'discordPoll')
  ) {
    return undefined;
  }
  const current = result.current;
  const best = result.best;
  const nextPostMs = msUntilNextDiscordPollPost();
  const isPollBetterAfterSwap =
    activityWindowArp(best, 'discordPoll') >
    activityWindowArp(current, 'discordPoll');
  const plan =
    best === undefined
      ? undefined
      : planLoadoutChanges(best.artifacts, current, settings);
  const canNowEquipHelpPoll = Boolean(
    best && plan && isImmediateDiscordUpgrade(plan, best),
  );
  const slot = discordPollSlot({
    needsSwap,
    waitMs,
    nextPostMs,
    isPollBetterAfterSwap,
    canNowEquipHelpPoll,
  });
  const currentBonus = comboBonusForActivity(current, 'discordPoll');
  const bestBonus = comboBonusForActivity(best, 'discordPoll');
  let phase: ActivityPhase = 'other';
  if (slot === 'afterFull' || slot === 'afterNow') {
    phase = 'after';
  } else if (slot === 'before') {
    phase = 'before';
  }
  const bonus = bonusForActivityPhase(phase, currentBonus, bestBonus);
  const todo: ActionTodo = {
    text: discordPollTodoText({
      slot,
      bonus,
      waitMs,
      nextPostMs,
      nowNames: plan?.now.map((change) => change.displayName).join(' + ') ?? '',
    }),
  };
  const twoHoursMs = 2 * 3_600_000;
  if (slot !== 'afterFull' && nextPostMs <= twoHoursMs) {
    todo.tone = 'warn';
  }
  return { slot, todo };
}

/**
 * Maximize ARP under cooldowns: finish current-set strengths first only when
 * the next equip would drop that activity's ARP. Filling a free slot (or
 * replacing a piece that doesn't help) happens first so the 24h cooldown
 * starts now, then activities the new set is equal/better for. Missing some
 * daily bonuses to locked slots is expected.
 */
function buildActionPlan(
  result: OptimizerResult,
  settings: ArtifactOptimizerSettings,
  siteState: SiteState,
): ActionTodo[] {
  const todos: ActionTodo[] = [];
  const best = result.best;
  const current = result.current;
  const isMatchingLoadout = isSameLoadout(best?.artifacts, current?.artifacts);
  const isLocked = hasAnySlotOnCooldown(settings);
  const waitMs = maxSlotCooldownMs(settings);
  const isNeedsSwap = Boolean(best && !isMatchingLoadout);

  const hasAllArpEquipped =
    result.hasAllArpEquipped === true || (current?.allArpPct ?? 0) > 0;
  // Don't use `??` here: explicit `false` from the optimizer must not hide
  // All-ARP% on the recommended/alternative combos.
  const hasOwnedAllArp =
    result.hasAllArpOwned === true ||
    hasAllArpEquipped ||
    (result.allArpLoadout?.allArpPct ?? 0) > 0 ||
    (best?.allArpPct ?? 0) > 0 ||
    result.alternatives.some((combo) => combo.allArpPct > 0);

  const shouldDeferBattlePassClaim = result.deferBattlePassClaims === true;
  const hasPlannedAllArp = (best?.allArpPct ?? 0) > 0;

  const sequenced = buildSequencedActivityTodos(result, settings, siteState, {
    needsSwap: isNeedsSwap,
    waitMs,
  });
  const discord = buildDiscordPollAction({
    result,
    settings,
    siteState,
    needsSwap: isNeedsSwap,
    waitMs,
  });

  // 1) UTC-reset work that would lose ARP if we equipped first.
  todos.push(...sequenced.beforeSwap);
  if (discord?.slot === 'before') {
    todos.push(discord.todo);
  }

  // 2) Swap (now, after those activities, or when cooldown ends).
  // Discord poll sits after immediate equip when that piece helps this poll,
  // or after full unlock when the next weekday 16:00 UTC post is still later.
  if (best && isNeedsSwap) {
    const swap = buildSwapEquipTodos({
      best,
      current,
      settings,
      siteState,
      isLocked,
      waitMs,
      beforeSwapCount:
        sequenced.beforeSwap.length + (discord?.slot === 'before' ? 1 : 0),
      upgrades: result.upgrades,
    });
    todos.push(
      ...swap.immediate,
      ...sequenced.afterNow,
      ...(discord?.slot === 'afterNow' ? [discord.todo] : []),
      ...swap.later,
    );
  } else {
    pushEquipPlanTodos(todos, {
      best,
      current,
      settings,
      siteState,
      needsSwap: isNeedsSwap,
      isMatchingLoadout,
      isLocked,
      waitMs,
      beforeSwapCount: sequenced.beforeSwap.length,
      hasOwnedAllArp,
      hasAllArpEquipped,
      upgrades: result.upgrades,
    });
  }

  pushAllArpGuardTodos(todos, siteState, {
    ownsAllArp: hasOwnedAllArp,
    hasAllArpEquipped,
    isLocked,
    deferBattlePassClaims: shouldDeferBattlePassClaim,
    hasPlannedAllArp,
  });

  // Claim BP when All-ARP% is already on, or after a swap that was planned
  // for something else (community). Don't swap onto All-ARP% just for BP.
  // Season ending before All-ARP% can go on → claim on the current set.
  if (shouldDeferBattlePassClaim) {
    pushBattlePassTodo(todos, siteState, {
      ownsAllArp: hasOwnedAllArp,
      hasAllArpEquipped: false,
      afterAllArpEquipped: hasPlannedAllArp,
    });
  } else {
    pushBattlePassTodo(todos, siteState, {
      ownsAllArp: hasOwnedAllArp,
      hasAllArpEquipped,
      seasonEndsBeforeAllArp: hasOwnedAllArp && !hasAllArpEquipped,
    });
  }

  // 3) Activities that prefer the recommended set (after swap / unlock).
  const afterSwap = [...sequenced.afterSwap];
  if (discord?.slot === 'afterFull') {
    afterSwap.unshift(discord.todo);
  }
  // 4) Everything else (order less sensitive to loadout).
  todos.push(
    ...afterSwap,
    ...sequenced.other,
    ...(discord?.slot === 'other' ? [discord.todo] : []),
  );

  if (todos.length === 0) {
    return [
      {
        tone: 'muted',
        text: 'Nothing urgent — check back after activities refresh',
      },
    ];
  }

  return todos;
}

function actionTodoToneClass(tone: ActionTodo['tone']): string {
  if (tone === 'warn') {
    return ' ao-todo-warn';
  }
  if (tone === 'muted') {
    return ' ao-todo-muted';
  }
  return '';
}

function renderActionTodoBody(todo: ActionTodo): string {
  const parts = [
    `<span class="ao-todo-headline">${escapeHtml(todo.text)}</span>`,
  ];
  if (todo.loadout) {
    parts.push(
      `<span class="ao-todo-loadout">${escapeHtml(todo.loadout)}</span>`,
    );
  }
  if (todo.reasons && todo.reasons.length > 0) {
    const items = todo.reasons
      .map((reason) => {
        const detail = reason.detail
          ? `<div class="ao-todo-reason-detail">${escapeHtml(reason.detail)}</div>`
          : '';
        return `<li><div class="ao-todo-reason-text">${escapeHtml(reason.text)}</div>${detail}</li>`;
      })
      .join('');
    parts.push(`<ul class="ao-todo-reasons">${items}</ul>`);
  }
  return parts.join('');
}

function renderTodoUpgradeButton(todo: ActionTodo): string {
  if (todo.upgradeInstanceId === undefined) {
    return '';
  }
  return `<button type="button" class="ao-upgrade-btn" data-id="${todo.upgradeInstanceId}">Upgrade</button>`;
}

function isCautionTodo(todo: ActionTodo): boolean {
  return todo.kind === 'caution';
}

function renderActionPlanContents(todos: ActionTodo[]): string {
  const cautions = todos.filter((todo) => isCautionTodo(todo));
  const steps = todos.filter((todo) => !isCautionTodo(todo));
  const cautionHtml = cautions
    .map((todo) => {
      const toneClass = actionTodoToneClass(todo.tone);
      return `<div class="ao-caution${toneClass}" role="note">${renderActionTodoBody(todo)}</div>`;
    })
    .join('');
  const items = steps
    .map((todo, index) => {
      const toneClass = actionTodoToneClass(todo.tone);
      return `<li class="ao-todo-item${toneClass}"><span class="ao-todo-index">${index + 1}.</span><div class="ao-todo-text">${renderActionTodoBody(todo)}</div>${renderTodoUpgradeButton(todo)}</li>`;
    })
    .join('');
  const listHtml =
    steps.length > 0 ? `<ul class="ao-todo-list">${items}</ul>` : '';
  return `
    <div class="ao-heading">What to do</div>
    ${cautionHtml}
    ${listHtml}
  `;
}

function renderActionPlan(todos: ActionTodo[]): string {
  return `<div id="ao-action-plan">${renderActionPlanContents(todos)}</div>`;
}

function renderSectionDivider(): string {
  return '<hr class="ao-divider" />';
}

const SKELETON_BAR_WIDTHS = ['88%', '72%', '64%', '48%'] as const;

function renderHydrateBanner(message: string): string {
  return `<div class="ao-hydrate" role="status" aria-live="polite"><span class="ao-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span></div>`;
}

function renderSkeletonBars(): string {
  return SKELETON_BAR_WIDTHS.map(
    (width) => `<div class="ao-skel" style="width:${width}"></div>`,
  ).join('');
}

function renderPanelSkeleton(message = 'Loading recommendations…'): string {
  return `
    <div class="ao-heading">Artifact Optimizer</div>
    ${renderHydrateBanner(message)}
    <div id="ao-action-plan" class="ao-skel-block">
      <div class="ao-heading">What to do</div>
      ${renderSkeletonBars()}
    </div>
    ${renderSectionDivider()}
    <div class="ao-skel-block">
      ${renderSkeletonBars()}
    </div>
    <div class="ao-actions">
      <button type="button" disabled>Equip Recommended</button>
      <button type="button" class="ao-secondary" disabled>Open Full Panel</button>
    </div>
  `;
}

function renderModalSkeleton(): string {
  return `
    ${renderHydrateBanner('Loading recommendations…')}
    <div id="ao-action-plan" class="ao-skel-block">
      <div class="ao-heading">What to do</div>
      ${renderSkeletonBars()}
    </div>
    ${renderSectionDivider()}
    <div class="ao-skel-block">${renderSkeletonBars()}</div>
  `;
}

function isControlCenterPage(): boolean {
  let path = location.pathname;
  while (path.endsWith('/') && path.length > 1) {
    path = path.slice(0, -1);
  }
  return path.endsWith('/control-center');
}

function formatEquippedLabel(
  result: OptimizerResult,
  settings: ArtifactOptimizerSettings,
): string {
  if (!result.current) {
    return 'None detected';
  }
  return sortArtifactsForDisplay(result.current.artifacts)
    .map((artifact) => {
      const isLocked =
        artifact.slotLocked === true ||
        (artifact.equippedPosition !== undefined &&
          isSlotOnCooldown(settings, artifact.equippedPosition));
      return isLocked
        ? `${artifact.displayName} (locked)`
        : artifact.displayName;
    })
    .join(' + ');
}

/**
Host-only chrome for light DOM. Panel paint lives in each shadow tree.
*/
function buildOptimizerCss(): string {
  return `
      #${BACKDROP_ID} {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
        z-index: 10000;
      }
      #${MODAL_ID} {
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10001;
        width: min(560px, 94vw);
        max-height: 90vh;
        overflow-y: auto;
        background: transparent;
      }
      #${INLINE_ID},
      #${CC_PANEL_ID} {
        display: block;
        margin: 16px 0;
        width: 100%;
        max-width: 100%;
        box-sizing: border-box;
      }
      body > #${INLINE_ID},
      body > #${CC_PANEL_ID},
      html > #${INLINE_ID},
      html > #${CC_PANEL_ID} {
        margin: 88px auto 16px;
        padding: 0 16px;
        max-width: 1100px;
      }
      #${DIALOG_ID} {
        position: fixed;
        inset: 0;
        z-index: 10002;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #${DIALOG_ID}[hidden] {
        display: none !important;
      }
      #${DIALOG_ID} .ao-dialog-scrim {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.85);
      }
      #${DIALOG_ID} .ao-dialog {
        position: relative;
        z-index: 1;
        width: min(420px, 92vw);
        background: #1a1a1a;
        color: #fff;
        border: 1px solid #00bc8c;
        border-radius: 8px;
        padding: 20px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
        line-height: 1.45;
      }
      #${DIALOG_ID} .ao-dialog-title {
        margin: 0 0 10px;
        color: #00bc8c;
        font-size: 1.1em;
        font-weight: bold;
      }
      #${DIALOG_ID} .ao-dialog-message {
        margin: 0 0 16px;
        color: #eee;
        white-space: pre-wrap;
      }
      #${DIALOG_ID} .ao-dialog-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      #${DIALOG_ID} button {
        background: #00bc8c;
        color: #fff;
        border: none;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      }
      #${DIALOG_ID} button.ao-secondary {
        background: #555;
      }
      #${DIALOG_ID} button.ao-danger {
        background: #e74c3c;
      }
      #${TOAST_ID} {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10003;
        max-width: min(420px, 92vw);
        background: #1a1a1a;
        color: #fff;
        border: 1px solid #00bc8c;
        border-radius: 8px;
        padding: 10px 16px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 14px;
      }
      #${TOAST_ID}[hidden] {
        display: none !important;
      }
  `;
}

function ensureOptimizerStyles(): void {
  let style = document.querySelector<HTMLStyleElement>(`#${STYLE_ID}`);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head || document.documentElement).append(style);
  }
  style.textContent = buildOptimizerCss();
}

const dialogState: {
  resolve?: (isConfirmed: boolean) => void;
  keyListener?: (event: KeyboardEvent) => void;
  doesEscapeConfirm?: boolean;
} = {};

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeAoDialog(dialogState.doesEscapeConfirm === true);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeAoDialog(true);
  }
}

function closeAoDialog(isConfirmed: boolean): void {
  if (dialogState.keyListener) {
    document.removeEventListener('keydown', dialogState.keyListener, {
      capture: true,
    });
    delete dialogState.keyListener;
  }
  const resolve = dialogState.resolve;
  delete dialogState.resolve;
  delete dialogState.doesEscapeConfirm;
  document.querySelector(`#${DIALOG_ID}`)?.remove();
  resolve?.(isConfirmed);
}

function showAoDialog(options: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
}): Promise<boolean> {
  ensureOptimizerStyles();
  closeAoDialog(false);

  const root = document.createElement('div');
  root.id = DIALOG_ID;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const title = options.title ?? 'Artifact Optimizer';
  root.setAttribute('aria-label', title);
  const cancelButton = options.cancelLabel
    ? `<button type="button" class="ao-secondary" data-ao-dialog="cancel">${escapeHtml(options.cancelLabel)}</button>`
    : '';
  const confirmClass = options.isDanger === true ? 'ao-danger' : '';
  root.innerHTML = `
    <div class="ao-dialog-scrim" data-ao-dialog="cancel"></div>
    <div class="ao-dialog">
      <div class="ao-dialog-title">${escapeHtml(title)}</div>
      <div class="ao-dialog-message">${escapeHtml(options.message)}</div>
      <div class="ao-dialog-actions">
        ${cancelButton}
        <button type="button" class="${confirmClass}" data-ao-dialog="ok">${escapeHtml(options.confirmLabel ?? 'OK')}</button>
      </div>
    </div>
  `;

  return new Promise((resolve) => {
    dialogState.resolve = resolve;
    root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const actionElement = target.closest('[data-ao-dialog]');
      if (!(actionElement instanceof HTMLElement)) {
        return;
      }
      const action = actionElement.dataset.aoDialog;
      if (action === 'ok') {
        closeAoDialog(true);
        return;
      }
      if (action === 'cancel') {
        closeAoDialog(!options.cancelLabel);
      }
    });
    dialogState.doesEscapeConfirm = !options.cancelLabel;
    dialogState.keyListener = onDialogKeydown;
    document.addEventListener('keydown', onDialogKeydown, { capture: true });
    document.body.append(root);
    root.querySelector<HTMLButtonElement>('[data-ao-dialog="ok"]')?.focus();
  });
}

async function showAoAlert(message: string, title?: string): Promise<void> {
  await showAoDialog({
    message,
    ...(title && { title }),
    confirmLabel: 'OK',
  });
}

async function didConfirmAoDialog(
  message: string,
  options: { title?: string; confirmLabel?: string; isDanger?: boolean } = {},
): Promise<boolean> {
  return showAoDialog({
    message,
    cancelLabel: 'Cancel',
    confirmLabel: options.confirmLabel ?? 'Confirm',
    ...(options.title && { title: options.title }),
    ...(options.isDanger === true && { isDanger: true }),
  });
}

function showAoToast(message: string): void {
  ensureOptimizerStyles();
  document.querySelector(`#${TOAST_ID}`)?.remove();
  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => {
    toast.remove();
  }, TOAST_MS);
}

/**
Host positioning only — panel paint lives in the shadow tree.
*/
function applyOpaqueModalChrome(modal: HTMLElement): void {
  const paint: Array<[string, string]> = [
    ['position', 'fixed'],
    ['top', '50%'],
    ['left', '50%'],
    ['transform', 'translate(-50%, -50%)'],
    ['z-index', '10001'],
    ['width', 'min(560px, 94vw)'],
    ['max-height', '90vh'],
    ['overflow-y', 'auto'],
    ['background', 'transparent'],
    ['opacity', '1'],
  ];
  for (const [property, value] of paint) {
    modal.style.setProperty(property, value, 'important');
  }
}

function applyOpaqueBackdropChrome(backdrop: HTMLElement): void {
  const paint: Array<[string, string]> = [
    ['position', 'fixed'],
    ['inset', '0'],
    ['background', 'rgba(0, 0, 0, 0.85)'],
    ['background-color', 'rgba(0, 0, 0, 0.85)'],
    ['opacity', '1'],
    ['z-index', '10000'],
  ];
  for (const [property, value] of paint) {
    backdrop.style.setProperty(property, value, 'important');
  }
}

function ensureOptimizerBackdrop(): HTMLElement {
  let backdrop = document.querySelector<HTMLElement>(`#${BACKDROP_ID}`);
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = BACKDROP_ID;
    backdrop.style.setProperty('display', 'none', 'important');
    applyOpaqueBackdropChrome(backdrop);
    backdrop.addEventListener('click', () => {
      setOptimizerModalOpen(false);
    });
    document.body.append(backdrop);
  }
  return backdrop;
}

function setOptimizerModalOpen(isOpen: boolean): void {
  const modal = document.querySelector<HTMLElement>(`#${MODAL_ID}`);
  const backdrop = ensureOptimizerBackdrop();
  if (!modal) {
    backdrop.style.setProperty('display', 'none', 'important');
    return;
  }
  modal.hidden = !isOpen;
  if (isOpen) {
    applyOpaqueModalChrome(modal);
    applyOpaqueBackdropChrome(backdrop);
    modal.style.setProperty('display', 'block', 'important');
    backdrop.style.setProperty('display', 'block', 'important');
  } else {
    modal.style.setProperty('display', 'none', 'important');
    backdrop.style.setProperty('display', 'none', 'important');
  }
}

const ACTIVITY_LABELS: Record<string, string> = {
  timeOnSite: 'Time on Site',
  steamQuests: 'Steam Quests',
  watchTwitch: 'Watch Twitch',
  dailyCalendar: 'Daily Calendar',
  discordPoll: 'Discord Poll',
  dailyQuests: 'Daily / weekend quests',
  steamCommunityEvent: 'Steam Community Event',
};

const BREAKDOWN_LABELS: Record<string, string> = {
  ...ACTIVITY_LABELS,
  dailyQuests: 'Daily quests',
  weekendQuests: 'Weekend quests',
  battlePassClaims: 'Battle Pass claims',
};

function breakdownLabel(key: string): string {
  return BREAKDOWN_LABELS[key] ?? key;
}

function formatBreakdownLine(entry: BreakdownLine): string {
  const parts = [entry.base];
  if (entry.categoryBonus !== 0) {
    parts.push(entry.categoryBonus);
  }
  if (entry.allArpBonus !== 0) {
    parts.push(entry.allArpBonus);
  }
  if (parts.length === 1) {
    return `~${entry.total} ARP`;
  }
  return `~${entry.total} (${parts.join(' + ')})`;
}

function renderBreakdown(result: OptimizerResult['best']): string {
  if (!result) {
    return '';
  }
  const rows = Object.entries(result.breakdown)
    .filter(([, entry]) => entry.total !== 0)
    .map(
      ([k, entry]) =>
        `<div class="ao-row ao-muted">${escapeHtml(breakdownLabel(k))}: ${formatBreakdownLine(entry)}</div>`,
    )
    .join('');
  return `
    <div class="ao-row">Estimated next-24h ARP: <strong>${result.weeklyArp}</strong></div>
    ${
      result.marketplaceSavingsArp > 0
        ? `<div class="ao-row">Market savings: <strong>${result.marketplaceSavingsArp}</strong></div>`
        : ''
    }
    <div class="ao-row">All ARP multiplier: <strong>${(
      result.allArpPct * 100
    ).toFixed(0)}%</strong></div>
    ${
      result.activeSetNames.length > 0
        ? `<div class="ao-row">Sets: ${result.activeSetNames.join(', ')}</div>`
        : ''
    }
    <details>
      <summary class="ao-muted">Breakdown</summary>
      ${rows}
    </details>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTextLink(
  label: string,
  url: string,
  dateAccessed?: string,
): string {
  const accessedSuffix = dateAccessed ? ` (on ${dateAccessed})` : '';
  return `<a class="ao-text-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>${accessedSuffix}`;
}

function renderCredits(options?: { compact?: boolean }): string {
  if (ARTIFACT_CREDITS.length === 0) {
    return '';
  }

  const sourceLinks = ARTIFACT_CREDITS.map((source) =>
    renderTextLink(source.label, source.url, source.dateAccessed),
  ).join(', ');

  if (options?.compact) {
    return `<div class="ao-muted ao-credit">Sources: ${sourceLinks}</div>`;
  }

  const detailLinks = ARTIFACT_CREDITS.flatMap((source) => source.links ?? [])
    .map((link) => renderTextLink(link.label, link.url))
    .join(', ');
  const details = detailLinks ? ` · ${detailLinks}` : '';
  return `<div class="ao-muted ao-credit">Sources: ${sourceLinks}${details}</div>`;
}

function shouldDeferBattlePassClaims(result: OptimizerResult): boolean {
  return result.deferBattlePassClaims === true;
}

/**
Notes already covered by the action plan — keep market / inventory extras only.
*/
function renderVaultDiscountBlock(result: OptimizerResult): string {
  const hint = result.vaultDiscount;
  if (!hint || hint.dismissed || !hint.note) {
    return '';
  }
  return `<div class="ao-note ao-vault-discount">
    <div>${escapeHtml(hint.note)}</div>
    <div class="ao-note-actions">
      <button type="button" class="ao-secondary" data-ao-dismiss-vault="${escapeHtml(hint.cycleId)}">Skip vault discount</button>
    </div>
  </div>`;
}

function renderVaultDiscountRestore(result: OptimizerResult): string {
  if (!result.vaultDiscount?.dismissed) {
    return '';
  }
  return `<div class="ao-row">
    Game Vault discount recs skipped for this rotation
    <button type="button" class="ao-secondary" data-ao-restore-vault>Restore</button>
  </div>`;
}

async function applyVaultDiscountDismiss(cycleId: string): Promise<void> {
  await saveArtifactSettings({ vaultDiscountDismissedCycle: cycleId });
}

async function restoreVaultDiscountRecs(): Promise<void> {
  await saveArtifactSettings({ vaultDiscountDismissedCycle: '' });
}

function bindVaultDiscountActions(
  root: ParentNode,
  onChanged: () => void | Promise<void>,
): void {
  const dismiss = root.querySelector<HTMLButtonElement>(
    '[data-ao-dismiss-vault]',
  );
  dismiss?.addEventListener('click', () => {
    const cycleId = dismiss.dataset.aoDismissVault;
    if (!cycleId) {
      return;
    }
    void applyVaultDiscountDismiss(cycleId).then(() => onChanged());
  });
  root
    .querySelector('[data-ao-restore-vault]')
    ?.addEventListener('click', () => {
      void restoreVaultDiscountRecs().then(() => onChanged());
    });
}

function supplementalNotes(notes: string[]): string[] {
  return notes.filter((note) => {
    if (/Battle Pass ARP Boost/i.test(note)) {
      return false;
    }
    if (
      /All-ARP%/i.test(note) &&
      /community|unlocked by community/i.test(note)
    ) {
      return false;
    }
    if (/^~\d+\s*ARP\b/i.test(note)) {
      return false;
    }
    return true;
  });
}

function renderCommunityEventBlock(
  siteState: SiteState | undefined,
  options?: { detailed?: boolean },
): string {
  const event = siteState?.communityEvent;
  if (!event?.isLive) {
    return '';
  }
  const title = escapeHtml(event.title ?? 'Steam Community Event');
  const pending =
    event.pendingArp > 0
      ? `<strong>${escapeHtml(describeCommunityEventPending(event))}</strong>`
      : 'no pending ARP with a gate met';
  const lines = [
    `<div><strong>${title}</strong></div>`,
    `<div>${event.personalHours}h played · ${pending}</div>`,
  ];
  if (options?.detailed) {
    const awardParts: string[] = [];
    if (event.awardedArp > 0) {
      awardParts.push(`${event.awardedArp} on event page`);
    }
    if ((event.receivedArpFromLog ?? 0) > 0) {
      awardParts.push(`${event.receivedArpFromLog} in ARP Log`);
    }
    if (awardParts.length > 0) {
      lines.push(
        `<div class="ao-muted">Awarded: ${awardParts.join(' · ')}</div>`,
      );
    }
  }
  lines.push(`<div>${renderTextLink('Open event', event.url)}</div>`);
  return `<div class="ao-note">${lines.join('')}</div>`;
}

function renderBattlePassBlock(
  siteState: SiteState | undefined,
  options?: { deferClaims?: boolean; hasPlannedAllArp?: boolean },
): string {
  const bp = siteState?.battlePass;
  if (!bp) {
    return '';
  }
  const remaining = battlePassRemainingMs(bp);
  let endsPart = '';
  if (remaining !== undefined) {
    endsPart = ` · ends in ${formatMs(remaining)}`;
  } else if (bp.endsInText) {
    endsPart = ` · ends in ${escapeHtml(bp.endsInText)}`;
  }
  const lines: string[] = [
    `<div><strong>Battle Pass</strong> · ${bp.tokens ?? '?'} / ${bp.tokensMax ?? '?'} tokens${endsPart}</div>`,
  ];
  if (bp.readyToClaim > 0) {
    const arpBoostPart =
      bp.readyToClaimArp > 0 ? ` (${bp.readyToClaimArp} ARP Boost)` : '';
    if (options?.deferClaims && bp.readyToClaimArp > 0) {
      const holdHint = options.hasPlannedAllArp
        ? 'claim after All-ARP% is on'
        : 'can wait — more boosts may unlock; claim when All-ARP% is already on';
      lines.push(
        `<div><strong>${bp.readyToClaim} unclaimed</strong>${arpBoostPart} — ${holdHint}</div>`,
      );
    } else {
      lines.push(
        `<div><strong>${bp.readyToClaim} ready to claim</strong>${arpBoostPart}</div>`,
      );
    }
  }
  lines.push(`<div>${renderTextLink('Open Battle Pass', bp.url)}</div>`);
  return `<div class="ao-note">${lines.join('')}</div>`;
}

function renderCooldownBlock(settings: ArtifactOptimizerSettings): string {
  const lockParts = ([1, 2, 3] as const)
    .filter((position) => isSlotOnCooldown(settings, position))
    .map((position) => {
      const remaining = formatMs(cooldownRemainingMs(settings, position));
      return `slot ${position} (${remaining} left)`;
    });
  if (lockParts.length === 0) {
    return '';
  }
  return `<div class="ao-note">24h slot cooldown: ${lockParts.join(', ')}</div>`;
}

function renderArpLogCard(siteState: SiteState | undefined): string {
  const arp = siteState?.arpLog;
  if (!arp) {
    return '';
  }
  const when = new Date(arp.scrapedAt).toLocaleString();
  const redeemable = arp.redeemableArp?.toLocaleString() ?? '?';
  const today =
    arp.todayDelta === undefined
      ? ''
      : `<div>Today so far: <strong>+${arp.todayDelta}</strong> ARP</div>`;
  const recent = arp.recent
    .slice(0, 5)
    .map(
      (entry) =>
        `<div class="ao-muted">${escapeHtml(entry.action)} · ${entry.arp}</div>`,
    )
    .join('');
  return `<div class="ao-note">
      <div><strong>ARP Log</strong> · scraped ${escapeHtml(when)}</div>
      <div>Redeemable: <strong>${redeemable}</strong></div>
      ${today}
      ${recent ? `<div style="margin-top:6px">Recent:</div>${recent}` : ''}
    </div>`;
}

function renderActivityCapsCard(siteState: SiteState | undefined): string {
  if (!siteState) {
    return '';
  }
  const caps = siteState.caps;
  const rows = (Object.keys(ACTIVITY_LABELS) as ActivityKey[])
    .map((key) => {
      const status = caps[key];
      if (!status || status === 'unknown') {
        return '';
      }
      const label = ACTIVITY_LABELS[key] ?? key;
      const word = status === 'available' ? 'available' : 'done / capped';
      const tone = status === 'available' ? '' : ' ao-muted';
      return `<div class="${tone.trim()}">${escapeHtml(label)} · ${word}</div>`;
    })
    .filter(Boolean);
  if (rows.length === 0) {
    return '';
  }
  const updated = siteState.updatedAt
    ? ` · ${escapeHtml(new Date(siteState.updatedAt).toLocaleString())}`
    : '';
  return `<div class="ao-note">
      <div><strong>Activity caps</strong>${updated}</div>
      ${rows.join('')}
    </div>`;
}

function renderStatusSection(
  result: OptimizerResult,
  settings: ArtifactOptimizerSettings,
  siteState: SiteState | undefined,
): string {
  const cards = [
    renderBattlePassBlock(siteState, {
      deferClaims: shouldDeferBattlePassClaims(result),
      hasPlannedAllArp: (result.best?.allArpPct ?? 0) > 0,
    }),
    renderCommunityEventBlock(siteState, { detailed: true }),
    renderCooldownBlock(settings),
    renderActivityCapsCard(siteState),
    renderArpLogCard(siteState),
  ].filter(Boolean);
  if (cards.length === 0) {
    return '';
  }
  return `
    <div class="ao-heading">Status</div>
    ${cards.join('')}
  `;
}

function formatSwapMessage(result: OptimizerResult): string {
  if (result.dailySwap) {
    return `<div class="ao-row">${result.dailySwap.reason}</div>`;
  }
  const currentIds = new Set(
    (result.current?.artifacts ?? []).map((a) => a.instanceId),
  );
  const bestIds = new Set(
    (result.best?.artifacts ?? []).map((a) => a.instanceId),
  );
  const isMatch =
    bestIds.size > 0 &&
    bestIds.size === currentIds.size &&
    [...bestIds].every((id) => currentIds.has(id));
  if (isMatch) {
    return `<div class="ao-row ao-muted">Current loadout matches the recommendation.</div>`;
  }
  if ((result.current?.artifacts.length ?? 0) < 3) {
    return `<div class="ao-row ao-muted">Equipped slots are incomplete (${result.current?.artifacts.length ?? 0}/3) — use Equip Recommended to fill empty slots.</div>`;
  }
  return `<div class="ao-row ao-muted">Could not compute a single-piece swap — use Equip Recommended.</div>`;
}

function renderUpgradePath(
  upgrades: UpgradeSuggestion[],
  fragments: number,
): string {
  if (upgrades.length === 0) {
    return `<div class="ao-row ao-muted">No ARP upgrades left on owned artifacts.</div>`;
  }
  const seenAffordable = new Set<number>();
  let hasReachedSave = false;
  return upgrades
    .map((upgrade) => {
      const step = `${TIER_LABELS[upgrade.fromTier]} → ${TIER_LABELS[upgrade.toTier]}`;
      const gain = `+${upgrade.arpGain} ARP/mo`;
      if (upgrade.isAffordable) {
        const shouldShowUpgradeButton = !seenAffordable.has(
          upgrade.artifact.instanceId,
        );
        seenAffordable.add(upgrade.artifact.instanceId);
        const verb = shouldShowUpgradeButton ? 'Upgrade' : 'Then';
        const button = shouldShowUpgradeButton
          ? `<button type="button" class="ao-upgrade-btn" data-id="${upgrade.artifact.instanceId}">Upgrade</button>`
          : '';
        return `
        <div class="ao-row">
          ${verb} <strong>${upgrade.artifact.displayName}</strong>
          ${step}
          (${upgrade.fragmentCost} frag, ${gain}, ${upgrade.efficiency.toFixed(1)} ARP/frag)
          ${button}
        </div>`;
      }
      if (!hasReachedSave) {
        hasReachedSave = true;
        return `
        <div class="ao-row ao-muted">
          Save for <strong>${upgrade.artifact.displayName}</strong>
          ${step}
          (need ${upgrade.fragmentCost}, have ${fragments}, ${gain})
        </div>`;
      }
      return `
        <div class="ao-row ao-muted">
          Then <strong>${upgrade.artifact.displayName}</strong>
          ${step}
          (${upgrade.fragmentCost} frag, ${gain})
        </div>`;
    })
    .join('');
}

function renderResultBody(
  result: OptimizerResult,
  snapshot: ArtifactSnapshot | undefined,
  settings: ArtifactOptimizerSettings,
  siteState: SiteState | undefined,
  options: { isHydrating?: boolean } = {},
): string {
  const scrapedAt = snapshot?.scrapedAt
    ? new Date(snapshot.scrapedAt).toLocaleString()
    : 'never';
  const fragments = settings.manualFragments ?? snapshot?.fragments ?? 0;
  const hydrateBanner = options.isHydrating
    ? renderHydrateBanner('Updating in the background…')
    : '';

  const actionPlan = renderActionPlan(
    buildActionPlan(result, settings, siteState ?? emptySiteState()),
  );
  const extras = supplementalNotes(result.notes)
    .map((n) => `<div class="ao-note">${escapeHtml(n)}</div>`)
    .join('');
  const vaultDiscount = renderVaultDiscountBlock(result);

  const upgrades = renderUpgradePath(result.upgrades, fragments);

  const swap = formatSwapMessage(result);
  const status = renderStatusSection(result, settings, siteState);
  const equippedLabel = formatEquippedLabel(result, settings);

  const activityToggles = (
    Object.keys(settings.activities) as (keyof typeof settings.activities)[]
  )
    .map((key) => {
      const a = settings.activities[key];
      const label = ACTIVITY_LABELS[key] ?? key;
      return `
        <label class="ao-toggle">
          <input type="checkbox" data-activity="${key}" ${a.enabled ? 'checked' : ''}/>
          ${label} <span class="ao-muted">(freq)</span>
          <input type="number" min="0" max="2" step="0.1" data-freq="${key}" value="${a.frequency}"/>
        </label>`;
    })
    .join('');

  return `
    ${hydrateBanner}
    <div class="ao-muted">Inventory snapshot: ${scrapedAt} · Fragments: ${fragments}</div>
    ${actionPlan}
    ${vaultDiscount}
    ${extras}
    ${renderSectionDivider()}
    <div class="ao-heading">Recommended loadout</div>
    <div class="ao-row"><strong>${comboLabel(result.best)}</strong></div>
    ${renderBreakdown(result.best)}
    <div class="ao-heading">Currently equipped</div>
    <div class="ao-row">${equippedLabel}</div>
    ${result.current ? renderBreakdown(result.current) : ''}
    <div class="ao-heading">Suggested swap</div>
    ${swap}
    <div class="ao-heading">Upgrade priority</div>
    ${upgrades}
    ${status}
    <details class="ao-advanced">
      <summary>Advanced / manual overrides</summary>
      <div class="ao-heading">Activity profile</div>
      ${renderVaultDiscountRestore(result)}
      ${activityToggles}
      <div class="ao-row">
        Target Game Vault purchase (ARP):
        <input type="number" id="ao-vault-price" min="0" step="1" value="${settings.pendingVaultPurchaseArp}"/>
      </div>
      <div class="ao-row">
        Manual fragment override (blank = scraped):
        <input type="number" id="ao-manual-frags" min="0" step="1" value="${
          settings.manualFragments ?? ''
        }" placeholder="auto"/>
      </div>
      <div class="ao-heading">Manual artifacts</div>
      <div class="ao-muted">Only needed if auto-scrape fails.</div>
      <div class="ao-row">
        <select id="ao-manual-family">
          ${ARTIFACTS.map((a) => `<option value="${a.id}">${a.id}</option>`).join('')}
        </select>
        <select id="ao-manual-tier">
          ${Object.entries(TIER_LABELS)
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join('')}
        </select>
        <button type="button" id="ao-add-manual">Add</button>
      </div>
      <div id="ao-manual-list" class="ao-row">
        ${
          settings.manualArtifacts.length === 0
            ? '<span class="ao-muted">None</span>'
            : settings.manualArtifacts
                .map(
                  (m, index) =>
                    `<div>${m.familyId} @ ${TIER_LABELS[m.tier]}
                      <button type="button" class="ao-remove-manual ao-secondary" data-index="${index}">Remove</button>
                     </div>`,
                )
                .join('')
        }
      </div>
    </details>
  `;
}

function isSiteStatePage(): boolean {
  const path = location.pathname;
  return (
    path.includes('/control-center') ||
    path.includes('/marketplace') ||
    path.includes('/game-vault') ||
    path.includes('/battle-pass') ||
    path.includes('/arp-log') ||
    path.includes('/steam/community-event')
  );
}

function loadCachedOrRemoteSnapshot(
  isRemote: boolean,
): Promise<ArtifactSnapshot | undefined> {
  if (isRemote) {
    return ensureArtifactSnapshot();
  }
  return loadSnapshot();
}

async function gatherData(options?: {
  /**
	When true, fetch/open Showroom & site pages if cached data is missing/stale.
	*/
  remote?: boolean;
  /**
	When true, re-fetch Control Center / Battle Pass / event pages even if fresh.
	*/
  forceSite?: boolean;
}): Promise<{
  snapshot: ArtifactSnapshot | undefined;
  settings: ArtifactOptimizerSettings;
  siteState: SiteState;
  result: OptimizerResult;
}> {
  const isRemote = options?.remote ?? true;
  // Control Center already re-reads the live DOM below. A forced remote
  // event/BP fetch can clobber ASCE hours + milestone cards with empty
  // shell HTML and flip Zorathian → twitch for no real state change.
  const shouldForceSite = options?.forceSite === true && !isControlCenterPage();

  const snapshotPromise = isArtifactsShowroomPage()
    ? scrapeAndPersist()
    : loadCachedOrRemoteSnapshot(isRemote);
  const settingsPromise = getArtifactSettings();
  const siteStatePromise = isRemote
    ? ensureSiteState({ force: shouldForceSite })
    : loadSiteState();

  const [snapshot, settings, loadedState] = await Promise.all([
    snapshotPromise,
    settingsPromise,
    siteStatePromise,
  ]);

  let siteState: SiteState = loadedState ?? emptySiteState();
  if (isSiteStatePage()) {
    if (isRemote) {
      siteState = await refreshSiteStateFromPage();
      await applyAsceCommunityHours(siteState);
    } else {
      applyLiveDocumentToSiteState(siteState);
    }
    await saveSiteState(siteState);
  }

  const emptySnapshot: ArtifactSnapshot = {
    scrapedAt: new Date(0).toISOString(),
    username: undefined,
    fragments: settings.manualFragments ?? 0,
    artifacts: [],
  };

  const result = optimize(
    buildContext(snapshot ?? emptySnapshot, settings, siteState),
  );
  return rememberGathered({ snapshot, settings, siteState, result });
}

type GatheredData = Awaited<ReturnType<typeof gatherData>>;

const gatheredCache: { current?: GatheredData } = {};

function rememberGathered(data: GatheredData): GatheredData {
  gatheredCache.current = data;
  return data;
}

function snapshotForOptimize(data: GatheredData): ArtifactSnapshot {
  return (
    data.snapshot ?? {
      scrapedAt: new Date(0).toISOString(),
      username: undefined,
      fragments: data.settings.manualFragments ?? 0,
      artifacts: [],
    }
  );
}

function requiresAsceHydrate(state: SiteState): boolean {
  if (!state.communityEvent?.isLive) {
    return false;
  }
  return (
    state.communityEvent.communityHoursSource !== 'asce' ||
    hasPendingAsceRefresh()
  );
}

function requiresBackgroundHydrate(
  data: GatheredData,
  options: { force?: boolean } = {},
): boolean {
  if (options.force) {
    return true;
  }
  if (
    !isArtifactsShowroomPage() &&
    requiresRemoteSnapshotHydrate(data.snapshot)
  ) {
    return true;
  }
  if (requiresRemoteSiteHydrate(data.siteState)) {
    return true;
  }
  if (requiresSteamFreeHydrate(data.siteState)) {
    return true;
  }
  return requiresAsceHydrate(data.siteState);
}

async function hydrateAsceData(
  data: GatheredData,
): Promise<GatheredData | undefined> {
  if (!data.siteState.communityEvent?.isLive) {
    return;
  }
  const hasAsceHoursChanged = await didRefreshAsceCommunityHours(
    data.siteState,
  );
  if (!hasAsceHoursChanged) {
    return;
  }
  await saveSiteState(data.siteState);
  const asceResult = optimize(
    buildContext(snapshotForOptimize(data), data.settings, data.siteState),
  );
  return rememberGathered({ ...data, result: asceResult });
}

async function hydrateGatheredData(
  options: { force?: boolean } = {},
): Promise<GatheredData> {
  const remote = await gatherData({
    remote: true,
    forceSite: options.force === true,
  });
  const asce = await hydrateAsceData(remote);
  return asce ?? remote;
}

async function persistFormSettings(modal: HTMLElement): Promise<void> {
  const root = modalTree(modal);
  const settings = await getArtifactSettings();
  const activities = { ...settings.activities };
  for (const key of Object.keys(activities) as (keyof typeof activities)[]) {
    const enabled = root.querySelector<HTMLInputElement>(
      `input[data-activity="${CSS.escape(key)}"]`,
    )?.checked;
    const frequencyRaw =
      root.querySelector<HTMLInputElement>(
        `input[data-freq="${CSS.escape(key)}"]`,
      )?.value ?? '';
    const frequency = Number(frequencyRaw);
    activities[key] = {
      enabled: enabled ?? activities[key].enabled,
      frequency:
        frequencyRaw.trim() === '' || Number.isNaN(frequency)
          ? activities[key].frequency
          : frequency,
    };
  }

  const vaultInput = root.querySelector<HTMLInputElement>('#ao-vault-price');
  const fragsRaw =
    root.querySelector<HTMLInputElement>('#ao-manual-frags')?.value ?? '';
  const patch: Partial<ArtifactOptimizerSettings> = {
    activities,
  };
  if (vaultInput) {
    const vault = Number(vaultInput.value);
    patch.pendingVaultPurchaseArp = Number.isNaN(vault) ? 0 : vault;
  }
  const parsedFrags = Number(fragsRaw);
  if (fragsRaw.trim() !== '' && !Number.isNaN(parsedFrags)) {
    patch.manualFragments = parsedFrags;
  }
  await saveArtifactSettings(patch);
}

async function confirmAndApplyLoadout(
  result: OptimizerResult,
  settings: ArtifactOptimizerSettings,
): Promise<void> {
  await confirmAndApplyCombo(
    result.best,
    result.current,
    settings,
    'recommended',
  );
}

async function confirmAndApplyCombo(
  combo: ScoredCombo | undefined,
  current: ScoredCombo | undefined,
  settings: ArtifactOptimizerSettings,
  label: string,
): Promise<void> {
  if (!combo || combo.artifacts.length === 0) {
    await showAoAlert(`No ${label} loadout available.`);
    return;
  }

  const plan = planLoadoutChanges(combo.artifacts, current, settings);
  if (plan.now.length === 0) {
    if (plan.lockedSlots.length > 0) {
      await showAoAlert(
        `No unlocked slots to change. Wait ${formatMs(plan.waitMs)} for slot(s) ${plan.lockedSlots.join(', ')}.`,
      );
      return;
    }
    await showAoAlert(`The ${label} loadout is already equipped.`);
    return;
  }

  const nowLines = plan.now
    .map((change) => `${change.displayName} → slot ${change.position}`)
    .join('\n');
  const lockedNote =
    plan.lockedSlots.length > 0
      ? `\n\nLeaving locked slot(s) ${plan.lockedSlots.join(', ')} as-is (${formatMs(plan.waitMs)} remaining).`
      : '';
  const laterNote =
    plan.laterNames.length > 0
      ? `\nStill needed later: ${plan.laterNames.join(', ')}.`
      : '';
  const isOk = await didConfirmAoDialog(
    `Equip ${label} into unlocked slot(s) now?\n\n${nowLines}${lockedNote}${laterNote}\n\nThis uses the live AWA API and starts a 24h cooldown per changed slot.`,
    { title: 'Equip loadout', confirmLabel: 'Equip' },
  );
  if (!isOk) {
    return;
  }

  const currentlyEquipped = (current?.artifacts ?? [])
    .filter((a) => a.equippedPosition !== undefined)
    .map((a) => ({
      artifactId: a.instanceId,
      position: a.equippedPosition as ArtifactSlot,
    }));

  const { allOk, results } = await applyLoadout(plan.now, currentlyEquipped);
  notifyLoadoutResult(allOk, results, label);
}

function notifyLoadoutResult(
  isOk: boolean,
  results: { ok: boolean; error?: string; message?: string }[],
  label = 'recommended',
): void {
  if (isOk) {
    if (results.length === 0) {
      void showAoAlert(`The ${label} loadout is already equipped.`);
      return;
    }
    showAoToast('Loadout applied. Reloading…');
    location.reload();
    return;
  }
  const failed = results.find((r) => !r.ok);
  const error =
    failed?.error ??
    failed?.message ??
    'Unknown error (slot may be locked for 24h)';
  void showAoAlert(`Failed to apply loadout: ${error}`);
}

async function handleAddManual(root: HTMLElement): Promise<void> {
  const familyId =
    root.querySelector<HTMLSelectElement>('#ao-manual-family')?.value;
  if (!familyId) {
    return;
  }
  const tier = Number(
    root.querySelector<HTMLSelectElement>('#ao-manual-tier')?.value,
  ) as ArtifactTier;
  const settings = await getArtifactSettings();
  await saveArtifactSettings({
    manualArtifacts: [...settings.manualArtifacts, { familyId, tier }],
    preferScraped: false,
  });
}

async function handleRemoveManual(index: number): Promise<void> {
  const settings = await getArtifactSettings();
  const manualArtifacts = settings.manualArtifacts.filter(
    (_, itemIndex) => itemIndex !== index,
  );
  await saveArtifactSettings({ manualArtifacts });
}

async function handleUpgradeClick(
  instanceId: number,
  onChanged: () => Promise<void>,
): Promise<void> {
  const isOk = await didConfirmAoDialog(
    'Upgrade this artifact? This spends fragments and cannot be undone.',
    { title: 'Upgrade artifact', confirmLabel: 'Upgrade', isDanger: true },
  );
  if (!isOk) {
    return;
  }
  const upgradeResult = await upgradeArtifact(instanceId);
  if (!upgradeResult.ok) {
    await showAoAlert(
      `Upgrade failed: ${upgradeResult.error ?? upgradeResult.status}`,
    );
    return;
  }
  await applySnapshotUpgrade(instanceId);
  showAoToast('Artifact upgraded.');
  await onChanged();
  if (isControlCenterPage()) {
    void injectControlCenterPanel({ force: true });
  } else if (isArtifactsShowroomPage()) {
    void injectShowroomPanel({ force: true });
  }
}

function bindDynamicBody(
  root: HTMLElement,
  onChanged: () => Promise<void>,
): void {
  root.querySelector('#ao-add-manual')?.addEventListener('click', () => {
    void handleAddManual(root).then(onChanged);
  });

  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '.ao-remove-manual',
  )) {
    button.addEventListener('click', () => {
      void handleRemoveManual(Number(button.dataset.index)).then(onChanged);
    });
  }

  bindUpgradeButtons(root, onChanged);
  bindVaultDiscountActions(root, onChanged);
}

function bindUpgradeButtons(
  root: ParentNode,
  onChanged: () => Promise<void>,
): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    '.ao-upgrade-btn',
  )) {
    button.addEventListener('click', () => {
      void handleUpgradeClick(Number(button.dataset.id), onChanged);
    });
  }
}

type RefreshViewOptions = {
  remote?: boolean;
  /**
  Re-read the live page and await ASCE. Does not write Advanced settings —
  Save does that. On Control Center, skips a forced remote event-page fetch.
  */
  force?: boolean;
  /**
  Write Advanced form fields to GM before gathering (Save only).
  */
  persist?: boolean;
};

type OptimizerModal = HTMLElement & {
  __aoRefresh?: (options?: RefreshViewOptions) => Promise<void>;
};

function panelTree(root: HTMLElement): ParentNode {
  return root.shadowRoot ?? root;
}

function modalTree(modal: HTMLElement): ParentNode {
  return panelTree(modal);
}

type PanelShadowVariant = 'modal' | 'inline';

function buildPanelShadowCss(variant: PanelShadowVariant): string {
  const hostCss =
    variant === 'modal'
      ? `
    :host {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10001;
      width: min(560px, 94vw);
      max-height: 90vh;
      overflow-y: auto;
      box-sizing: border-box;
    }
  `
      : `
    :host {
      display: block;
      margin: 0;
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
  `;

  return `
    ${hostCss}
    .ao-panel,
    .ao-panel * {
      text-decoration: none !important;
      text-decoration-line: none !important;
      -webkit-text-fill-color: unset !important;
      text-transform: none !important;
      letter-spacing: normal !important;
      text-shadow: none !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif !important;
      box-sizing: border-box;
    }
    .ao-panel {
      display: block;
      background: #1a1a1a;
      color: #fff;
      padding: ${variant === 'modal' ? '20px' : '16px'};
      border-radius: 8px;
      border: 1px solid ${variant === 'modal' ? '#444' : '#00bc8c'};
      box-shadow: ${
        variant === 'modal'
          ? '0 12px 40px rgba(0, 0, 0, 0.85)'
          : '0 0 10px rgba(0, 188, 140, 0.25)'
      };
      font-size: 14px;
      line-height: 1.4;
      width: 100%;
    }
    .ao-panel > * {
      display: block;
      width: 100%;
    }
    .ao-title {
      color: #fff !important;
      font-size: 1.4em !important;
      font-weight: bold !important;
      margin: 0 0 12px !important;
    }
    .ao-heading {
      color: #00bc8c !important;
      font-size: 1.05em !important;
      font-weight: bold !important;
      margin: 14px 0 8px !important;
    }
    .ao-heading:first-child {
      margin-top: 0 !important;
    }
    .ao-row {
      display: block;
      margin: 6px 0 6px 8px;
      color: #fff !important;
      line-height: 1.4;
    }
    .ao-muted {
      color: #aaa !important;
      font-size: 0.9em !important;
    }
    .ao-credit {
      margin: 0 0 10px !important;
    }
    .ao-note {
      display: block;
      background: #2a2a2a;
      border-left: 3px solid #00bc8c;
      padding: 8px 10px;
      margin: 8px 0;
      color: #eee !important;
    }
    .ao-note > div + div {
      margin-top: 4px;
    }
    .ao-note-actions {
      margin-top: 8px;
    }
    .ao-status-details {
      margin: 8px 0 4px;
    }
    .ao-status-details summary {
      cursor: pointer;
      user-select: none;
    }
    .ao-status-details[open] summary {
      margin-bottom: 6px;
    }
    .ao-text-link {
      color: #00bc8c !important;
      text-decoration: underline !important;
      text-decoration-line: underline !important;
      cursor: pointer;
    }
    .ao-actions {
      display: flex !important;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      width: 100%;
    }
    .ao-todo-list {
      display: block;
      margin: 0 0 4px;
      padding: 0;
      list-style: none;
      width: 100%;
    }
    .ao-divider {
      display: block;
      border: 0;
      border-top: 1px solid #444;
      margin: 14px 0;
      width: 100%;
    }
    .ao-todo-item {
      display: flex;
      gap: 6px;
      margin: 6px 0;
      line-height: 1.45;
      color: #eee !important;
      align-items: flex-start;
    }
    .ao-todo-index {
      color: #00bc8c !important;
      font-weight: 600;
      flex: 0 0 auto;
      padding-top: 1px;
    }
    .ao-todo-item > .ao-upgrade-btn {
      flex: 0 0 auto;
      padding: 4px 10px;
      font-size: 13px !important;
    }
    .ao-row .ao-upgrade-btn {
      margin-left: 8px;
    }
    .ao-todo-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1 1 auto;
    }
    .ao-todo-headline {
      display: block;
      font-weight: 600;
    }
    .ao-todo-loadout {
      display: block;
      color: #fff !important;
      margin: 2px 0 2px;
    }
    .ao-todo-reasons {
      display: block;
      margin: 4px 0 0;
      padding: 0 0 0 1.1em;
      list-style: disc;
      color: #ccc !important;
    }
    .ao-todo-reasons > li {
      display: list-item;
      margin: 2px 0;
    }
    .ao-todo-reason-text {
      display: block;
    }
    .ao-todo-reason-detail {
      display: block;
      margin-top: 1px;
      color: #aaa !important;
      font-size: 0.92em;
    }
    .ao-todo-muted {
      color: #aaa !important;
    }
    .ao-todo-warn {
      color: #f0c674 !important;
    }
    .ao-caution {
      display: block;
      margin: 0 0 10px;
      padding: 8px 10px;
      border: 1px solid #f0c674;
      border-radius: 6px;
      background: rgba(240, 198, 116, 0.12);
      color: #f0c674 !important;
    }
    .ao-caution .ao-todo-headline {
      font-weight: 700;
    }
    .ao-caution .ao-todo-reasons {
      color: #e6d5a3 !important;
      padding-left: 1.1em;
    }
    button {
      display: inline-block;
      width: auto;
      background: #00bc8c;
      color: #fff !important;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px !important;
    }
    button.ao-secondary {
      background: #555;
    }
    button.ao-danger {
      background: #e74c3c;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    label.ao-toggle {
      display: block;
      margin: 4px 0 4px 8px;
      color: #fff !important;
    }
    input[type="number"],
    input[type="text"],
    select {
      width: 90px;
      margin-left: 6px;
      padding: 2px 4px;
      background: #2a2a2a;
      color: #fff !important;
      border: 1px solid #555;
      border-radius: 3px;
      caret-color: #fff;
      font-size: 14px !important;
    }
    select {
      width: auto;
      min-width: 120px;
    }
    input[type="checkbox"] {
      margin-right: 6px;
      accent-color: #00bc8c;
    }
    details {
      display: block;
      width: 100%;
    }
    details.ao-advanced {
      margin-top: 14px;
      border-top: 1px solid #333;
      padding-top: 10px;
    }
    details.ao-advanced > summary {
      cursor: pointer;
      color: #00bc8c !important;
      font-weight: bold;
      list-style: none;
    }
    details.ao-advanced > summary::-webkit-details-marker {
      display: none;
    }
    details.ao-advanced > summary::before {
      content: '▸ ';
    }
    details.ao-advanced[open] > summary::before {
      content: '▾ ';
    }
    details > summary {
      color: #aaa !important;
      cursor: pointer;
    }
    .ao-hydrate {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 10px;
      padding: 8px 10px;
      background: #222;
      border: 1px solid #00bc8c55;
      border-radius: 4px;
      color: #ccc !important;
      font-size: 0.92em !important;
    }
    .ao-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #00bc8c44;
      border-top-color: #00bc8c;
      border-radius: 50%;
      animation: ao-spin 0.7s linear infinite;
      flex: 0 0 auto;
    }
    .ao-skel {
      display: block;
      height: 12px;
      margin: 8px 0;
      border-radius: 4px;
      background: linear-gradient(90deg, #2a2a2a 25%, #333 37%, #2a2a2a 63%);
      background-size: 400% 100%;
      animation: ao-skel 1.2s ease-in-out infinite;
    }
    @keyframes ao-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes ao-skel {
      0% {
        background-position: 100% 0;
      }
      100% {
        background-position: 0 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .ao-spinner,
      .ao-skel {
        animation: none;
      }
    }
  `;
}

function buildModalShadowCss(): string {
  return buildPanelShadowCss('modal');
}

function buildInlineShadowCss(): string {
  return buildPanelShadowCss('inline');
}

/**
Prefer a non-link insertion point so site link styles cannot leak in.
*/
function resolveShowroomInsertTarget():
  | {
      parent: Element;
      before: ChildNode | null;
    }
  | undefined {
  const fragments = [...document.querySelectorAll('div, p, span')].find(
    (element) => /^Fragments:\s*\d+/i.test(element.textContent?.trim() ?? ''),
  );
  let target: Element | undefined =
    fragments ?? document.querySelector('#weapon-section') ?? undefined;
  if (!target) {
    return undefined;
  }
  const link = target.closest('a');
  if (link) {
    target = link;
  }
  const parent = target.parentElement;
  if (!parent) {
    return undefined;
  }
  return { parent, before: target.nextSibling };
}

function bindModalEvents(
  modal: OptimizerModal,
  initial: Awaited<ReturnType<typeof gatherData>>,
): void {
  let cache = initial;
  const tree = (): ParentNode => modalTree(modal);

  const paint = (
    data: Awaited<ReturnType<typeof gatherData>>,
    options: { isHydrating?: boolean } = {},
  ): void => {
    cache = data;
    const body = tree().querySelector('#ao-body');
    if (!body) {
      return;
    }
    body.innerHTML = renderResultBody(
      cache.result,
      cache.snapshot,
      cache.settings,
      cache.siteState,
      { isHydrating: options.isHydrating === true },
    );
    bindDynamicBody(body as HTMLElement, () => refreshView());
  };

  const refreshView = async (options?: RefreshViewOptions): Promise<void> => {
    const isRemote = options?.remote ?? true;
    const isForce = options?.force ?? false;
    if (options?.persist === true) {
      await persistFormSettings(modal);
    }
    const cached = await gatherData({ remote: false });
    const shouldHydrate =
      isRemote &&
      (isForce || requiresBackgroundHydrate(cached, { force: isForce }));
    paint(cached, { isHydrating: shouldHydrate });
    if (!shouldHydrate) {
      return;
    }
    paint(await hydrateGatheredData({ force: isForce }), {
      isHydrating: false,
    });
    syncControlCenterFromGathered();
  };

  tree()
    .querySelector('#ao-close')
    ?.addEventListener('click', () => {
      setOptimizerModalOpen(false);
    });

  tree()
    .querySelector('#ao-save')
    ?.addEventListener('click', () => {
      void (async () => {
        await persistFormSettings(modal);
        await refreshView({ persist: false });
        showAoToast('Settings saved.');
      })();
    });

  tree()
    .querySelector('#ao-equip')
    ?.addEventListener('click', () => {
      void confirmAndApplyLoadout(cache.result, cache.settings);
    });

  tree()
    .querySelector('#ao-refresh')
    ?.addEventListener('click', () => {
      void refreshView({ force: true });
    });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      setOptimizerModalOpen(false);
    }
  });

  paint(initial, {
    isHydrating: requiresBackgroundHydrate(initial),
  });
  modal.__aoRefresh = refreshView;
}

/**
 * Drop any leftover dialog from older script versions (light DOM without shadow).
 */
function destroyOptimizerModal(): void {
  document.querySelector(`#${MODAL_ID}`)?.remove();
  document.querySelector(`#${BACKDROP_ID}`)?.remove();
}

/**
 * Prepare styles only. The dialog DOM is created the first time it is opened
 * so a failed stylesheet can never leave a visible overlay on page load.
 */
export async function createOptimizerModal(): Promise<void> {
  destroyOptimizerModal();
  ensureOptimizerStyles();
}

async function openOptimizerModal(): Promise<void> {
  ensureOptimizerStyles();
  let modal =
    document.querySelector<OptimizerModal>(`#${MODAL_ID}`) ?? undefined;
  // Recreate if this is a stale pre-shadow modal from a hot-updated userscript.
  if (modal && !modal.shadowRoot) {
    modal.remove();
    modal = undefined;
  }
  const isNew = !modal;
  if (!modal) {
    const shell = document.createElement('div') as OptimizerModal;
    shell.id = MODAL_ID;
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-labelledby', 'ao-title');
    shell.hidden = true;
    const shadow = shell.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${buildModalShadowCss()}</style>
      <div class="ao-panel">
        <div class="ao-title" id="ao-title">Artifact Optimizer</div>
        ${renderCredits()}
        <div id="ao-body">
          ${renderModalSkeleton()}
        </div>
        <div class="ao-actions">
          <button type="button" id="ao-equip">Equip Recommended</button>
          <button type="button" id="ao-refresh" class="ao-secondary">Refresh</button>
          <button type="button" id="ao-save" class="ao-secondary">Save Settings</button>
          <button type="button" id="ao-close" class="ao-danger">Close</button>
        </div>
      </div>
    `;
    document.body.append(shell);
    modal = shell;
  }

  setOptimizerModalOpen(true);
  if (isNew) {
    const cached =
      gatheredCache.current ?? (await gatherData({ remote: false }));
    bindModalEvents(modal, cached);
  }
  const shouldHydrate =
    gatheredCache.current !== undefined &&
    requiresBackgroundHydrate(gatheredCache.current);
  if (shouldHydrate || !isNew) {
    void modal.__aoRefresh?.({ remote: shouldHydrate || !isNew });
  }
}

export function addOptimizerMenuButton(): void {
  const menuList = document.querySelector<HTMLElement>(
    '.nav-item-mus .dropdown-menu.dropdown-menu-end',
  );
  if (!menuList || menuList.querySelector('[data-ao-menu]')) {
    return;
  }
  const item = document.createElement('a');
  item.className = 'dropdown-item';
  item.href = '#';
  item.dataset.aoMenu = '1';
  item.textContent = 'Artifact Optimizer';
  item.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openOptimizerModal();
  });
  menuList.insertBefore(item, menuList.lastElementChild);
}

function watchOptimizerMenuButton(): void {
  addOptimizerMenuButton();
  if (document.documentElement.dataset.aoMenuWatch === '1') {
    return;
  }
  document.documentElement.dataset.aoMenuWatch = '1';
  const observer = new MutationObserver(() => {
    if (!document.querySelector('[data-ao-menu]')) {
      addOptimizerMenuButton();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function parkElement(element: HTMLElement): void {
  const parent = document.body ?? document.documentElement;
  if (element.parentElement !== parent) {
    parent.prepend(element);
  }
}

function findControlCenterMount(): HTMLElement | undefined {
  return (
    document.querySelector<HTMLElement>('.container.account.has-fixed-menu') ??
    document.querySelector<HTMLElement>('main .container.account') ??
    document.querySelector<HTMLElement>('main') ??
    undefined
  );
}

function insertControlCenterHost(panel: HTMLElement): void {
  const container = findControlCenterMount();
  if (container) {
    if (panel.parentElement !== container) {
      container.prepend(panel);
    }
    return;
  }
  parkElement(panel);
}

function watchControlCenterHost(panel: HTMLElement): void {
  insertControlCenterHost(panel);
  if (panel.dataset.aoHostWatch === '1') {
    return;
  }
  panel.dataset.aoHostWatch = '1';
  const observer = new MutationObserver(() => {
    if (!panel.isConnected) {
      insertControlCenterHost(panel);
      return;
    }
    const mount = findControlCenterMount();
    if (mount && panel.parentElement !== mount && !panel.contains(mount)) {
      insertControlCenterHost(panel);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function insertShowroomHost(panel: HTMLElement): void {
  const insert = resolveShowroomInsertTarget();
  if (!insert) {
    parkElement(panel);
    return;
  }
  if (panel.parentNode !== insert.parent) {
    insert.parent.insertBefore(panel, insert.before);
  }
}

function watchShowroomHost(panel: HTMLElement): void {
  insertShowroomHost(panel);
  if (panel.dataset.aoHostWatch === '1') {
    return;
  }
  panel.dataset.aoHostWatch = '1';
  const observer = new MutationObserver(() => {
    if (!panel.isConnected) {
      insertShowroomHost(panel);
      return;
    }
    const parent = panel.parentElement;
    const isParked =
      parent === document.body || parent === document.documentElement;
    if (isParked) {
      insertShowroomHost(panel);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function mountInlinePanelShadow(
  host: HTMLElement,
  bodyHtml: string,
): ShadowRoot {
  // Recreate if this is a stale pre-shadow panel from a hot-updated userscript.
  if (host.shadowRoot) {
    host.shadowRoot.replaceChildren();
  }
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>${buildInlineShadowCss()}</style>
    <div class="ao-panel">
      ${bodyHtml}
    </div>
  `;
  return shadow;
}

function replaceInlinePanelBody(panel: HTMLElement, bodyHtml: string): void {
  const box = panelTree(panel).querySelector('.ao-panel');
  if (box) {
    box.innerHTML = bodyHtml;
    return;
  }
  mountInlinePanelShadow(panel, bodyHtml);
}

function bumpPanelGeneration(panel: HTMLElement): number {
  const generation = Number(panel.dataset.aoGen ?? '0') + 1;
  panel.dataset.aoGen = String(generation);
  return generation;
}

function isPanelGenerationCurrent(
  panel: HTMLElement,
  generation: number,
): boolean {
  return panel.isConnected && panel.dataset.aoGen === String(generation);
}

function renderShowroomPanelBody(
  data: GatheredData,
  options: { isHydrating?: boolean } = {},
): string {
  const hydrateBanner = options.isHydrating
    ? renderHydrateBanner('Updating in the background…')
    : '';
  return `
    <div class="ao-heading">Artifact Optimizer</div>
    ${renderCredits({ compact: true })}
    ${hydrateBanner}
    <div class="ao-row"><strong>Recommended:</strong> ${comboLabel(data.result.best)}</div>
    ${renderBreakdown(data.result.best)}
    ${renderVaultDiscountBlock(data.result)}
    ${renderShowroomEquipActions(data.result)}
  `;
}

function renderControlCenterPanelBody(
  data: GatheredData,
  options: { isHydrating?: boolean } = {},
): string {
  const hydrateBanner = options.isHydrating
    ? renderHydrateBanner('Updating in the background…')
    : '';
  return `
    <div class="ao-heading">Artifact Optimizer</div>
    ${renderCredits({ compact: true })}
    ${hydrateBanner}
    ${renderActionPlan(
      buildActionPlan(data.result, data.settings, data.siteState),
    )}
    ${renderSectionDivider()}
    <div class="ao-row"><strong>Recommended:</strong> ${comboLabel(data.result.best)}</div>
    ${renderBreakdown(data.result.best)}
    ${renderCooldownBlock(data.settings)}
    ${renderVaultDiscountBlock(data.result)}
    ${supplementalNotes(data.result.notes)
      .map((note) => `<div class="ao-note">${escapeHtml(note)}</div>`)
      .join('')}
    <div class="ao-actions">
      <button type="button" id="ao-cc-equip">Equip Recommended</button>
      <button type="button" id="ao-cc-open" class="ao-secondary">Open Full Panel</button>
      <button type="button" id="ao-cc-artifacts" class="ao-secondary">Go to Artifacts</button>
      <button type="button" id="ao-cc-refresh" class="ao-secondary">Refresh</button>
    </div>
  `;
}

function ensureControlCenterHost(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`#${CC_PANEL_ID}`);
  if (existing) {
    watchControlCenterHost(existing);
    return existing;
  }
  const panel = document.createElement('div');
  panel.id = CC_PANEL_ID;
  mountInlinePanelShadow(panel, renderPanelSkeleton());
  watchControlCenterHost(panel);
  return panel;
}

function ensureShowroomHost(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`#${INLINE_ID}`);
  if (existing) {
    watchShowroomHost(existing);
    return existing;
  }
  const panel = document.createElement('div');
  panel.id = INLINE_ID;
  mountInlinePanelShadow(panel, renderPanelSkeleton());
  watchShowroomHost(panel);
  return panel;
}

async function refreshPanelFromLivePage(
  panel: HTMLElement,
  generation: number,
  paint: (data: GatheredData, isHydrating: boolean) => void,
): Promise<void> {
  if (isControlCenterPage()) {
    await waitForControlCenterDocument();
    if (!isPanelGenerationCurrent(panel, generation)) {
      return;
    }
    insertControlCenterHost(panel);
  } else if (isArtifactsShowroomPage()) {
    await waitForShowroomDocument();
    if (!isPanelGenerationCurrent(panel, generation)) {
      return;
    }
    insertShowroomHost(panel);
  } else {
    return;
  }
  const live = await gatherData({ remote: false });
  if (!isPanelGenerationCurrent(panel, generation)) {
    return;
  }
  paint(live, false);
}

async function fillPanelFromCacheThenHydrate(
  panel: HTMLElement,
  generation: number,
  paint: (data: GatheredData, isHydrating: boolean) => void,
  options: { force?: boolean } = {},
): Promise<void> {
  const cached = await gatherData({ remote: false });
  if (!isPanelGenerationCurrent(panel, generation)) {
    return;
  }
  const shouldHydrate = requiresBackgroundHydrate(cached, options);
  paint(cached, shouldHydrate);

  let isComplete = false;
  const liveRefresh = refreshPanelFromLivePage(
    panel,
    generation,
    (data, isHydrating) => {
      if (isComplete) {
        return;
      }
      paint(data, shouldHydrate || isHydrating);
    },
  );

  if (!shouldHydrate) {
    await liveRefresh;
    return;
  }
  const hydrated = await hydrateGatheredData(options);
  isComplete = true;
  if (!isPanelGenerationCurrent(panel, generation)) {
    return;
  }
  paint(hydrated, false);
}

function renderShowroomEquipActions(result: OptimizerResult): string {
  const allArp = result.allArpLoadout
    ? `<button type="button" id="ao-inline-equip-allarp" title="${escapeHtml(comboLabel(result.allArpLoadout))}">Equip All-ARP%</button>`
    : '';
  const monthlyMeta = result.monthlyMetaLoadout
    ? `<button type="button" id="ao-inline-equip-monthly" class="ao-secondary" title="${escapeHtml(comboLabel(result.monthlyMetaLoadout))}">Equip Monthly META</button>`
    : '';
  const market = result.marketDiscountLoadout
    ? `<button type="button" id="ao-inline-equip-market" class="ao-secondary" title="${escapeHtml(comboLabel(result.marketDiscountLoadout))}">Equip Market Discount</button>`
    : '';
  return `
    <div class="ao-actions">
      <button type="button" id="ao-inline-equip">Equip Recommended</button>
      ${allArp}
      ${monthlyMeta}
      ${market}
      <button type="button" id="ao-inline-open" class="ao-secondary">Open Full Panel</button>
    </div>
  `;
}

export async function injectShowroomPanel(
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isArtifactsShowroomPage()) {
    return;
  }
  ensureOptimizerStyles();
  const panel = ensureShowroomHost();
  if (panel.dataset.aoReady === '1' && options.force !== true) {
    return;
  }
  const generation = bumpPanelGeneration(panel);

  const paint = (data: GatheredData, isHydrating: boolean): void => {
    replaceInlinePanelBody(
      panel,
      renderShowroomPanelBody(data, { isHydrating }),
    );
    bindShowroomPanelActions(panel, data);
    bindVaultDiscountActions(panelTree(panel), () => {
      void injectShowroomPanel({ force: true });
    });
  };

  await fillPanelFromCacheThenHydrate(panel, generation, paint, options);
  if (isPanelGenerationCurrent(panel, generation)) {
    panel.dataset.aoReady = '1';
  }
}

function paintControlCenterPanel(
  panel: HTMLElement,
  data: GatheredData,
  isHydrating: boolean,
): void {
  replaceInlinePanelBody(
    panel,
    renderControlCenterPanelBody(data, { isHydrating }),
  );
  bindInlinePanelActions(panel, data, {
    equipId: 'ao-cc-equip',
    openId: 'ao-cc-open',
    artifactsId: 'ao-cc-artifacts',
  });
  bindUpgradeButtons(panelTree(panel), async () => {
    await injectControlCenterPanel({ force: true });
  });
  bindVaultDiscountActions(panelTree(panel), () => {
    void injectControlCenterPanel({ force: true });
  });
  panelTree(panel)
    .querySelector('#ao-cc-artifacts')
    ?.addEventListener('click', () => {
      location.assign('/user-artifacts-room');
    });
  panelTree(panel)
    .querySelector('#ao-cc-refresh')
    ?.addEventListener('click', () => {
      void injectControlCenterPanel({ force: true });
    });
}

function syncControlCenterFromGathered(): void {
  if (!isControlCenterPage() || !gatheredCache.current) {
    return;
  }
  const panel = document.querySelector<HTMLElement>(`#${CC_PANEL_ID}`);
  if (!panel?.shadowRoot) {
    return;
  }
  paintControlCenterPanel(panel, gatheredCache.current, false);
}

export async function injectControlCenterPanel(
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isControlCenterPage()) {
    return;
  }
  ensureOptimizerStyles();
  const panel = ensureControlCenterHost();
  if (panel.dataset.aoReady === '1' && options.force !== true) {
    return;
  }
  const generation = bumpPanelGeneration(panel);

  const paint = (data: GatheredData, isHydrating: boolean): void => {
    paintControlCenterPanel(panel, data, isHydrating);
  };

  await fillPanelFromCacheThenHydrate(panel, generation, paint, options);
  if (isPanelGenerationCurrent(panel, generation)) {
    panel.dataset.aoReady = '1';
  }
}

const DEFAULT_INLINE_PANEL_IDS = {
  equipId: 'ao-inline-equip',
  openId: 'ao-inline-open',
  artifactsId: 'ao-inline-artifacts',
} as const;

function bindShowroomPanelActions(
  panel: HTMLElement,
  data: Awaited<ReturnType<typeof gatherData>>,
): void {
  const tree = panelTree(panel);
  tree.querySelector('#ao-inline-equip')?.addEventListener('click', () => {
    void confirmAndApplyCombo(
      data.result.best,
      data.result.current,
      data.settings,
      'recommended',
    );
  });
  tree
    .querySelector('#ao-inline-equip-allarp')
    ?.addEventListener('click', () => {
      void confirmAndApplyCombo(
        data.result.allArpLoadout,
        data.result.current,
        data.settings,
        'All-ARP%',
      );
    });
  tree
    .querySelector('#ao-inline-equip-monthly')
    ?.addEventListener('click', () => {
      void confirmAndApplyCombo(
        data.result.monthlyMetaLoadout,
        data.result.current,
        data.settings,
        'monthly META',
      );
    });
  tree
    .querySelector('#ao-inline-equip-market')
    ?.addEventListener('click', () => {
      void confirmAndApplyCombo(
        data.result.marketDiscountLoadout,
        data.result.current,
        data.settings,
        'market discount',
      );
    });
  tree.querySelector('#ao-inline-open')?.addEventListener('click', () => {
    void openOptimizerModal();
  });
}

function bindInlinePanelActions(
  panel: HTMLElement,
  data: Awaited<ReturnType<typeof gatherData>>,
  ids: {
    equipId: string;
    openId: string;
    artifactsId: string;
  } = DEFAULT_INLINE_PANEL_IDS,
): void {
  const tree = panelTree(panel);
  tree.querySelector(`#${ids.equipId}`)?.addEventListener('click', () => {
    void confirmAndApplyLoadout(data.result, data.settings);
  });
  tree.querySelector(`#${ids.openId}`)?.addEventListener('click', () => {
    void openOptimizerModal();
  });
}

export async function initArtifactOptimizer(): Promise<void> {
  ensureOptimizerStyles();
  watchOptimizerMenuButton();

  if (isControlCenterPage()) {
    ensureControlCenterHost();
    void injectControlCenterPanel();
  } else if (isArtifactsShowroomPage()) {
    ensureShowroomHost();
    void injectShowroomPanel();
  } else if (isSiteStatePage()) {
    void (async () => {
      const state = await refreshSiteStateFromPage();
      await applyAsceCommunityHours(state);
      await saveSiteState(state);
    })();
  }

  await createOptimizerModal();
}
