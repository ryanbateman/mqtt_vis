import { useTopicStore } from "../stores/topicStore";
import { formatTimestamp } from "../utils/formatters";
import type { SparkplugMetric } from "../types/sparkplug";

/** Render a metric value for the table. */
function formatMetricValue(metric: SparkplugMetric): string {
  if (metric.isNull || metric.value === null) return "null";
  if (typeof metric.value === "number" && !Number.isInteger(metric.value)) {
    return metric.value.toPrecision(6).replace(/\.?0+$/, "");
  }
  return String(metric.value);
}

/**
 * Insights Drawer content for a Sparkplug B edge node or device: lifecycle
 * status plus a live metric table. Subscribes to sparkplugVersion, so it
 * re-renders whenever the device state slice changes.
 */
export function SparkplugDevicePanel({ deviceKey }: { deviceKey: string }) {
  // Version subscription drives re-renders; the Map itself is mutated in place.
  useTopicStore((s) => s.sparkplugVersion);
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
                <th className="px-3 py-1.5 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.name} className="border-t border-gray-800/60">
                  <td className="px-3 py-1 font-mono text-gray-300 break-all">{m.name}</td>
                  <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{m.datatypeName}</td>
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
