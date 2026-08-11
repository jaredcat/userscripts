import {
  ARTIFACT_SETS,
  type ArtifactDefinition,
  ArtifactEffectType,
  ArtifactTier,
  BASE_ACTIVITY,
  displayNameFor,
  fragmentCostToUpgradeFrom,
  getArtifactById,
  getNumericEffect,
  MONTHLY_ARP_FOR_PCT,
  MONTHLY_CATEGORY_USES,
  monthlyMetaStandingFamilies,
  upgradeFocusOrder,
} from './data';
import { type ArtifactSnapshot, type OwnedArtifact } from './scraper';
import {
  COOLDOWN_MS,
  cooldownRemainingMs,
  type ArtifactOptimizerSettings,
  type ArtifactSlotPosition,
} from './settings';
import {
  battlePassClaimableArp,
  battlePassRemainingMs,
  breakDownCommunityEventPending,
  canAffordAnyVaultOffer,
  canAffordVaultPrice,
  canEarnCommunityEventArp,
  describeWaitingCommunityProgress,
  emptySiteState,
  formatCommunityEta,
  gameVaultCatalogPrice,
  gameVaultCycleId,
  gameVaultOpensAtMs,
  hasPostedListPriceVaultGames,
  isActivityAvailable,
  isActivityPending,
  isGameVaultCurrentlyOpen,
  isGameVaultStockOpen,
  estimateCommunityUnlockAt,
  estimateNextCommunityUnlock,
  remainingSteamQuestRewards,
  twitchWatchRemainingMs,
  vaultPayArp,
  willMissDiscountEquipBeforeOpen,
  type SiteState,
} from './siteState';

export interface BreakdownLine {
  /**
  Final ARP after All-ARP% multiplier.
  */
  total: number;
  /**
  Activity ARP before artifact flat bonus and All-ARP%.
  */
  base: number;
  /**
  Flat category bonus from artifacts + sets (pre-multiplier).
  */
  categoryBonus: number;
  /**
  All-ARP% uplift included in total.
  */
  allArpBonus: number;
}

interface RawBreakdownParts {
  base: number;
  categoryBonus: number;
}

export interface ScoredCombo {
  artifacts: OwnedArtifact[];
  /**
  Estimated ARP for the current 24h swap window.
  */
  weeklyArp: number;
  marketplaceSavingsArp: number;
  totalScore: number;
  allArpPct: number;
  /**
  Flat Steam Quests ARP bonus from artifacts + sets (pre-multiplier).
  */
  steamQuestsFlat: number;
  /**
  Flat Watch Twitch ARP bonus from artifacts + sets (pre-multiplier).
  */
  watchTwitchFlat: number;
  /**
  Flat Daily Calendar ARP bonus from artifacts + sets (pre-multiplier).
  */
  dailyCalendarFlat: number;
  /**
  Flat Discord Poll ARP bonus from artifacts + sets (pre-multiplier).
  */
  discordPollFlat: number;
  activeSetNames: string[];
  breakdown: Record<string, BreakdownLine>;
}

export interface UpgradeSuggestion {
  artifact: OwnedArtifact;
  fromTier: ArtifactTier;
  toTier: ArtifactTier;
  fragmentCost: number;
  /**
  Estimated extra ARP per month from this tier step (category uses / All-ARP%).
  */
  arpGain: number;
  efficiency: number;
  /**
  True when fragments cover this step without skipping a higher-priority save.
  */
  isAffordable: boolean;
}

export interface OptimizerResult {
  best: ScoredCombo | undefined;
  current: ScoredCombo | undefined;
  alternatives: ScoredCombo[];
  upgrades: UpgradeSuggestion[];
  dailySwap:
    | {
        unequip: OwnedArtifact;
        equip: OwnedArtifact;
        reason: string;
      }
    | undefined;
  notes: string[];
  /**
  Inventory includes positive All-ARP% (artifact or set), not limited to top scored combos.
  */
  hasAllArpOwned?: boolean;
  /**
  Currently equipped loadout has positive All-ARP%.
  */
  hasAllArpEquipped?: boolean;
  /**
  Hold BP claims at 0% All-ARP% while the season still has time.
  Not a reason to swap onto All-ARP%. False when already wearing it, or
  the season ends before All-ARP% can go on (claim on the current set).
  */
  deferBattlePassClaims?: boolean;
  /**
  Best owned loadout maximizing All-ARP% (HPC / Zorathian / etc.), for claim windows.
  */
  allArpLoadout?: ScoredCombo;
  /**
  Best owned loadout maximizing market discount (Stanley / Light Warping / etc.).
  */
  marketDiscountLoadout?: ScoredCombo;
  /**
  Megumin standing 3-set (wear all month), not the 24h remaining-activity combo.
  */
  monthlyMetaLoadout?: ScoredCombo;
  /**
  Game Vault discount rec for this rotation (dismissable).
  */
  vaultDiscount?: {
    cycleId: string;
    note?: string;
    dismissed: boolean;
  };
}

export interface OptimizerContext {
  snapshot: ArtifactSnapshot;
  settings: ArtifactOptimizerSettings;
  siteState: SiteState;
}

const BP_CLAIM_BUFFER_MS = 10 * 60 * 1000;
const deferBattlePassCache = new WeakMap<OptimizerContext, boolean>();

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) {
    return [[]];
  }
  if (items.length < k) {
    return [];
  }
  const [first, ...rest] = items;
  if (first === undefined) {
    return [];
  }
  const withFirst = combinations(rest, k - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function msUntilNextUtcMidnight(now = Date.now()): number {
  const date = new Date(now);
  return Math.max(
    0,
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) -
      now,
  );
}

/**
 * Soonest All-ARP% deadline in this 24h window (UTC reset, and community
 * unlock when ASCE ETA is inside the lock). Slots that unlock before this
 * can still complete Zorathian / HPC; slots locked past it cannot.
 */
function pinHorizonMs(siteState: SiteState, now = Date.now()): number {
  const untilReset = msUntilNextUtcMidnight(now);
  const event = siteState.communityEvent;
  if (!event?.isLive || !canEarnCommunityEventArp(event)) {
    return untilReset;
  }
  const pending = breakDownCommunityEventPending(event);
  if (pending.waitingCommunityArp <= 0) {
    return untilReset;
  }
  const eta = estimateNextCommunityUnlock(event, now);
  if (eta === undefined || eta.etaMs > COOLDOWN_MS) {
    return untilReset;
  }
  return Math.min(untilReset, eta.etaMs);
}

function pinnedEquippedArtifacts(
  owned: OwnedArtifact[],
  settings: ArtifactOptimizerSettings,
  siteState: SiteState,
): OwnedArtifact[] {
  const horizonMs = pinHorizonMs(siteState);
  return owned.filter((artifact) => {
    if (artifact.equippedPosition === undefined) {
      return false;
    }
    const remaining = cooldownRemainingMs(settings, artifact.equippedPosition);
    if (remaining > 0) {
      return remaining >= horizonMs;
    }
    // Site lock with no local timer — cannot swap, timing unknown.
    return artifact.slotLocked === true;
  });
}

function combinationsWithPinned(
  owned: OwnedArtifact[],
  size: number,
  pinned: OwnedArtifact[],
): OwnedArtifact[][] {
  if (pinned.length >= size) {
    return [pinned.slice(0, size)];
  }
  const pinnedIds = new Set(pinned.map((artifact) => artifact.instanceId));
  const rest = owned.filter((artifact) => !pinnedIds.has(artifact.instanceId));
  return combinations(rest, size - pinned.length).map((extra) => [
    ...pinned,
    ...extra,
  ]);
}

function activeSets(familyIds: string[]): typeof ARTIFACT_SETS {
  return ARTIFACT_SETS.filter(
    (set) =>
      !set.unconfirmed && set.memberIds.every((id) => familyIds.includes(id)),
  );
}

interface BonusBuckets {
  steamQuests: number;
  watchTwitch: number;
  dailyCalendar: number;
  timeOnSite: number;
  discordPoll: number;
  marketDiscountPct: number;
  allArpPct: number;
  communityPlaytimePct: number;
}

function emptyBonuses(): BonusBuckets {
  return {
    steamQuests: 0,
    watchTwitch: 0,
    dailyCalendar: 0,
    timeOnSite: 0,
    discordPoll: 0,
    marketDiscountPct: 0,
    allArpPct: 0,
    communityPlaytimePct: 0,
  };
}

function applyEffect(
  bonuses: BonusBuckets,
  type: ArtifactEffectType,
  value: number,
): void {
  switch (type) {
    case ArtifactEffectType.SteamQuests: {
      bonuses.steamQuests += value;
      break;
    }
    case ArtifactEffectType.WatchTwitch: {
      bonuses.watchTwitch += value;
      break;
    }
    case ArtifactEffectType.DailyCalendar: {
      bonuses.dailyCalendar += value;
      break;
    }
    case ArtifactEffectType.TimeOnSite: {
      bonuses.timeOnSite += value;
      break;
    }
    case ArtifactEffectType.DiscordPoll: {
      bonuses.discordPoll += value;
      break;
    }
    case ArtifactEffectType.MarketDiscountPct: {
      // Values are stored negative (e.g. -0.15); accumulate magnitude as savings fraction
      bonuses.marketDiscountPct += Math.abs(value);
      break;
    }
    case ArtifactEffectType.AllArpPct: {
      bonuses.allArpPct += value;
      break;
    }
    case ArtifactEffectType.CommunityPlaytimePct: {
      bonuses.communityPlaytimePct += value;
      break;
    }
    default: {
      break;
    }
  }
}

function applySetBonuses(bonuses: BonusBuckets, familyIds: string[]): void {
  for (const set of activeSets(familyIds)) {
    const arpEffects = set.effects.filter(
      (effect) => effect.unit !== 'cosmetic',
    );
    for (const effect of arpEffects) {
      applyEffect(bonuses, effect.type, effect.value);
    }
  }
}

function collectBonuses(owned: OwnedArtifact[]): BonusBuckets {
  const bonuses = emptyBonuses();
  for (const item of owned) {
    const family = getArtifactById(item.familyId);
    if (!family) {
      continue;
    }
    applyEffect(
      bonuses,
      family.effectType,
      getNumericEffect(family, item.tier),
    );
  }
  applySetBonuses(
    bonuses,
    owned.map((artifact) => artifact.familyId),
  );
  return bonuses;
}

/**
 * Flats + All-ARP% for an arbitrary equipped set (including 1–2 pieces or a
 * post-immediate-equip mix). Used to decide whether filling a free slot would
 * actually hurt a pending activity.
 */
export interface ActivityLoadoutStats {
  allArpPct: number;
  steamQuestsFlat: number;
  watchTwitchFlat: number;
  dailyCalendarFlat: number;
  discordPollFlat: number;
}

export function activityStatsForArtifacts(
  artifacts: OwnedArtifact[],
): ActivityLoadoutStats {
  const bonuses = collectBonuses(artifacts);
  return {
    allArpPct: bonuses.allArpPct,
    steamQuestsFlat: bonuses.steamQuests,
    watchTwitchFlat: bonuses.watchTwitch,
    dailyCalendarFlat: bonuses.dailyCalendar,
    discordPollFlat: bonuses.discordPoll,
  };
}

function setBreakdownParts(
  breakdown: Record<string, RawBreakdownParts>,
  key: string,
  base: number,
  categoryBonus = 0,
): number {
  const value = base + categoryBonus;
  if (value === 0) {
    return 0;
  }
  breakdown[key] = { base, categoryBonus };
  return value;
}

function addDailyCategory(
  breakdown: Record<string, RawBreakdownParts>,
  key: string,
  base: number,
  flatBonus: number,
  days: number,
  frequency: number,
): number {
  return setBreakdownParts(
    breakdown,
    key,
    base * days * frequency,
    flatBonus * days * frequency,
  );
}

function scoreSteamQuests(
  breakdown: Record<string, RawBreakdownParts>,
  bonuses: BonusBuckets,
  freq: number,
  siteState: SiteState,
): number {
  const bases = remainingSteamQuestRewards(siteState);
  if (bases.length === 0) {
    return 0;
  }
  return setBreakdownParts(
    breakdown,
    'steamQuests',
    bases.reduce((sum, base) => sum + base, 0) * freq,
    bonuses.steamQuests * bases.length * freq,
  );
}

function scoreDailyQuests(
  breakdown: Record<string, RawBreakdownParts>,
  freq: number,
): number {
  const B = BASE_ACTIVITY;
  let flatSum = setBreakdownParts(
    breakdown,
    'dailyQuests',
    B.dailyQuestBase * freq,
  );
  const day = new Date().getUTCDay();
  if (day === 0 || day === 6) {
    flatSum += setBreakdownParts(
      breakdown,
      'weekendQuests',
      B.weekendQuestBase * freq,
    );
  }
  return flatSum;
}

function scoreSecondaryActivities(
  breakdown: Record<string, RawBreakdownParts>,
  bonuses: BonusBuckets,
  context: OptimizerContext,
  isEnabled: (key: keyof OptimizerContext['settings']['activities']) => boolean,
  freq: (key: keyof OptimizerContext['settings']['activities']) => number,
): number {
  const { siteState } = context;
  const caps = siteState.caps;
  const B = BASE_ACTIVITY;
  let flatSum = 0;

  if (isEnabled('discordPoll') && isActivityPending(caps, 'discordPoll')) {
    const polls = B.discordPollsWhenPending * freq('discordPoll');
    flatSum += setBreakdownParts(
      breakdown,
      'discordPoll',
      B.discordPollBase * polls,
      bonuses.discordPoll * polls,
    );
  }

  if (isEnabled('dailyQuests') && isActivityPending(caps, 'dailyQuests')) {
    flatSum += scoreDailyQuests(breakdown, freq('dailyQuests'));
  }

  if (isEnabled('steamCommunityEvent')) {
    const eventArp = communityEventArpInSwapWindow(siteState);
    if (eventArp > 0) {
      flatSum += setBreakdownParts(
        breakdown,
        'steamCommunityEvent',
        eventArp * freq('steamCommunityEvent'),
      );
    }
  }

  const readyClaims = battlePassClaimableArp(siteState.battlePass);
  if (readyClaims > 0 && !shouldDeferBattlePassForContext(context)) {
    const owned = resolveOwnedList(context);
    const hasAllArpOn = hasAllArpEffect(currentLoadout(owned));
    if (!hasAllArpOn || bonuses.allArpPct > 0) {
      flatSum += setBreakdownParts(
        breakdown,
        'battlePassClaims',
        readyClaims * 40,
      );
    }
  }

  return flatSum;
}

/**
 * Community Event ARP that this 24h lock will still be wearing when it grants.
 *
 * Personal-hours-not-met: player-controlled — score it (equip All-ARP% first).
 * Waiting-on-community: per milestone, only if that gate's ASCE ETA is inside
 * COOLDOWN_MS (75k in ~16h counts; 85k a day later does not). The award fires
 * on whatever is equipped; All-ARP% is the only boost (Megumin FAQ). Watch
 * Twitch repeats daily — it must not beat this one-shot. Unknown ETA stays
 * unscored. Both-gates-met is scrape lag — ignore.
 */
function communityEventArpInSwapWindow(siteState: SiteState): number {
  const event = siteState.communityEvent;
  if (!event?.isLive || !canEarnCommunityEventArp(event)) {
    return 0;
  }
  const pending = breakDownCommunityEventPending(event);
  let arp = pending.waitingPersonalArp;
  for (const milestone of event.milestones) {
    if (
      milestone.isAwarded ||
      milestone.arpReward <= 0 ||
      milestone.personalHoursRequired > event.personalHours ||
      milestone.isCommunityUnlocked
    ) {
      continue;
    }
    const target = milestone.communityHoursRequired;
    if (target === undefined) {
      continue;
    }
    const eta = estimateCommunityUnlockAt(event, target);
    if (eta !== undefined && eta.etaMs <= COOLDOWN_MS) {
      arp += milestone.arpReward;
    }
  }
  return arp;
}

function scoreWindowActivities(
  bonuses: BonusBuckets,
  context: OptimizerContext,
): { flatSum: number; breakdown: Record<string, RawBreakdownParts> } {
  const { settings, siteState } = context;
  const acts = settings.activities;
  const caps = siteState.caps;
  const B = BASE_ACTIVITY;
  const breakdown: Record<string, RawBreakdownParts> = {};
  let flatSum = 0;

  const isEnabled = (key: keyof typeof acts): boolean =>
    (acts[key]?.enabled ?? false) && (acts[key]?.frequency ?? 0) > 0;
  const freq = (key: keyof typeof acts): number =>
    isEnabled(key) ? (acts[key]?.frequency ?? 0) : 0;

  if (isEnabled('timeOnSite') && isActivityAvailable(caps, 'timeOnSite')) {
    flatSum += addDailyCategory(
      breakdown,
      'timeOnSite',
      B.timeOnSiteBasePerDay,
      bonuses.timeOnSite,
      B.days,
      freq('timeOnSite'),
    );
  }

  if (isEnabled('watchTwitch')) {
    const remainingArp =
      twitchWatchRemainingMs(siteState, bonuses.watchTwitch) / 60_000;
    if (remainingArp > 0) {
      flatSum += setBreakdownParts(breakdown, 'watchTwitch', remainingArp);
    }
  }

  if (isEnabled('steamQuests') && isActivityPending(caps, 'steamQuests')) {
    flatSum += scoreSteamQuests(
      breakdown,
      bonuses,
      freq('steamQuests'),
      siteState,
    );
  }

  if (
    isEnabled('dailyCalendar') &&
    isActivityAvailable(caps, 'dailyCalendar')
  ) {
    flatSum += addDailyCategory(
      breakdown,
      'dailyCalendar',
      B.dailyCalendarBasePerDay,
      bonuses.dailyCalendar,
      B.days,
      freq('dailyCalendar'),
    );
  }

  flatSum += scoreSecondaryActivities(
    breakdown,
    bonuses,
    context,
    isEnabled,
    freq,
  );

  return { flatSum, breakdown };
}

function comboMarketDiscountPct(combo: ScoredCombo | undefined): number {
  if (!combo) {
    return 0;
  }
  return collectBonuses(combo.artifacts).marketDiscountPct;
}

/**
Current redeemable ARP plus the best remaining 24h-window earnings among the
given loadouts (quests / dailies still left). Undefined when balance is unknown.
*/
function projectedRedeemableArp(
  context: OptimizerContext,
  ...windows: (ScoredCombo | undefined)[]
): number | undefined {
  const current = context.siteState.arpLog?.redeemableArp;
  if (current === undefined) {
    return undefined;
  }
  const earnable = Math.max(
    0,
    ...windows.map((combo) => combo?.weeklyArp ?? 0),
  );
  return current + earnable;
}

function vaultListPrice(context: OptimizerContext, discountPct = 0): number {
  if (context.settings.pendingVaultPurchaseArp > 0) {
    return context.settings.pendingVaultPurchaseArp;
  }
  return gameVaultCatalogPrice(context.siteState, discountPct);
}

/**
List price only while Game Vault has a claim this combo can actually afford.
*/
function vaultPurchasePriceNow(
  context: OptimizerContext,
  discountPct = 0,
): number {
  if (!isGameVaultCurrentlyOpen(context.siteState, discountPct)) {
    return 0;
  }
  const price = vaultListPrice(context, discountPct);
  if (price <= 0) {
    return 0;
  }
  if (
    !canAffordVaultPrice(
      context.siteState.arpLog?.redeemableArp,
      vaultPayArp(price, discountPct),
    )
  ) {
    return 0;
  }
  return price;
}

/**
 * Holistic combo score for the next 24h swap window.
 *
 * Artifacts can only change once per day, so we score what you can still earn
 * before the next swap — not a multi-week average. Weeklies (Steam Quests,
 * Discord) count only while still unfinished; capped dailies score 0.
 *
 * Stacking order (confirmed by guide math + FAQ):
 *   totalArp = Σ(base + flatCategoryBonus) × (1 + Σ AllArpPct)
 *
 * AllArpPct is a blanket multiplier over every ARP source — including categories
 * with no dedicated artifact (Steam Community Event Reward, Battle Pass claims).
 * MarketDiscountPct is scored separately as ARP savings, not as a multiplier.
 */
export function scoreCombo(
  three: OwnedArtifact[],
  context: OptimizerContext,
): ScoredCombo {
  const bonuses = collectBonuses(three);
  const { flatSum, breakdown: rawBreakdown } = scoreWindowActivities(
    bonuses,
    context,
  );
  const multiplier = 1 + bonuses.allArpPct;
  const windowArp = flatSum * multiplier;

  const breakdown: Record<string, BreakdownLine> = {};
  for (const [key, raw] of Object.entries(rawBreakdown)) {
    const preMultiplier = raw.base + raw.categoryBonus;
    const total = Math.round(preMultiplier * multiplier);
    const base = Math.round(raw.base);
    const categoryBonus = Math.round(raw.categoryBonus);
    breakdown[key] = {
      total,
      base,
      categoryBonus,
      allArpBonus: total - base - categoryBonus,
    };
  }

  const vaultPrice = vaultPurchasePriceNow(context, bonuses.marketDiscountPct);
  const marketplaceSavingsArp = vaultPrice * bonuses.marketDiscountPct;

  return {
    artifacts: three,
    weeklyArp: Math.round(windowArp),
    marketplaceSavingsArp: Math.round(marketplaceSavingsArp),
    totalScore: Math.round(windowArp + marketplaceSavingsArp),
    allArpPct: bonuses.allArpPct,
    steamQuestsFlat: bonuses.steamQuests,
    watchTwitchFlat: bonuses.watchTwitch,
    dailyCalendarFlat: bonuses.dailyCalendar,
    discordPollFlat: bonuses.discordPoll,
    activeSetNames: activeSets(three.map((a) => a.familyId)).map((s) => s.name),
    breakdown,
  };
}

function resolveOwnedList(context: OptimizerContext): OwnedArtifact[] {
  const { snapshot, settings } = context;
  if (settings.preferScraped && snapshot.artifacts.length > 0) {
    return snapshot.artifacts;
  }
  if (settings.manualArtifacts.length > 0) {
    return settings.manualArtifacts.map((manual, index) => {
      const family = getArtifactById(manual.familyId);
      const owned: OwnedArtifact = {
        instanceId: manual.instanceId ?? -(index + 1),
        familyId: manual.familyId,
        displayName: family
          ? displayNameFor(family, manual.tier)
          : manual.familyId,
        tier: manual.tier,
        category: family?.category ?? 'Weapon',
        maxLevel: manual.tier >= ArtifactTier.Interstellar,
        perkDescription: '',
      };
      const upgradeCost = fragmentCostToUpgradeFrom(manual.tier);
      if (upgradeCost !== undefined) {
        owned.upgradeCost = upgradeCost;
      }
      if (manual.equippedPosition !== undefined) {
        owned.equippedPosition = manual.equippedPosition;
      }
      return owned;
    });
  }
  return snapshot.artifacts;
}

function currentLoadout(owned: OwnedArtifact[]): OwnedArtifact[] {
  return owned
    .filter((artifact) => artifact.equippedPosition !== undefined)
    .toSorted(
      (left, right) =>
        (left.equippedPosition ?? 0) - (right.equippedPosition ?? 0),
    );
}

function isSameLoadout(left: OwnedArtifact[], right: OwnedArtifact[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right.map((artifact) => artifact.instanceId));
  return left.every((artifact) => rightIds.has(artifact.instanceId));
}

const UPGRADE_PATH_MAX = 5;

function monthlyUpgradeGain(
  artifact: OwnedArtifact,
  toTier: ArtifactTier,
): number {
  const family = getArtifactById(artifact.familyId);
  if (!family || family.effectUnit === 'cosmetic') {
    return 0;
  }
  const delta =
    getNumericEffect(family, toTier) - getNumericEffect(family, artifact.tier);
  if (delta <= 0) {
    return 0;
  }
  if (family.effectType === ArtifactEffectType.AllArpPct) {
    return Math.round(delta * MONTHLY_ARP_FOR_PCT);
  }
  const uses = MONTHLY_CATEGORY_USES[family.effectType];
  if (uses === undefined) {
    return 0;
  }
  return Math.round(delta * uses);
}

function withUpgradedArtifact(
  artifact: OwnedArtifact,
  toTier: ArtifactTier,
): OwnedArtifact {
  const family = getArtifactById(artifact.familyId);
  const upgraded: OwnedArtifact = {
    ...artifact,
    tier: toTier,
    displayName: family ? displayNameFor(family, toTier) : artifact.displayName,
  };
  const nextCost = fragmentCostToUpgradeFrom(toTier);
  if (nextCost === undefined) {
    delete upgraded.upgradeCost;
  } else {
    upgraded.upgradeCost = nextCost;
  }
  return upgraded;
}

function replaceOwned(
  owned: OwnedArtifact[],
  instanceId: number,
  replacement: OwnedArtifact,
): OwnedArtifact[] {
  return owned.map((artifact) =>
    artifact.instanceId === instanceId ? replacement : artifact,
  );
}

function upgradeFocusRank(familyId: string, order: readonly string[]): number {
  const index = order.indexOf(familyId);
  return index === -1 ? order.length : index;
}

function nextUpgradeCandidate(
  owned: OwnedArtifact[],
  focusOrder: readonly string[],
): UpgradeSuggestion | undefined {
  const candidates: UpgradeSuggestion[] = [];
  for (const artifact of owned) {
    if (artifact.tier >= ArtifactTier.Interstellar) {
      continue;
    }
    const family = getArtifactById(artifact.familyId);
    const toTier = (artifact.tier + 1) as ArtifactTier;
    if (family?.effects[toTier] === undefined) {
      continue;
    }
    const fragmentCost =
      artifact.upgradeCost ?? fragmentCostToUpgradeFrom(artifact.tier);
    if (fragmentCost === undefined) {
      continue;
    }
    const arpGain = monthlyUpgradeGain(artifact, toTier);
    if (arpGain <= 0) {
      continue;
    }
    candidates.push({
      artifact,
      fromTier: artifact.tier,
      toTier,
      fragmentCost,
      arpGain,
      efficiency: arpGain / fragmentCost,
      isAffordable: false,
    });
  }
  return candidates.toSorted((left, right) => {
    const rankDelta =
      upgradeFocusRank(left.artifact.familyId, focusOrder) -
      upgradeFocusRank(right.artifact.familyId, focusOrder);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    if (right.arpGain !== left.arpGain) {
      return right.arpGain - left.arpGain;
    }
    return left.fragmentCost - right.fragmentCost;
  })[0];
}

/**
Long-term META upgrade path. Walks focus order one tier at a time. Marks
which steps the current fragment balance could cover (nothing is spent until
the user confirms Upgrade). The first unaffordable step is the save target;
leftover fragments are not suggested on cheaper sidegrades.
*/
function suggestUpgrades(
  owned: OwnedArtifact[],
  fragments: number,
): UpgradeSuggestion[] {
  const focusOrder = upgradeFocusOrder(
    new Set(owned.map((artifact) => artifact.familyId)),
  );
  let remaining = fragments;
  let isSaving = false;
  let working = owned.map((artifact) => ({ ...artifact }));
  const path: UpgradeSuggestion[] = [];

  while (path.length < UPGRADE_PATH_MAX) {
    const next = nextUpgradeCandidate(working, focusOrder);
    if (!next) {
      break;
    }
    const isAffordable = !isSaving && next.fragmentCost <= remaining;
    if (isAffordable) {
      remaining -= next.fragmentCost;
    } else {
      isSaving = true;
    }
    const ownedName =
      owned.find((artifact) => artifact.instanceId === next.artifact.instanceId)
        ?.displayName ?? next.artifact.displayName;
    path.push({
      ...next,
      artifact: { ...next.artifact, displayName: ownedName },
      isAffordable,
    });
    working = replaceOwned(
      working,
      next.artifact.instanceId,
      withUpgradedArtifact(next.artifact, next.toTier),
    );
  }
  return path;
}

function findBestCombo(
  owned: OwnedArtifact[],
  context: OptimizerContext,
): ScoredCombo | undefined {
  const shouldRequireAllArpForOneShot =
    communityEventArpInSwapWindow(context.siteState) > 0 &&
    canAssembleAllArp(owned);
  if (shouldRequireAllArpForOneShot) {
    const allArp = findBestComboBy(
      owned,
      context,
      (combo) => combo.weeklyArp,
      (combo) => combo.allArpPct > 0,
    );
    if (allArp) {
      return allArp;
    }
  }
  return findBestComboBy(
    owned,
    context,
    (combo) => combo.weeklyArp,
    () => true,
  );
}

/**
 * Pick the best owned 1–3 piece loadout by a primary metric, with totalScore as tie-break.
 */
function findBestComboBy(
  owned: OwnedArtifact[],
  context: OptimizerContext,
  primary: (combo: ScoredCombo) => number,
  isEligible: (combo: ScoredCombo) => boolean,
): ScoredCombo | undefined {
  if (owned.length === 0) {
    return undefined;
  }
  const size = Math.min(3, owned.length);
  const pinned = pinnedEquippedArtifacts(
    owned,
    context.settings,
    context.siteState,
  );
  let best: ScoredCombo | undefined;
  let bestPrimary = Number.NEGATIVE_INFINITY;
  for (const combo of combinationsWithPinned(owned, size, pinned)) {
    const scored = scoreCombo(combo, context);
    if (!isEligible(scored)) {
      continue;
    }
    const score = primary(scored);
    if (
      !best ||
      score > bestPrimary ||
      (score === bestPrimary && scored.totalScore > best.totalScore)
    ) {
      best = scored;
      bestPrimary = score;
    }
  }
  return best;
}

function findBestAllArpCombo(
  owned: OwnedArtifact[],
  context: OptimizerContext,
): ScoredCombo | undefined {
  return findBestComboBy(
    owned,
    context,
    (combo) => combo.allArpPct,
    (combo) => combo.allArpPct > 0,
  );
}

function findBestMarketDiscountCombo(
  owned: OwnedArtifact[],
  context: OptimizerContext,
): ScoredCombo | undefined {
  return findBestComboBy(
    owned,
    context,
    (combo) => collectBonuses(combo.artifacts).marketDiscountPct,
    (combo) => collectBonuses(combo.artifacts).marketDiscountPct > 0,
  );
}

function hasMarketDiscount(combo: ScoredCombo | undefined): boolean {
  if (!combo || combo.artifacts.length === 0) {
    return false;
  }
  return collectBonuses(combo.artifacts).marketDiscountPct > 0;
}

function earliestSlotUnlockMs(
  context: OptimizerContext,
  now = Date.now(),
): number {
  const remaining = ([1, 2, 3] as ArtifactSlotPosition[]).map((position) =>
    cooldownRemainingMs(context.settings, position, now),
  );
  return now + Math.min(...remaining);
}

interface VaultDiscountGuard {
  best: ScoredCombo | undefined;
  marketDiscountLoadout?: ScoredCombo;
  vaultDiscount?: OptimizerResult['vaultDiscount'];
}

function dismissedVaultGuard(
  arpBest: ScoredCombo | undefined,
  cycleId: string,
): VaultDiscountGuard {
  return {
    best: arpBest,
    vaultDiscount: { cycleId, dismissed: true },
  };
}

function suggestVaultDiscount(
  best: ScoredCombo,
  discountCombo: ScoredCombo | undefined,
  note: string,
  cycleId: string,
): VaultDiscountGuard {
  const vaultDiscount = { cycleId, note, dismissed: false };
  if (
    discountCombo &&
    !isSameLoadout(best.artifacts, discountCombo.artifacts)
  ) {
    return { best, marketDiscountLoadout: discountCombo, vaultDiscount };
  }
  if (hasMarketDiscount(best)) {
    return { best, vaultDiscount };
  }
  return { best, vaultDiscount };
}

function resolvePreOpenVaultDiscount(
  arpBest: ScoredCombo,
  current: ScoredCombo | undefined,
  discountCombo: ScoredCombo | undefined,
  context: OptimizerContext,
  cycleId: string,
  now: number,
): VaultDiscountGuard {
  const opensAt = gameVaultOpensAtMs(context.siteState);
  if (opensAt === undefined) {
    return { best: arpBest };
  }
  const eta = formatCommunityEta(Math.max(0, opensAt - now));
  const swapAt = earliestSlotUnlockMs(context, now);
  const isAlreadyOnBest =
    current !== undefined &&
    isSameLoadout(arpBest.artifacts, current.artifacts);

  if (isAlreadyOnBest) {
    if (!willMissDiscountEquipBeforeOpen(swapAt, context.siteState, now)) {
      return { best: arpBest };
    }
    return {
      best: arpBest,
      vaultDiscount: {
        cycleId,
        dismissed: false,
        note: `Slots locked past Game Vault open (${eta}) — market-discount may not be equippable in time.`,
      },
    };
  }

  if (
    !willMissDiscountEquipBeforeOpen(
      swapAt + COOLDOWN_MS,
      context.siteState,
      now,
    )
  ) {
    return { best: arpBest };
  }

  if (current && hasMarketDiscount(current)) {
    return suggestVaultDiscount(
      current,
      discountCombo,
      `Keep market-discount equipped until Game Vault opens (${eta}) — swapping now would lock slots past open.`,
      cycleId,
    );
  }

  if (discountCombo) {
    return suggestVaultDiscount(
      discountCombo,
      discountCombo,
      `Equip market-discount before Game Vault opens (${eta}) — a 24h ARP swap would still be locked at open.`,
      cycleId,
    );
  }

  return { best: arpBest };
}

function resolveOpenVaultDiscount(
  arpBest: ScoredCombo,
  current: ScoredCombo | undefined,
  discountCombo: ScoredCombo | undefined,
  context: OptimizerContext,
  cycleId: string,
  now: number,
): VaultDiscountGuard {
  const isAlreadyOnBest =
    current !== undefined &&
    isSameLoadout(arpBest.artifacts, current.artifacts);
  if (isAlreadyOnBest) {
    if (!discountCombo) {
      return { best: arpBest };
    }
    return {
      best: arpBest,
      marketDiscountLoadout: discountCombo,
      vaultDiscount: {
        cycleId,
        dismissed: false,
        note: 'Game Vault has eligible claims — equip market-discount before buying (logout/relogin after).',
      },
    };
  }

  if (current && hasMarketDiscount(current)) {
    return suggestVaultDiscount(
      current,
      discountCombo,
      'Keep market-discount equipped — Game Vault stock can run out, and a 24h swap would miss the discount.',
      cycleId,
    );
  }

  const canEquipNow = earliestSlotUnlockMs(context, now) <= now;
  if (discountCombo && canEquipNow) {
    return suggestVaultDiscount(
      discountCombo,
      discountCombo,
      'Equip market-discount before claiming Game Vault (eligible stock can run out). Logout/relogin after.',
      cycleId,
    );
  }

  return {
    best: arpBest,
    vaultDiscount: {
      cycleId,
      dismissed: false,
      note: 'Slots locked — Game Vault stock may run out before you can equip market-discount.',
    },
  };
}

/**
Pre-open: only interrupt ARP recs when a 24h lock would still be running at
vault open (discount gear would not be equippable in time). Skip like dismiss
when current ARP + remaining 24h earnings still cannot cover any posted
eligible game even with discount. After open: suggest from live stock/tier
when that projected ARP would be enough — do not ARP-swap into a 24h lock
that would block discount before they can buy. Auctions never count.
Dismissable per rotation.
*/
function resolveVaultDiscountBest(
  arpBest: ScoredCombo | undefined,
  current: ScoredCombo | undefined,
  discountCombo: ScoredCombo | undefined,
  context: OptimizerContext,
  now = Date.now(),
): VaultDiscountGuard {
  const cycleId = gameVaultCycleId(context.siteState);
  if (cycleId && context.settings.vaultDiscountDismissedCycle === cycleId) {
    return dismissedVaultGuard(arpBest, cycleId);
  }
  if (!arpBest || hasMarketDiscount(arpBest)) {
    return { best: arpBest };
  }

  const discountPct = comboMarketDiscountPct(discountCombo);
  const projectedArp = projectedRedeemableArp(
    context,
    arpBest,
    current,
    discountCombo,
  );
  if (
    hasPostedListPriceVaultGames(context.siteState) &&
    !canAffordAnyVaultOffer(context.siteState, discountPct, projectedArp)
  ) {
    return { best: arpBest };
  }

  if (isGameVaultStockOpen(context.siteState)) {
    return resolveOpenVaultDiscount(
      arpBest,
      current,
      discountCombo,
      context,
      cycleId ?? 'open',
      now,
    );
  }

  const opensAt = gameVaultOpensAtMs(context.siteState);
  if (opensAt !== undefined && opensAt > now) {
    return resolvePreOpenVaultDiscount(
      arpBest,
      current,
      discountCombo,
      context,
      cycleId ?? context.siteState.gameVaultOpensAt ?? 'upcoming',
      now,
    );
  }

  return { best: arpBest };
}

function isMonthlyMetaEligible(artifact: OwnedArtifact): boolean {
  const family = getArtifactById(artifact.familyId);
  if (!family || family.effectUnit === 'cosmetic') {
    return false;
  }
  if (family.effectType === ArtifactEffectType.None) {
    return false;
  }
  if (
    family.effectType === ArtifactEffectType.AllArpPct &&
    getNumericEffect(family, artifact.tier) < 0
  ) {
    return false;
  }
  return true;
}

function bestOwnedOfFamily(
  owned: OwnedArtifact[],
  familyId: string,
  usedIds: ReadonlySet<number>,
): OwnedArtifact | undefined {
  return owned
    .filter(
      (artifact) =>
        artifact.familyId === familyId &&
        !usedIds.has(artifact.instanceId) &&
        isMonthlyMetaEligible(artifact),
    )
    .toSorted((left, right) => right.tier - left.tier)[0];
}

/**
Megumin ❌ Swap standing set from owned pieces. Missing families are filled
from the same META order (not by today's 24h score).
*/
function findMonthlyMetaCombo(
  owned: OwnedArtifact[],
  context: OptimizerContext,
): ScoredCombo | undefined {
  const { standing, fillOrder } = monthlyMetaStandingFamilies(
    new Set(owned.map((artifact) => artifact.familyId)),
  );
  const picked: OwnedArtifact[] = [];
  const usedIds = new Set<number>();

  const tryAddFamily = (familyId: string): void => {
    if (picked.length >= 3) {
      return;
    }
    const artifact = bestOwnedOfFamily(owned, familyId, usedIds);
    if (!artifact) {
      return;
    }
    picked.push(artifact);
    usedIds.add(artifact.instanceId);
  };

  for (const familyId of standing) {
    tryAddFamily(familyId);
  }
  for (const familyId of fillOrder) {
    tryAddFamily(familyId);
  }
  if (picked.length === 0) {
    return undefined;
  }
  return scoreCombo(picked, context);
}

function suggestDailySwap(
  best: ScoredCombo,
  current: ScoredCombo | undefined,
): OptimizerResult['dailySwap'] {
  if (!current || current.artifacts.length < 3) {
    return undefined;
  }
  const currentIds = new Set(current.artifacts.map((a) => a.instanceId));
  const bestIds = new Set(best.artifacts.map((a) => a.instanceId));
  const toUnequip = current.artifacts.find((a) => !bestIds.has(a.instanceId));
  const toEquip = best.artifacts.find((a) => !currentIds.has(a.instanceId));
  if (!toUnequip || !toEquip) {
    return undefined;
  }
  return {
    unequip: toUnequip,
    equip: toEquip,
    reason: `Swap ${toUnequip.displayName} → ${toEquip.displayName} for +${
      best.totalScore - current.totalScore
    } estimated ARP in the next 24h swap window`,
  };
}

function hasAllArpEffect(artifacts: OwnedArtifact[]): boolean {
  return collectBonuses(artifacts).allArpPct > 0;
}

function canAssembleAllArp(owned: OwnedArtifact[]): boolean {
  const ids = new Set(owned.map((artifact) => artifact.familyId));
  if (ids.has('herkow-plasma-chamber')) {
    return true;
  }
  const zorathian = ARTIFACT_SETS.find(
    (set) => set.id === 'zorathian-renaissance',
  );
  return zorathian?.memberIds.every((id) => ids.has(id)) === true;
}

function hasInventoryAllArp(owned: OwnedArtifact[]): boolean {
  return canAssembleAllArp(owned) || hasAllArpEffect(owned);
}

function unconstrainedAllArpCombo(
  owned: OwnedArtifact[],
): OwnedArtifact[] | undefined {
  if (owned.length === 0) {
    return undefined;
  }
  const size = Math.min(3, owned.length);
  let best: OwnedArtifact[] | undefined;
  let bestPct = 0;
  for (const combo of combinations(owned, size)) {
    const pct = collectBonuses(combo).allArpPct;
    if (pct > bestPct) {
      bestPct = pct;
      best = combo;
    }
  }
  return bestPct > 0 ? best : undefined;
}

/**
 * When the All-ARP% set can actually go on (per-slot remaining), not a flat 24h.
 */
function allArpEquipWaitMs(
  owned: OwnedArtifact[],
  settings: ArtifactOptimizerSettings,
): number | undefined {
  if (hasAllArpEffect(currentLoadout(owned))) {
    return 0;
  }
  const combo = unconstrainedAllArpCombo(owned);
  if (!combo) {
    return undefined;
  }
  const comboIds = new Set(combo.map((artifact) => artifact.instanceId));
  const slots: ArtifactSlotPosition[] = [1, 2, 3];
  let waitMs = 0;
  for (const position of slots) {
    const equipped = owned.find(
      (artifact) => artifact.equippedPosition === position,
    );
    if (equipped && comboIds.has(equipped.instanceId)) {
      continue;
    }
    waitMs = Math.max(waitMs, cooldownRemainingMs(settings, position));
  }
  return waitMs;
}

/**
 * Hold BP claims while All-ARP% is off and the season still has time.
 * Not a reason to swap onto All-ARP% — more boosts may unlock, and twitch /
 * community can be worth more right now. Claim when already wearing All-ARP%
 * (or when the season ends before it can go on).
 */
function shouldWaitForAllArpBeforeBattlePass(
  owned: OwnedArtifact[],
  settings: ArtifactOptimizerSettings,
  siteState: SiteState,
): boolean {
  if (!hasInventoryAllArp(owned)) {
    return false;
  }
  if (hasAllArpEffect(currentLoadout(owned))) {
    return false;
  }
  if (battlePassClaimableArp(siteState.battlePass) <= 0) {
    return false;
  }
  const waitMs = allArpEquipWaitMs(owned, settings);
  if (waitMs === undefined) {
    return false;
  }
  const bpLeft = battlePassRemainingMs(siteState.battlePass);
  if (bpLeft === undefined) {
    return true;
  }
  return waitMs + BP_CLAIM_BUFFER_MS < bpLeft;
}

function shouldDeferBattlePassForContext(context: OptimizerContext): boolean {
  const cached = deferBattlePassCache.get(context);
  if (cached !== undefined) {
    return cached;
  }
  const shouldDefer = shouldWaitForAllArpBeforeBattlePass(
    resolveOwnedList(context),
    context.settings,
    context.siteState,
  );
  deferBattlePassCache.set(context, shouldDefer);
  return shouldDefer;
}

function appendBattlePassNotes(
  notes: string[],
  owned: OwnedArtifact[],
  equipped: OwnedArtifact[],
  best: ScoredCombo | undefined,
  context: OptimizerContext,
): void {
  const bp = context.siteState.battlePass;
  const readyArp = battlePassClaimableArp(bp);
  if (!bp || readyArp <= 0) {
    return;
  }
  const hasOwnedAllArp = hasInventoryAllArp(owned);
  const hasAllArpOn = hasAllArpEffect(equipped);
  if (hasOwnedAllArp && !hasAllArpOn) {
    if (shouldDeferBattlePassForContext(context)) {
      if ((best?.allArpPct ?? 0) > 0) {
        notes.push(
          `Don't claim Battle Pass ARP Boost yet — ${readyArp} ready; claim after All-ARP% is on.`,
        );
        return;
      }
      notes.push(
        `Leave Battle Pass unclaimed (${readyArp} ready) — more boosts may unlock. Claim when All-ARP% is already on; don't swap just for BP.`,
      );
      return;
    }
    notes.push(
      `Claim ${readyArp} Battle Pass ARP Boost(s) now — Battle Pass ends before All-ARP% can be equipped.`,
    );
    return;
  }
  if (hasAllArpOn) {
    notes.push(
      `Claim ${readyArp} Battle Pass ARP Boost(s) now — All-ARP% is equipped.`,
    );
    return;
  }
  notes.push(`You have ${readyArp} Battle Pass ARP Boost(s) ready to claim.`);
}

function appendCommunityEventNotes(
  notes: string[],
  owned: OwnedArtifact[],
  equipped: OwnedArtifact[],
  context: OptimizerContext,
): void {
  const event = context.siteState.communityEvent;
  if (!event?.isLive || event.pendingArp <= 0) {
    return;
  }
  if (!canEarnCommunityEventArp(event)) {
    return;
  }

  const breakdown = breakDownCommunityEventPending(event);
  const summary = describeCommunityEventPendingNote(event, breakdown);
  const hasAllArpOwned = hasInventoryAllArp(owned);
  const hasAllArpOn = hasAllArpEffect(equipped);

  if (hasAllArpOwned && !hasAllArpOn && breakdown.waitingPersonalArp > 0) {
    notes.push(`${summary} — equip All-ARP% first.`);
    return;
  }

  if (
    hasAllArpOwned &&
    !hasAllArpOn &&
    communityEventArpInSwapWindow(context.siteState) > 0
  ) {
    notes.push(
      `${summary} — grants during this lock (once). Watch Twitch repeats daily; wear All-ARP% for the lump.`,
    );
    return;
  }

  if (hasAllArpOwned && !hasAllArpOn && breakdown.waitingCommunityArp > 0) {
    notes.push(`${summary} — consider All-ARP%.`);
    return;
  }

  notes.push(summary);
}

function describeCommunityEventPendingNote(
  event: NonNullable<OptimizerContext['siteState']['communityEvent']>,
  breakdown: ReturnType<typeof breakDownCommunityEventPending>,
): string {
  if (breakdown.waitingPersonalArp > 0) {
    return `~${breakdown.waitingPersonalArp} ARP unlocked by community`;
  }
  if (breakdown.waitingCommunityArp > 0) {
    const progress = describeWaitingCommunityProgress(event);
    return progress
      ? `~${breakdown.waitingCommunityArp} ARP on community unlock (${progress})`
      : `~${breakdown.waitingCommunityArp} ARP on community unlock`;
  }
  if (breakdown.imminentArp > 0) {
    return `~${breakdown.imminentArp} ARP may already be awarding`;
  }
  return `~${event.pendingArp} ARP still open`;
}

function collectNotes(
  owned: OwnedArtifact[],
  equipped: OwnedArtifact[],
  best: ScoredCombo | undefined,
  context: OptimizerContext,
): string[] {
  const notes: string[] = [];
  appendBattlePassNotes(notes, owned, equipped, best, context);
  appendCommunityEventNotes(notes, owned, equipped, context);

  if (
    best &&
    isActivityPending(context.siteState.caps, 'steamQuests') &&
    equipped.length > 0
  ) {
    const currentSteam = collectBonuses(equipped).steamQuests;
    if (best.steamQuestsFlat < currentSteam) {
      notes.push(
        `Steam Quests still look unfinished — finish them before swapping away from your +${currentSteam} Steam Quests bonus (equip before starting quests).`,
      );
    } else if (currentSteam === 0 && best.steamQuestsFlat > 0) {
      notes.push(
        'Equip a Steam Quests artifact before starting any quest — Control Center still shows 15/25; real ARP is on the ARP Log.',
      );
    }
  }

  return notes;
}

export function optimize(context: OptimizerContext): OptimizerResult {
  const owned = resolveOwnedList(context);

  if (owned.length === 0) {
    return {
      best: undefined,
      current: undefined,
      alternatives: [],
      upgrades: [],
      dailySwap: undefined,
      notes: [
        'No owned artifacts known yet — inventory could not be loaded automatically. Open the optimizer again in a moment, or expand Advanced / manual overrides.',
      ],
      hasAllArpOwned: false,
      hasAllArpEquipped: false,
    };
  }

  const fragments =
    context.settings.manualFragments ?? context.snapshot.fragments;
  const upgrades = suggestUpgrades(owned, fragments);
  const arpBest = findBestCombo(owned, context);
  const equipped = currentLoadout(owned);
  const current =
    equipped.length > 0 ? scoreCombo(equipped, context) : undefined;
  const allArpLoadout = findBestAllArpCombo(owned, context);
  const discountCombo = findBestMarketDiscountCombo(owned, context);
  const guarded = resolveVaultDiscountBest(
    arpBest,
    current,
    discountCombo,
    context,
  );
  const best = guarded.best;
  const monthlyMetaLoadout = findMonthlyMetaCombo(owned, context);

  const alternatives: ScoredCombo[] = [];
  if (owned.length >= 3) {
    const pinned = pinnedEquippedArtifacts(
      owned,
      context.settings,
      context.siteState,
    );
    const scored = combinationsWithPinned(owned, 3, pinned)
      .map((combo) => scoreCombo(combo, context))
      .toSorted((left, right) => right.weeklyArp - left.weeklyArp);
    alternatives.push(...scored.slice(0, 5));
  }
  const marketDiscountLoadout = guarded.marketDiscountLoadout;
  if (
    marketDiscountLoadout &&
    alternatives.every(
      (combo) =>
        !isSameLoadout(combo.artifacts, marketDiscountLoadout.artifacts),
    )
  ) {
    alternatives.push(marketDiscountLoadout);
  }

  const notes = collectNotes(owned, equipped, best, context);

  const result: OptimizerResult = {
    best,
    current,
    alternatives,
    upgrades,
    dailySwap: best ? suggestDailySwap(best, current) : undefined,
    notes,
    hasAllArpOwned: hasInventoryAllArp(owned),
    hasAllArpEquipped: hasAllArpEffect(equipped),
    deferBattlePassClaims: shouldDeferBattlePassForContext(context),
  };
  if (allArpLoadout) {
    result.allArpLoadout = allArpLoadout;
  }
  if (marketDiscountLoadout) {
    result.marketDiscountLoadout = marketDiscountLoadout;
  }
  if (monthlyMetaLoadout) {
    result.monthlyMetaLoadout = monthlyMetaLoadout;
  }
  if (guarded.vaultDiscount) {
    result.vaultDiscount = guarded.vaultDiscount;
  }
  return result;
}

export function buildContext(
  snapshot: ArtifactSnapshot,
  settings: ArtifactOptimizerSettings,
  siteState: SiteState | undefined,
): OptimizerContext {
  return {
    snapshot,
    settings,
    siteState: siteState ?? emptySiteState(),
  };
}

export function describeArtifact(
  family: ArtifactDefinition,
  tier: ArtifactTier,
): string {
  return `${displayNameFor(family, tier)} (${family.category})`;
}
