import type { SparkplugMetric } from "../../types/sparkplug";

/**
 * Alias bookkeeping for Sparkplug DATA decoding.
 *
 * BIRTH messages define metrics with both a name and a numeric alias;
 * subsequent DATA messages may carry only the alias. The worker keeps one
 * alias map per edge node ("group/edge") and resolves names before results
 * reach the main thread.
 */
export type AliasMap = Map<number, { name: string; datatype: number }>;

/** Record name/alias pairs from a BIRTH message's metrics. */
export function recordAliases(map: AliasMap, metrics: readonly SparkplugMetric[]): void {
  for (const m of metrics) {
    if (m.alias !== null && m.name !== null) {
      map.set(m.alias, { name: m.name, datatype: m.datatype });
    }
  }
}

/**
 * Resolve alias-only metrics against the map, filling in name (and datatype
 * when the DATA message omitted it). Unknown aliases get a placeholder name
 * "alias:N" — happens when subscribing after the BIRTH was published.
 */
export function resolveAliases(map: AliasMap, metrics: SparkplugMetric[]): void {
  for (const m of metrics) {
    if (m.name !== null || m.alias === null) continue;
    const known = map.get(m.alias);
    if (known) {
      m.name = known.name;
      if (m.datatype === 0) m.datatype = known.datatype;
    } else {
      m.name = `alias:${m.alias}`;
    }
  }
}
