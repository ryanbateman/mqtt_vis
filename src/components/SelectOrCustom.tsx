import { useRef, useState, type ReactNode } from "react";

/** One selectable option. */
export interface SelectOrCustomOption {
  value: string;
  label: string;
}

/** Sentinel <option> value for entering custom mode. */
const CUSTOM_SENTINEL = "__custom__";

/**
 * A single morphing form control: a text input by default (showing the
 * current value), with an embedded chevron that swaps in a native <select>
 * of known options; choosing "Custom…" morphs back. The dropdown also
 * appears when the input is emptied (blur) or Escape is pressed. A compact
 * take on the "Other (please specify)" reveal pattern — both modes keep
 * native form semantics, focus follows the morph, and custom text survives
 * round-trips.
 *
 * Controlled: `value` is the real field value (URL/filter string);
 * mode and the remembered custom draft are internal.
 */
export function SelectOrCustom({
  id,
  options,
  value,
  onChange,
  customLabel,
  placeholder,
  disabled = false,
  onFocus,
  inputClassName = "",
  leading,
}: {
  id?: string;
  options: SelectOrCustomOption[];
  value: string;
  onChange: (value: string) => void;
  /** Label of the sentinel option, e.g. "Custom Broker…". */
  customLabel: string;
  placeholder: string;
  disabled?: boolean;
  onFocus?: () => void;
  /** Extra classes for the custom-mode input (e.g. font-mono). */
  inputClassName?: string;
  /** Element rendered left of the control (e.g. broker icon). */
  leading?: ReactNode;
}) {
  const isKnown = options.some((o) => o.value === value);
  // Custom (text) mode is the default — the dropdown is one chevron away.
  const [mode, setMode] = useState<"list" | "custom">("custom");
  // Last custom text — restored when re-entering custom mode.
  const [customDraft, setCustomDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  const enterCustom = () => {
    setMode("custom");
    onChange(customDraft);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /**
   * Show the dropdown. Deliberately does NOT change the value — browsing
   * the list is not choosing from it. While the value is custom (or empty)
   * the select displays the leading "Custom…" option, which is truthful.
   */
  const showList = (refocus: boolean) => {
    setMode("list");
    if (refocus) requestAnimationFrame(() => selectRef.current?.focus());
  };

  if (mode === "custom") {
    return (
      <div className="flex items-center gap-2">
        {leading}
        <div className="relative w-full">
          <input
            id={id}
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setCustomDraft(e.target.value);
            }}
            onFocus={onFocus}
            onKeyDown={(e) => {
              if (e.key === "Escape") showList(true);
            }}
            onBlur={() => {
              if (value === "") showList(false);
            }}
            disabled={disabled}
            placeholder={placeholder}
            className={`w-full pl-3 pr-8 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 ${inputClassName}`}
          />
          <button
            type="button"
            onClick={() => showList(true)}
            disabled={disabled}
            title="Choose from list"
            className="absolute inset-y-0 right-0 pl-1.5 pr-3 flex items-center text-gray-500 hover:text-gray-200 disabled:opacity-50 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {leading}
      <select
        id={id}
        ref={selectRef}
        // A custom (or empty) value displays as the hidden placeholder, so
        // every visible option — including "Custom…" — fires a change event
        // when picked (re-selecting the displayed option never does).
        value={isKnown ? value : ""}
        onChange={(e) => {
          if (e.target.value === CUSTOM_SENTINEL) {
            enterCustom();
          } else {
            onChange(e.target.value);
          }
        }}
        onFocus={onFocus}
        disabled={disabled}
        className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer"
      >
        <option value="" hidden disabled>
          Select…
        </option>
        <option value={CUSTOM_SENTINEL}>{customLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
