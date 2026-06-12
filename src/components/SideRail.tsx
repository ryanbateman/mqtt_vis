import { useRef, useState, type ReactNode } from "react";
import { loadSavedSettings, persistSettings } from "../utils/settingsStorage";

/** Width bounds for resizable rail content (px). */
const MIN_WIDTH = 240;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 320;

function clampWidth(width: number): number {
  // Keep some graph visible regardless of viewport size.
  const viewportMax = Math.max(MIN_WIDTH, window.innerWidth - 200);
  return Math.min(Math.max(width, MIN_WIDTH), Math.min(MAX_WIDTH, viewportMax));
}

/** One section of a side rail: an icon in the strip plus expandable content. */
export interface RailSection<Id extends string = string> {
  id: Id;
  /** Section title — icon tooltip and expanded-panel header. */
  title: string;
  /** Icon rendered in the strip (sized by the caller, w-5 h-5 works well). */
  icon: ReactNode;
  /** Status dot colour classes shown on the icon (e.g. "bg-emerald-500"). */
  dotClass?: string | null;
  /** Small numeric badge on the icon. Hidden when null or 0. */
  badge?: number | null;
  /** Greyed out and unclickable — no content available. */
  disabled?: boolean;
  content: ReactNode;
}

/**
 * Full-height navigation rail fixed to one viewport edge: a narrow vertical
 * icon strip with a content panel that expands inward. One section is active
 * at a time; clicking the active section's icon collapses the panel.
 * Replaces the floating-panel layout (connection/settings left, detail/
 * insights/ecosystems right).
 */
export function SideRail<Id extends string>({
  side,
  sections,
  activeId,
  onSelect,
  footer,
  resizable = false,
}: {
  side: "left" | "right";
  sections: RailSection<Id>[];
  /** Currently expanded section, or null when collapsed. */
  activeId: Id | null;
  /** Called with the clicked section id, or null when collapsing. */
  onSelect: (id: Id | null) => void;
  /** Optional element pinned to the bottom of the icon strip. */
  footer?: ReactNode;
  /** Content panel width adjustable by dragging its inner edge (persisted). */
  resizable?: boolean;
}) {
  const active = sections.find((s) => s.id === activeId && !s.disabled) ?? null;
  const innerBorder = side === "left" ? "border-r" : "border-l";

  // Resizable width — initialised from saved settings, persisted on drag end.
  const [width, setWidth] = useState(
    () => loadSavedSettings().railWidth ?? DEFAULT_WIDTH,
  );
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = { startX: e.clientX, startWidth: widthRef.current };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    const delta = side === "right" ? drag.startX - e.clientX : e.clientX - drag.startX;
    setWidth(clampWidth(drag.startWidth + delta));
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    persistSettings({ railWidth: widthRef.current });
  };

  return (
    <div
      className={`absolute inset-y-0 z-10 flex ${
        side === "left" ? "left-0" : "right-0 flex-row-reverse"
      }`}
    >
      {/* Icon strip */}
      <div
        className={`w-12 flex flex-col items-center py-3 gap-1.5 bg-gray-900/95 backdrop-blur-sm ${innerBorder} border-gray-700 flex-shrink-0`}
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={s.disabled}
            onClick={() => onSelect(activeId === s.id ? null : s.id)}
            title={s.title}
            className={`relative w-9 h-9 flex items-center justify-center rounded-md transition-colors ${
              s.disabled
                ? "text-gray-700 cursor-default"
                : activeId === s.id
                  ? "bg-gray-700/70 text-blue-300"
                  : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
            }`}
          >
            {s.icon}
            {s.dotClass && (
              <span
                className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ${s.dotClass}`}
              />
            )}
            {s.badge != null && s.badge > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[15px] h-3.5 px-0.5 rounded-full bg-gray-700 border border-gray-600 text-[9px] font-mono text-gray-300 flex items-center justify-center">
                {s.badge > 99 ? "99+" : s.badge}
              </span>
            )}
          </button>
        ))}
        {footer && <div className="mt-auto">{footer}</div>}
      </div>

      {/* Expanding content panel */}
      <div
        className={`grid transition-[grid-template-columns,opacity] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)] bg-gray-900/90 backdrop-blur-sm ${
          active
            ? `grid-cols-[1fr] opacity-100 ${innerBorder} border-gray-700`
            : "grid-cols-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {active && (
            <div
              className={`relative h-full flex flex-col ${resizable ? "" : "w-80"}`}
              style={resizable ? { width } : undefined}
            >
              {/* Drag handle on the inner edge — pointer-captured column resize */}
              {resizable && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  className={`absolute inset-y-0 ${
                    side === "right" ? "left-0 -ml-0.5" : "right-0 -mr-0.5"
                  } w-1.5 z-10 cursor-col-resize hover:bg-blue-500/40 active:bg-blue-500/60 transition-colors touch-none`}
                />
              )}
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/60 flex-shrink-0">
                <span className="text-sm font-semibold text-gray-200">
                  {active.title}
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  title="Collapse"
                  className="p-0.5 text-gray-500 hover:text-gray-200 transition-colors"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${side === "right" ? "rotate-180" : ""}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                {active.content}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
