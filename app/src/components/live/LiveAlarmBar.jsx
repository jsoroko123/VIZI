import { Fragment } from "react";

export default function LiveAlarmBar({
  visible,
  hasLiveAlarms,
  theme,
  top,
  left,
  height,
  alarmCount,
  liveAlarmMarqueeViewportRef,
  liveAlarmMarqueeTrackRef,
  liveAlarmMarqueeDurationSec,
  liveAlarmMarqueeItems,
  onOpenAlarms,
}) {
  if (!visible) return null;

  return (
    <div
      className={`vizi-live-alarmbar vizi-scroll ${hasLiveAlarms ? "is-alert" : "is-clear"}`}
      onClick={onOpenAlarms}
      title="Open alarms"
      style={{
        position: "fixed",
        top,
        left,
        right: 0,
        height,
        zIndex: 205,
        borderTop: hasLiveAlarms
          ? "1px solid color-mix(in srgb, #ef4444 22%, rgba(255,255,255,0.3) 78%)"
          : "1px solid color-mix(in srgb, #2563eb 14%, rgba(255,255,255,0.42) 86%)",
        borderBottom: hasLiveAlarms
          ? "1px solid color-mix(in srgb, #b91c1c 55%, var(--border) 45%)"
          : "1px solid color-mix(in srgb, #1e3a8a 34%, var(--border) 66%)",
        background: hasLiveAlarms
          ? theme === "dark"
            ? "linear-gradient(180deg, #2c0f14 0%, #3a1219 100%)"
            : "linear-gradient(180deg, #ffdada 0%, #ffcfcf 100%)"
          : theme === "dark"
          ? "linear-gradient(180deg, #0a1627 0%, #0d1d33 100%)"
          : "linear-gradient(180deg, #edf4ff 0%, #e6f0ff 100%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px",
        overflowX: "hidden",
        overflowY: "visible",
        whiteSpace: "nowrap",
        cursor: "pointer",
        boxShadow: hasLiveAlarms
          ? "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 18px rgba(127,29,29,0.26)"
          : "inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 18px rgba(15,23,42,0.12)",
        backdropFilter: "blur(4px)",
      }}
    >
      <span
        aria-hidden="true"
        className={`vizi-live-alarm-radar ${hasLiveAlarms ? "is-alert" : "is-clear"}`}
      >
        <span className="vizi-live-alarm-radar-ring ring-a" />
        <span className="vizi-live-alarm-radar-ring ring-b" />
        <span className="vizi-live-alarm-radar-core" />
      </span>
      <div
        className="vizi-live-alarmbar-title"
        style={{
          fontSize: 8,
          fontWeight: 900,
          color: hasLiveAlarms
            ? theme === "dark"
              ? "#ffe2e2"
              : "#7a1414"
            : theme === "dark"
            ? "#d4e2ff"
            : "#1e3a8a",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          flex: "0 0 auto",
          border: hasLiveAlarms
            ? "1px solid color-mix(in srgb, #ef4444 58%, rgba(255,255,255,0.26) 42%)"
            : "1px solid color-mix(in srgb, #2563eb 44%, rgba(255,255,255,0.42) 56%)",
          borderRadius: 999,
          padding: "2px 8px",
          background: hasLiveAlarms
            ? theme === "dark"
              ? "rgba(220,38,38,0.2)"
              : "rgba(220,38,38,0.1)"
            : theme === "dark"
            ? "rgba(37,99,235,0.16)"
            : "rgba(37,99,235,0.08)",
        }}
      >
        {hasLiveAlarms ? `Alarms (${alarmCount})` : "Alarms clear"}
      </div>
      {hasLiveAlarms ? (
        <div ref={liveAlarmMarqueeViewportRef} className="vizi-live-alarm-marquee">
          <div
            ref={liveAlarmMarqueeTrackRef}
            className="vizi-live-alarm-marquee-track"
            style={{ ["--alarm-marquee-duration"]: `${liveAlarmMarqueeDurationSec}s` }}
          >
            {[0, 1, 2].map((segment) => (
              <Fragment key={`alarm-marquee-segment-${segment}`}>
                <div
                  className="vizi-live-alarm-marquee-group"
                  aria-hidden={segment > 0 ? "true" : undefined}
                >
                  {liveAlarmMarqueeItems.map((item, idx) => (
                    <div
                      key={`alarm-marquee-${segment}-${item.id || idx}`}
                      className="vizi-live-alarm-marquee-item"
                      title={item.title}
                    >
                      <span className="vizi-live-alarm-marquee-item-label">{item.label}</span>
                      {item.at ? <span className="vizi-live-alarm-marquee-item-time">{item.at}</span> : null}
                    </div>
                  ))}
                </div>
                <div className="vizi-live-alarm-marquee-gap" aria-hidden="true" />
              </Fragment>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
