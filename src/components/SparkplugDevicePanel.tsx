import { useEffect } from "react";
import { useTopicStore } from "../stores/topicStore";
import { formatTimestamp } from "../utils/formatters";
import type { MetricSample } from "../utils/sparkplug/lifecycle";
import type { SparkplugMetric } from "../types/sparkplug";

/** Render a metric value for the table. */
function formatMetricValue(metric: SparkplugMetric): string {
  if (metric.isNull || metric.value === null) return "null";
  if (typeof metric.value === "number" && !Number.isInteger(metric.value)) {
    return metric.value.toPrecision(6).replace(/\.?0+$/, "");
  }
  return String(metric.value);
}

const SPARK_W = 72;
const SPARK_H = 16;
const SPARK_PAD = 1.5;

/** Datatypes with no numeric sparkline representation. */
const NON_SPARKABLE = new Set([
  "String", "Text", "UUID", "Bytes", "File", "DataSet", "Template", "Unknown",
]);

/**
 * Inline sparkline for one metric's recent samples. Numeric metrics render
 * a min/max-normalised polyline. Booleans render as a digital-trace band
 * strip — one filled rectangle per run of equal value (emerald = true,
 * dim = false) — which stays legible at any toggle density, unlike an
 * outline square wave that degrades into a hairline comb.
 * History records only while the panel is open, so this starts empty and
 * fills as DATA arrives. Needs two samples to draw anything.
 */
function Sparkline({ samples, isBoolean }: { samples: readonly MetricSample[]; isBoolean: boolean }) {
  if (samples.length < 2) {
    return <span className="text-[9px] text-gray-600">…</span>;
  }

  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const tSpan = Math.max(t1 - t0, 1);
  const x = (t: number) => SPARK_PAD + ((t - t0) / tSpan) * (SPARK_W - 2 * SPARK_PAD);

  if (isBoolean) {
    // Build runs of consecutive equal values; each value holds until the
    // next sample (report-by-exception semantics), so a run spans from its
    // first sample to the start of the next run.
    const bandY = 3;
    const bandH = SPARK_H - 6;
    const rects: { x0: number; x1: number; v: number }[] = [];
    let runStart = samples[0];
    for (let i = 1; i <= samples.length; i++) {
      const s = samples[i];
      if (s === undefined || s.v !== runStart.v) {
        const end = s ?? samples[samples.length - 1];
        rects.push({ x0: x(runStart.t), x1: x(end.t), v: runStart.v });
        if (s) runStart = s;
      }
    }
    return (
      <svg
        width={SPARK_W}
        height={SPARK_H}
        className="block"
        aria-label={`History of last ${samples.length} samples`}
      >
        {rects.map((r, i) => (
          <rect
            key={i}
            x={r.x0}
            y={r.v ? bandY : SPARK_H / 2 - 1}
            width={Math.max(r.x1 - r.x0, 1)}
            height={r.v ? bandH : 2}
            fill={r.v ? "#34d399" : "#4b5563"}
            fillOpacity={r.v ? 0.8 : 0.9}
          />
        ))}
      </svg>
    );
  }

  let vMin = Infinity;
  let vMax = -Infinity;
  for (const s of samples) {
    if (s.v < vMin) vMin = s.v;
    if (s.v > vMax) vMax = s.v;
  }
  const vSpan = vMax - vMin;
  // Flat series draw as a centred line
  const y = (v: number) =>
    vSpan === 0
      ? SPARK_H / 2
      : SPARK_H - SPARK_PAD - ((v - vMin) / vSpan) * (SPARK_H - 2 * SPARK_PAD);

  const points = samples
    .map((s) => `${x(s.t).toFixed(1)},${y(s.v).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      width={SPARK_W}
      height={SPARK_H}
      className="block"
      aria-label={`History of last ${samples.length} samples`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="#34d399"
        strokeWidth={1}
        strokeOpacity={0.9}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Insights Drawer content for a Sparkplug B edge node or device: lifecycle
 * status plus a live metric table. Subscribes to sparkplugVersion, so it
 * re-renders whenever the device state slice changes.
 */
export function SparkplugDevicePanel({ deviceKey }: { deviceKey: string }) {
  // Version subscription drives re-renders; the Map itself is mutated in place.
  useTopicStore((s) => s.sparkplugVersion);
  const startSparkplugHistory = useTopicStore((s) => s.startSparkplugHistory);
  const stopSparkplugHistory = useTopicStore((s) => s.stopSparkplugHistory);
  const getSparkplugHistory = useTopicStore((s) => s.getSparkplugHistory);

  // Record metric history only while this panel is open (starts empty).
  useEffect(() => {
    startSparkplugHistory(deviceKey);
    return () => stopSparkplugHistory();
  }, [deviceKey, startSparkplugHistory, stopSparkplugHistory]);

  const devices = useTopicStore.getState().sparkplugDevices;
  const device = devices.get(deviceKey);
  // seq is tracked per edge node (shared counter across its messages)
  const edgeEntry = device
    ? devices.get(`${device.groupId}/${device.edgeNodeId}`) ?? device
    : undefined;

  if (!device) {
    return (
      <div className="flex-1 min-h-0 p-3 text-xs text-gray-500">
        No device state recorded for {deviceKey}.
      </div>
    );
  }

  const metrics = [...device.metrics.values()].sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? "")
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Status block */}
      <div className="px-3 py-2 border-b border-gray-700/50 flex-shrink-0">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <span className="text-gray-500">Status</span>
          <span className={`font-mono font-medium ${device.online ? "text-emerald-400" : "text-red-400"}`}>
            {device.online ? "ONLINE" : "OFFLINE"}
          </span>
          <span className="text-gray-500">Role</span>
          <span className="text-gray-300 font-mono">{device.role}</span>
          <span className="text-gray-500">Last message</span>
          <span className="text-gray-300 font-mono">{device.lastMessageType}</span>
          <span className="text-gray-500">Last birth</span>
          <span className="text-gray-300 font-mono">
            {device.lastBirthTimestamp !== null ? formatTimestamp(device.lastBirthTimestamp) : "-"}
          </span>
          <span className="text-gray-500">Last data</span>
          <span className="text-gray-300 font-mono">
            {device.lastDataTimestamp !== null ? formatTimestamp(device.lastDataTimestamp) : "-"}
          </span>
          <span className="text-gray-500">Seq</span>
          <span className="text-gray-300 font-mono">
            {edgeEntry?.lastSeq ?? "-"}
            {(edgeEntry?.seqGapCount ?? 0) > 0 && (
              <span className="text-amber-400/80 ml-1.5">
                {edgeEntry!.seqGapCount} gap{edgeEntry!.seqGapCount === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Metric table */}
      {metrics.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto max-h-72">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-gray-900/95">
              <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-1.5 font-medium">Metric</th>
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium" aria-label="History sparkline" />
                <th className="px-3 py-1.5 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.name} className="border-t border-gray-800/60">
                  <td className="px-3 py-1 font-mono text-gray-300 break-all">{m.name}</td>
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{m.datatypeName}</td>
                  <td className="px-2 py-1 align-middle">
                    {!NON_SPARKABLE.has(m.datatypeName) && (
                      <Sparkline
                        samples={getSparkplugHistory(m.name ?? "") ?? []}
                        isBoolean={m.datatypeName === "Boolean"}
                      />
                    )}
                  </td>
                  <td
                    className="px-3 py-1 font-mono text-gray-100 text-right break-all"
                    title={m.timestamp !== null ? formatTimestamp(m.timestamp) : undefined}
                  >
                    {formatMetricValue(m)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-3 text-[11px] text-gray-500">
          No metrics decoded yet — they arrive with the next BIRTH or DATA message.
        </div>
      )}
    </div>
  );
}
