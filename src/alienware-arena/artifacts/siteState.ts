import { GM } from '$';
import { BASE_ACTIVITY, lastDiscordPollPostAt } from './data';
import {
  resolveSiteStateSteamFreeToPlay,
  scrapeSteamAppIdFromDocument,
} from './steamApp';

const SITE_STATE_KEY = 'artifactSiteState';

export type ActivityKey =
  | 'timeOnSite'
  | 'steamQuests'
  | 'watchTwitch'
  | 'dailyCalendar'
  | 'discordPoll'
  | 'dailyQuests'
  | 'steamCommunityEvent';

export type CapStatus = 'available' | 'capped' | 'unknown';

export interface ActivityCapState {
  timeOnSite: CapStatus;
  steamQuests: CapStatus;
  watchTwitch: CapStatus;
  dailyCalendar: CapStatus;
  discordPoll: CapStatus;
  dailyQuests: CapStatus;
  steamCommunityEvent: CapStatus;
}

export interface GameVaultItem {
  name: string;
  price: number;
  inStock: boolean;
  /**
  False while the monthly vault countdown is active (`data-product-disabled`).
  Undefined on older cached scrapes — treat as unknown.
  */
  purchasable?: boolean;
  /**
  Blind auction — you name an ARP bid. Discord: market % off does not apply.
  */
  isAuction?: boolean;
  /**
  Minimum Arena tier to claim (`data-arp-tier`).
  */
  minTier?: number;
}

export interface BattlePassState {
  tokens?: number;
  tokensMax?: number;
  /**
  Total milestones with a CLAIM button (ARP, fragments, cosmetics, …).
  */
  readyToClaim: number;
  /**
  Claimable ARP Boost (or flat ARP) milestones — these are multiplied by All-ARP%.
  */
  readyToClaimArp: number;
  endsInText?: string;
  /**
  Absolute end from the on-page countdown at scrape time (not a 24h slot lock).
  */
  endsAt?: string;
  url: string;
  scrapedAt: string;
}

export interface ArpLogEntry {
  action: string;
  arp: number;
  date?: string;
}

export interface ArpLogState {
  scrapedAt: string;
  redeemableArp?: number;
  lifetimeArp?: number;
  /**
	Today's ARP delta shown next to redeemable balance on the log page.
	*/
  todayDelta?: number;
  recent: ArpLogEntry[];
}

export interface CommunityEventMilestone {
  index: number;
  personalHoursRequired: number;
  communityHoursRequired?: number;
  /**
	ARP granted by this milestone (0 for fragments/artifacts/cosmetics).
	*/
  arpReward: number;
  rewardLabel: string;
  /**
	Community hour gate has unlocked.
	ARP auto-awards once this AND personal hours are both met.
	*/
  isCommunityUnlocked: boolean;
  isAwarded: boolean;
}

export interface CommunityEventState {
  scrapedAt: string;
  url: string;
  title?: string;
  isLive: boolean;
  personalHours: number;
  /**
  Live community progress bar, e.g. 62160 of 100000 hour(s).
  */
  communityHours?: number;
  /**
  Denominator from the progress bar (usually the final milestone).
  */
  communityHoursCap?: number;
  /**
  Historical community-hour snapshots for unlock ETA (capped).
  Prefer ASCE hourly history when the feed matches this event.
  */
  communityHoursSamples?: CommunityHoursSample[];
  /**
  `asce` when samples came from https://github.com/MarvashMagalli/ASCE
  (do not keep appending per-visit points on top of that series).
  */
  communityHoursSource?: 'asce' | 'local';
  milestones: CommunityEventMilestone[];
  /**
	Unawarded ARP where at least one gate is already met (personal hours and/or
	community unlock). Rewards auto-grant once both gates are true.
	*/
  pendingArp: number;
  /**
	Sum of awarded milestone ARP bases from the event page (not All-ARP boosted).
	*/
  awardedArp: number;
  /**
	Sum of Steam Community Event Reward lines from ARP Log (actual ARP received).
	*/
  receivedArpFromLog?: number;
  /**
  You must own the event game on the linked Steam account. `ineligible` when
  the event page shows Check Game / Visit Steam / Sync Games and Steam says
  the title isn't free. Free games stay recommended — Steam only reports a
  newly added title to AWA after some playtime.
  */
  playEligibility?: SteamPlayEligibility;
  steamAppId?: number;
  isFree?: boolean;
  /**
  AWA didn't see the game in the library yet, but Steam lists it as free.
  */
  libraryPending?: boolean;
}

export interface CommunityHoursSample {
  at: string;
  hours: number;
}

export type SteamPlayEligibility = 'eligible' | 'ineligible' | 'unknown';

export interface SteamQuestRow {
  id?: string;
  name: string;
  href?: string;
  rewardArp: number;
  status: 'complete' | 'incomplete';
  /**
  Steam Quests require owning the game (family sharing doesn't count).
  Choose Your Own Game is always eligible. Paid titles stay `unknown` until
  the quest page is scraped; Check Game + a paid Steam listing → ineligible.
  Check Game + Steam `is_free` (or $0) stays eligible (`libraryPending`).
  */
  eligibility: SteamPlayEligibility;
  steamAppId?: number;
  isFree?: boolean;
  libraryPending?: boolean;
}

export interface SteamQuestsState {
  scrapedAt: string;
  quests: SteamQuestRow[];
}

export interface WatchTwitchProgress {
  scrapedAt: string;
  /**
  Base Watch Twitch ARP earned today (`twitchData.totalPoints`).
  */
  baseArp: number;
  bonusArp: number;
  /**
  Raw `twitchData.timeWatched` from Control Center (minutes when it tracks
  1:1 with `totalPoints`).
  */
  timeWatched: number;
  isUnderCap: boolean;
  /**
  Unbuffed daily ARP cap from Quest Setup / terms ("up to N ARP every day").
  Watch-Twitch artifacts (Pn295 Alloy, etc.) raise the cap on top of this;
  rate stays 1 ARP/min so a higher cap means a longer sit.
  */
  capArp: number;
  /**
  Remaining watch at the unbuffed cap only. Prefer `twitchWatchRemainingMs`
  with the loadout's Watch Twitch flat.
  */
  remainingMs: number;
}

export interface SiteState {
  updatedAt: string;
  caps: ActivityCapState;
  gameVault: GameVaultItem[];
  /**
  Next Game Vault open time from `#game-vault-timer` while claims are closed.
  */
  gameVaultOpensAt?: string;
  /**
  Arena tier (`window.arp_tier` / tier-tag). Used for vault eligibility.
  */
  userArpTier?: number;
  battlePass?: BattlePassState;
  arpLog?: ArpLogState;
  communityEvent?: CommunityEventState;
  watchTwitch?: WatchTwitchProgress;
  steamQuests?: SteamQuestsState;
}

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

function pageText(document_: Document = document): string {
  return document_.body?.textContent ?? '';
}

function readTimeOnSiteCap(body: string): CapStatus | undefined {
  const tosBlock =
    /Time on Site[\s\S]{0,200}?Max ARP per day:\s*(\d+)[\s\S]{0,80}?Earned ARP:\s*(\d+)/i.exec(
      body,
    );
  if (!tosBlock?.[1] || !tosBlock[2]) {
    return undefined;
  }
  const capArp = Number(tosBlock[1]);
  const earnedArp = Number(tosBlock[2]);
  if (!Number.isFinite(capArp) || !Number.isFinite(earnedArp)) {
    return undefined;
  }
  // UCF: equip ToS bonus before the unbuffed 5 ARP. Once that base is hit,
  // extra sit is inefficient — treat as done even if a ToS artifact raised max.
  if (earnedArp >= BASE_ACTIVITY.timeOnSiteBasePerDay) {
    return 'capped';
  }
  return earnedArp >= capArp ? 'capped' : 'available';
}

function isElementDisplayNone(element: Element): boolean {
  const styleAttribute = element.getAttribute('style') ?? '';
  if (/display:\s*none/i.test(styleAttribute)) {
    return true;
  }
  if (element instanceof HTMLElement && element.style.display === 'none') {
    return true;
  }
  return false;
}

function isElementVisiblyHidden(element: Element): boolean {
  if (isElementDisplayNone(element) || element.hasAttribute('hidden')) {
    return true;
  }
  if (element.getAttribute('aria-hidden') === 'true') {
    return true;
  }
  const className = element.getAttribute('class') ?? '';
  if (/\b(d-none|hidden|hide|invisible)\b/i.test(className)) {
    return true;
  }
  const view = element.ownerDocument.defaultView;
  if (view && element instanceof view.HTMLElement) {
    const style = view.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return true;
    }
  }
  return false;
}

/**
CC status is `Incomplete: 0 ARP` (earned so far), not the bare word Incomplete.
*/
function parseTwitchArpStatus(document_: Document): {
  cap?: CapStatus;
  earnedArp?: number;
} {
  const status =
    document_
      .querySelector('#control-center__twitch-arp-status')
      ?.textContent?.trim() ?? '';
  const incompleteArp = /^Incomplete:\s*(\d+)\s*ARP/i.exec(status);
  if (incompleteArp?.[1] !== undefined) {
    return { cap: 'available', earnedArp: Number(incompleteArp[1]) };
  }
  if (/^Incomplete\b/i.test(status)) {
    return { cap: 'available' };
  }
  if (/^Complete\b/i.test(status)) {
    return { cap: 'capped' };
  }
  return {};
}

function readWatchTwitchCapFromDocument(
  document_: Document,
): CapStatus | undefined {
  const fromStatus = parseTwitchArpStatus(document_).cap;
  if (fromStatus) {
    return fromStatus;
  }

  const card = findActivityCard(document_, /^Watch Twitch$/i);
  if (card && /Incomplete/i.test(card.textContent ?? '')) {
    return 'available';
  }

  const maxReached = document_.querySelector(
    '#control-center__twitch-max-reached',
  );
  if (
    maxReached &&
    !isElementVisiblyHidden(maxReached) &&
    /Max Cap Reached/i.test(maxReached.textContent ?? '')
  ) {
    return 'capped';
  }

  return readWatchTwitchCap(pageText(document_));
}

function readWatchTwitchCap(body: string): CapStatus | undefined {
  // Plain-text fallback when dedicated Twitch status nodes are missing.
  // Incomplete must win over a hidden "Max Cap Reached" in the same card.
  if (/Watch Twitch[\s\S]{0,400}?Incomplete:\s*\d+\s*ARP/i.test(body)) {
    return 'available';
  }
  if (/Watch Twitch[\s\S]{0,400}?\bIncomplete\b/i.test(body)) {
    return 'available';
  }
  if (
    /Watch Twitch[\s\S]{0,240}Max Cap Reached/i.test(body) &&
    !/twitch-max-reached[^>]*display:\s*none/i.test(body)
  ) {
    return 'capped';
  }
  if (/Watch Twitch[\s\S]{0,80}\bComplete\b/i.test(body)) {
    return 'capped';
  }
  return undefined;
}

/**
AWA credits 1 Watch Twitch ARP per minute (extension `/twitch/extensions/track`
poll, same cadence as Time on Site `/tos/track`).
*/
const TWITCH_MS_PER_ARP = 60_000;

interface DailyArpTwitchData {
  totalPoints: number;
  timeWatched: number;
  bonusPoints: number;
  isUnderCap: boolean;
}

function parseDailyArpTwitchData(
  document_: Document,
): DailyArpTwitchData | undefined {
  const scripts = [...document_.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent ?? '')
    .join('\n');
  const assignment = /dailyArpData\s*=\s*(\{[\s\S]*?\});/.exec(scripts)?.[1];
  if (!assignment) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(assignment);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || !('twitchData' in parsed)) {
    return undefined;
  }
  const twitch = (parsed as { twitchData: unknown }).twitchData;
  if (!twitch || typeof twitch !== 'object') {
    return undefined;
  }
  const data = twitch as Record<string, unknown>;
  const totalPoints = Number(data.totalPoints);
  if (!Number.isFinite(totalPoints)) {
    return undefined;
  }
  const timeWatched = Number(data.timeWatched);
  const bonusPoints = Number(data.bonusPoints);
  return {
    totalPoints,
    timeWatched: Number.isFinite(timeWatched) ? timeWatched : 0,
    bonusPoints: Number.isFinite(bonusPoints) ? bonusPoints : 0,
    isUnderCap: data.underCap !== false,
  };
}

/**
Daily Twitch ARP cap from Quest Setup / Rewards terms / Control Center copy.
*/
function parseTwitchDailyCapArp(document_: Document): number | undefined {
  const body = pageText(document_);
  const patterns = [
    /only earn up to\s+(\d+)\s*ARP from Twitch/i,
    /Earn up to\s+(\d+)\s*ARP per day by watching participating Twitch/i,
    /watching Twitch[\s\S]{0,160}?earn up to\s+(\d+)\s*ARP every day/i,
    /Watch Twitch[\s\S]{0,240}?Max ARP per day:\s*(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (!match?.[1]) {
      continue;
    }
    const value = Number(match[1]);
    if (value > 0) {
      return value;
    }
  }
  return undefined;
}

/**
Merge Control Center `twitchData` + Quest Setup unbuffed daily cap.
Remaining watch for a loadout is `twitchWatchRemainingMs(state, twitchFlat)`.
*/
export function scrapeWatchTwitchProgressFromDocument(
  document_: Document,
  previous?: WatchTwitchProgress,
): WatchTwitchProgress | undefined {
  const twitchData = parseDailyArpTwitchData(document_);
  const capFromPage = parseTwitchDailyCapArp(document_);
  const statusEarned = parseTwitchArpStatus(document_).earnedArp;
  if (!twitchData && capFromPage === undefined && statusEarned === undefined) {
    return previous;
  }
  const capArp =
    capFromPage ?? previous?.capArp ?? BASE_ACTIVITY.watchTwitchBasePerDay;
  const baseArp =
    twitchData?.totalPoints ?? statusEarned ?? previous?.baseArp ?? 0;
  const isUnderCap = twitchData?.isUnderCap ?? previous?.isUnderCap ?? true;
  const remainingArp = isUnderCap ? Math.max(0, capArp - baseArp) : 0;
  return {
    scrapedAt: new Date().toISOString(),
    baseArp,
    bonusArp: twitchData?.bonusPoints ?? previous?.bonusArp ?? 0,
    timeWatched: twitchData?.timeWatched ?? previous?.timeWatched ?? 0,
    isUnderCap,
    capArp,
    remainingMs: remainingArp * TWITCH_MS_PER_ARP,
  };
}

/**
Wall-clock left to finish Watch Twitch at 1 ARP/min.
`twitchFlat` is the loadout's Pn295 / Scion bonus — it raises the daily cap,
not the tick rate, so Interstellar Pn295 is ~30m from zero (15+15).
*/
export function twitchWatchRemainingMs(
  state: SiteState | undefined,
  twitchFlat = 0,
  now = new Date(),
): number {
  const progress = state?.watchTwitch;
  const baseCap = progress?.capArp ?? BASE_ACTIVITY.watchTwitchBasePerDay;
  const isFreshProgress =
    progress !== undefined &&
    utcDateString(new Date(progress.scrapedAt)) === utcDateString(now);
  // Watch Twitch resets at 00:00 UTC — ignore earn counts scraped yesterday.
  let earned = 0;
  if (isFreshProgress && progress) {
    earned = progress.baseArp;
  } else if (state?.caps.watchTwitch === 'capped') {
    earned = baseCap;
  }
  return Math.max(0, baseCap + twitchFlat - earned) * TWITCH_MS_PER_ARP;
}

function readQuestStatusesFromCard(card: Element): CapStatus | undefined {
  const statuses = [...card.querySelectorAll('td, th, span, div, li')]
    .map((element) => element.textContent?.trim() ?? '')
    .filter((text) => /^(Incomplete|Complete)$/i.test(text));
  if (statuses.some((status) => /^Incomplete$/i.test(status))) {
    return 'available';
  }
  if (statuses.some((status) => /^Complete$/i.test(status))) {
    return 'capped';
  }
  const text = card.textContent ?? '';
  if (/Incomplete/i.test(text)) {
    return 'available';
  }
  if (/\bComplete\b/i.test(text)) {
    return 'capped';
  }
  return undefined;
}

const STEAM_QUEST_STATUS_ID_PREFIX = 'control-center__steam-quest-status-';
const STEAM_LIBRARY_SYNC_LABEL = /^(Check Game|Visit Steam|Sync Games)$/i;
const STEAM_OWNERSHIP_DENIAL =
  /do not own|don['’]t own|not in your steam library|not in your library|must own this game/i;

function controlLabel(element: Element): string {
  return (element.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
}

function hasSteamLibrarySyncControl(document_: Document): boolean {
  if (document_.querySelector('.btn-check-owned-games')) {
    return true;
  }
  return [...document_.querySelectorAll('a, button')].some((element) =>
    STEAM_LIBRARY_SYNC_LABEL.test(controlLabel(element)),
  );
}

function hasSteamOwnershipDenialText(document_: Document): boolean {
  return STEAM_OWNERSHIP_DENIAL.test(pageText(document_));
}

export function isChooseYourOwnGameQuest(quest: {
  name: string;
  href?: string;
}): boolean {
  return /choose[- ]your[- ]own[- ]game/i.test(
    `${quest.name} ${quest.href ?? ''}`,
  );
}

function steamQuestStatusFromText(
  text: string,
): SteamQuestRow['status'] | undefined {
  const trimmed = text.trim();
  if (/^complete$/i.test(trimmed)) {
    return 'complete';
  }
  if (/^incomplete$/i.test(trimmed)) {
    return 'incomplete';
  }
  return undefined;
}

function steamQuestEligibilityFromStatusText(
  text: string,
  quest: { name: string; href?: string },
): SteamPlayEligibility {
  if (/unavailable|ineligible|locked|not owned|unowned/i.test(text.trim())) {
    return 'ineligible';
  }
  if (isChooseYourOwnGameQuest(quest)) {
    return 'eligible';
  }
  return 'unknown';
}

function parseSteamQuestRewardArp(text: string): number | undefined {
  const compact = text.replaceAll(',', '');
  const arpAt = compact.toUpperCase().indexOf(' ARP');
  if (arpAt === -1) {
    return undefined;
  }
  const amountToken = compact.slice(0, arpAt).trim().split(' ').at(-1);
  const reward = Number(amountToken);
  return Number.isFinite(reward) && reward > 0 ? reward : undefined;
}

function pathnameFromHref(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  try {
    return new URL(href, 'https://na.alienwarearena.com').pathname;
  } catch {
    return href.startsWith('/') ? href : undefined;
  }
}

function buildSteamQuestRow(options: {
  id?: string;
  name: string;
  href?: string;
  rewardArp: number;
  statusText: string;
}): SteamQuestRow {
  const { name, href, rewardArp, statusText, id } = options;
  const identity = { name, ...(href && { href }) };
  const status = steamQuestStatusFromText(statusText) ?? 'incomplete';
  const row: SteamQuestRow = {
    name,
    rewardArp,
    status,
    eligibility:
      status === 'complete'
        ? 'eligible'
        : steamQuestEligibilityFromStatusText(statusText, identity),
  };
  if (id) {
    row.id = id;
  }
  if (href) {
    row.href = href;
  }
  return row;
}

function parseSteamQuestRowFromStatusCell(
  card: Element,
  statusCell: Element,
): SteamQuestRow | undefined {
  const id = statusCell.id.startsWith(STEAM_QUEST_STATUS_ID_PREFIX)
    ? statusCell.id.slice(STEAM_QUEST_STATUS_ID_PREFIX.length)
    : undefined;
  const row = statusCell.closest('tr') ?? statusCell.parentElement;
  if (!row) {
    return undefined;
  }
  const questLink = row.querySelector('a[href*="/steam/quests/"]');
  const name =
    questLink?.textContent?.replaceAll(/\s+/g, ' ').trim() ||
    row.querySelector('a')?.textContent?.replaceAll(/\s+/g, ' ').trim();
  if (!name) {
    return undefined;
  }
  const rewardCell = id
    ? card.querySelector(`#control-center__steam-quest-reward-${id}`)
    : undefined;
  const rewardArp = parseSteamQuestRewardArp(
    rewardCell?.textContent ?? row.textContent ?? '',
  );
  if (rewardArp === undefined) {
    return undefined;
  }
  const href = pathnameFromHref(questLink?.getAttribute('href') ?? undefined);
  return buildSteamQuestRow({
    name,
    rewardArp,
    statusText: statusCell.textContent?.trim() ?? '',
    ...(id && { id }),
    ...(href && { href }),
  });
}

function parseSteamQuestRowFromTableRow(
  row: Element,
): SteamQuestRow | undefined {
  const questLink = row.querySelector('a[href*="/steam/quests/"]');
  const name = questLink?.textContent?.replaceAll(/\s+/g, ' ').trim();
  if (!name) {
    return undefined;
  }
  const rewardArp = parseSteamQuestRewardArp(row.textContent ?? '');
  if (rewardArp === undefined) {
    return undefined;
  }
  const statusCell = [...row.querySelectorAll('td')].find((cell) =>
    steamQuestStatusFromText(cell.textContent ?? ''),
  );
  const href = pathnameFromHref(questLink?.getAttribute('href') ?? undefined);
  return buildSteamQuestRow({
    name,
    rewardArp,
    statusText: statusCell?.textContent?.trim() ?? '',
    ...(href && { href }),
  });
}

export function scrapeSteamQuestRowsFromDocument(
  document_: Document,
): SteamQuestRow[] {
  const card = findActivityCard(document_, /^Steam Quests$/i);
  if (!card) {
    return [];
  }
  const fromStatusIds = [
    ...card.querySelectorAll('[id^="control-center__steam-quest-status-"]'),
  ]
    .map((cell) => parseSteamQuestRowFromStatusCell(card, cell))
    .filter((row): row is SteamQuestRow => row !== undefined);
  if (fromStatusIds.length > 0) {
    return fromStatusIds;
  }
  return [...card.querySelectorAll('tr')]
    .map((row) => parseSteamQuestRowFromTableRow(row))
    .filter((row): row is SteamQuestRow => row !== undefined);
}

export function steamQuestsCapFromRows(
  quests: SteamQuestRow[],
): CapStatus | undefined {
  if (quests.length === 0) {
    return undefined;
  }
  return remainingSteamQuestRowsFromList(quests).length > 0
    ? 'available'
    : 'capped';
}

function steamQuestRowKey(row: SteamQuestRow): string {
  return row.id ?? row.href ?? row.name.toLowerCase();
}

function mergeSteamQuestRows(
  scraped: SteamQuestRow[],
  previous: SteamQuestRow[] | undefined,
): SteamQuestRow[] {
  if (!previous || previous.length === 0) {
    return scraped;
  }
  const priorByKey = new Map(
    previous.map((row) => [steamQuestRowKey(row), row]),
  );
  return scraped.map((row) => {
    const prior = priorByKey.get(steamQuestRowKey(row));
    if (!prior) {
      return row;
    }
    if (row.eligibility !== 'unknown' || prior.status !== row.status) {
      return row;
    }
    const merged: SteamQuestRow = {
      ...row,
      eligibility: prior.eligibility,
    };
    if (prior.steamAppId !== undefined) {
      merged.steamAppId = prior.steamAppId;
    }
    if (prior.isFree !== undefined) {
      merged.isFree = prior.isFree;
    }
    if (prior.libraryPending === true) {
      merged.libraryPending = true;
    }
    return merged;
  });
}

function remainingSteamQuestRowsFromList(
  quests: SteamQuestRow[],
): SteamQuestRow[] {
  return quests.filter(
    (quest) =>
      quest.status === 'incomplete' && quest.eligibility !== 'ineligible',
  );
}

export function remainingSteamQuestRows(siteState: SiteState): SteamQuestRow[] {
  return remainingSteamQuestRowsFromList(siteState.steamQuests?.quests ?? []);
}

/**
 * Bases still earnable this week. Falls back to the typical 15+25+25 week
 * when Control Center rows haven't been scraped yet. Upcoming weeks are
 * unknown until posted — monthly META still uses the typical week.
 */
export function remainingSteamQuestRewards(siteState: SiteState): number[] {
  const quests = siteState.steamQuests?.quests;
  if (!quests || quests.length === 0) {
    return [...BASE_ACTIVITY.steamQuestBases];
  }
  return remainingSteamQuestRowsFromList(quests).map(
    (quest) => quest.rewardArp,
  );
}

export function requiresSteamQuestEligibilityFetch(state: SiteState): boolean {
  return (state.steamQuests?.quests ?? []).some((quest) => {
    if (
      quest.status !== 'incomplete' ||
      !quest.href ||
      isChooseYourOwnGameQuest(quest)
    ) {
      return false;
    }
    if (quest.eligibility === 'unknown') {
      return true;
    }
    return quest.eligibility === 'ineligible' && quest.isFree === undefined;
  });
}

/**
 * Quest/event page signals that the linked Steam account does not own the
 * game. Buttons exist in the DOM only when AWA failed the library check;
 * completed/in-progress pages keep the click handlers in a script tag.
 */
export function scrapeSteamPlayEligibilityFromDocument(
  document_: Document,
  options: { personalHours?: number; href?: string } = {},
): SteamPlayEligibility {
  if ((options.personalHours ?? 0) > 0) {
    return 'eligible';
  }
  if (
    options.href &&
    isChooseYourOwnGameQuest({ name: '', href: options.href })
  ) {
    return 'eligible';
  }
  const body = pageText(document_);
  if (/completed this quest/i.test(body)) {
    return 'eligible';
  }
  if (document_.querySelector('.btn-start-quest, a[href^="steam://"]')) {
    return 'eligible';
  }
  const hasLaunchGame = [...document_.querySelectorAll('a, button')].some(
    (element) => /^Launch Game$/i.test(controlLabel(element)),
  );
  if (hasLaunchGame) {
    return 'eligible';
  }
  const progress = document_.querySelector(
    ':scope .progress-steam-quest [aria-valuenow]',
  );
  const played = Number(progress?.getAttribute('aria-valuenow') ?? '');
  if (Number.isFinite(played) && played > 0) {
    return 'eligible';
  }
  if (
    hasSteamLibrarySyncControl(document_) ||
    hasSteamOwnershipDenialText(document_)
  ) {
    return 'ineligible';
  }
  return 'unknown';
}

export function canEarnCommunityEventArp(
  event: CommunityEventState | undefined,
): boolean {
  return event?.playEligibility !== 'ineligible';
}

export function applySteamQuestsFromDocument(
  next: SiteState,
  document_: Document,
): void {
  const scraped = scrapeSteamQuestRowsFromDocument(document_);
  if (scraped.length === 0) {
    return;
  }
  const quests = mergeSteamQuestRows(scraped, next.steamQuests?.quests);
  next.steamQuests = {
    scrapedAt: new Date().toISOString(),
    quests,
  };
  const cap = steamQuestsCapFromRows(quests);
  if (cap) {
    next.caps.steamQuests = cap;
  }
}

export function applySteamQuestDetailFromDocument(
  next: SiteState,
  document_: Document,
  pagePath: string,
): void {
  const quests = [...(next.steamQuests?.quests ?? [])];
  if (quests.length === 0) {
    return;
  }
  const index = quests.findIndex(
    (quest) => quest.href && pagePath.includes(quest.href),
  );
  if (index === -1) {
    return;
  }
  const current = quests[index];
  if (!current) {
    return;
  }
  const isQuestComplete = /completed this quest/i.test(pageText(document_));
  const scrapedEligibility = scrapeSteamPlayEligibilityFromDocument(
    document_,
    current.href ? { href: current.href } : {},
  );
  let eligibility = scrapedEligibility;
  if (isQuestComplete) {
    eligibility = 'eligible';
  } else if (scrapedEligibility === 'unknown') {
    eligibility = current.eligibility;
  }
  const steamAppId =
    scrapeSteamAppIdFromDocument(document_) ?? current.steamAppId;
  const updated: SteamQuestRow = {
    ...current,
    eligibility,
    status: isQuestComplete ? 'complete' : current.status,
  };
  if (steamAppId !== undefined) {
    updated.steamAppId = steamAppId;
  }
  quests[index] = updated;
  next.steamQuests = {
    scrapedAt: new Date().toISOString(),
    quests,
  };
  const cap = steamQuestsCapFromRows(quests);
  if (cap) {
    next.caps.steamQuests = cap;
  }
}

function findActivityCard(
  document_: Document,
  title: RegExp,
): Element | undefined {
  const header = [...document_.querySelectorAll('h2, h3, h4')].find((element) =>
    title.test(element.textContent?.trim() ?? ''),
  );
  if (!header) {
    return undefined;
  }
  return (
    header.closest(
      '.user-profile__profile-card, .aa-card, [class*="profile-card"]',
    ) ??
    header.parentElement?.parentElement ??
    undefined
  );
}

function readSteamQuestsCap(body: string): CapStatus | undefined {
  // Avoid the broad "Daily" lookahead — it breaks section capture on Control Center.
  const steamSection =
    /Steam Quests([\s\S]{0,8000}?)(?=Watch Twitch|Discord Poll|Battle Pass|Time on Site|$)/i.exec(
      body,
    );
  if (!steamSection?.[1]) {
    return undefined;
  }
  const section = steamSection[1];
  if (/Incomplete/i.test(section)) {
    return 'available';
  }
  if (/\bComplete\b/i.test(section)) {
    return 'capped';
  }
  return undefined;
}

function readSteamQuestsCapFromDocument(
  document_: Document,
): CapStatus | undefined {
  const fromRows = steamQuestsCapFromRows(
    scrapeSteamQuestRowsFromDocument(document_),
  );
  if (fromRows) {
    return fromRows;
  }
  const card = findActivityCard(document_, /^Steam Quests$/i);
  if (card) {
    return (
      readQuestStatusesFromCard(card) ?? readSteamQuestsCap(pageText(document_))
    );
  }
  return readSteamQuestsCap(pageText(document_));
}

function readDailyQuestsCap(body: string): CapStatus | undefined {
  const section =
    /Daily Quests([\s\S]{0,1200}?)(?=Steam Quests|Watch Twitch|OLD SCHOOL|Community Event|$)/i.exec(
      body,
    );
  if (!section?.[1]) {
    return undefined;
  }
  if (/Incomplete/i.test(section[1])) {
    return 'available';
  }
  if (/\bComplete\b/i.test(section[1])) {
    return 'capped';
  }
  return undefined;
}

function readDailyQuestsCapFromDocument(
  document_: Document,
): CapStatus | undefined {
  const card = findActivityCard(document_, /^Daily Quests$/i);
  if (card) {
    return (
      readQuestStatusesFromCard(card) ?? readDailyQuestsCap(pageText(document_))
    );
  }
  return readDailyQuestsCap(pageText(document_));
}

function readDailyCalendarCap(body: string): CapStatus | undefined {
  // Legacy Control Center label.
  if (/Daily Login Calendar[\s\S]{0,120}Claimed/i.test(body)) {
    return 'capped';
  }
  if (/Daily Login Calendar[\s\S]{0,120}\bClaim\b/i.test(body)) {
    return 'available';
  }

  // Current Control Center: Today's Reward / 28-Day Daily Login Rewards.
  if (!/Today'?s Reward|28-Day Daily Login Rewards/i.test(body)) {
    return undefined;
  }
  if (/Today'?s Reward[\s\S]{0,240}Claimed/i.test(body)) {
    return 'capped';
  }
  if (/Today'?s Reward[\s\S]{0,240}\bClaim\b/i.test(body)) {
    return 'available';
  }
  // Calendar UI is present but there's no claim CTA → already taken today.
  return 'capped';
}

function readDailyCalendarCapFromDocument(
  document_: Document,
): CapStatus | undefined {
  const fromText = readDailyCalendarCap(pageText(document_));
  if (fromText) {
    return fromText;
  }
  const card = findActivityCard(
    document_,
    /^(Today'?s Reward|28-Day Daily Login Rewards|Daily Login)/i,
  );
  if (!card) {
    return undefined;
  }
  const claimControl = [...card.querySelectorAll('button, a')].find((element) =>
    /^claim$/i.test(element.textContent?.trim() ?? ''),
  );
  if (!claimControl) {
    return 'capped';
  }
  if (claimControl instanceof HTMLButtonElement && claimControl.disabled) {
    return 'capped';
  }
  if (claimControl.getAttribute('aria-disabled') === 'true') {
    return 'capped';
  }
  return 'available';
}

function readDiscordPollCap(body: string): CapStatus | undefined {
  if (/Discord Poll[\s\S]{0,100}Complete/i.test(body)) {
    return 'capped';
  }
  if (/Discord Poll[\s\S]{0,100}Incomplete/i.test(body)) {
    return 'available';
  }
  return undefined;
}

function utcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Mark daily/weekly activities complete when ARP Log already shows the earn.
 * Control Center often omits Discord Poll and renamed the login calendar UI.
 */
export function applyArpLogActivityCaps(
  caps: ActivityCapState,
  arpLog: ArpLogState | undefined,
  now = new Date(),
): ActivityCapState {
  if (!arpLog || arpLog.recent.length === 0) {
    return caps;
  }
  const today = utcDateString(now);
  const next: ActivityCapState = { ...caps };
  const todaysActions = arpLog.recent.filter((entry) => entry.date === today);

  if (
    todaysActions.some((entry) => /Daily Login Calendar/i.test(entry.action))
  ) {
    next.dailyCalendar = 'capped';
  }
  const pollStartDate = utcDateString(lastDiscordPollPostAt(now));
  const hasVotedThisPoll = arpLog.recent.some(
    (entry) =>
      /Discord Poll/i.test(entry.action) &&
      entry.date !== undefined &&
      entry.date >= pollStartDate,
  );
  if (hasVotedThisPoll) {
    next.discordPoll = 'capped';
  } else if (next.discordPoll === 'unknown') {
    // CC often omits Discord Poll. A poll posted at weekday 16:00 UTC may
    // still be open (cutoff unconfirmed) — show it until ARP Log records a vote.
    next.discordPoll = 'available';
  }
  return next;
}

/**
 * Best-effort Control Center activity cap detection.
 * Unknown → treat as still available when scoring.
 */
export function scrapeControlCenterCapsFromDocument(
  document_: Document,
): Partial<ActivityCapState> {
  const body = pageText(document_);
  const caps: Partial<ActivityCapState> = {};

  const timeOnSite = readTimeOnSiteCap(body);
  if (timeOnSite) {
    caps.timeOnSite = timeOnSite;
  }
  const watchTwitch = readWatchTwitchCapFromDocument(document_);
  if (watchTwitch) {
    caps.watchTwitch = watchTwitch;
  }
  const steamQuests = readSteamQuestsCapFromDocument(document_);
  if (steamQuests) {
    caps.steamQuests = steamQuests;
  }
  const dailyCalendar = readDailyCalendarCapFromDocument(document_);
  if (dailyCalendar) {
    caps.dailyCalendar = dailyCalendar;
  }
  const discordPoll = readDiscordPollCap(body);
  if (discordPoll) {
    caps.discordPoll = discordPoll;
  }
  const dailyQuests = readDailyQuestsCapFromDocument(document_);
  if (dailyQuests) {
    caps.dailyQuests = dailyQuests;
  }

  const liveEvent = scrapeLiveCommunityEventBanner(document_);
  caps.steamCommunityEvent = liveEvent ? 'available' : 'capped';

  return caps;
}

/**
 * LIVE Steam Community Event banner on Control Center (href + title).
 */
export function scrapeLiveCommunityEventBanner(
  document_: Document,
): { url: string; title?: string } | undefined {
  const bannerLink =
    document_.querySelector<HTMLAnchorElement>(
      ':scope a.community-event-banner',
    ) ??
    document_.querySelector<HTMLAnchorElement>(
      ":scope .community-event-banner a[href*='/steam/community-event/']",
    ) ??
    [
      ...document_.querySelectorAll<HTMLAnchorElement>(
        ":scope a[href*='/steam/community-event/']",
      ),
    ].find((link) => /LIVE/i.test(link.textContent ?? ''));

  if (!bannerLink?.href) {
    return undefined;
  }
  const path = bannerLink.pathname || bannerLink.getAttribute('href') || '';
  if (!path.includes('/steam/community-event/')) {
    return undefined;
  }
  const title = bannerLink.textContent?.replaceAll(/\s+/g, ' ').trim();
  const result: { url: string; title?: string } = { url: path };
  if (title) {
    result.title = title;
  }
  return result;
}

/**
 * True when a milestone can still auto-award: not awarded yet, has ARP, and at
 * least one of the two gates is already satisfied. Award fires when both are.
 */
export function isCommunityEventMilestonePending(
  milestone: CommunityEventMilestone,
  personalHours: number,
): boolean {
  if (milestone.isAwarded || milestone.arpReward <= 0) {
    return false;
  }
  const isPersonalMet = milestone.personalHoursRequired <= personalHours;
  return isPersonalMet || milestone.isCommunityUnlocked;
}

export function computePendingCommunityEventArp(
  personalHours: number,
  milestones: CommunityEventMilestone[],
): number {
  return milestones
    .filter((milestone) =>
      isCommunityEventMilestonePending(milestone, personalHours),
    )
    .reduce((sum, milestone) => sum + milestone.arpReward, 0);
}

export interface CommunityEventPendingBreakdown {
  /**
  Both gates appear met but not yet marked awarded — usually scrape lag; award
  should already be in flight. Do not treat as future earnable ARP.
  */
  imminentArp: number;
  /**
  Personal hours met; still waiting on community unlock. Award fires when the
  community catches up (ETA from ASCE hourly history when available).
  */
  waitingCommunityArp: number;
  /**
  Community unlocked; personal hours not met yet. Player controls when this
  grants by playing more — equip All-ARP% before grinding those hours.
  */
  waitingPersonalArp: number;
  pendingCount: number;
}

/**
 * Split pending community-event ARP by which gate is still open.
 *
 * Scoring: `waitingPersonalArp` is player-controlled (play more hours after
 * community unlock). `waitingCommunityArp` is scored when ASCE ETA is inside
 * the 24h slot lock — you'll still be wearing that combo when it grants.
 * Unknown ETA stays unscored (UI warning only). `imminentArp` should already
 * be awarded.
 */
export function breakDownCommunityEventPending(
  event: CommunityEventState,
): CommunityEventPendingBreakdown {
  let imminentArp = 0;
  let waitingCommunityArp = 0;
  let waitingPersonalArp = 0;
  let pendingCount = 0;

  for (const milestone of event.milestones) {
    if (!isCommunityEventMilestonePending(milestone, event.personalHours)) {
      continue;
    }
    pendingCount += 1;
    const isPersonalMet =
      milestone.personalHoursRequired <= event.personalHours;
    if (isPersonalMet && milestone.isCommunityUnlocked) {
      imminentArp += milestone.arpReward;
    } else if (isPersonalMet) {
      waitingCommunityArp += milestone.arpReward;
    } else {
      waitingPersonalArp += milestone.arpReward;
    }
  }

  return {
    imminentArp,
    waitingCommunityArp,
    waitingPersonalArp,
    pendingCount,
  };
}

export function describeCommunityEventPending(
  event: CommunityEventState,
): string {
  const { imminentArp, waitingCommunityArp, waitingPersonalArp } =
    breakDownCommunityEventPending(event);
  if (imminentArp <= 0 && waitingCommunityArp <= 0 && waitingPersonalArp <= 0) {
    return 'no unawarded ARP with a gate already met';
  }

  const parts: string[] = [];
  // Actionable first: community already unlocked — play hours with All-ARP%.
  if (waitingPersonalArp > 0) {
    parts.push(`~${waitingPersonalArp} ARP unlocked — play hours to claim`);
  }
  if (waitingCommunityArp > 0) {
    const progress = describeWaitingCommunityProgress(event);
    parts.push(
      progress
        ? `~${waitingCommunityArp} ARP · ${progress}`
        : `~${waitingCommunityArp} ARP on community unlock`,
    );
  }
  if (imminentArp > 0) {
    parts.push(`~${imminentArp} may already be awarding`);
  }
  return parts.join('; ');
}

const COMMUNITY_SAMPLE_MAX = 96;
/**
Debounce rapid reloads when the user is on the event page.
*/
const COMMUNITY_SAMPLE_VISIT_MIN_GAP_MS = 15 * 60 * 1000;
/**
 * Local fallback only: remote scrapes add a rate sample on this cadence when
 * ASCE is unavailable. User visits still sample separately.
 */
export const COMMUNITY_HOURS_REMOTE_SAMPLE_MIN_MS = 60 * 60 * 1000;
const COMMUNITY_RATE_MIN_SPAN_MS = 15 * 60 * 1000;
const COMMUNITY_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const COMMUNITY_TREND_WINDOW_MS = 48 * 60 * 60 * 1000;
/**
 * Each half of the 48h window must be at least this long to trust a ratio.
 */
const COMMUNITY_TREND_HALF_MIN_MS = 18 * 60 * 60 * 1000;
const COMMUNITY_RATIO_MIN = 0.5;
const COMMUNITY_RATIO_MAX = 2;
/**
 * When the last two days are fading, only apply this fraction of the observed
 * decay. Shorter ETA = users swap artifacts before the gate, not after.
 * Growth is applied in full so a late push does not sneak up.
 */
const COMMUNITY_DECAY_TRUST = 0.5;
const COMMUNITY_RATIO_FLAT_EPS = 0.03;
/**
Ignore absurd rates (scrapes across events / bad data).
*/
const COMMUNITY_MAX_HOURS_PER_DAY = 80_000;

export type CommunityHoursSampleSource = 'visit' | 'remote';

/**
 * Drop live progress + sample history once an event ends (keeps awarded /
 * milestone snapshot for ARP-log reconciliation until the next event).
 */
export function markCommunityEventEnded(
  event: CommunityEventState,
): CommunityEventState {
  return {
    scrapedAt: event.scrapedAt,
    url: event.url,
    isLive: false,
    personalHours: event.personalHours,
    milestones: event.milestones,
    pendingArp: 0,
    awardedArp: event.awardedArp,
    ...(event.title !== undefined && { title: event.title }),
    ...(event.receivedArpFromLog !== undefined && {
      receivedArpFromLog: event.receivedArpFromLog,
    }),
  };
}

function shouldSkipCommunityHoursSample(options: {
  source: CommunityHoursSampleSource;
  gapMs: number;
  hours: number;
  lastHours: number;
}): boolean {
  const { source, gapMs, hours, lastHours } = options;
  if (source === 'remote') {
    // Remote: fixed minimum interval only.
    return gapMs < COMMUNITY_HOURS_REMOTE_SAMPLE_MIN_MS;
  }
  // Visit: skip unchanged duplicates within a short debounce.
  return gapMs < COMMUNITY_SAMPLE_VISIT_MIN_GAP_MS && hours === lastHours;
}

/**
 * Append a community-hours sample when progress moved or enough time passed.
 * Resets history if hours drop sharply (new event / bad scrape).
 */
export function appendCommunityHoursSample(
  samples: CommunityHoursSample[],
  hours: number,
  atIso = new Date().toISOString(),
  source: CommunityHoursSampleSource = 'visit',
): CommunityHoursSample[] {
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(hours) || hours < 0 || Number.isNaN(atMs)) {
    return samples;
  }

  const next = [...samples];
  const last = next.at(-1);
  if (last) {
    // New event or reset — start fresh.
    if (hours + 1 < last.hours) {
      return [{ at: atIso, hours }];
    }

    const lastMs = Date.parse(last.at);
    if (
      Number.isFinite(lastMs) &&
      shouldSkipCommunityHoursSample({
        source,
        gapMs: atMs - lastMs,
        hours,
        lastHours: last.hours,
      })
    ) {
      return next;
    }
  }

  next.push({ at: atIso, hours });
  if (next.length > COMMUNITY_SAMPLE_MAX) {
    return next.slice(-COMMUNITY_SAMPLE_MAX);
  }
  return next;
}

/**
 * Merge a fresh scrape with prior event state (keeps sample history while live).
 * Pass `source: 'visit'` for real page navigations; `'remote'` for background
 * fetches (samples only on the remote minimum interval).
 */
function isSparseCommunityEventScrape(
  scraped: CommunityEventState,
  previous: CommunityEventState | undefined,
): boolean {
  return (
    previous?.isLive === true &&
    previous.milestones.length > 0 &&
    scraped.milestones.length === 0
  );
}

export function mergeCommunityEventScrape(
  scraped: CommunityEventState,
  previous: CommunityEventState | undefined,
  options: { source?: CommunityHoursSampleSource } = {},
): CommunityEventState {
  if (previous && isSparseCommunityEventScrape(scraped, previous)) {
    return previous;
  }
  return mergeLiveCommunityEventScrape(scraped, previous, options);
}

function mergeLiveCommunityEventScrape(
  scraped: CommunityEventState,
  previous: CommunityEventState | undefined,
  options: { source?: CommunityHoursSampleSource } = {},
): CommunityEventState {
  if (!scraped.isLive) {
    return markCommunityEventEnded(
      previous?.url === scraped.url
        ? { ...previous, ...scraped, isLive: false, pendingArp: 0 }
        : scraped,
    );
  }

  const source = options.source ?? 'visit';
  const sameEvent =
    previous &&
    previous.isLive &&
    (previous.url === scraped.url ||
      (previous.title !== undefined &&
        scraped.title !== undefined &&
        previous.title === scraped.title));

  const hasAsceHistory =
    Boolean(sameEvent) && previous?.communityHoursSource === 'asce';
  let samples = sameEvent ? [...(previous.communityHoursSamples ?? [])] : [];
  if (!hasAsceHistory && scraped.communityHours !== undefined) {
    samples = appendCommunityHoursSample(
      samples,
      scraped.communityHours,
      scraped.scrapedAt,
      source,
    );
  }

  const merged: CommunityEventState = {
    ...scraped,
  };
  if (samples.length > 0) {
    merged.communityHoursSamples = samples;
  }
  if (hasAsceHistory) {
    merged.communityHoursSource = 'asce';
  }
  return carryForwardCommunityEventFields(merged, previous, Boolean(sameEvent));
}

function carryForwardCommunityEventFields(
  merged: CommunityEventState,
  previous: CommunityEventState | undefined,
  isSameEvent: boolean,
): CommunityEventState {
  const next = { ...merged };
  if (
    previous &&
    isSameEvent &&
    merged.personalHours <= 0 &&
    previous.personalHours > 0
  ) {
    next.personalHours = previous.personalHours;
    next.pendingArp = computePendingCommunityEventArp(
      previous.personalHours,
      merged.milestones,
    );
  }
  const shouldKeepPlayEligible =
    next.personalHours > 0 ||
    (isSameEvent &&
      previous?.playEligibility === 'eligible' &&
      merged.playEligibility !== 'ineligible');
  if (shouldKeepPlayEligible) {
    next.playEligibility = 'eligible';
  }
  if (
    isSameEvent &&
    previous?.communityHoursSource === 'asce' &&
    previous.communityHours !== undefined &&
    (next.communityHours === undefined ||
      next.communityHours < previous.communityHours)
  ) {
    next.communityHours = previous.communityHours;
    next.communityHoursSource = 'asce';
  }
  if (next.steamAppId === undefined && previous?.steamAppId !== undefined) {
    next.steamAppId = previous.steamAppId;
  }
  if (next.isFree === undefined && previous?.isFree !== undefined) {
    next.isFree = previous.isFree;
  }
  return next;
}

export interface CommunityUnlockEstimate {
  targetHours: number;
  hoursRemaining: number;
  hoursPerDay: number;
  etaMs: number;
  sampleCount: number;
}

/**
 * Next community-hour gate for ARP still waiting on community unlock
 * (personal hours already met).
 */
export function nextCommunityUnlockTarget(
  event: CommunityEventState,
): number | undefined {
  const waiting = event.milestones
    .filter((milestone) => {
      if (milestone.isAwarded || milestone.arpReward <= 0) {
        return false;
      }
      if (milestone.personalHoursRequired > event.personalHours) {
        return false;
      }
      return !milestone.isCommunityUnlocked;
    })
    .toSorted(
      (left, right) =>
        (left.communityHoursRequired ?? Number.POSITIVE_INFINITY) -
        (right.communityHoursRequired ?? Number.POSITIVE_INFINITY),
    );
  return waiting[0]?.communityHoursRequired;
}

/**
 * Estimate time until the next waiting-on-community ARP milestone unlocks,
 * using ASCE hourly samples when present (local visit samples as fallback).
 *
 * Pace is the trailing 24h (not lifetime — launch day would make ETA too
 * early). A 48h day-over-day ratio adapts to fade vs a late push without
 * assuming a curve. Decay is half-trusted so the ETA stays on the early
 * side and users have time to swap artifacts.
 */
export function estimateCommunityUnlockAt(
  event: CommunityEventState,
  targetHours: number,
  nowMs = Date.now(),
): CommunityUnlockEstimate | undefined {
  const currentHours = event.communityHours;
  if (currentHours === undefined) {
    return undefined;
  }
  const hoursRemaining = targetHours - currentHours;
  if (hoursRemaining <= 0) {
    return {
      targetHours,
      hoursRemaining: 0,
      hoursPerDay: 0,
      etaMs: 0,
      sampleCount: event.communityHoursSamples?.length ?? 0,
    };
  }

  const samples = event.communityHoursSamples ?? [];
  const rate = estimateCommunityHoursPerMs(samples, nowMs);
  if (rate === undefined || rate <= 0) {
    return undefined;
  }

  const hoursPerDay = rate * 86_400_000;
  if (hoursPerDay > COMMUNITY_MAX_HOURS_PER_DAY) {
    return undefined;
  }

  const end = samples.at(-1);
  const measuredRatio = end
    ? communityDayOverDayRatio(samples, end)
    : undefined;
  const ratio =
    measuredRatio === undefined ? 1 : optimisticCommunityRatio(measuredRatio);

  return {
    targetHours,
    hoursRemaining,
    hoursPerDay,
    etaMs: communityEtaMs(hoursRemaining, rate, ratio),
    sampleCount: samples.length,
  };
}

export function estimateNextCommunityUnlock(
  event: CommunityEventState,
  nowMs = Date.now(),
): CommunityUnlockEstimate | undefined {
  const targetHours = nextCommunityUnlockTarget(event);
  if (targetHours === undefined) {
    return undefined;
  }
  return estimateCommunityUnlockAt(event, targetHours, nowMs);
}

function parseCommunitySampleMs(
  sample: CommunityHoursSample,
): number | undefined {
  const ms = Date.parse(sample.at);
  return Number.isFinite(ms) ? ms : undefined;
}

function sampleAtOrBefore(
  samples: CommunityHoursSample[],
  tMs: number,
): CommunityHoursSample | undefined {
  let best: CommunityHoursSample | undefined;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    const ms = parseCommunitySampleMs(sample);
    if (ms !== undefined && ms <= tMs && ms >= bestMs) {
      best = sample;
      bestMs = ms;
    }
  }
  return best;
}

function communityHoursPerMsBetween(
  start: CommunityHoursSample,
  end: CommunityHoursSample,
): number | undefined {
  const startMs = parseCommunitySampleMs(start);
  const endMs = parseCommunitySampleMs(end);
  if (
    startMs === undefined ||
    endMs === undefined ||
    endMs - startMs < 2 * 60 * 1000
  ) {
    return undefined;
  }
  const deltaHours = end.hours - start.hours;
  if (deltaHours <= 0) {
    return undefined;
  }
  return deltaHours / (endMs - startMs);
}

/**
 * Trailing 24h when history is long enough; otherwise the full available
 * span (new events) or the last two points.
 */
function estimateCommunityHoursPerMs(
  samples: CommunityHoursSample[],
  nowMs: number,
): number | undefined {
  if (samples.length < 2) {
    return undefined;
  }

  const end = samples.at(-1);
  if (!end) {
    return undefined;
  }
  const endMs = parseCommunitySampleMs(end);
  if (endMs === undefined || nowMs - endMs > 3 * 86_400_000) {
    return undefined;
  }

  const windowStart = sampleAtOrBefore(
    samples,
    endMs - COMMUNITY_RATE_WINDOW_MS,
  );
  const fromWindow = windowStart
    ? communityHoursPerMsBetween(windowStart, end)
    : undefined;
  if (fromWindow !== undefined) {
    return fromWindow;
  }

  const first = samples.at(0);
  if (first && first !== end) {
    const fromHistory = communityHoursPerMsBetween(first, end);
    if (fromHistory !== undefined) {
      const startMs = parseCommunitySampleMs(first);
      if (
        startMs !== undefined &&
        endMs - startMs >= COMMUNITY_RATE_MIN_SPAN_MS
      ) {
        return fromHistory;
      }
    }
  }

  const previous = samples.at(-2);
  return previous ? communityHoursPerMsBetween(previous, end) : undefined;
}

function communityDayOverDayRatio(
  samples: CommunityHoursSample[],
  end: CommunityHoursSample,
): number | undefined {
  const endMs = parseCommunitySampleMs(end);
  if (endMs === undefined) {
    return undefined;
  }
  const mid = sampleAtOrBefore(samples, endMs - COMMUNITY_RATE_WINDOW_MS);
  const start = sampleAtOrBefore(samples, endMs - COMMUNITY_TREND_WINDOW_MS);
  if (!mid || !start || start === mid || mid === end) {
    return undefined;
  }
  const midMs = parseCommunitySampleMs(mid);
  const startMs = parseCommunitySampleMs(start);
  if (
    midMs === undefined ||
    startMs === undefined ||
    endMs - midMs < COMMUNITY_TREND_HALF_MIN_MS ||
    midMs - startMs < COMMUNITY_TREND_HALF_MIN_MS
  ) {
    return undefined;
  }
  const recent = communityHoursPerMsBetween(mid, end);
  const previous = communityHoursPerMsBetween(start, mid);
  if (recent === undefined || previous === undefined || previous <= 0) {
    return undefined;
  }
  const ratio = recent / previous;
  if (!Number.isFinite(ratio)) {
    return undefined;
  }
  return Math.min(COMMUNITY_RATIO_MAX, Math.max(COMMUNITY_RATIO_MIN, ratio));
}

function optimisticCommunityRatio(measured: number): number {
  if (measured >= 1) {
    return measured;
  }
  return 1 - (1 - measured) * COMMUNITY_DECAY_TRUST;
}

/**
 * Linear when the ratio is ~1. Otherwise integrate R0 * r^(t/day).
 * If fade is too steep to ever hit the target, fall back to linear so we
 * still warn early instead of implying "never".
 */
function communityEtaMs(
  remainingHours: number,
  ratePerMs: number,
  dailyRatio: number,
): number {
  const linearMs = remainingHours / ratePerMs;
  if (Math.abs(dailyRatio - 1) < COMMUNITY_RATIO_FLAT_EPS) {
    return linearMs;
  }
  const ratePerDay = ratePerMs * 86_400_000;
  const lnRatio = Math.log(dailyRatio);
  const root = 1 + (remainingHours * lnRatio) / ratePerDay;
  if (root <= 0) {
    return linearMs;
  }
  const days = Math.log(root) / lnRatio;
  if (!Number.isFinite(days) || days <= 0) {
    return linearMs;
  }
  return days * 86_400_000;
}

export function formatCommunityEta(etaMs: number): string {
  if (etaMs <= 0) {
    return 'now';
  }
  const totalMinutes = Math.round(etaMs / 60_000);
  if (totalMinutes < 60) {
    return `~${Math.max(1, totalMinutes)}m`;
  }
  const totalHours = Math.round(etaMs / 3_600_000);
  if (totalHours < 48) {
    return `~${totalHours}h`;
  }
  const days = totalHours / 24;
  return `~${days.toFixed(1)}d`;
}

/**
 * Compact community progress for unlock ETA, e.g. "65,184/75,000h · ETA ~18h".
 * Empty when we have nothing useful to show.
 */
export function describeWaitingCommunityProgress(
  event: CommunityEventState,
): string {
  const eta = estimateNextCommunityUnlock(event);
  const target = eta?.targetHours ?? nextCommunityUnlockTarget(event);
  const parts: string[] = [];

  if (target !== undefined && event.communityHours !== undefined) {
    parts.push(
      `${Math.round(event.communityHours).toLocaleString()}/${target.toLocaleString()}h`,
    );
  } else if (event.communityHours !== undefined) {
    parts.push(`${Math.round(event.communityHours).toLocaleString()}h`);
  }

  if (eta) {
    parts.push(`ETA ${formatCommunityEta(eta.etaMs)}`);
  }

  return parts.join(' · ');
}

export function computeAwardedCommunityEventArp(
  milestones: CommunityEventMilestone[],
): number {
  return milestones
    .filter((milestone) => milestone.isAwarded && milestone.arpReward > 0)
    .reduce((sum, milestone) => sum + milestone.arpReward, 0);
}

export function isCommunityEventRewardAction(action: string): boolean {
  return /Steam Community Event Reward/i.test(action);
}

export function sumCommunityEventRewardsFromArpLog(
  arpLog: ArpLogState | undefined,
): number {
  if (!arpLog) {
    return 0;
  }
  return arpLog.recent
    .filter((entry) => isCommunityEventRewardAction(entry.action))
    .reduce((sum, entry) => sum + entry.arp, 0);
}

/**
 * Cross-check event-page award flags against ARP Log receipts.
 * Marks personal-met milestones as awarded when log ARP still accounts for
 * their base reward (handles stale scrapes / missing Community Unlocked flags).
 * Receipt in the log implies both gates were met at award time.
 */
export function reconcileCommunityEventWithArpLog(
  event: CommunityEventState,
  arpLog: ArpLogState | undefined,
): CommunityEventState {
  const receivedArpFromLog = sumCommunityEventRewardsFromArpLog(arpLog);
  const milestones = event.milestones
    .map((milestone) => ({
      ...milestone,
      isCommunityUnlocked: milestone.isCommunityUnlocked || milestone.isAwarded,
    }))
    .toSorted((left, right) => left.index - right.index);

  let remainingReceived = receivedArpFromLog;
  for (const milestone of milestones) {
    if (milestone.isAwarded && milestone.arpReward > 0) {
      remainingReceived = Math.max(0, remainingReceived - milestone.arpReward);
    }
  }

  for (const milestone of milestones) {
    if (
      milestone.isAwarded ||
      milestone.arpReward <= 0 ||
      milestone.personalHoursRequired > event.personalHours ||
      remainingReceived < milestone.arpReward
    ) {
      continue;
    }
    // Log receipt means the milestone already auto-awarded (both gates were met).
    milestone.isAwarded = true;
    milestone.isCommunityUnlocked = true;
    remainingReceived -= milestone.arpReward;
  }

  const next: CommunityEventState = {
    ...event,
    milestones,
    pendingArp: computePendingCommunityEventArp(
      event.personalHours,
      milestones,
    ),
    awardedArp: computeAwardedCommunityEventArp(milestones),
  };
  if (receivedArpFromLog > 0) {
    next.receivedArpFromLog = receivedArpFromLog;
  }
  return next;
}

function parseLabeledHours(text: string, label: string): number | undefined {
  const marker = `${label}: `;
  const start = text.indexOf(marker);
  if (start === -1) {
    return undefined;
  }
  const slice = text.slice(start + marker.length);
  const match = /^([\d.]+)/.exec(slice);
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseLeadingCount(text: string, unit: string): number | undefined {
  const unitIndex = text.indexOf(` ${unit}`);
  if (unitIndex === -1) {
    return undefined;
  }
  const before = text.slice(0, unitIndex).trim();
  const token = before.split(' ').pop();
  const value = token ? Number(token) : Number.NaN;
  return Number.isFinite(value) ? value : undefined;
}

function parseMilestoneCell(
  cell: Element,
): CommunityEventMilestone | undefined {
  const text = cell.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '';
  const milestoneMarker = text.indexOf('Milestone ');
  if (milestoneMarker === -1) {
    return undefined;
  }
  const index = Number(
    text.slice(milestoneMarker + 'Milestone '.length).split(' ', 1)[0],
  );
  if (!Number.isFinite(index)) {
    return undefined;
  }

  const personalHoursRequired = parseLabeledHours(text, 'Personal') ?? 0;
  const communityHours = parseLabeledHours(text, 'Community');
  const arpReward = parseLeadingCount(text, 'ARP') ?? 0;
  const fragmentCount = parseLeadingCount(text, 'Fragment');
  const heading =
    cell.querySelector(':scope h3')?.textContent?.trim() ||
    cell.querySelector(':scope img[alt]')?.getAttribute('alt') ||
    (arpReward > 0 ? `${arpReward} ARP` : 'Reward');

  const milestone: CommunityEventMilestone = {
    index,
    personalHoursRequired,
    arpReward,
    rewardLabel: heading,
    isCommunityUnlocked: /Community Unlocked/i.test(text),
    isAwarded: /\bAwarded\b/i.test(text),
  };
  if (communityHours !== undefined) {
    milestone.communityHoursRequired = communityHours;
  }
  if (fragmentCount !== undefined && arpReward <= 0) {
    milestone.rewardLabel = `${fragmentCount} Fragments`;
  }
  return milestone;
}

/**
 * Event pages fill `#personal-hours` client-side from an inline
 * `personalPlaytime` value (minutes). Static fetch HTML leaves the span empty,
 * so prefer DOM text when present, otherwise parse the script minutes.
 */
export function parseCommunityEventPersonalHours(document_: Document): number {
  const hoursFromDom = document_
    .querySelector('#personal-hours')
    ?.textContent?.trim();
  if (hoursFromDom && /\d/.test(hoursFromDom)) {
    const fromDom = Number(hoursFromDom);
    if (Number.isFinite(fromDom)) {
      return fromDom;
    }
  }

  const body = pageText(document_);
  const hoursFromText = /Your Total Hours:\s*([\d.]+)/i.exec(body)?.[1];
  if (hoursFromText) {
    const fromText = Number(hoursFromText);
    if (Number.isFinite(fromText)) {
      return fromText;
    }
  }

  // Server-rendered into page JS: `let personalPlaytime = 489;` (minutes).
  const scriptSource = [...document_.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent ?? '')
    .join('\n');
  const minutesMatch =
    /personalPlaytime\s*=\s*(\d+)/i.exec(scriptSource) ??
    /personalPlaytime\s*=\s*(\d+)/i.exec(body);
  if (minutesMatch?.[1]) {
    return Math.floor(Number(minutesMatch[1]) / 60);
  }

  return 0;
}

function isAsciiWhitespace(char: string): boolean {
  return ' \t\n\r\f\v'.includes(char);
}

function trailingNumberToken(value: string): string | undefined {
  let end = value.length;
  while (end > 0 && isAsciiWhitespace(value[end - 1] ?? '')) {
    end -= 1;
  }
  let start = end;
  while (start > 0) {
    const char = value[start - 1] ?? '';
    if (char === ',' || (char >= '0' && char <= '9')) {
      start -= 1;
      continue;
    }
    break;
  }
  if (start === end) {
    return undefined;
  }
  return value.slice(start, end);
}

function leadingNumberToken(value: string): string | undefined {
  let start = 0;
  while (start < value.length && isAsciiWhitespace(value[start] ?? '')) {
    start += 1;
  }
  let end = start;
  while (end < value.length) {
    const char = value[end] ?? '';
    if (char === ',' || (char >= '0' && char <= '9')) {
      end += 1;
      continue;
    }
    break;
  }
  if (start === end) {
    return undefined;
  }
  return value.slice(start, end);
}

/**
 * Live progress bar text, e.g. "62160 of 100000 hour(s)".
 */
function parseHoursOfCap(text: string):
  | {
      hours: number;
      cap: number;
    }
  | undefined {
  const lower = text.toLowerCase();
  const hourIndex = lower.indexOf('hour');
  if (hourIndex === -1) {
    return undefined;
  }

  const beforeHour = text.slice(0, hourIndex);
  let leftRaw: string | undefined;
  let rightRaw: string | undefined;

  const ofIndex = beforeHour.toLowerCase().lastIndexOf(' of ');
  if (ofIndex === -1) {
    const slashIndex = beforeHour.lastIndexOf('/');
    if (slashIndex === -1) {
      return undefined;
    }
    leftRaw = beforeHour.slice(0, slashIndex);
    rightRaw = beforeHour.slice(slashIndex + 1);
  } else {
    leftRaw = beforeHour.slice(0, ofIndex);
    rightRaw = beforeHour.slice(ofIndex + 4);
  }

  const leftToken = trailingNumberToken(leftRaw);
  const rightToken = leadingNumberToken(rightRaw);
  if (!leftToken || !rightToken) {
    return undefined;
  }

  const hours = Number(leftToken.replaceAll(',', ''));
  const cap = Number(rightToken.replaceAll(',', ''));
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(cap) ||
    hours < 0 ||
    cap <= 0
  ) {
    return undefined;
  }

  return { hours, cap };
}

export function parseCommunityEventProgress(document_: Document): {
  communityHours?: number;
  communityHoursCap?: number;
} {
  const candidates = [
    ...document_.querySelectorAll('b, strong, .progress, .event-progress'),
  ].map((node) => node.textContent?.trim() ?? '');
  candidates.push(pageText(document_));

  for (const text of candidates) {
    const parsed = parseHoursOfCap(text);
    if (!parsed) {
      continue;
    }
    return {
      communityHours: parsed.hours,
      communityHoursCap: parsed.cap,
    };
  }
  return {};
}

function parseCommunityEventTitleFromDocumentTitle(
  documentTitle: string,
): string | undefined {
  const prefixMatch = /Steam Community Event\s*[-–]\s*/i.exec(documentTitle);
  if (!prefixMatch) {
    return undefined;
  }

  let title = documentTitle
    .slice(prefixMatch.index + prefixMatch[0].length)
    .trim();
  const pipeIndex = title.lastIndexOf('|');
  if (pipeIndex !== -1) {
    const suffix = title.slice(pipeIndex + 1).trim();
    if (suffix.toLowerCase() === 'alienware arena') {
      title = title.slice(0, pipeIndex).trim();
    }
  }

  return title.length > 0 ? title : undefined;
}

function parseCommunityEventTitle(document_: Document): string | undefined {
  const documentTitle = document_.title?.replaceAll(/\s+/g, ' ').trim() ?? '';
  const fromDocumentTitle =
    parseCommunityEventTitleFromDocumentTitle(documentTitle);
  if (fromDocumentTitle) {
    return fromDocumentTitle;
  }

  const fromEventLabel = document_
    .querySelector(
      '.event-title-date, :scope .community-event-view .event-name',
    )
    ?.textContent?.replaceAll(/\s+/g, ' ')
    .trim();
  if (fromEventLabel) {
    return fromEventLabel;
  }

  return undefined;
}

/**
 * Parse a LIVE Steam Community Event page (carousel milestone cards).
 * Pending ARP = not yet awarded, and personal hours and/or community unlock
 * already met (auto-awards when both gates are true).
 */
export function scrapeCommunityEventFromDocument(
  document_: Document,
  url: string,
): CommunityEventState {
  const body = pageText(document_);
  const personalHours = parseCommunityEventPersonalHours(document_);
  const isLive =
    body.includes('This event is LIVE') || /\bLIVE\b/.test(body.slice(0, 500));

  const milestones: CommunityEventMilestone[] = [];
  for (const cell of document_.querySelectorAll('.carousel-cell')) {
    const milestone = parseMilestoneCell(cell);
    if (milestone) {
      milestones.push(milestone);
    }
  }

  milestones.sort((left, right) => left.index - right.index);

  const titleMatch = parseCommunityEventTitle(document_);

  const safeHours = Number.isFinite(personalHours) ? personalHours : 0;
  const progress = parseCommunityEventProgress(document_);
  const playEligibility = scrapeSteamPlayEligibilityFromDocument(document_, {
    personalHours: safeHours,
  });
  const steamAppId = scrapeSteamAppIdFromDocument(document_);
  const state: CommunityEventState = {
    scrapedAt: new Date().toISOString(),
    url,
    isLive,
    personalHours: safeHours,
    milestones,
    pendingArp: computePendingCommunityEventArp(safeHours, milestones),
    awardedArp: computeAwardedCommunityEventArp(milestones),
    playEligibility,
  };
  if (steamAppId !== undefined) {
    state.steamAppId = steamAppId;
  }
  if (titleMatch) {
    state.title = titleMatch;
  }
  if (progress.communityHours !== undefined) {
    state.communityHours = progress.communityHours;
  }
  if (progress.communityHoursCap !== undefined) {
    state.communityHoursCap = progress.communityHoursCap;
  }
  return state;
}

export function scrapeCommunityEvent(): CommunityEventState | undefined {
  if (!location.pathname.includes('/steam/community-event')) {
    return undefined;
  }
  return scrapeCommunityEventFromDocument(document, location.pathname);
}

export function scrapeControlCenterCaps(): Partial<ActivityCapState> {
  return scrapeControlCenterCapsFromDocument(document);
}

function isListPriceVaultClaim(game: GameVaultItem): boolean {
  return game.isAuction !== true;
}

function isVaultTierMet(
  game: GameVaultItem,
  userTier: number | undefined,
): boolean {
  if (userTier === undefined || game.minTier === undefined) {
    return true;
  }
  return userTier >= game.minTier;
}

export function vaultPayArp(price: number, discountPct = 0): number {
  const pct = Math.min(1, Math.max(0, discountPct));
  return Math.ceil(price * (1 - pct) - 1e-9);
}

export function vaultGamePayArp(game: GameVaultItem, discountPct = 0): number {
  return vaultPayArp(game.price, discountPct);
}

export function canAffordVaultPrice(
  redeemableArp: number | undefined,
  payArp: number,
): boolean {
  if (redeemableArp === undefined) {
    return true;
  }
  return redeemableArp >= payArp;
}

function isPostedListPriceVaultGame(game: GameVaultItem): boolean {
  return game.inStock && isListPriceVaultClaim(game);
}

/**
Posted list-price vault game this user could buy: in stock, tier, enough ARP.
Does not require the vault to be open yet (`purchasable` is false during countdown).
`availableArp` defaults to current redeemable; pass current + remaining-window
earnings to include quests still left today. Unknown ARP/tier does not exclude.
*/
export function isAffordableVaultOffer(
  game: GameVaultItem,
  state: Pick<SiteState, 'userArpTier' | 'arpLog'>,
  discountPct = 0,
  availableArp: number | undefined = state.arpLog?.redeemableArp,
): boolean {
  if (!isPostedListPriceVaultGame(game)) {
    return false;
  }
  if (!isVaultTierMet(game, state.userArpTier)) {
    return false;
  }
  return canAffordVaultPrice(availableArp, vaultGamePayArp(game, discountPct));
}

export function hasPostedListPriceVaultGames(state: SiteState): boolean {
  return state.gameVault.some((game) => isPostedListPriceVaultGame(game));
}

export function canAffordAnyVaultOffer(
  state: SiteState,
  discountPct = 0,
  availableArp: number | undefined = state.arpLog?.redeemableArp,
): boolean {
  return state.gameVault.some((game) =>
    isAffordableVaultOffer(game, state, discountPct, availableArp),
  );
}

/**
In-stock list-price vault game this user can claim right now: purchasable +
tier + enough redeemable ARP. `discountPct` is the market % off they would pay.
*/
export function isClaimableVaultGame(
  game: GameVaultItem,
  state: Pick<SiteState, 'userArpTier' | 'arpLog'>,
  discountPct = 0,
): boolean {
  return (
    game.purchasable === true &&
    isAffordableVaultOffer(game, state, discountPct)
  );
}

function isVaultStockForUser(
  game: GameVaultItem,
  userTier: number | undefined,
): boolean {
  return (
    game.purchasable === true &&
    isListPriceVaultClaim(game) &&
    isVaultTierMet(game, userTier)
  );
}

/**
True while this user still has an in-stock list-price Game Vault claim
(tier only — ARP is checked separately). Stock can run out at any time.
*/
export function isGameVaultStockOpen(state: SiteState): boolean {
  return state.gameVault.some((game) =>
    isVaultStockForUser(game, state.userArpTier),
  );
}

/**
True while this user still has an in-stock list-price Game Vault claim they
can afford right now (optionally after market discount).
*/
export function isGameVaultCurrentlyOpen(
  state: SiteState,
  discountPct = 0,
): boolean {
  return state.gameVault.some((game) =>
    isClaimableVaultGame(game, state, discountPct),
  );
}

/**
Logout/relogin slack so a lock lifting at open still counts as missing the start.
*/
export const GAME_VAULT_EQUIP_BUFFER_MS = 30 * 60 * 1000;

/**
Stable id for this vault rotation (countdown ISO, kept after open).
*/
export function gameVaultCycleId(state: SiteState): string | undefined {
  if (state.gameVaultOpensAt) {
    return state.gameVaultOpensAt;
  }
  if (isGameVaultStockOpen(state)) {
    return 'open';
  }
  return undefined;
}

export function gameVaultOpensAtMs(state: SiteState): number | undefined {
  const opensAt = parseTimestamp(state.gameVaultOpensAt);
  return Number.isFinite(opensAt) ? opensAt : undefined;
}

/**
True when slots stay locked past vault open, so discount gear cannot be equipped in time.
*/
export function willMissDiscountEquipBeforeOpen(
  lockUntilMs: number,
  state: SiteState,
  now = Date.now(),
): boolean {
  const opensAt = gameVaultOpensAtMs(state);
  if (opensAt === undefined || opensAt <= now) {
    return false;
  }
  return lockUntilMs + GAME_VAULT_EQUIP_BUFFER_MS > opensAt;
}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return Number.NaN;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

export function gameVaultCatalogPrice(
  state: SiteState,
  discountPct = 0,
): number {
  const buyable = state.gameVault.find((game) =>
    isClaimableVaultGame(game, state, discountPct),
  );
  return buyable?.price ?? 0;
}

export function scrapeGameVaultTimerMsFromDocument(
  document_: Document,
): number | undefined {
  const timer = document_.querySelector<HTMLElement>('#game-vault-timer');
  const raw =
    timer?.dataset.unlockDate ??
    timer?.dataset.endDate ??
    timer?.dataset.lockDate ??
    timer?.dataset.closeDate;
  const ms = parseTimestamp(raw?.trim());
  return Number.isFinite(ms) ? ms : undefined;
}

export function scrapeGameVaultFromDocument(
  document_: Document,
): GameVaultItem[] {
  const items = document_.querySelectorAll<HTMLElement>(
    [
      '.gamevault-marketplace-product[data-product-price]',
      '.marketplace-game-product[data-product-price]',
    ].join(', '),
  );

  const result: GameVaultItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const priceRaw = item.dataset.productPrice;
    if (priceRaw === undefined) {
      continue;
    }
    const price = Number(priceRaw);
    if (Number.isNaN(price) || price <= 0) {
      continue;
    }
    const id =
      item.dataset.productId ?? `${price}:${item.dataset.productName ?? ''}`;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const isAuction =
      item.dataset.isBlindAuction === 'true' ||
      item.classList.contains('auction-game');
    const isInStock = item.dataset.productInStock !== 'false';
    const isDisabled = item.dataset.productDisabled === 'true';
    const minTierRaw = item.dataset.arpTier;
    const minTier = minTierRaw === undefined ? undefined : Number(minTierRaw);
    const name =
      item.dataset.productName?.trim() ||
      item
        .querySelector('.product-name, .gv-product-name, h3, h4')
        ?.textContent?.trim() ||
      item.getAttribute('title') ||
      'Game Vault item';
    const nextItem: GameVaultItem = {
      name,
      price,
      inStock: isInStock && !isAuction,
      purchasable: isInStock && !isDisabled && !isAuction,
      isAuction,
    };
    if (minTier !== undefined && Number.isFinite(minTier)) {
      nextItem.minTier = minTier;
    }
    result.push(nextItem);
  }
  return result;
}

export function scrapeGameVault(): GameVaultItem[] {
  return scrapeGameVaultFromDocument(document);
}

export function scrapeUserArpTierFromDocument(
  document_: Document,
): number | undefined {
  if (document_ === document) {
    const arpTier = (globalThis as typeof globalThis & { arp_tier?: unknown })
      .arp_tier;
    if (
      typeof arpTier === 'number' &&
      Number.isFinite(arpTier) &&
      arpTier >= 0
    ) {
      return arpTier;
    }
  }
  for (const script of document_.querySelectorAll('script')) {
    const match = /(?:var\s+|window\.)?arp_tier\s*=\s*(\d+)/.exec(
      script.textContent ?? '',
    );
    if (match?.[1]) {
      return Number(match[1]);
    }
  }
  const tierImg = document_.querySelector<HTMLImageElement>(
    'img[src*="/images/content/tier-tags/"]',
  );
  const tierMatch = /tier-tags\/(\d+)\.png/.exec(tierImg?.src ?? '');
  if (!tierMatch?.[1]) {
    return undefined;
  }
  const tier = Number(tierMatch[1]);
  return Number.isFinite(tier) ? tier : undefined;
}

function parseRedeemableArpText(text: string): number | undefined {
  const match = /Redeemable ARP:\s*([\d,]+)/i.exec(text);
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(value) ? value : undefined;
}

export function scrapeRedeemableArpFromDocument(
  document_: Document,
): number | undefined {
  if (document_ === document) {
    const win = globalThis as typeof globalThis & {
      user_arp?: unknown;
      arp_points?: unknown;
      redeemable_arp?: unknown;
    };
    for (const value of [win.user_arp, win.arp_points, win.redeemable_arp]) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
      }
    }
  }
  for (const script of document_.querySelectorAll('script')) {
    const match =
      /(?:var\s+|window\.)?(?:user_arp|arp_points|redeemable_arp)\s*=\s*(\d+)/.exec(
        script.textContent ?? '',
      );
    if (match?.[1]) {
      return Number(match[1]);
    }
  }
  return parseRedeemableArpText(pageText(document_));
}

export function applyRedeemableArpFromDocument(
  next: SiteState,
  document_: Document,
): void {
  const arp = scrapeRedeemableArpFromDocument(document_);
  if (arp === undefined) {
    return;
  }
  next.arpLog = {
    scrapedAt: next.arpLog?.scrapedAt ?? new Date().toISOString(),
    recent: next.arpLog?.recent ?? [],
    ...next.arpLog,
    redeemableArp: arp,
  };
}

function applyGameVaultSchedule(
  next: SiteState,
  timerMs: number | undefined,
  isOpen: boolean,
  now: number,
): void {
  if (isOpen) {
    const existingOpen = parseTimestamp(next.gameVaultOpensAt);
    if (!Number.isFinite(existingOpen) || existingOpen > now) {
      next.gameVaultOpensAt = new Date(now).toISOString();
    }
    return;
  }
  if (timerMs !== undefined && timerMs > now) {
    next.gameVaultOpensAt = new Date(timerMs).toISOString();
    return;
  }
  delete next.gameVaultOpensAt;
}

export function applyGameVaultDocument(
  next: SiteState,
  document_: Document,
): void {
  const tier = scrapeUserArpTierFromDocument(document_);
  if (tier !== undefined) {
    next.userArpTier = tier;
  }
  applyRedeemableArpFromDocument(next, document_);
  const vault = scrapeGameVaultFromDocument(document_);
  const timerMs = scrapeGameVaultTimerMsFromDocument(document_);
  if (timerMs === undefined && vault.length === 0) {
    return;
  }
  if (vault.length > 0) {
    next.gameVault = vault;
  }
  applyGameVaultSchedule(
    next,
    timerMs,
    vault.some((game) => isVaultStockForUser(game, next.userArpTier)),
    Date.now(),
  );
}

export function scrapeBattlePassFromDocument(
  document_: Document,
): BattlePassState | undefined {
  const body = pageText(document_);
  const popups = document_.querySelectorAll('.bp-popup[data-milestone-id]');
  const tokensMatch = /BATTLE TOKENS\s*([\d,]+)\s*\/\s*([\d,]+)/i.exec(body);
  const legacyClaims = (body.match(/Ready to claim/gi) ?? []).length;
  // Tokens can be in the fetch HTML while claim popups are client-rendered.
  // Treat that as "not loaded" so we don't cache 0 ready over real boosts.
  if (legacyClaims === 0 && popups.length === 0) {
    return undefined;
  }

  const { readyToClaim, readyToClaimArp } = countBattlePassClaims(document_);

  const state: BattlePassState = {
    readyToClaim,
    readyToClaimArp,
    url: '/control-center/battle-pass/1',
    scrapedAt: new Date().toISOString(),
  };

  if (tokensMatch?.[1] && tokensMatch[2]) {
    state.tokens = Number(tokensMatch[1].replaceAll(',', ''));
    state.tokensMax = Number(tokensMatch[2].replaceAll(',', ''));
  }

  applyBattlePassCountdown(state, body);

  return state;
}

const BATTLE_PASS_ENDS_RE =
  /battle\s*pass\s*ends?\s*in\s*(\d{1,3}(?:\s*:\s*\d{1,2}){2,3})/i;

function applyBattlePassCountdown(state: BattlePassState, body: string): void {
  const endsMatch = BATTLE_PASS_ENDS_RE.exec(body);
  if (!endsMatch?.[1]) {
    return;
  }
  const raw = endsMatch[1].replaceAll(/\s+/g, ' ').trim();
  state.endsInText = raw;
  const remaining = parseBattlePassCountdownMs(raw);
  if (remaining !== undefined) {
    state.endsAt = new Date(Date.now() + remaining).toISOString();
  }
}

/**
 * `13 : 12 : 35 : 05` (d:h:m:s) or `12:35:05` (h:m:s).
 */
export function parseBattlePassCountdownMs(text: string): number | undefined {
  const parts = text
    .trim()
    .split(':')
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part));
  if (parts.length < 3 || parts.length > 4) {
    return undefined;
  }
  const seconds = parts.at(-1) ?? 0;
  const minutes = parts.at(-2) ?? 0;
  const hours = parts.at(-3) ?? 0;
  const days = parts.length === 4 ? (parts[0] ?? 0) : 0;
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

export function battlePassRemainingMs(
  battlePass: BattlePassState | undefined,
  now = Date.now(),
): number | undefined {
  if (!battlePass) {
    return undefined;
  }
  if (battlePass.endsAt) {
    const endsAt = Date.parse(battlePass.endsAt);
    if (!Number.isNaN(endsAt)) {
      return Math.max(0, endsAt - now);
    }
  }
  if (!battlePass.endsInText || !battlePass.scrapedAt) {
    return undefined;
  }
  const parsed = parseBattlePassCountdownMs(battlePass.endsInText);
  const scrapedAt = Date.parse(battlePass.scrapedAt);
  if (parsed === undefined || Number.isNaN(scrapedAt)) {
    return undefined;
  }
  return Math.max(0, parsed - (now - scrapedAt));
}

export function mergeBattlePassScrape(
  scraped: BattlePassState,
  previous: BattlePassState | undefined,
): BattlePassState {
  if (scraped.endsAt || !previous?.endsAt) {
    return scraped;
  }
  const merged: BattlePassState = {
    ...scraped,
    endsAt: previous.endsAt,
  };
  if (!merged.endsInText && previous.endsInText) {
    merged.endsInText = previous.endsInText;
  }
  return merged;
}

export function applyBattlePassEndFromDocument(
  next: SiteState,
  document_: Document,
): void {
  if (!next.battlePass) {
    return;
  }
  const battlePass = { ...next.battlePass };
  applyBattlePassCountdown(battlePass, pageText(document_));
  next.battlePass = battlePass;
}

/**
 * Battle Pass track popups use `.bp-popup__claim-btn` (often hidden until opened).
 * Dedupes free/premium duplicate popups by milestone id.
 */
function countBattlePassClaims(document_: Document): {
  readyToClaim: number;
  readyToClaimArp: number;
} {
  const popups = document_.querySelectorAll('.bp-popup[data-milestone-id]');
  if (popups.length > 0) {
    const seen = new Set<string>();
    let readyToClaim = 0;
    let readyToClaimArp = 0;
    for (const popup of popups) {
      if (!(popup instanceof HTMLElement)) {
        continue;
      }
      const id = popup.dataset.milestoneId ?? '';
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      if (!popup.querySelector('.bp-popup__claim-btn')) {
        continue;
      }
      readyToClaim += 1;
      const title =
        popup.querySelector('.bp-popup__title')?.textContent?.trim() ?? '';
      if (isBattlePassArpRewardTitle(title)) {
        readyToClaimArp += 1;
      }
    }
    return { readyToClaim, readyToClaimArp };
  }

  // Legacy / alternate copy.
  const legacy = (pageText(document_).match(/Ready to claim/gi) ?? []).length;
  return { readyToClaim: legacy, readyToClaimArp: legacy };
}

function isBattlePassArpRewardTitle(title: string): boolean {
  if (/ARP\s*Boost/i.test(title)) {
    return true;
  }
  // e.g. "40 ARP" but not "25 ARP Required" (requirement line, not reward title).
  return /^\d[\d,]*\s*ARP$/i.test(title.trim());
}

/**
Claimable Battle Pass ARP that All-ARP% multiplies.
*/
export function battlePassClaimableArp(
  battlePass: BattlePassState | undefined,
): number {
  return battlePass?.readyToClaimArp ?? 0;
}

export function scrapeBattlePass(): BattlePassState | undefined {
  if (!location.pathname.includes('/battle-pass')) {
    return undefined;
  }
  return scrapeBattlePassFromDocument(document);
}

/**
 * Best-effort ARP Log scrape (action rows + balance header).
 */
export function scrapeArpLogFromDocument(document_: Document): ArpLogState {
  const body = pageText(document_);
  const state: ArpLogState = {
    scrapedAt: new Date().toISOString(),
    recent: [],
  };

  const redeemableArp = parseRedeemableArpText(body);
  if (redeemableArp !== undefined) {
    state.redeemableArp = redeemableArp;
  }
  const lifetime = /Lifetime ARP:\s*([\d,]+)/i.exec(body);
  if (lifetime?.[1]) {
    state.lifetimeArp = Number(lifetime[1].replaceAll(',', ''));
  }

  const todayTotal = /Total ARP earned today:\s*([\d,]+)/i.exec(body);
  if (todayTotal?.[1]) {
    state.todayDelta = Number(todayTotal[1].replaceAll(',', ''));
  } else {
    // ARP Log header shows redeemable with a sibling +N for the filtered window.
    const plusMatch = /Redeemable ARP:[\s\S]{0,80}?\+\s*([\d,]+)/i.exec(body);
    if (plusMatch?.[1]) {
      state.todayDelta = Number(plusMatch[1].replaceAll(',', ''));
    }
  }

  const actionNames = [
    'Time On Site',
    'Game Prize',
    'Daily Login Calendar',
    'Daily Login Streak',
    'Discord Poll',
    'Steam Community Event Reward',
    'Steam Quest',
    'Steam Quests',
    'Twitch Passive',
    'Watch Twitch',
    'Community Event',
    'Forum Post',
    'Giveaway',
    'Battle Pass Reward',
    'Battle Pass',
    'Quest',
  ].join('|');
  const rowPattern = new RegExp(
    String.raw`(${actionNames})\s+(\d+)\s+(\d{4}-\d{2}-\d{2})`,
    'gi',
  );
  for (const match of body.matchAll(rowPattern)) {
    const entry: ArpLogEntry = {
      action: match[1] ?? 'Unknown',
      arp: Number(match[2]),
    };
    if (match[3]) {
      entry.date = match[3];
    }
    state.recent.push(entry);
    if (state.recent.length >= 50) {
      break;
    }
  }

  return state;
}

export function scrapeArpLog(): ArpLogState | undefined {
  if (!location.pathname.includes('/arp-log')) {
    return undefined;
  }
  return scrapeArpLogFromDocument(document);
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

const CONTROL_CENTER_WIDGET =
  '[id^="control-center__"], a.community-event-banner';

export function isControlCenterDocumentReady(document_: Document): boolean {
  return Boolean(document_.querySelector(CONTROL_CENTER_WIDGET));
}

export async function waitForControlCenterDocument(
  timeoutMs = 12_000,
): Promise<void> {
  if (isControlCenterDocumentReady(document)) {
    return;
  }
  await new Promise<void>((resolve) => {
    let isSettled = false;
    const observer = new MutationObserver(() => {
      if (isControlCenterDocumentReady(document)) {
        finish();
      }
    });
    const timer = setTimeout(finish, timeoutMs);
    function finish(): void {
      if (isSettled) {
        return;
      }
      isSettled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    }
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
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
    next.arpLog = scrapeArpLogFromDocument(document);
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
