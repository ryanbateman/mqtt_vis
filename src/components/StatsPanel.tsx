import { useEffect, useRef, useState } from "react";
import { useTopicStore, TOPIC_NODE_CAP } from "../stores/topicStore";
import { useDomainEntities } from "./EcosystemsPanel";
import type { TopicNode } from "../types";
import { formatRate, formatUptime, formatPayloadSize } from "../utils/formatters";
import { TAG_REGISTRY } from "../utils/tagRegistry";
import { getEcosystemDefinition } from "../utils/ecosystemRegistry";
import {
  payloadSizeStats,
  histogramBuckets,
  topByRate,
  tagTypeCounts,
  entityEcosystemCounts,
  PAYLOAD_HISTOGRAM_EDGES,
} from "../utils/statsAggregate";

const THROUGHPUT_SAMPLES = 60; // ~1 minute at 1Hz
const SPARK_W = 240;
const SPARK_H = 36;

/** Collect last-payload sizes from every topic that has received a message. */
function collectSizes(root: TopicNode): number[] {
  const sizes: number[] = [];
  const stack: TopicNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.messageCount > 0) sizes.push(n.lastPayloadSize);
    for (const c of n.children.values()) stack.push(c);
  }
  return sizes;
}

/** Short label for a histogram bucket, e.g. "16–64", "16K+". */
function bucketLabel(edges: number[], i: number): string {
  const lo = edges[i];
  const hi = edges[i + 1];
  const fmt = (n: number) => (n >= 1024 ? `${n / 1024}K` : String(n));
  return hi === Infinity ? `${fmt(lo)}+` : `${fmt(lo)}–${fmt(hi)}`;
}

function Sparkline({ samples }: { samples: number[] }) {
  if (samples.length < 2) {
    return <div className="h-9 flex items-center text-[10px] text-gray-600">collecting…</div>;
  }
  const max = Math.max(...samples, 0.001);
  const x = (i: number) => (i / (THROUGHPUT_SAMPLES - 1)) * SPARK_W;
  const y = (v: number) => SPARK_H - 2 - (v / max) * (SPARK_H - 4);
  const pts = samples.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height={SPARK_H} viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className="block">
      <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth={1.2} strokeOpacity={0.9} strokeLinejoin="round" />
    </svg>
  );
}

/** A labelled horizontal bar (count) with a coloured fill. */
function Bar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max((count / max) * 100, 2) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-28 shrink-0 truncate text-gray-400">{label}</span>
      <div className="flex-1 h-2.5 rounded bg-gray-800 overflow-hidden">
        <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-gray-300">{count.toLocaleString()}</span>
    </div>
  );
}

export function StatsPanel() {
  const [, setTick] = useState(0);
  const throughputRef = useRef<number[]>([]);
  const entities = useDomainEntities();

  useEffect(() => {
    const id = setInterval(() => {
      const buf = throughputRef.current;
      buf.push(useTopicStore.getState().root.aggregateRate);
      if (buf.length > THROUGHPUT_SAMPLES) buf.shift();
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const s = useTopicStore.getState();
  const nodes = s.graphNodes;
  const throughput = s.root.aggregateRate;
  const uptime = s.connectionStatus === "connected" ? formatUptime(Date.now() - s.sessionStart) : "—";

  const sizes = collectSizes(s.root);
  const sizeStats = payloadSizeStats(sizes);
  const histo = histogramBuckets(sizes, PAYLOAD_HISTOGRAM_EDGES);
  const histoMax = Math.max(...histo, 0);
  const noisy = topByRate(nodes, 10);
  const tagCounts = tagTypeCounts(nodes);
  const tagMax = Math.max(0, ...tagCounts.values());
  const ecoCounts = entityEcosystemCounts(entities);

  const Row = ({ label, value }: { label: string; value: string }) => (
    <>
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-mono">{value}</span>
    </>
  );

  return (
    <div className="p-3 space-y-4 overflow-y-auto h-full text-gray-300">
      {/* Session overview */}
      <section>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          <Row label="Messages" value={s.totalMessages.toLocaleString()} />
          <Row label="Topics" value={s.totalTopics.toLocaleString()} />
          <Row label="Graph nodes" value={`${nodes.length.toLocaleString()}${s.nodeCapReached ? ` / ${TOPIC_NODE_CAP.toLocaleString()} (cap)` : ""}`} />
          <Row label="Entities" value={entities.length.toLocaleString()} />
          <Row label="Throughput" value={`${formatRate(throughput)} msg/s`} />
          <Row label="Uptime" value={uptime} />
        </div>
      </section>

      {/* Throughput over the last minute */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Throughput (last minute)</div>
        <Sparkline samples={throughputRef.current} />
      </section>

      {/* Noisiest topics by rate */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Noisiest Topics</div>
        {noisy.length === 0 ? (
          <div className="text-[11px] text-gray-600">No active topics.</div>
        ) : (
          <div className="space-y-0.5">
            {noisy.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => s.setSelectedNodeId(n.id)}
                className="w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left hover:bg-gray-700/50 transition-colors"
                title={n.id}
              >
                <span className="flex-1 truncate text-[11px] text-gray-300">{n.id}</span>
                <span className="shrink-0 font-mono text-[10px] text-sky-300">{formatRate(n.messageRate)}/s</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Payload size distribution */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Payload Sizes</div>
        {sizeStats.count === 0 ? (
          <div className="text-[11px] text-gray-600">No payloads yet.</div>
        ) : (
          <>
            <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-1 text-[11px] mb-2">
              <Row label="Avg" value={formatPayloadSize(Math.round(sizeStats.avg))} />
              <Row label="Median" value={formatPayloadSize(sizeStats.median)} />
              <Row label="p95" value={formatPayloadSize(sizeStats.p95)} />
              <Row label="Max" value={formatPayloadSize(sizeStats.max)} />
            </div>
            <div className="space-y-0.5">
              {histo.map((count, i) => (
                <Bar key={i} label={bucketLabel(PAYLOAD_HISTOGRAM_EDGES, i)} count={count} max={histoMax} color="#64748b" />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Topic type breakdown (payload tags) */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Topic Types</div>
        {tagMax === 0 ? (
          <div className="text-[11px] text-gray-600">No tagged topics.</div>
        ) : (
          <div className="space-y-0.5">
            {TAG_REGISTRY.filter((def) => (tagCounts.get(def.id) ?? 0) > 0).map((def) => (
              <Bar key={def.id} label={def.label} count={tagCounts.get(def.id) ?? 0} max={tagMax} color={def.ringColor} />
            ))}
          </div>
        )}
      </section>

      {/* Entities by ecosystem */}
      {ecoCounts.size > 0 && (
        <section>
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Entities by Ecosystem</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
            {[...ecoCounts.entries()].sort((a, b) => b[1] - a[1]).map(([eco, count]) => {
              const def = getEcosystemDefinition(eco);
              return (
                <div key={eco} className="contents">
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: def.color }} />
                    {def.label}
                  </span>
                  <span className="text-right font-mono text-gray-300">{count.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
