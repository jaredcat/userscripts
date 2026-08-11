import { recordSlotChange } from './settings';

export type ArtifactSlot = 1 | 2 | 3;

export interface ApiResult {
  ok: boolean;
  status: number;
  error?: string;
  message?: string;
}

interface SiteJsonResponse {
  success?: boolean;
  message?: string;
}

/**
 * AWA returns HTTP 200 with `{ success: false }` for locked slots / rejected equips.
 * Match the site's jQuery POST encoding (JSON body + form content-type).
 */
async function postJson(
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResult> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let parsed: SiteJsonResponse | undefined;
    try {
      parsed = JSON.parse(text) as SiteJsonResponse;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      const result: ApiResult = {
        ok: false,
        status: response.status,
        error: parsed?.message ?? `Request failed (${response.status})`,
      };
      if (parsed?.message) {
        result.message = parsed.message;
      }
      return result;
    }

    if (parsed?.success === false) {
      const result: ApiResult = {
        ok: false,
        status: response.status,
        error:
          parsed.message ??
          'Request rejected (slot may be on 24h cooldown or already set).',
      };
      if (parsed.message) {
        result.message = parsed.message;
      }
      return result;
    }

    const result: ApiResult = {
      ok: true,
      status: response.status,
    };
    if (parsed?.message) {
      result.message = parsed.message;
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

/**
POST /change-user-artifacts — equip artifact into a slot.
*/
export async function equipArtifact(
  artifactId: number,
  position: ArtifactSlot,
): Promise<ApiResult> {
  const result = await postJson('/change-user-artifacts', {
    artifactId,
    position,
  });
  if (result.ok) {
    await recordSlotChange(position, artifactId);
  }
  return result;
}

/**
POST /unequip-user-artifact
*/
export async function unequipArtifact(
  artifactId: number,
  position: ArtifactSlot,
): Promise<ApiResult> {
  const result = await postJson('/unequip-user-artifact', {
    artifactId,
    position,
  });
  if (result.ok) {
    await recordSlotChange(position, artifactId);
  }
  return result;
}

/**
POST /upgrade-user-artifact
*/
export async function upgradeArtifact(artifactId: number): Promise<ApiResult> {
  return postJson('/upgrade-user-artifact', { artifactId });
}

/**
 * Equip a recommended loadout into free / specified slots.
 * Uses /change-user-artifacts as an in-place replace (same as the site modal) —
 * do NOT unequip first; emptying a slot can burn the 24h cooldown and leave it empty.
 */
export async function applyLoadout(
  targets: { artifactId: number; position: ArtifactSlot }[],
  currentlyEquipped: { artifactId: number; position: ArtifactSlot }[],
): Promise<{ results: ApiResult[]; allOk: boolean }> {
  const results: ApiResult[] = [];

  for (const target of targets) {
    const isAlready = currentlyEquipped.some(
      (c) =>
        c.artifactId === target.artifactId && c.position === target.position,
    );
    if (isAlready) {
      continue;
    }
    const equipResult = await equipArtifact(target.artifactId, target.position);
    results.push(equipResult);
    if (!equipResult.ok) {
      return { results, allOk: false };
    }
  }

  return {
    results,
    allOk: results.every((r) => r.ok),
  };
}
