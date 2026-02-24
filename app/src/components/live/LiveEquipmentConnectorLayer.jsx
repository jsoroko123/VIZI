import React from "react";

export default function LiveEquipmentConnectorLayer({ lines, connectFxById }) {
  if (!Array.isArray(lines) || lines.length === 0) return null;

  return (
    <svg
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 11990,
        overflow: "visible",
      }}
    >
      {lines.map((line) => {
        const midY = line.toY - 26;
        const d = `M ${line.fromX} ${line.fromY} C ${line.fromX} ${midY}, ${line.toX} ${midY}, ${line.toX} ${line.toY}`;
        const showConnectFx = Boolean(connectFxById?.[line.id]);
        const approxLen = Math.max(24, Math.hypot(line.toX - line.fromX, line.toY - line.fromY) * 1.15);
        return (
          <g key={`live-eq-link-${line.id}`}>
            <path d={d} fill="none" stroke="rgba(43,108,255,0.24)" strokeWidth="6" strokeLinecap="round" />
            <path d={d} fill="none" stroke="rgba(255,255,255,0.62)" strokeWidth="1.3" strokeLinecap="round" />
            {showConnectFx ? (
              <path
                d={d}
                fill="none"
                stroke="rgba(147,197,253,0.95)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeDasharray={approxLen}
                strokeDashoffset={approxLen}
                style={{
                  ["--link-len"]: `${approxLen}px`,
                  animation: "live-eq-link-grow 1.2s ease-out 1",
                }}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
