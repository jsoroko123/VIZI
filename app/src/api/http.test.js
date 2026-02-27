import { requestJson, requestText } from "./http";

describe("http request helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns JSON payload on successful requestJson", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: 7 }),
    });

    await expect(requestJson("/api/db/tables")).resolves.toEqual({ ok: true, value: 7 });
  });

  it("throws fallback error message on failed requestJson", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    await expect(requestJson("/api/db/tables", { fallbackError: "DB failed" })).rejects.toThrow(
      "DB failed"
    );
  });

  it("logs opc failures and throws when requestText fails", async () => {
    const viziLog = vi.fn();
    window.viziLog = viziLog;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    });

    await expect(requestText("/api/opc/config")).rejects.toThrow("Request failed (503)");
    expect(viziLog).toHaveBeenCalledWith(
      "error",
      "OPC API request failed",
      expect.objectContaining({ path: "/api/opc/config", reason: "http_error", status: 503 })
    );
  });
});

