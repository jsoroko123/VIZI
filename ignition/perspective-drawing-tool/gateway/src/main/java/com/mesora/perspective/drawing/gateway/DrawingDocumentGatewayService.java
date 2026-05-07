package com.mesora.perspective.drawing.gateway;

import static com.mesora.perspective.drawing.common.MesoraPerspectiveDrawing.MODULE_ID;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.Locale;

import com.inductiveautomation.ignition.common.gson.Gson;
import com.inductiveautomation.ignition.common.gson.GsonBuilder;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;

final class DrawingDocumentGatewayService {

    private static final Gson gson = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();
    private static final String README_FILE_NAME = "README.txt";
    private static final int MAX_DRAWING_JSON_CHARS = 20_000_000;
    private static final String README_TEXT = String.join(
        System.lineSeparator(),
        "Mesora Drawing Tool Gateway Drawing Storage",
        "",
        "Browser-editable Vizi drawings are saved here as JSON files.",
        "The component property drawingStorageKey selects the file path below this folder.",
        "Use browserEditEnabled only for authorized Perspective users."
    ) + System.lineSeparator();

    private final LoggerEx logger;
    private final Path drawingDirectory;
    private final String drawingDirectoryDisplayPath;

    DrawingDocumentGatewayService(GatewayContext gatewayContext, LoggerEx logger) {
        this.logger = logger;
        this.drawingDirectory = resolveDrawingDirectory(gatewayContext);
        this.drawingDirectoryDisplayPath = this.drawingDirectory.toAbsolutePath().normalize().toString();
        ensureDrawingDirectory();
    }

    DrawingDocumentResponse readDocument(String rawKey) {
        ensureDrawingDirectory();
        String key = normalizeStorageKey(rawKey);
        if (key.isBlank()) {
            return DrawingDocumentResponse.error("Drawing storage key is required.", "", drawingDirectoryDisplayPath);
        }

        Path target = resolveDocumentPath(key);
        if (target == null) {
            return DrawingDocumentResponse.error("Drawing storage key could not be used safely.", key, drawingDirectoryDisplayPath);
        }
        if (!Files.isRegularFile(target)) {
            return new DrawingDocumentResponse(true, false, key, null, displayPath(target), 0, 0, "");
        }

        try {
            String raw = Files.readString(target, StandardCharsets.UTF_8);
            Object document = gson.fromJson(raw, Object.class);
            return new DrawingDocumentResponse(
                true,
                true,
                key,
                document,
                displayPath(target),
                Files.getLastModifiedTime(target).toMillis(),
                Files.size(target),
                ""
            );
        } catch (Exception e) {
            logger.warnf("Failed to read drawing document '%s': %s", target, String.valueOf(e.getMessage()));
            return DrawingDocumentResponse.error("Failed to read drawing document: " + String.valueOf(e.getMessage()), key, displayPath(target));
        }
    }

    DrawingDocumentResponse saveDocument(String rawKey, Object document) {
        ensureDrawingDirectory();
        String key = normalizeStorageKey(rawKey);
        if (key.isBlank()) {
            return DrawingDocumentResponse.error("Drawing storage key is required.", "", drawingDirectoryDisplayPath);
        }
        if (document == null) {
            return DrawingDocumentResponse.error("Drawing document payload is required.", key, drawingDirectoryDisplayPath);
        }

        Path target = resolveDocumentPath(key);
        if (target == null) {
            return DrawingDocumentResponse.error("Drawing storage key could not be used safely.", key, drawingDirectoryDisplayPath);
        }

        String json = gson.toJson(document);
        if (json.length() > MAX_DRAWING_JSON_CHARS) {
            return DrawingDocumentResponse.error("Drawing document is too large to save.", key, displayPath(target));
        }

        Path temp = null;
        try {
            Files.createDirectories(target.getParent());
            temp = Files.createTempFile(target.getParent(), safeTempPrefix(target), ".tmp");
            Files.writeString(temp, json + System.lineSeparator(), StandardCharsets.UTF_8);
            try {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException _ignored) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
            }

            return new DrawingDocumentResponse(
                true,
                true,
                key,
                document,
                displayPath(target),
                Files.getLastModifiedTime(target).toMillis(),
                Files.size(target),
                ""
            );
        } catch (Exception e) {
            if (temp != null) {
                try {
                    Files.deleteIfExists(temp);
                } catch (IOException _ignored) {
                }
            }
            logger.warnf("Failed to save drawing document '%s': %s", target, String.valueOf(e.getMessage()));
            return DrawingDocumentResponse.error("Failed to save drawing document: " + String.valueOf(e.getMessage()), key, displayPath(target));
        }
    }

    String displayDirectory() {
        return drawingDirectoryDisplayPath;
    }

    private Path resolveDrawingDirectory(GatewayContext gatewayContext) {
        if (gatewayContext != null && gatewayContext.getSystemManager() != null) {
            Path moduleConfigDir = gatewayContext.getSystemManager().getModuleConfigDir(MODULE_ID);
            if (moduleConfigDir != null) {
                return moduleConfigDir.resolve("drawings");
            }
            if (gatewayContext.getSystemManager().getDataDir() != null) {
                return gatewayContext.getSystemManager().getDataDir().toPath()
                    .resolve("modules")
                    .resolve(MODULE_ID)
                    .resolve("drawings");
            }
        }
        return Paths.get("data", "modules", MODULE_ID, "drawings");
    }

    private void ensureDrawingDirectory() {
        try {
            Files.createDirectories(drawingDirectory);
            Path readmePath = drawingDirectory.resolve(README_FILE_NAME);
            if (!Files.exists(readmePath)) {
                Files.writeString(readmePath, README_TEXT, StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            logger.warnf(
                "Failed to prepare drawing storage directory '%s': %s",
                drawingDirectory,
                String.valueOf(e.getMessage())
            );
        }
    }

    private Path resolveDocumentPath(String key) {
        String normalized = normalizeStorageKey(key);
        if (normalized.isBlank()) {
            return null;
        }
        try {
            Path root = drawingDirectory.toAbsolutePath().normalize();
            Path resolved = root.resolve(normalized).normalize();
            if (!resolved.startsWith(root) || !resolved.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".json")) {
                return null;
            }
            return resolved;
        } catch (InvalidPathException _ignored) {
            return null;
        }
    }

    private String normalizeStorageKey(String rawKey) {
        String candidate = trimToEmpty(rawKey).replace('\\', '/');
        while (candidate.startsWith("/")) {
            candidate = candidate.substring(1);
        }
        if (candidate.isBlank()) {
            return "";
        }

        String[] parts = candidate.split("/");
        StringBuilder cleaned = new StringBuilder();
        for (String part : parts) {
            String segment = sanitizePathSegment(part);
            if (segment.isBlank()) {
                continue;
            }
            if (cleaned.length() > 0) {
                cleaned.append('/');
            }
            cleaned.append(segment);
        }

        String text = cleaned.toString();
        if (text.isBlank()) {
            return "";
        }
        if (!text.toLowerCase(Locale.ROOT).endsWith(".json")) {
            text += ".json";
        }

        try {
            Path normalized = Paths.get(text).normalize();
            if (normalized.isAbsolute()) {
                return "";
            }
            String out = normalized.toString().replace('\\', '/');
            if (out.isBlank() || out.equals(".") || out.startsWith("..") || out.contains("/../")) {
                return "";
            }
            return out;
        } catch (InvalidPathException _ignored) {
            return "";
        }
    }

    private String sanitizePathSegment(String rawSegment) {
        String segment = trimToEmpty(rawSegment);
        segment = segment.replaceAll("[\\r\\n]+", "");
        segment = segment.replaceAll("[\\\\:*?\"<>|]+", "_");
        segment = segment.replaceAll("\\s+", " ").trim();
        while (segment.startsWith(".")) {
            segment = segment.substring(1).trim();
        }
        return segment;
    }

    private String safeTempPrefix(Path target) {
        String name = target == null || target.getFileName() == null ? "drawing" : target.getFileName().toString();
        name = name.replaceAll("[^a-zA-Z0-9._-]+", "_");
        if (name.length() < 3) {
            name = "drawing";
        }
        return name;
    }

    private String displayPath(Path path) {
        if (path == null) {
            return drawingDirectoryDisplayPath;
        }
        return path.toAbsolutePath().normalize().toString();
    }

    private String trimToEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    record DrawingDocumentResponse(
        boolean ok,
        boolean exists,
        String key,
        Object document,
        String filePath,
        long lastModified,
        long size,
        String error
    ) {
        static DrawingDocumentResponse error(String error, String key, String filePath) {
            return new DrawingDocumentResponse(false, false, trimStatic(key), null, trimStatic(filePath), 0, 0, trimStatic(error));
        }

        private static String trimStatic(String value) {
            return value == null ? "" : value.trim();
        }
    }
}
