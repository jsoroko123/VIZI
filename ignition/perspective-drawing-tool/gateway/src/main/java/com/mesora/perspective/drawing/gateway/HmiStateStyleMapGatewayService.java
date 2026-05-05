package com.mesora.perspective.drawing.gateway;

import static com.mesora.perspective.drawing.common.MesoraPerspectiveDrawing.MODULE_ID;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Map;

import com.inductiveautomation.ignition.common.gson.Gson;
import com.inductiveautomation.ignition.common.gson.GsonBuilder;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;

final class HmiStateStyleMapGatewayService {

    private static final Gson gson = new GsonBuilder().setPrettyPrinting().create();
    private static final String FILE_NAME = "hmi-state-style-maps.json";
    private static final String DEFAULT_RESOURCE_NAME = "/" + FILE_NAME;
    private static final String README_FILE_NAME = "README-hmi-state-style-maps.txt";
    private static final String FALLBACK_DEFAULT_JSON = String.join(
        System.lineSeparator(),
        "{",
        "  \"classes\": {",
        "    \"MotorStopped\": {\"class\": \"Terra/EquipmentStyles/Motor/Stopped\", \"text\": \"Stopped\"},",
        "    \"MotorStartingFwd\": {\"class\": \"Terra/EquipmentStyles/Motor/StartingFwd\", \"text\": \"Starting Forward\"},",
        "    \"MotorStartingRev\": {\"class\": \"Terra/EquipmentStyles/Motor/StartingRev\", \"text\": \"Starting Reverse\"},",
        "    \"MotorRunningFwd\": {\"class\": \"Terra/EquipmentStyles/Motor/RunningFwd\", \"text\": \"Running Forward\"},",
        "    \"MotorRunningRev\": {\"class\": \"Terra/EquipmentStyles/Motor/RunningRev\", \"text\": \"Running Reverse\"},",
        "    \"MotorStopping\": {\"class\": \"Terra/EquipmentStyles/Motor/Stopping\", \"text\": \"Stopping\"},",
        "    \"MotorFaulted\": {\"class\": \"Terra/EquipmentStyles/Motor/Faulted\", \"text\": \"Faulted\"}",
        "  },",
        "  \"hmiStateStyleMaps\": {",
        "    \"Motor\": {",
        "      \"1\": \"MotorStopped\",",
        "      \"2\": \"MotorStartingFwd\",",
        "      \"3\": \"MotorStartingRev\",",
        "      \"4\": \"MotorRunningFwd\",",
        "      \"5\": \"MotorRunningRev\",",
        "      \"6\": \"MotorStopping\",",
        "      \"16\": \"MotorFaulted\"",
        "    },",
        "    \"Diverter\": {},",
        "    \"TwoWay\": {}",
        "  }",
        "}"
    ) + System.lineSeparator();
    private static final String README_TEXT = String.join(
        System.lineSeparator(),
        "Mesora Drawing Tool HMI State Style Maps",
        "",
        "Edit hmi-state-style-maps.json to map UDT HMI_State integer values to Perspective style classes.",
        "The gateway reads this file through the /hmi-state-style-maps data route with no-cache headers.",
        "After editing the file, click Refresh Styles in the drawing tool or reload the Perspective session.",
        "",
        "Supported shapes:",
        "1. Direct maps: {\"Motor\": {\"1\": {\"class\": \"Terra/EquipmentStyles/Motor/Stopped\", \"text\": \"Stopped\"}}}",
        "2. Reusable classes: {\"classes\": {\"MotorStopped\": {\"class\": \"Terra/EquipmentStyles/Motor/Stopped\"}}, \"hmiStateStyleMaps\": {\"Motor\": {\"1\": \"MotorStopped\"}}}",
        "",
        "Perspective remains the source of truth for the actual colors, fills, strokes, and other style details.",
        "Each state entry can use class, styleClass, className, style, cssClass, or color, but class is recommended."
    ) + System.lineSeparator();

    private final LoggerEx logger;
    private final Path configDirectory;
    private final Path styleMapFile;
    private final String styleMapDisplayPath;

    HmiStateStyleMapGatewayService(GatewayContext gatewayContext, LoggerEx logger) {
        this.logger = logger;
        this.configDirectory = resolveConfigDirectory(gatewayContext);
        this.styleMapFile = this.configDirectory.resolve(FILE_NAME);
        this.styleMapDisplayPath = resolveStyleMapDisplayPath(this.styleMapFile);
        ensureConfigFile();
    }

    HmiStateStyleMapResponse getStyleMaps() {
        ensureConfigFile();

        long lastModified = 0L;
        try {
            if (Files.exists(styleMapFile)) {
                lastModified = Files.getLastModifiedTime(styleMapFile).toMillis();
            }
        } catch (IOException _ignored) {
        }

        try {
            String rawJson = Files.readString(styleMapFile, StandardCharsets.UTF_8);
            Object parsed = rawJson == null || rawJson.isBlank()
                ? Map.of()
                : gson.fromJson(rawJson, Object.class);
            Object maps = extractMaps(parsed);
            Object styles = extractNamedObject(parsed, "styles", "classes", "styleClasses", "styleDefinitions");
            return new HmiStateStyleMapResponse(
                maps == null ? Map.of() : maps,
                styles == null ? Map.of() : styles,
                styleMapDisplayPath,
                lastModified,
                countTopLevelMaps(maps),
                ""
            );
        } catch (Exception e) {
            logger.warnf(
                "Failed to load HMI state style map file '%s': %s",
                styleMapFile,
                String.valueOf(e.getMessage())
            );
            return new HmiStateStyleMapResponse(
                Map.of(),
                Map.of(),
                styleMapDisplayPath,
                lastModified,
                0,
                "Failed to load HMI state style maps: " + String.valueOf(e.getMessage())
            );
        }
    }

    private Path resolveConfigDirectory(GatewayContext gatewayContext) {
        if (gatewayContext != null && gatewayContext.getSystemManager() != null) {
            Path moduleConfigDir = gatewayContext.getSystemManager().getModuleConfigDir(MODULE_ID);
            if (moduleConfigDir != null) {
                return moduleConfigDir;
            }
            if (gatewayContext.getSystemManager().getDataDir() != null) {
                return gatewayContext.getSystemManager().getDataDir().toPath()
                    .resolve("modules")
                    .resolve(MODULE_ID);
            }
        }
        return Paths.get("data", "modules", MODULE_ID);
    }

    private void ensureConfigFile() {
        try {
            Files.createDirectories(configDirectory);
            if (!Files.exists(styleMapFile)) {
                Files.writeString(styleMapFile, loadDefaultJson(), StandardCharsets.UTF_8);
            } else if (isLegacyBundledDefault(styleMapFile)) {
                Files.writeString(styleMapFile, loadDefaultJson(), StandardCharsets.UTF_8);
            } else if (migrateBuiltInStateMapDefaults(styleMapFile)) {
                logger.infof("Updated built-in HMI state style defaults in '%s'.", styleMapFile);
            }

            Path readmePath = configDirectory.resolve(README_FILE_NAME);
            if (!Files.exists(readmePath)) {
                Files.writeString(readmePath, README_TEXT, StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            logger.warnf(
                "Failed to prepare HMI state style map file '%s': %s",
                styleMapFile,
                String.valueOf(e.getMessage())
            );
        }
    }

    private String loadDefaultJson() {
        try (InputStream stream = HmiStateStyleMapGatewayService.class.getResourceAsStream(DEFAULT_RESOURCE_NAME)) {
            if (stream != null) {
                return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            logger.warnf(
                "Failed to load bundled HMI state style map defaults '%s': %s",
                DEFAULT_RESOURCE_NAME,
                String.valueOf(e.getMessage())
            );
        }
        return FALLBACK_DEFAULT_JSON;
    }

    private boolean isLegacyBundledDefault(Path file) {
        try {
            String raw = Files.readString(file, StandardCharsets.UTF_8);
            return normalizeJsonText(raw).equals(normalizeJsonText(FALLBACK_DEFAULT_JSON));
        } catch (IOException _ignored) {
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private boolean migrateBuiltInStateMapDefaults(Path file) {
        try {
            String raw = Files.readString(file, StandardCharsets.UTF_8);
            if (raw == null || raw.isBlank()) {
                return false;
            }

            Object existingParsed = gson.fromJson(raw, Object.class);
            Object bundledParsed = gson.fromJson(loadDefaultJson(), Object.class);
            if (!(existingParsed instanceof Map<?, ?> existingRoot)
                || !(bundledParsed instanceof Map<?, ?> bundledRoot)) {
                return false;
            }

            Object existingMapsObject = extractMaps(existingParsed);
            Object bundledMapsObject = extractMaps(bundledParsed);
            if (!(existingMapsObject instanceof Map<?, ?> existingMaps)
                || !(bundledMapsObject instanceof Map<?, ?> bundledMaps)) {
                return false;
            }

            boolean changed = false;
            Map<String, Object> typedExistingMaps = (Map<String, Object>) existingMaps;
            Map<String, Object> typedBundledMaps = (Map<String, Object>) bundledMaps;
            for (String mapName : new String[] {
                "Motor",
                "AIN",
                "DIC",
                "DIC_Generic",
                "Distributor",
                "DOC",
                "Gate",
                "LevelSwitch_Discrete",
                "ScaleAdaptor",
                "TwoWay",
                "Diverter"
            }) {
                changed |= replaceLegacyBuiltInMap(typedExistingMaps, typedBundledMaps, mapName);
            }
            changed |= addMissingBundledStyleDefinitions((Map<String, Object>) existingRoot, bundledParsed);

            if (changed) {
                Files.writeString(file, gson.toJson(existingParsed), StandardCharsets.UTF_8);
            }
            return changed;
        } catch (Exception _ignored) {
            return false;
        }
    }

    private boolean replaceLegacyBuiltInMap(
        Map<String, Object> existingMaps,
        Map<String, Object> bundledMaps,
        String mapName
    ) {
        Object bundled = bundledMaps.get(mapName);
        if (!(bundled instanceof Map<?, ?>)) {
            return false;
        }
        Object current = existingMaps.get(mapName);
        if (!isLegacyBuiltInMap(current, bundled)) {
            return false;
        }
        existingMaps.put(mapName, bundled);
        return true;
    }

    private boolean isLegacyBuiltInMap(Object mapObject, Object bundledMapObject) {
        if (!(mapObject instanceof Map<?, ?> map)) {
            return true;
        }
        if (!(bundledMapObject instanceof Map<?, ?> bundledMap)) {
            return false;
        }
        if (bundledMap.containsKey("Fallback") && !map.containsKey("Fallback")) {
            return true;
        }
        for (Object key : map.keySet()) {
            if (!bundledMap.containsKey(key)) {
                return true;
            }
        }
        for (Map.Entry<?, ?> entry : bundledMap.entrySet()) {
            Object current = map.get(entry.getKey());
            if (current != null && !String.valueOf(current).equals(String.valueOf(entry.getValue()))) {
                return true;
            }
        }
        return false;
    }

    private boolean addMissingBundledStyleDefinitions(Map<String, Object> root, Object bundledParsed) {
        Object bundledStylesObject = extractNamedObject(bundledParsed, "styles", "classes", "styleClasses", "styleDefinitions");
        if (!(bundledStylesObject instanceof Map<?, ?> bundledStyles)) {
            return false;
        }

        boolean changed = false;
        Map<String, Object> existingStyles = getOrCreateStyleDefinitions(root);
        for (Map.Entry<?, ?> entry : bundledStyles.entrySet()) {
            String styleKey = trimToEmpty(String.valueOf(entry.getKey()));
            if (!styleKey.isBlank() && !existingStyles.containsKey(styleKey)) {
                existingStyles.put(styleKey, entry.getValue());
                changed = true;
            }
        }
        return changed;
    }

    private Map<String, Object> getOrCreateStyleDefinitions(Map<String, Object> root) {
        for (String key : new String[] {"classes", "styles", "styleClasses", "styleDefinitions"}) {
            Object value = root.get(key);
            if (value instanceof Map<?, ?> map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> typed = (Map<String, Object>) map;
                return typed;
            }
        }

        Map<String, Object> styles = new LinkedHashMap<>();
        root.put("classes", styles);
        return styles;
    }

    private String normalizeJsonText(String value) {
        return value == null ? "" : value.replace("\r\n", "\n").trim();
    }

    private String resolveStyleMapDisplayPath(Path resolvedPath) {
        String override = trimToEmpty(System.getenv("MESORA_HMI_STATE_STYLE_MAP_DISPLAY_PATH"));
        if (!override.isBlank()) {
            return override;
        }
        return resolvedPath.toAbsolutePath().normalize().toString();
    }

    private Object extractMaps(Object parsed) {
        Object wrapped = extractNamedObject(
            parsed,
            "hmiStateStyleMaps",
            "udtStateStyleMaps",
            "maps",
            "stateMaps"
        );
        return wrapped == null ? parsed : wrapped;
    }

    private Object extractNamedObject(Object parsed, String... names) {
        if (!(parsed instanceof Map<?, ?> source) || names == null) {
            return null;
        }

        Map<String, Object> byLowerName = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : source.entrySet()) {
            byLowerName.put(String.valueOf(entry.getKey()).trim().toLowerCase(), entry.getValue());
        }

        for (String name : names) {
            String key = trimToEmpty(name).toLowerCase();
            if (!key.isBlank() && byLowerName.containsKey(key)) {
                return byLowerName.get(key);
            }
        }
        return null;
    }

    private int countTopLevelMaps(Object maps) {
        if (maps instanceof Map<?, ?> map) {
            return map.size();
        }
        return 0;
    }

    private String trimToEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    record HmiStateStyleMapResponse(
        Object maps,
        Object styles,
        String filePath,
        long lastModified,
        int mapCount,
        String error
    ) {
    }
}
