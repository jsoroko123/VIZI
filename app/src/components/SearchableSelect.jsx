import Select from "react-select";

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((opt) => {
      if (opt == null) return null;
      if (typeof opt === "string" || typeof opt === "number") {
        const value = String(opt);
        return { value, label: value };
      }
      const value = String(opt?.value ?? "");
      if (!value) return null;
      const label = String(opt?.label ?? value);
      return { value, label };
    })
    .filter(Boolean);
}

export default function SearchableSelect({
  value = "",
  onChange,
  options = [],
  placeholder = "Search...",
  disabled = false,
  style = {},
  title = "",
  ariaLabel = "",
}) {
  const normalized = normalizeOptions(options);
  const selectedValue = String(value ?? "");
  const selected = normalized.find((opt) => String(opt.value) === selectedValue) || null;

  const borderRadius = Number(style.borderRadius) || 10;
  const fontSize = Number(style.fontSize) || 12;
  const fontWeight = Number(style.fontWeight) || 600;
  const height = Number(style.height) || 30;
  const paddingY = 0;
  const paddingX = 8;
  const borderColor = String(style.borderColor || "var(--border)");
  const background = String(style.background || "var(--bg-elev)");
  const color = String(style.color || "var(--text)");

  return (
    <div title={title} aria-label={ariaLabel || title || placeholder}>
      <Select
        options={normalized}
        value={selected}
        isDisabled={disabled}
        isSearchable
        isClearable
        placeholder={placeholder}
        onChange={(opt) => onChange?.(String(opt?.value || ""))}
        styles={{
          control: (base, state) => ({
            ...base,
            minHeight: height,
            height,
            borderRadius,
            borderColor: state.isFocused ? "var(--accent)" : borderColor,
            background,
            boxShadow: "none",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize,
            fontWeight,
            color,
            paddingTop: 0,
            paddingBottom: 0,
          }),
          valueContainer: (base) => ({
            ...base,
            padding: `${paddingY}px ${paddingX}px`,
            height,
          }),
          singleValue: (base) => ({
            ...base,
            color,
            fontSize,
            fontWeight,
          }),
          input: (base) => ({
            ...base,
            color,
            fontSize,
            fontWeight,
            margin: 0,
            padding: 0,
          }),
          placeholder: (base) => ({
            ...base,
            color: "var(--text-muted)",
            fontSize,
          }),
          menu: (base) => ({
            ...base,
            zIndex: 100,
            background,
            border: "1px solid var(--border)",
            borderRadius,
            overflow: "hidden",
          }),
          menuList: (base) => ({
            ...base,
            maxHeight: 280,
            paddingTop: 0,
            paddingBottom: 0,
          }),
          option: (base, state) => ({
            ...base,
            background: state.isFocused ? "var(--bg-soft)" : "var(--bg-elev)",
            color,
            cursor: "pointer",
            fontSize,
            fontWeight,
            padding: "8px 10px",
          }),
          dropdownIndicator: (base) => ({
            ...base,
            color: "var(--text-muted)",
            padding: "0 8px",
          }),
          indicatorSeparator: (base) => ({
            ...base,
            background: "var(--border)",
          }),
          clearIndicator: (base) => ({
            ...base,
            color: "var(--text-muted)",
            padding: "0 8px",
          }),
        }}
        menuPortalTarget={typeof document !== "undefined" ? document.body : null}
        menuPosition="fixed"
      />
    </div>
  );
}
