import type { ReactNode } from "react";

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
}: {
  side: "left" | "right";
  sections: RailSection<Id>[];
  /** Currently expanded section, or null when collapsed. */
  activeId: Id | null;
  /** Called with the clicked section id, or null when collapsing. */
  onSelect: (id: Id | null) => void;
  /** Optional element pinned to the bottom of the icon strip. */
  footer?: ReactNode;
}) {
  const active = sections.find((s) => s.id === activeId && !s.disabled) ?? null;
  const innerBorder = side === "left" ? "border-r" : "border-l";

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
            <div className="w-80 h-full flex flex-col">
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
