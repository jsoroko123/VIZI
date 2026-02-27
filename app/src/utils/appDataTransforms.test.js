import {
  getFolderFromKey,
  normalizeAlarmOperatorValue,
  normalizeProjectPlcEntries,
  normalizeTableDisplayName,
  tokenizeSvgCatalogText,
} from "./appDataTransforms";

describe("appDataTransforms", () => {
  it("normalizes project PLC entries and truncates raw text", () => {
    const raw = [
      {
        id: "abc",
        name: " PLC One ",
        size: "123",
        uploadedAt: 42,
        rawText: "abcdefghijklmnopqrstuvwxyz",
        chatHistory: [
          { role: "assistant", content: "ok" },
          { role: "invalid", content: "user fallback" },
        ],
      },
      {
        name: "",
        rawText: "",
      },
    ];

    const out = normalizeProjectPlcEntries(raw, { maxRawText: 5 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "abc",
      name: "PLC One",
      size: 123,
      uploadedAt: 42,
      rawText: "abcde",
    });
    expect(out[0].chatHistory).toEqual([
      { role: "assistant", content: "ok" },
      { role: "user", content: "user fallback" },
    ]);
  });

  it("parses folder names and tokenizes catalog text", () => {
    expect(getFolderFromKey("./assets/SVG_Files/Airlock.svg")).toBe("Root");
    expect(getFolderFromKey("./assets/SVG_Files/Bins/Terra_Bin_Skinny.svg")).toBe("Bins");
    expect(tokenizeSvgCatalogText("TwoWay_Diverter.svg / diverter-two way")).toEqual(
      expect.arrayContaining(["TwoWay", "Diverter", "diverter", "two", "way"])
    );
  });

  it("normalizes display names and operators", () => {
    expect(normalizeTableDisplayName("ai_reports")).toBe("Ai Reports");
    expect(normalizeTableDisplayName("routeColorMap")).toBe("Route Color Map");
    expect(normalizeAlarmOperatorValue(">=")).toBe(">=");
    expect(normalizeAlarmOperatorValue("??")).toBe("==");
  });
});

