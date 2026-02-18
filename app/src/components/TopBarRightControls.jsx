export default function TopBarRightControls({
  isLiveMode,
  canViewArea,
  drawerView,
  showMainDrawer,
  showSecurityDrawer,
  theme,
  setTheme,
  setShowMainDrawer,
  setShowUserDrawer,
  setShowSecurityDrawer,
  openDrawer,
  user,
  avatarLabel,
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { key: "theme", label: "Theme", alwaysVisible: true },
          { key: "plc", label: "PLC", areaKey: "plc" },
          { key: "opc", label: "OPC", areaKey: "opc" },
          { key: "server", label: "Server", areaKey: "server" },
          { key: "tags", label: "Tag", areaKey: "tags" },
          { key: "database", label: "Database", areaKey: "database" },
          { key: "reports", label: "Reports", areaKey: "reports" },
          { key: "ai", label: "AI", areaKey: "ai" },
          { key: "security", label: "Security", areaKey: "security" },
          { key: "help", label: "Help", areaKey: "help" },
        ]
          .filter((item) => (item.alwaysVisible || !isLiveMode) && canViewArea(item.areaKey))
          .map((item) => {
            const isActiveView =
              drawerView === item.key ||
              (item.key === "opc" && (drawerView === "logs" || drawerView === "diagnostics"));
            const isActive =
              item.key === "theme"
                ? false
                : item.key === "security"
                ? showSecurityDrawer || (showMainDrawer && drawerView === "security")
                : showMainDrawer && isActiveView;
            return (
              <button
                key={`top-nav-${item.key}`}
                data-preserve-style="true"
                title={
                  item.key === "theme"
                    ? theme === "dark"
                      ? "Switch to light mode"
                      : "Switch to dark mode"
                    : item.label
                }
                onClick={() => {
                  if (item.key === "theme") {
                    setTheme((t) => (t === "dark" ? "light" : "dark"));
                    return;
                  }
                  if (item.key === "security") {
                    setShowMainDrawer(false);
                    setShowUserDrawer(false);
                    setShowSecurityDrawer(true);
                    return;
                  }
                  openDrawer(item.key);
                }}
                style={{
                  border: `1px solid ${isActive ? "var(--selected-border)" : "var(--border)"}`,
                  background: isActive ? "var(--selected-bg)" : "var(--bg-elev)",
                  color: isActive ? "var(--selected-text)" : "var(--text)",
                  borderRadius: 999,
                  padding: item.key === "theme" ? "4px 8px" : "4px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  minWidth: item.key === "theme" ? 34 : undefined,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: isActive ? "var(--selected-shadow)" : "0 6px 16px rgba(15, 23, 42, 0.08)",
                }}
              >
                {item.key === "theme" ? (
                  theme === "dark" ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
                      <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )
                ) : (
                  item.label
                )}
              </button>
            );
          })}
      </div>
      <button
        onClick={() => {
          setShowMainDrawer(false);
          setShowSecurityDrawer(false);
          setShowUserDrawer(true);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          border: "1px solid var(--border)",
          background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
          borderRadius: 999,
          padding: "4px 10px",
          cursor: "pointer",
        }}
      >
        {user?.avatar_url ? (
          <img
            src={user.avatar_url}
            alt="avatar"
            style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: theme === "dark" ? "#ffffff" : "#111827",
              color: theme === "dark" ? "#111827" : "white",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {avatarLabel}
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
          {user?.display_name || user?.username || "User"}
        </div>
      </button>
    </div>
  );
}
