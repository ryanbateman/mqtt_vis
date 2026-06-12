import { useEffect, useRef, useState, type ReactNode } from "react";

/** One selectable option. */
export interface SelectOrCustomOption {
  value: string;
  label: string;
}

/** Sentinel <option> value for entering custom mode. */
const CUSTOM_SENTINEL = "__custom__";

/**
 * A single morphing form control: a native <select> of known options that
 * converts to a text input when "Custom…" is chosen, and reverts to the
 * dropdown when the input is emptied (blur), Escape is pressed, or the
 * embedded chevron button is clicked. A compact take on the
 * "Other (please specify)" reveal pattern — both modes keep native form
 * semantics, focus follows the morph, and custom text survives round-trips.
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
  const [mode, setMode] = useState<"list" | "custom">(
    () => (isKnown || value === "" ? "list" : "custom"),
  );
  // Last custom text — restored when re-entering custom mode.
  const [customDraft, setCustomDraft] = useState(() => (isKnown ? "" : value));
  // Last known-option selection — restored when leaving custom mode.
  const lastListValue = useRef(isKnown ? value : (options[0]?.value ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  // List mode displays a concrete option — if the incoming value is empty
  // (e.g. no saved filter), true-up the parent state to the displayed
  // option once on mount so the form value matches what the user sees.
  useEffect(() => {
    if (mode === "list" && value === "" && options.length > 0) {
      onChange(options[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enterCustom = () => {
    setMode("custom");
    onChange(customDraft);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  /** Back to the dropdown, restoring the last known selection. */
  const revertToList = (refocus: boolean) => {
    setMode("list");
    onChange(lastListValue.current);
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
              if (e.key === "Escape") revertToList(true);
            }}
            onBlur={() => {
              if (value === "") revertToList(false);
            }}
            disabled={disabled}
            placeholder={placeholder}
            className={`w-full pl-3 pr-8 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50 ${inputClassName}`}
          />
          <button
            type="button"
            onClick={() => revertToList(true)}
            disabled={disabled}
            title="Choose from list"
            className="absolute inset-y-0 right-0 px-2 flex items-center text-gray-500 hover:text-gray-200 disabled:opacity-50 transition-colors"
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
        value={isKnown ? value : (options[0]?.value ?? "")}
        onChange={(e) => {
          if (e.target.value === CUSTOM_SENTINEL) {
            enterCustom();
          } else {
            lastListValue.current = e.target.value;
            onChange(e.target.value);
          }
        }}
        onFocus={onFocus}
        disabled={disabled}
        className="w-full px-3 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:outline-none focus:border-blue-500 disabled:opacity-50 cursor-pointer"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value={CUSTOM_SENTINEL}>{customLabel}</option>
      </select>
    </div>
  );
}
