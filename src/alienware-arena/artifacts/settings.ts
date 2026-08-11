import { GM } from '$';

import type { ArtifactTier } from './data';
import type { ActivityKey } from './siteState';

const SETTINGS_KEY = 'artifactOptimizerSettings';
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const COOLDOWN_MS =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

export type ArtifactSlotPosition = 1 | 2 | 3;

export interface ActivityToggle {
  enabled: boolean;
  /**
   * Relative weight / participation frequency multiplier (1 = full guide assumption).
   */
  frequency: number;
}

export interface ManualOwnedArtifact {
  familyId: string;
  tier: ArtifactTier;
  instanceId?: number;
  equippedPosition?: ArtifactSlotPosition;
}

export interface SlotCooldownEntry {
  position: ArtifactSlotPosition;
  changedAt: string;
  artifactInstanceId?: number;
}

export interface ArtifactOptimizerSettings {
  activities: Record<ActivityKey, ActivityToggle>;
  /**
   * Target list-price Game Vault claim (ARP); 0 = first claimable vault price. Not auction bids.
   */
  pendingVaultPurchaseArp: number;
  /**
   * Manual fragment override; undefined = use scraped.
   */
  manualFragments?: number;
  /**
   * Manual owned list; empty = use scraped only.
   */
  manualArtifacts: ManualOwnedArtifact[];
  /**
   * Prefer scraped data when both exist.
   */
  preferScraped: boolean;
  slotCooldowns: SlotCooldownEntry[];
  /**
  Skip Game Vault discount recs for this rotation (`gameVaultCycleId`).
  */
  vaultDiscountDismissedCycle?: string;
}

const DEFAULT_ACTIVITIES: Record<ActivityKey, ActivityToggle> = {
  timeOnSite: { enabled: true, frequency: 1 },
  steamQuests: { enabled: true, frequency: 1 },
  watchTwitch: { enabled: true, frequency: 1 },
  dailyCalendar: { enabled: true, frequency: 1 },
  discordPoll: { enabled: true, frequency: 1 },
  dailyQuests: { enabled: true, frequency: 1 },
  steamCommunityEvent: { enabled: true, frequency: 1 },
};

export const defaultArtifactSettings: ArtifactOptimizerSettings = {
  activities: { ...DEFAULT_ACTIVITIES },
  pendingVaultPurchaseArp: 0,
  manualArtifacts: [],
  preferScraped: true,
  slotCooldowns: [],
};

function isPartialSettings(
  value: unknown,
): value is Partial<ArtifactOptimizerSettings> {
  return typeof value === 'object' && !!value;
}

function mergeActivities(
  base: Record<ActivityKey, ActivityToggle>,
  incoming: Partial<Record<ActivityKey, ActivityToggle>> | undefined,
): Record<ActivityKey, ActivityToggle> {
  if (!incoming) {
    return base;
  }
  const legacy = incoming as Partial<Record<ActivityKey, ActivityToggle>> & {
    communityEvent?: ActivityToggle;
  };
  const next = { ...base };
  // Older builds used `communityEvent` for Control Center daily/weekend quests.
  if (legacy.communityEvent && !legacy.dailyQuests) {
    next.dailyQuests = {
      enabled: legacy.communityEvent.enabled,
      frequency:
        typeof legacy.communityEvent.frequency === 'number'
          ? legacy.communityEvent.frequency
          : 1,
    };
  }
  for (const key of Object.keys(DEFAULT_ACTIVITIES) as ActivityKey[]) {
    const value = incoming[key];
    if (!value) {
      continue;
    }
    next[key] = {
      enabled: value.enabled,
      frequency: typeof value.frequency === 'number' ? value.frequency : 1,
    };
  }
  return next;
}

function applyParsedSettings(
  settings: ArtifactOptimizerSettings,
  parsed: Partial<ArtifactOptimizerSettings>,
): void {
  settings.activities = mergeActivities(settings.activities, parsed.activities);

  if (typeof parsed.pendingVaultPurchaseArp === 'number') {
    settings.pendingVaultPurchaseArp = parsed.pendingVaultPurchaseArp;
  }
  if (typeof parsed.manualFragments === 'number') {
    settings.manualFragments = parsed.manualFragments;
  }
  if (Array.isArray(parsed.manualArtifacts)) {
    settings.manualArtifacts = parsed.manualArtifacts;
  }
  if (typeof parsed.preferScraped === 'boolean') {
    settings.preferScraped = parsed.preferScraped;
  }
  if (Array.isArray(parsed.slotCooldowns)) {
    settings.slotCooldowns = parsed.slotCooldowns;
  }
  if (typeof parsed.vaultDiscountDismissedCycle === 'string') {
    if (parsed.vaultDiscountDismissedCycle) {
      settings.vaultDiscountDismissedCycle = parsed.vaultDiscountDismissedCycle;
    } else {
      delete settings.vaultDiscountDismissedCycle;
    }
  }
}

export async function getArtifactSettings(): Promise<ArtifactOptimizerSettings> {
  const raw: string | Partial<ArtifactOptimizerSettings> | undefined =
    await GM.getValue(SETTINGS_KEY);
  const settings: ArtifactOptimizerSettings = {
    ...defaultArtifactSettings,
    activities: { ...DEFAULT_ACTIVITIES },
    manualArtifacts: [],
    slotCooldowns: [],
  };

  if (!raw) {
    return settings;
  }

  try {
    const parsedUnknown: unknown =
      typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isPartialSettings(parsedUnknown)) {
      return settings;
    }
    applyParsedSettings(settings, parsedUnknown);
  } catch (error) {
    console.error('[Artifact Optimizer] Error parsing settings:', error);
  }

  return settings;
}

export async function saveArtifactSettings(
  patch: Partial<ArtifactOptimizerSettings>,
): Promise<ArtifactOptimizerSettings> {
  const previous = await getArtifactSettings();
  const next: ArtifactOptimizerSettings = {
    ...previous,
    ...patch,
    activities: patch.activities
      ? { ...previous.activities, ...patch.activities }
      : previous.activities,
  };
  await GM.setValue(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function findCooldownEntry(
  settings: ArtifactOptimizerSettings,
  position: ArtifactSlotPosition,
): SlotCooldownEntry | undefined {
  return settings.slotCooldowns.find((entry) => entry.position === position);
}

export function isSlotOnCooldown(
  settings: ArtifactOptimizerSettings,
  position: ArtifactSlotPosition,
  now = Date.now(),
): boolean {
  const entry = findCooldownEntry(settings, position);
  if (!entry) {
    return false;
  }
  const changedAt = Date.parse(entry.changedAt);
  if (Number.isNaN(changedAt)) {
    return false;
  }
  return now - changedAt < COOLDOWN_MS;
}

export function cooldownRemainingMs(
  settings: ArtifactOptimizerSettings,
  position: ArtifactSlotPosition,
  now = Date.now(),
): number {
  const entry = findCooldownEntry(settings, position);
  if (!entry) {
    return 0;
  }
  const changedAt = Date.parse(entry.changedAt);
  if (Number.isNaN(changedAt)) {
    return 0;
  }
  return Math.max(0, COOLDOWN_MS - (now - changedAt));
}

export async function recordSlotChange(
  position: ArtifactSlotPosition,
  artifactInstanceId?: number,
): Promise<void> {
  const settings = await getArtifactSettings();
  const rest = settings.slotCooldowns.filter(
    (entry) => entry.position !== position,
  );
  const entry: SlotCooldownEntry = {
    position,
    changedAt: new Date().toISOString(),
  };
  if (artifactInstanceId !== undefined) {
    entry.artifactInstanceId = artifactInstanceId;
  }
  rest.push(entry);
  await saveArtifactSettings({ slotCooldowns: rest });
}

/**
 * Merge Showroom lock icons / disabled modal slots into local cooldown state.
 * Locked slots without a timer start a full 24h estimate; unlocked slots clear.
 */
export async function syncSlotLocksFromScrape(
  slotLocks: Partial<Record<ArtifactSlotPosition, boolean>>,
  now = Date.now(),
): Promise<void> {
  const settings = await getArtifactSettings();
  let next = [...settings.slotCooldowns];

  for (const position of [1, 2, 3] as ArtifactSlotPosition[]) {
    const isLocked = slotLocks[position] === true;
    const hasExistingEntry = next.some((entry) => entry.position === position);

    if (isLocked) {
      if (hasExistingEntry && isSlotOnCooldown(settings, position, now)) {
        continue;
      }
      next = [
        ...next.filter((entry) => entry.position !== position),
        { position, changedAt: new Date(now).toISOString() },
      ];
      continue;
    }

    if (slotLocks[position] === false) {
      next = next.filter((entry) => entry.position !== position);
    }
  }

  await saveArtifactSettings({ slotCooldowns: next });
}

export { COOLDOWN_MS };
