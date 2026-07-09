import { useTopicStore } from "../stores/topicStore";
import { findNode } from "./topicParser";
import { getTag } from "./tagRegistry";
import type { GeoMetadata } from "../types/payloadTags";

/**
 * Extract the first geo detection result from a topic node looked up by path.
 * Returns null if the node doesn't exist or has no geo tag.
 *
 * Reads the store imperatively — callers are Leaflet store subscriptions that
 * run outside React's render cycle.
 */
export function getGeoForTopic(topicPath: string): GeoMetadata | null {
  const root = useTopicStore.getState().root;
  const segments = topicPath === "" ? [] : topicPath.split("/");
  const node = findNode(root, segments);
  return getTag(node?.payloadTags, "geo")?.metadata ?? null;
}
