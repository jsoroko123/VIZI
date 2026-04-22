package com.mesora.perspective.drawing.gateway;

import static com.mesora.perspective.drawing.common.MesoraPerspectiveDrawing.MODULE_ID;
import static com.mesora.perspective.drawing.common.MesoraPerspectiveDrawing.URL_ALIAS;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import com.inductiveautomation.ignition.common.gson.Gson;
import com.inductiveautomation.ignition.common.gson.GsonBuilder;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;

final class SvgLibraryGatewayService {

    private static final Gson gson = new GsonBuilder().create();
    private static final String BUILTIN_MANIFEST_RESOURCE = "mounted/svg-library/manifest.json";
    private static final String README_FILE_NAME = "README.txt";
    private static final String README_TEXT = String.join(
        System.lineSeparator(),
        "Mesora Drawing Tool External SVG Library",
        "",
        "Drop additional .svg files into this folder or any subfolder.",
        "Then reopen or refresh the SVG Library drawer in Perspective.",
        "No module rebuild is required after this feature is installed.",
        "",
        "Files in this folder appear under the 'External' group in the SVG Library."
    ) + System.lineSeparator();

    private final LoggerEx logger;
    private final Path externalLibraryDirectory;
    private final String externalLibraryDisplayPath;
    private volatile List<SvgCatalogEntry> builtinEntries;

    SvgLibraryGatewayService(GatewayContext gatewayContext, LoggerEx logger) {
        this.logger = logger;
        this.externalLibraryDirectory = resolveExternalLibraryDirectory(gatewayContext);
        this.externalLibraryDisplayPath = resolveExternalLibraryDisplayPath(this.externalLibraryDirectory);
        ensureExternalLibraryDirectory();
    }

    SvgLibraryCatalogResponse getCatalog() {
        ensureExternalLibraryDirectory();

        List<SvgCatalogEntry> builtin = loadBuiltinEntries();
        List<SvgCatalogEntry> external = scanExternalEntries();
        List<SvgCatalogEntry> entries = new ArrayList<>(builtin.size() + external.size());
        entries.addAll(builtin);
        entries.addAll(external);
        entries.sort(
            Comparator.comparing(SvgCatalogEntry::source, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SvgCatalogEntry::name, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SvgCatalogEntry::key, String.CASE_INSENSITIVE_ORDER)
        );

        return new SvgLibraryCatalogResponse(
            entries,
            externalLibraryDisplayPath,
            builtin.size(),
            external.size(),
            ""
        );
    }

    String readExternalSvg(String rawRelativePath) throws IOException {
        ensureExternalLibraryDirectory();
        Path resolvedPath = resolveExternalPath(rawRelativePath);
        if (resolvedPath == null || !Files.isRegularFile(resolvedPath)) {
            return null;
        }
        return Files.readString(resolvedPath, StandardCharsets.UTF_8);
    }

    private Path resolveExternalLibraryDirectory(GatewayContext gatewayContext) {
        if (gatewayContext != null && gatewayContext.getSystemManager() != null) {
            Path moduleConfigDir = gatewayContext.getSystemManager().getModuleConfigDir(MODULE_ID);
            if (moduleConfigDir != null) {
                return moduleConfigDir.resolve("svg-library");
            }
            if (gatewayContext.getSystemManager().getDataDir() != null) {
                return gatewayContext.getSystemManager().getDataDir().toPath()
                    .resolve("modules")
                    .resolve(MODULE_ID)
                    .resolve("svg-library");
            }
        }
        return Paths.get("data", "modules", MODULE_ID, "svg-library");
    }

    private void ensureExternalLibraryDirectory() {
        try {
            Files.createDirectories(externalLibraryDirectory);
            Path readmePath = externalLibraryDirectory.resolve(README_FILE_NAME);
            if (!Files.exists(readmePath)) {
                Files.writeString(readmePath, README_TEXT, StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            logger.warnf(
                "Failed to prepare external SVG library directory '%s': %s",
                externalLibraryDirectory,
                String.valueOf(e.getMessage())
            );
        }
    }

    private String resolveExternalLibraryDisplayPath(Path resolvedPath) {
        String override = trimToEmpty(System.getenv("MESORA_SVG_LIBRARY_DISPLAY_PATH"));
        if (!override.isBlank()) {
            return override;
        }
        return resolvedPath.toAbsolutePath().normalize().toString();
    }

    private List<SvgCatalogEntry> loadBuiltinEntries() {
        List<SvgCatalogEntry> cached = builtinEntries;
        if (cached != null) {
            return cached;
        }

        synchronized (this) {
            if (builtinEntries != null) {
                return builtinEntries;
            }

            List<SvgCatalogEntry> loaded = new ArrayList<>();
            try (InputStream input = SvgLibraryGatewayService.class.getClassLoader().getResourceAsStream(BUILTIN_MANIFEST_RESOURCE)) {
                if (input == null) {
                    logger.warnf("Built-in SVG manifest resource '%s' was unavailable.", BUILTIN_MANIFEST_RESOURCE);
                    builtinEntries = List.of();
                    return builtinEntries;
                }

                try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                    BuiltinManifestEntry[] parsed = gson.fromJson(reader, BuiltinManifestEntry[].class);
                    if (parsed != null) {
                        for (BuiltinManifestEntry entry : parsed) {
                            String key = trimToEmpty(entry == null ? null : entry.key());
                            String name = trimToEmpty(entry == null ? null : entry.name());
                            String url = trimToEmpty(entry == null ? null : entry.url());
                            if (key.isBlank() || url.isBlank()) {
                                continue;
                            }
                            if (name.isBlank()) {
                                name = fallbackNameFromKey(key);
                            }
                            loaded.add(new SvgCatalogEntry(key, name, List.of(url), "built-in"));
                        }
                    }
                }
            } catch (Exception e) {
                logger.warnf("Failed to load built-in SVG manifest: %s", String.valueOf(e.getMessage()));
            }

            builtinEntries = List.copyOf(loaded);
            return builtinEntries;
        }
    }

    private List<SvgCatalogEntry> scanExternalEntries() {
        if (!Files.isDirectory(externalLibraryDirectory)) {
            return List.of();
        }

        Map<String, SvgCatalogEntry> byKey = new LinkedHashMap<>();
        try (var stream = Files.walk(externalLibraryDirectory)) {
            stream
                .filter(Files::isRegularFile)
                .filter(this::isSvgPath)
                .forEach((path) -> {
                    String relativePath = normalizeRelativePath(externalLibraryDirectory.relativize(path).toString());
                    if (relativePath.isBlank()) {
                        return;
                    }

                    String key = "./assets/SVG_Files/External/" + relativePath;
                    String name = trimToEmpty(path.getFileName() == null ? "" : path.getFileName().toString());
                    byKey.put(
                        key.toLowerCase(Locale.ROOT),
                        new SvgCatalogEntry(
                            key,
                            name.isBlank() ? fallbackNameFromKey(relativePath) : name,
                            buildExternalUrlCandidates(relativePath),
                            "external"
                        )
                    );
                });
        } catch (IOException e) {
            logger.warnf(
                "Failed to scan external SVG library directory '%s': %s",
                externalLibraryDirectory,
                String.valueOf(e.getMessage())
            );
        }

        List<SvgCatalogEntry> entries = new ArrayList<>(byKey.values());
        entries.sort(
            Comparator.comparing(SvgCatalogEntry::name, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(SvgCatalogEntry::key, String.CASE_INSENSITIVE_ORDER)
        );
        return entries;
    }

    private Path resolveExternalPath(String rawRelativePath) {
        String relativePath = normalizeRelativePath(rawRelativePath);
        if (relativePath.isBlank()) {
            return null;
        }

        try {
            Path resolved = externalLibraryDirectory.resolve(relativePath).normalize();
            Path root = externalLibraryDirectory.normalize();
            if (!resolved.startsWith(root) || !isSvgPath(resolved)) {
                return null;
            }
            return resolved;
        } catch (InvalidPathException _ignored) {
            return null;
        }
    }

    private List<String> buildExternalUrlCandidates(String relativePath) {
        String encoded = URLEncoder.encode(relativePath, StandardCharsets.UTF_8);
        return List.of(
            "/data/" + URL_ALIAS + "/svg-library-file?path=" + encoded,
            "/main/data/" + URL_ALIAS + "/svg-library-file?path=" + encoded,
            "/data/" + MODULE_ID + "/svg-library-file?path=" + encoded,
            "/main/data/" + MODULE_ID + "/svg-library-file?path=" + encoded
        );
    }

    private boolean isSvgPath(Path path) {
        return isSvgPath(path == null ? "" : String.valueOf(path.getFileName()));
    }

    private boolean isSvgPath(String value) {
        String text = trimToEmpty(value).toLowerCase(Locale.ROOT);
        return !text.isBlank() && text.endsWith(".svg");
    }

    private String normalizeRelativePath(String rawPath) {
        String candidate = trimToEmpty(rawPath).replace('\\', '/');
        while (candidate.startsWith("/")) {
            candidate = candidate.substring(1);
        }
        if (candidate.isBlank()) {
            return "";
        }

        try {
            Path normalized = Paths.get(candidate).normalize();
            if (normalized.isAbsolute()) {
                return "";
            }
            String text = normalized.toString().replace('\\', '/');
            if (text.isBlank() || text.equals(".") || text.startsWith("..") || text.contains("/../")) {
                return "";
            }
            return text;
        } catch (InvalidPathException _ignored) {
            return "";
        }
    }

    private String fallbackNameFromKey(String key) {
        String text = trimToEmpty(key).replace('\\', '/');
        int slashIndex = text.lastIndexOf('/');
        return slashIndex >= 0 ? text.substring(slashIndex + 1) : text;
    }

    private String trimToEmpty(String value) {
        return value == null ? "" : value.trim();
    }

    record SvgCatalogEntry(
        String key,
        String name,
        List<String> urlCandidates,
        String source
    ) {
    }

    record SvgLibraryCatalogResponse(
        List<SvgCatalogEntry> entries,
        String externalDirectory,
        int builtInCount,
        int externalCount,
        String error
    ) {
    }

    private record BuiltinManifestEntry(
        String key,
        String name,
        String url
    ) {
    }
}
