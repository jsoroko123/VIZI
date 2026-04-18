import { useEffect, useState } from "react";
import "./TruckLoadoutPage.css";

const TRUCK_INFO_CARDS = [
  { label: "Truck ID", value: "5t7 3R7", emphasis: true },
  { label: "Product", value: "Cement", emphasis: true },
  { label: "Tare Weight", value: "20350" },
  { label: "Scale Weight", value: "88050" },
  { label: "Dosed Weight", value: "0" },
];

const SYSTEM_STATUS_ITEMS = [
  { key: "silo", label: "Silo Selected", value: "Silo 1", tone: "default" },
  { key: "spout", label: "Spout Position", value: "MOVING", tone: "accent" },
  { key: "running", label: "Load Running", value: "UNKNOWN", tone: "muted" },
  { key: "status", label: "Load Status", value: "AUTHORIZED TO LOAD", tone: "ok" },
];

const SETPOINT_FIELDS = [
  { label: "Target Net", value: "67500" },
  { label: "Target Gross", value: "87850" },
  { label: "Silo", value: "Silo 1" },
];

const CAMERA_FEEDS = [
  { id: "silo-1", label: "Silo 1 Camera" },
  { id: "silo-2", label: "Silo 2 Camera" },
];

const CAMERA_STATUS_ITEMS = [
  { label: "Spout Position", value: "UNKNOWN" },
  { label: "Load Status", value: "UNKNOWN" },
];

const ALARMS = [
  "Equipment Fault",
  "Failed During Load",
  "Stop Pressed at Spout",
  "HMI Stopped Load",
];

const EVENTS = [
  { name: "Truck Registered", value: "49877 lbs", timestamp: "03/15/2026 07:55:05PM" },
  { name: "Spout Position Landed", value: "True", timestamp: "03/15/2026 06:55:05PM" },
  { name: "Authorized to Load", value: "True", timestamp: "03/15/2026 06:40:05PM" },
  { name: "Equipment Fault", value: "True", timestamp: "03/15/2026 06:40:05PM" },
  { name: "Load Request Received", value: "True", timestamp: "03/15/2026 06:37:59PM" },
  { name: "Truck On Scale", value: "True", timestamp: "03/15/2026 06:35:18PM" },
  { name: "Spout Parked", value: "False", timestamp: "03/15/2026 06:33:42PM" },
  { name: "Load Complete", value: "False", timestamp: "03/15/2026 06:33:42PM" },
];

function formatClock(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusIcon({ type }) {
  const commonProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
  };

  if (type === "silo") {
    return (
      <svg {...commonProps}>
        <path d="M3 9.5 12 4l9 5.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.5 10.5h13M7 10.5v7m5-7v7m5-7v7M4 18.5h16" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "spout") {
    return (
      <svg {...commonProps}>
        <path d="M12 4v14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
        <path d="m7 13 5 5 5-5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "running") {
    return (
      <svg {...commonProps}>
        <path d="m8 6 9 6-9 6V6Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "status") {
    return (
      <svg {...commonProps}>
        <path d="M12 4v4m0 8v4m8-8h-4M8 12H4m12.2-5.2-2.8 2.8m0 4.8 2.8 2.8M7.8 6.8l2.8 2.8m0 4.8-2.8 2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "alarm") {
    return (
      <svg {...commonProps}>
        <path d="M7 18a5 5 0 0 0 10 0V11.5a5 5 0 1 0-10 0V18Zm4 3h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "camera-status") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
        <path d="m10.2 12 1.3 1.3 2.5-2.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return null;
}

function MediaWarningIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <path d="M22 5 40 37H4L22 5Z" fill="currentColor" opacity="0.98" />
      <path d="M22 14v10.5M22 30.25v.5" stroke="#505050" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

function TerraKeBrand() {
  return (
    <div className="truck-loadout__brand" aria-label="Terra KE">
      <div className="truck-loadout__brand-main">
        <span className="truck-loadout__brand-word">TERRA</span>
        <span className="truck-loadout__brand-ke-wrap">
          <span className="truck-loadout__brand-ke-ring" />
          <span className="truck-loadout__brand-ke">KE</span>
        </span>
      </div>
      <div className="truck-loadout__brand-sub">Powered By Knobelsdorff</div>
    </div>
  );
}

function CameraPlaceholder({ label }) {
  return (
    <div className="truck-loadout__camera-feed" role="img" aria-label={`${label} unavailable`}>
      <div className="truck-loadout__camera-error-card">
        <div className="truck-loadout__camera-error-copy">
          <strong>Error Loading Media:</strong>
          <span>File not valid</span>
        </div>
        <div className="truck-loadout__camera-error-icon">
          <MediaWarningIcon />
        </div>
      </div>
    </div>
  );
}

export default function TruckLoadoutPage() {
  const [selectedCameraId, setSelectedCameraId] = useState(CAMERA_FEEDS[0].id);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => new Date());

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Truck Loadout";
    const timerId = window.setInterval(() => {
      setLastUpdatedAt(new Date());
    }, 1000);
    return () => {
      document.title = previousTitle;
      window.clearInterval(timerId);
    };
  }, []);

  const selectedFeed = CAMERA_FEEDS.find((feed) => feed.id === selectedCameraId) || CAMERA_FEEDS[0];
  const secondaryFeed = CAMERA_FEEDS.find((feed) => feed.id !== selectedFeed.id) || CAMERA_FEEDS[1] || CAMERA_FEEDS[0];
  const displayedFeeds = [selectedFeed, secondaryFeed].filter(Boolean);

  return (
    <div className="truck-loadout-page">
      <div className="truck-loadout-shell">
        <header className="truck-loadout-panel truck-loadout__header">
          <TerraKeBrand />
          <div className="truck-loadout__header-copy">
            <div className="truck-loadout__eyebrow">Truck Loadout</div>
            <h1 className="truck-loadout__title">Truck Load Station Silo 1/2 Loadout</h1>
          </div>
        </header>

        <div className="truck-loadout__layout">
          <main className="truck-loadout__main">
            <section className="truck-loadout-panel">
              <div className="truck-loadout-panel__title">Truck Information</div>
              <div className="truck-loadout__stats-grid">
                {TRUCK_INFO_CARDS.map((card) => (
                  <article
                    key={card.label}
                    className={`truck-loadout__stat-card${card.emphasis ? " is-emphasis" : ""}`}
                  >
                    <div className="truck-loadout__stat-label">{card.label}</div>
                    <div className="truck-loadout__stat-value">{card.value}</div>
                  </article>
                ))}
              </div>
            </section>

            <section className="truck-loadout-panel">
              <div className="truck-loadout-panel__title">Load Progress</div>
              <div className="truck-loadout__progress-header">
                <div className="truck-loadout__progress-value">101 %</div>
                <div className="truck-loadout__progress-target">Target: 67500 lbs</div>
              </div>
              <div className="truck-loadout__progress-track" aria-label="Load progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={100}>
                <div className="truck-loadout__progress-bar" />
              </div>
            </section>

            <section className="truck-loadout-panel truck-loadout-panel--fill">
              <div className="truck-loadout-panel__title">Cameras</div>
              <div className="truck-loadout__camera-tabs" role="tablist" aria-label="Camera feeds">
                {CAMERA_FEEDS.map((feed) => (
                  <button
                    key={feed.id}
                    type="button"
                    role="tab"
                    aria-selected={selectedCameraId === feed.id}
                    className={`truck-loadout__camera-tab${selectedCameraId === feed.id ? " is-active" : ""}`}
                    onClick={() => setSelectedCameraId(feed.id)}
                  >
                    {feed.label}
                  </button>
                ))}
              </div>
              <div className="truck-loadout__camera-grid">
                {displayedFeeds.map((feed) => (
                  <CameraPlaceholder key={feed.id} label={feed.label} />
                ))}
              </div>
              <div className="truck-loadout__camera-status">
                {CAMERA_STATUS_ITEMS.map((item) => (
                  <div key={item.label} className="truck-loadout__camera-status-item">
                    <span className="truck-loadout__camera-status-icon">
                      <StatusIcon type="camera-status" />
                    </span>
                    <span className="truck-loadout__camera-status-label">{item.label}:</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="truck-loadout-panel truck-loadout-panel--fill">
              <div className="truck-loadout-panel__title">Events</div>
              <div className="truck-loadout__events-list vizi-scroll">
                {EVENTS.map((event) => (
                  <div key={`${event.name}-${event.timestamp}`} className="truck-loadout__event-row">
                    <span>{event.name}</span>
                    <span>{event.value}</span>
                    <span>{event.timestamp}</span>
                  </div>
                ))}
              </div>
            </section>
          </main>

          <aside className="truck-loadout__sidebar">
            <section className="truck-loadout-panel">
              <div className="truck-loadout-panel__title">System Status</div>
              <div className="truck-loadout__status-list">
                {SYSTEM_STATUS_ITEMS.map((item) => (
                  <div key={item.key} className="truck-loadout__status-row">
                    <div className="truck-loadout__status-label-wrap">
                      <span className={`truck-loadout__status-icon tone-${item.tone}`}>
                        <StatusIcon type={item.key} />
                      </span>
                      <span className="truck-loadout__status-label">{item.label}</span>
                    </div>
                    <strong className={`truck-loadout__status-value tone-${item.tone}`}>{item.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="truck-loadout-panel">
              <div className="truck-loadout-panel__title">Setpoints</div>
              <div className="truck-loadout__setpoints">
                {SETPOINT_FIELDS.map((field) => (
                  <label key={field.label} className="truck-loadout__setpoint-field">
                    <span>{field.label}</span>
                    <div className="truck-loadout__setpoint-input">{field.value}</div>
                  </label>
                ))}
              </div>
            </section>

            <section className="truck-loadout-panel truck-loadout-panel--fill">
              <div className="truck-loadout-panel__title truck-loadout-panel__title--icon">
                <span className="truck-loadout-panel__title-icon">
                  <StatusIcon type="alarm" />
                </span>
                <span>Alarms</span>
              </div>
              <div className="truck-loadout__alarms-list">
                {ALARMS.map((alarm) => (
                  <div key={alarm} className="truck-loadout__alarm-row">
                    <span className="truck-loadout__alarm-dot" />
                    <span>{alarm}</span>
                  </div>
                ))}
              </div>
              <div className="truck-loadout__last-update">Last Update: {formatClock(lastUpdatedAt)}</div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
