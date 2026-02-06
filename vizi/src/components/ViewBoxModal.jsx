import { useEffect, useMemo, useState } from "react";

const PRESETS = [
    { label: "1600×900 (Default)", w: 1600, h: 900 },
    { label: "1920×1080 (1080p)", w: 1920, h: 1080 },
    { label: "1280×720 (720p)", w: 1280, h: 720 },
    { label: "1024×768 (4:3)", w: 1024, h: 768 },
    { label: "800×600 (4:3)", w: 800, h: 600 },
    { label: "2048×2048 (Square)", w: 2048, h: 2048 },
    { label: "3440×1440 (Ultra Wide)", w: 3440, h: 1440 },
];

const overlayStyle = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 60,
};

const modalStyle = {
    width: 360,
    borderRadius: 16,
    background: "white",
    border: "1px solid #e6e6e6",
    boxShadow: "0 18px 60px rgba(0,0,0,0.25)",
    padding: 14,
};

const rowStyle = { display: "flex", gap: 10, marginTop: 10 };
const labelStyle = { fontSize: 12, color: "#444", marginBottom: 6 };
const inputStyle = {
    width: "60%",
    height: 36,
    borderRadius: 12,
    border: "1px solid #d6d6d6",
    padding: "0 10px",
    outline: "none",
};

const btnStyle = (primary) => ({
    height: 36,
    borderRadius: 12,
    border: primary ? "1px solid #2b6cff" : "1px solid #d6d6d6",
    background: primary ? "#2b6cff" : "white",
    color: primary ? "white" : "#111",
    padding: "0 12px",
    cursor: "pointer",
    boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
});

export default function ViewBoxModal({ open, onClose, vbW, vbH, onApply }) {
    const [w, setW] = useState(vbW);
    const [h, setH] = useState(vbH);

    useEffect(() => {
        if (!open) return;
        setW(vbW);
        setH(vbH);
    }, [open, vbW, vbH]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === "Escape") onClose?.();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    const canApply = useMemo(() => {
        const W = Number(w);
        const H = Number(h);
        return Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0;
    }, [w, h]);

    if (!open) return null;

    return (
        <div style={overlayStyle} onMouseDown={onClose}>
            <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Canvas ViewBox</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                    Set the drawing coordinate space (viewBox width & height).
                </div>

                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: "#444", marginBottom: 8 }}>Presets</div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {PRESETS.map((p) => (
                            <button
                                key={p.label}
                                type="button"
                                onClick={() => {
                                    setW(p.w);
                                    setH(p.h);
                                }}
                                style={{
                                    height: 34,
                                    borderRadius: 12,
                                    border: "1px solid #d6d6d6",
                                    background: "white",
                                    cursor: "pointer",
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
                                    fontSize: 12,
                                    color: "#111",
                                    padding: "0 10px",
                                    textAlign: "left",
                                }}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div style={rowStyle}>
                    <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Width</div>
                        <input
                            style={inputStyle}
                            value={w}
                            onChange={(e) => setW(e.target.value)}
                            inputMode="numeric"
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={labelStyle}>Height</div>
                        <input
                            style={inputStyle}
                            value={h}
                            onChange={(e) => setH(e.target.value)}
                            inputMode="numeric"
                        />
                    </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
                    <button style={btnStyle(false)} onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        style={btnStyle(true)}
                        disabled={!canApply}
                        onClick={() => {
                            if (!canApply) return;
                            onApply?.({ w: Number(w), h: Number(h) });
                            onClose?.();
                        }}
                    >
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}
