import React from "react";

function buildConnectorPath(line) {
  const fromX = Number(line?.fromX);
  const fromY = Number(line?.fromY);
  const toX = Number(line?.toX);
  const toY = Number(line?.toY);
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null;

  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const absDx = Math.abs(deltaX);
  const absDy = Math.abs(deltaY);
  const midX = fromX + deltaX * 0.52;
  const midY = fromY + deltaY * 0.54;
  const c1x = fromX + deltaX * Math.min(0.22, 24 / Math.max(24, absDx));
  const c1y = fromY + deltaY * 0.18 + Math.sign(deltaY || 1) * Math.min(34, absDy * 0.2);
  const c2x = fromX + deltaX * 0.36;
  const c2y = fromY + deltaY * 0.62;
  const c3x = fromX + deltaX * 0.68;
  const c3y = fromY + deltaY * 0.82;
  const c4x = toX - deltaX * Math.min(0.2, 22 / Math.max(22, absDx));
  const c4y = toY - deltaY * 0.16;
  const straightLen = Math.hypot(deltaX, deltaY);

  return {
    d: [
      `M ${fromX} ${fromY}`,
      `C ${c1x} ${c1y}, ${c2x} ${c2y}, ${midX} ${midY}`,
      `C ${c3x} ${c3y}, ${c4x} ${c4y}, ${toX} ${toY}`,
    ].join(" "),
    // Approximation for dash animation timing.
    length: Math.max(24, straightLen * 1.18),
  };
}

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
        const route = buildConnectorPath(line);
        if (!route?.d) return null;
        const { d, length } = route;
        const showConnectFx = Boolean(connectFxById?.[line.id]);
        const approxLen = Math.max(24, length);
        return (
          <g key={`live-eq-link-${line.id}`}>
            <path d={d} fill="none" stroke="rgba(43,108,255,0.24)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke="rgba(255,255,255,0.62)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            {showConnectFx ? (
              <path
                d={d}
                fill="none"
                stroke="rgba(147,197,253,0.95)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
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
