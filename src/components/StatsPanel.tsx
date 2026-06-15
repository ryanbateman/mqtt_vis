import { useEffect, useRef, useState } from "react";
import { useTopicStore, TOPIC_NODE_CAP, getRecentMessages } from "../stores/topicStore";
import { useDomainEntities } from "./EcosystemsPanel";
import type { TopicNode } from "../types";
import { formatRate, formatUptime, formatPayloadSize } from "../utils/formatters";
import { getEcosystemDefinition } from "../utils/ecosystemRegistry";
import {
  payloadSizeStats,
  histogramBuckets,
  topByEventCount,
  entityEcosystemCounts,
  PAYLOAD_HISTOGRAM_EDGES,
  type TopicCount,
} from "../utils/statsAggregate";

const THROUGHPUT_SAMPLES = 120; // ~2 minutes at 1Hz

type Window = "1m" | "5m" | "session";
const WINDOW_MS: Record<Window, number> = { "1m": 60_000, "5m": 300_000, session: Infinity };
const WINDOW_LABEL: Record<Window, string> = {
  "1m": "Previous minute",
  "5m": "Previous 5 minutes",
  session: "Since connect",
};

/** Walk the tree, collecting per-topic message count + last payload size. */
function collectNodeStats(root: TopicNode): { topic: string; count: number; size: number }[] {
  const out: { topic: string; count: number; size: number }[] = [];
  const stack: TopicNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.messageCount > 0) out.push({ topic: n.id, count: n.messageCount, size: n.lastPayloadSize });
    for (const c of n.children.values()) stack.push(c);
  }
  return out;
}

function bucketTick(edges: number[], i: number): string {
  const lo = edges[i];
  const hi = edges[i + 1];
  const fmt = (n: number) => (n >= 1024 ? `${n / 1024}K` : String(n));
  return hi === Infinity ? `${fmt(lo)}+` : fmt(hi);
}

function ageLabel(sec: number): string {
  if (sec <= 0) return "now";
  return sec >= 60 ? `-${Math.round(sec / 60)}m` : `-${sec}s`;
}

// --- Throughput line chart (axes, labels, markers) -------------------------

function ThroughputChart({ rates }: { rates: number[] }) {
  const W = 264, H = 116, L = 30, R = 8, T = 8, B = 18;
  const px0 = L, px1 = W - R, py0 = T, py1 = H - B;
  if (rates.length < 2) {
    return <div className="w-full aspect-[264/116] flex items-center justify-center text-[10px] text-gray-600">collecting throughput…</div>;
  }
  const yMax = Math.max(...rates, 0.5);
  const n = rates.length;
  const x = (i: number) => px0 + (i / (n - 1)) * (px1 - px0);
  const y = (v: number) => py1 - (v / yMax) * (py1 - py0);
  const yTicks = [0, yMax / 2, yMax];
  const pts = rates.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lastX = x(n - 1), lastY = y(rates[n - 1]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto text-gray-600">
      {/* gridlines + y labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={px0} y1={y(t)} x2={px1} y2={y(t)} stroke="currentColor" strokeWidth={0.5} strokeOpacity={0.3} />
          <text x={px0 - 3} y={y(t) + 3} textAnchor="end" className="fill-gray-500" fontSize={8}>
            {formatRate(t)}
          </text>
        </g>
      ))}
      {/* axes */}
      <line x1={px0} y1={py0} x2={px0} y2={py1} stroke="currentColor" strokeWidth={0.75} strokeOpacity={0.6} />
      <line x1={px0} y1={py1} x2={px1} y2={py1} stroke="currentColor" strokeWidth={0.75} strokeOpacity={0.6} />
      {/* x labels: oldest … mid … now (1 sample ≈ 1s) */}
      <text x={px0} y={H - 6} textAnchor="start" className="fill-gray-500" fontSize={8}>{ageLabel(n - 1)}</text>
      <text x={(px0 + px1) / 2} y={H - 6} textAnchor="middle" className="fill-gray-500" fontSize={8}>{ageLabel(Math.round((n - 1) / 2))}</text>
      <text x={px1} y={H - 6} textAnchor="end" className="fill-gray-500" fontSize={8}>now</text>
      {/* series */}
      <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth={1.3} strokeOpacity={0.95} strokeLinejoin="round" />
      {rates.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={1.1} fill="#38bdf8" fillOpacity={0.55} />
      ))}
      <circle cx={lastX} cy={lastY} r={2.4} fill="#38bdf8" />
      <text x={lastX - 3} y={lastY - 4} textAnchor="end" className="fill-sky-300" fontSize={8}>
        {formatRate(rates[n - 1])}/s
      </text>
    </svg>
  );
}

// --- Payload size histogram ------------------------------------------------

function Histogram({ counts }: { counts: number[] }) {
  const W = 264, H = 92, L = 4, R = 4, T = 8, B = 20;
  const px0 = L, px1 = W - R, py0 = T, py1 = H - B;
  const yMax = Math.max(...counts, 1);
  const slot = (px1 - px0) / counts.length;
  const barW = slot * 0.7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto">
      <line x1={px0} y1={py1} x2={px1} y2={py1} stroke="#475569" strokeWidth={0.75} />
      {counts.map((c, i) => {
        const h = (c / yMax) * (py1 - py0);
        const bx = px0 + i * slot + (slot - barW) / 2;
        return (
          <g key={i}>
            <rect x={bx} y={py1 - h} width={barW} height={h} rx={1} fill="#64748b" />
            {c > 0 && (
              <text x={bx + barW / 2} y={py1 - h - 2} textAnchor="middle" className="fill-gray-400" fontSize={7}>
                {c}
              </text>
            )}
            <text x={bx + barW / 2} y={H - 6} textAnchor="middle" className="fill-gray-500" fontSize={7}>
              {bucketTick(PAYLOAD_HISTOGRAM_EDGES, i)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function StatsPanel() {
  const [, setTick] = useState(0);
  const [period, setPeriod] = useState<Window>("1m");
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
  const uptime = s.connectionStatus === "connected" ? formatUptime(Date.now() - s.sessionStart) : "—";

  // Windowed stats below the chart.
  let noisy: TopicCount[];
  let sizes: number[];
  if (period === "session") {
    const nodes = collectNodeStats(s.root);
    noisy = [...nodes].sort((a, b) => b.count - a.count).slice(0, 10).map((n) => ({ topic: n.topic, count: n.count }));
    sizes = nodes.map((n) => n.size);
  } else {
    const cutoff = Date.now() - WINDOW_MS[period];
    const events = getRecentMessages().filter((m) => m.ts >= cutoff);
    noisy = topByEventCount(events, 10);
    sizes = events.map((e) => e.size);
  }
  const sizeStats = payloadSizeStats(sizes);
  const histo = histogramBuckets(sizes, PAYLOAD_HISTOGRAM_EDGES);
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
          <Row label="Graph nodes" value={`${s.graphNodes.length.toLocaleString()}${s.nodeCapReached ? ` / ${TOPIC_NODE_CAP.toLocaleString()} (cap)` : ""}`} />
          <Row label="Entities" value={entities.length.toLocaleString()} />
          <Row label="Uptime" value={uptime} />
        </div>
      </section>

      {/* Throughput over time */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Throughput (msg/s)</div>
        <ThroughputChart rates={throughputRef.current} />
      </section>

      {/* Window selector for the stats below */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-500">Period</span>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as Window)}
          className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-[11px] text-gray-100 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {(Object.keys(WINDOW_LABEL) as Window[]).map((w) => (
            <option key={w} value={w}>{WINDOW_LABEL[w]}</option>
          ))}
        </select>
      </div>

      {/* Noisiest topics (windowed) */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Noisiest Topics</div>
        {noisy.length === 0 ? (
          <div className="text-[11px] text-gray-600">No messages in this period.</div>
        ) : (
          <div className="space-y-0.5">
            {noisy.map((t) => (
              <button
                key={t.topic}
                type="button"
                onClick={() => s.setSelectedNodeId(t.topic)}
                className="w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left hover:bg-gray-700/50 transition-colors"
                title={t.topic}
              >
                <span className="flex-1 truncate text-[11px] text-gray-300">{t.topic}</span>
                <span className="shrink-0 font-mono text-[10px] text-sky-300">{t.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Payload sizes (windowed histogram) */}
      <section>
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Payload Sizes</div>
        {sizeStats.count === 0 ? (
          <div className="text-[11px] text-gray-600">No payloads in this period.</div>
        ) : (
          <>
            <Histogram counts={histo} />
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] mt-2">
              <Row label="Average" value={formatPayloadSize(Math.round(sizeStats.avg))} />
              <Row label="Median" value={formatPayloadSize(sizeStats.median)} />
              <Row label="p95" value={formatPayloadSize(sizeStats.p95)} />
              <Row label="Max" value={formatPayloadSize(sizeStats.max)} />
            </div>
          </>
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
