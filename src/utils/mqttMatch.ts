/**
 * MQTT topic-filter matching (MQTT 3.1.1 / 5 semantics).
 *
 * Used to decide whether a declared ecosystem topic is already covered by
 * the active subscription filter — following a covered topic would create an
 * overlapping subscription, and most brokers deliver one copy per matching
 * subscription (duplicates).
 */

/**
 * True when `filter` (may contain + and #) matches `topic` (no wildcards).
 * `#` matches the remaining levels including zero ("a/#" matches "a");
 * `+` matches exactly one level. Topics starting with `$` are not given
 * special treatment (the caller passes concrete declared topics, not
 * broker-internal ones).
 */
export function mqttTopicMatches(filter: string, topic: string): boolean {
  if (filter === "#") return true;
  const filterSegments = filter.split("/");
  const topicSegments = topic.split("/");

  for (let i = 0; i < filterSegments.length; i++) {
    const f = filterSegments[i];
    // "#" swallows the rest — including zero levels ("a/#" matches "a").
    if (f === "#") return true;
    if (i >= topicSegments.length) return false;
    if (f !== "+" && f !== topicSegments[i]) return false;
  }
  // All filter segments consumed without "#": lengths must match exactly.
  return filterSegments.length === topicSegments.length;
}
