import React from "react";

function buildConnectorPath(line) {
  const fromX = Number(line?.fromX);
  const fromY = Number(line?.fromY);
  const toX = Number(line?.toX);
  const toY = Number(line?.toY);
  if (![fromX, fromY, toX, toY].every(Number.isFinite)) return null;

  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const verticalDir = deltaY >= 0 ? 1 : -1;
  const trunkOffset = Math.max(26, Math.min(140, Math.abs(deltaY) * 0.45));
  const trunkY = fromY + trunkOffset * verticalDir;
  const approachInset = Math.max(28, Math.min(120, Math.abs(deltaX) * 0.18));
  const approachX = toX - Math.sign(deltaX || 1) * approachInset;

  if (Math.abs(deltaX) < 8) {
    return {
      d: `M ${fromX} ${fromY} L ${toX} ${toY}`,
      length: Math.abs(deltaY),
    };
  }

  return {
    d: [
      `M ${fromX} ${fromY}`,
      `L ${fromX} ${trunkY}`,
      `L ${approachX} ${trunkY}`,
      `L ${approachX} ${toY}`,
      `L ${toX} ${toY}`,
    ].join(" "),
    length:
      Math.abs(trunkY - fromY) +
      Math.abs(approachX - fromX) +
      Math.abs(toY - trunkY) +
      Math.abs(toX - approachX),
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
