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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.inductiveautomation.ignition.common.gson.Gson;
import com.inductiveautomation.ignition.common.gson.GsonBuilder;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;

final class SvgLibraryGatewayService {

    private static final Gson gson = new GsonBuilder().create();
    private static final String BUILTIN_MANIFEST_RESOURCE = "mounted/svg-library/manifest.json";
    private static final String README_FILE_NAME = "README.txt";
    private static final String DEFAULT_SVG_FILL = "#D7DADE";
    private static final String DEFAULT_SVG_STROKE = "#808080";
    private static final String DEFAULT_SVG_GRADIENT_START = "#e7e9ec";
    private static final String DEFAULT_SVG_GRADIENT_END = "#b8bdc4";
    private static final double DEFAULT_SVG_WORLD_STROKE_WIDTH = 1.5d;
    private static final int MAX_IMPORTED_SVG_CHARS = 2_000_000;
    private static final Pattern SVG_TAG_PATTERN = Pattern.compile("<svg\\b[^>]*>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern STOP_TAG_PATTERN = Pattern.compile("<stop\\b[^>]*>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern STYLE_ATTR_PATTERN = Pattern.compile("\\bstyle\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern STOP_COLOR_ATTR_PATTERN = Pattern.compile("\\bstop-color\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern STROKE_ATTR_PATTERN = Pattern.compile("\\bstroke\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern FILL_ATTR_PATTERN = Pattern.compile("\\bfill\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern STROKE_WIDTH_ATTR_PATTERN = Pattern.compile("\\bstroke-width\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern SHAPE_TAG_PATTERN = Pattern.compile("<(path|rect|circle|ellipse|polygon|polyline|line)\\b([^>]*?)(/?)>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern PRIMARY_FILL_ID_PATTERN = Pattern.compile("^(body|bodyouter|bodyinner|cyclone|shell|housing|vessel|casing|main|machine|hopper|tank|silo|bin|chute|rect5|path4|vent|vent_open|vent_closed|body[-_].*|.*[-_]body)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern EXCLUDED_FILL_ID_PATTERN = Pattern.compile("(arrow|screen|deck|inside|label|text|bargraph|lock|line|stroke|outline|indicator)", Pattern.CASE_INSENSITIVE);
    private static final Pattern NUMBER_PATTERN = Pattern.compile("[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?");
    private static final String README_TEXT = String.join(
        System.lineSeparator(),
        "Mesora Drawing Tool External SVG Library",
        "",
        "Drop additional .svg files into this folder or any subfolder.",
        "Then reopen or refresh the SVG Library drawer in Perspective.",
        "Refresh normalizes external SVGs to the module baseline style: fill #D7DADE, stroke #808080, and matched stroke width.",
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
        return normalizeExternalSvgFile(resolvedPath, normalizeRelativePath(rawRelativePath));
    }

    SvgLibraryUploadResponse uploadExternalSvg(String rawFileName, String rawFolder, String rawContent) {
        ensureExternalLibraryDirectory();

        String fileName = sanitizeImportedFileName(rawFileName);
        if (fileName.isBlank()) {
            return SvgLibraryUploadResponse.error("Choose an .svg file to import.", externalLibraryDisplayPath);
        }
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".svg")) {
            return SvgLibraryUploadResponse.error("Only .svg files can be imported.", externalLibraryDisplayPath);
        }

        String rawSvg = rawContent == null ? "" : rawContent;
        if (rawSvg.isBlank() || !SVG_TAG_PATTERN.matcher(rawSvg).find()) {
            return SvgLibraryUploadResponse.error("The selected file does not contain an <svg> root element.", externalLibraryDisplayPath);
        }
        if (rawSvg.length() > MAX_IMPORTED_SVG_CHARS) {
            return SvgLibraryUploadResponse.error("The selected SVG is too large to import.", externalLibraryDisplayPath);
        }

        String folder = normalizeRelativePath(rawFolder);
        String relativePath = normalizeRelativePath(folder.isBlank() ? fileName : folder + "/" + fileName);
        if (relativePath.isBlank() || !isSvgPath(relativePath)) {
            return SvgLibraryUploadResponse.error("The selected file name could not be used safely.", externalLibraryDisplayPath);
        }

        try {
            Path root = externalLibraryDirectory.toAbsolutePath().normalize();
            Path target = root.resolve(relativePath).normalize();
            if (!target.startsWith(root)) {
                return SvgLibraryUploadResponse.error("The selected file name could not be used safely.", externalLibraryDisplayPath);
            }

            String normalized = normalizeExternalSvgMarkup(rawSvg, relativePath);
            Files.createDirectories(target.getParent());
            Files.writeString(target, normalized, StandardCharsets.UTF_8);

            SvgCatalogEntry entry = new SvgCatalogEntry(
                "./assets/SVG_Files/External/" + relativePath,
                fallbackNameFromKey(relativePath),
                buildExternalUrlCandidates(relativePath),
                "external"
            );
            return new SvgLibraryUploadResponse(true, relativePath, entry, externalLibraryDisplayPath, "");
        } catch (IOException e) {
            return SvgLibraryUploadResponse.error(
                "Failed to import SVG: " + String.valueOf(e.getMessage()),
                externalLibraryDisplayPath
            );
        }
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

                    try {
                        normalizeExternalSvgFile(path, relativePath);
                    } catch (IOException e) {
                        logger.warnf(
                            "Failed to normalize external SVG '%s': %s",
                            path,
                            String.valueOf(e.getMessage())
                        );
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

    private String normalizeExternalSvgFile(Path path, String relativePath) throws IOException {
        String rawSvg = Files.readString(path, StandardCharsets.UTF_8);
        String normalized = normalizeExternalSvgMarkup(rawSvg, relativePath);
        if (!normalized.equals(rawSvg)) {
            Files.writeString(path, normalized, StandardCharsets.UTF_8);
        }
        return normalized;
    }

    private String normalizeExternalSvgMarkup(String rawSvg, String relativePath) {
        String original = rawSvg == null ? "" : rawSvg;
        Matcher svgMatcher = SVG_TAG_PATTERN.matcher(original);
        if (!svgMatcher.find()) {
            return original;
        }

        String originalRootTag = svgMatcher.group();
        boolean sourceHasEType = hasExplicitEType(original);
        SvgDimensions dimensions = resolveSvgDimensions(originalRootTag);
        String localStrokeWidth = formatSvgNumber(
            DEFAULT_SVG_WORLD_STROKE_WIDTH / Math.max(0.0001d, dimensions.scale())
        );

        String normalized = removeVectorEffect(original);
        if (!sourceHasEType) {
            normalized = replaceStrokeAttributes(normalized);
            normalized = replaceDefaultFillAttributes(normalized);
        }
        normalized = replaceStrokeWidthAttributes(normalized, localStrokeWidth);
        normalized = normalizeStyleAttributes(normalized, localStrokeWidth, !sourceHasEType);
        if (!sourceHasEType) {
            normalized = normalizeClosedStrokeOnlyShapeFills(normalized);
        }
        normalized = ensureShapeStrokeWidths(normalized, localStrokeWidth);
        normalized = markPrimaryFillTarget(normalized);

        Matcher refreshedSvgMatcher = SVG_TAG_PATTERN.matcher(normalized);
        if (refreshedSvgMatcher.find()) {
            String rootTag = refreshedSvgMatcher.group();
            String eType = trimToEmpty(readAttribute(rootTag, "eType"));
            if (eType.isBlank()) {
                eType = inferExternalEType(relativePath);
            }

            String updatedRootTag = rootTag;
            updatedRootTag = upsertAttribute(updatedRootTag, "kewidth", formatSvgNumber(dimensions.keyWidth()));
            updatedRootTag = upsertAttribute(updatedRootTag, "keheight", formatSvgNumber(dimensions.keyHeight()));
            updatedRootTag = upsertAttribute(updatedRootTag, "eType", eType);
            if (!sourceHasEType) {
                updatedRootTag = upsertAttribute(updatedRootTag, "fill", DEFAULT_SVG_FILL);
                updatedRootTag = upsertAttribute(updatedRootTag, "stroke", DEFAULT_SVG_STROKE);
            }
            updatedRootTag = upsertAttribute(updatedRootTag, "stroke-width", localStrokeWidth);
            updatedRootTag = upsertAttribute(updatedRootTag, "stroke-linejoin", "round");
            updatedRootTag = upsertAttribute(updatedRootTag, "stroke-linecap", "round");

            normalized =
                normalized.substring(0, refreshedSvgMatcher.start()) +
                updatedRootTag +
                normalized.substring(refreshedSvgMatcher.end());
        }

        return normalized;
    }

    private String replaceStrokeAttributes(String text) {
        return STROKE_ATTR_PATTERN.matcher(text).replaceAll((match) -> {
            String value = trimToEmpty(match.group(2));
            if (shouldPreservePaint(value)) {
                return match.group();
            }
            String quote = match.group(1);
            return "stroke=" + quote + DEFAULT_SVG_STROKE + quote;
        });
    }

    private String replaceDefaultFillAttributes(String text) {
        return FILL_ATTR_PATTERN.matcher(text).replaceAll((match) -> {
            String value = trimToEmpty(match.group(2));
            if (!shouldNormalizeExternalFill(value)) {
                return match.group();
            }
            String quote = match.group(1);
            return "fill=" + quote + DEFAULT_SVG_FILL + quote;
        });
    }

    private String replaceStrokeWidthAttributes(String text, String localStrokeWidth) {
        return STROKE_WIDTH_ATTR_PATTERN.matcher(text).replaceAll((match) -> {
            double value = firstNumber(match.group(2));
            if (isFinite(value) && value <= 0d) {
                return match.group();
            }
            String quote = match.group(1);
            return "stroke-width=" + quote + localStrokeWidth + quote;
        });
    }

    private String normalizeStyleAttributes(String text, String localStrokeWidth, boolean normalizePaint) {
        return STYLE_ATTR_PATTERN.matcher(text).replaceAll((match) -> {
            String quote = match.group(1);
            String[] declarations = String.valueOf(match.group(2)).split(";");
            List<String> nextDeclarations = new ArrayList<>();
            for (String declaration : declarations) {
                String trimmed = trimToEmpty(declaration);
                if (trimmed.isBlank()) {
                    continue;
                }
                int colonIndex = trimmed.indexOf(':');
                if (colonIndex <= 0) {
                    continue;
                }
                String property = trimToEmpty(trimmed.substring(0, colonIndex));
                String value = trimToEmpty(trimmed.substring(colonIndex + 1));
                if (property.isBlank() || value.isBlank()) {
                    continue;
                }
                String propertyKey = property.toLowerCase(Locale.ROOT);
                if ("vector-effect".equals(propertyKey)) {
                    continue;
                }
                if (normalizePaint && "stroke".equals(propertyKey) && !shouldPreservePaint(value)) {
                    value = DEFAULT_SVG_STROKE;
                } else if (normalizePaint && "fill".equals(propertyKey) && shouldNormalizeExternalFill(value)) {
                    value = DEFAULT_SVG_FILL;
                } else if ("stroke-width".equals(propertyKey)) {
                    double width = firstNumber(value);
                    if (!isFinite(width) || width > 0d) {
                        value = localStrokeWidth;
                    }
                }
                nextDeclarations.add(property + ":" + value);
            }
            if (nextDeclarations.isEmpty()) {
                return "";
            }
            return "style=" + quote + String.join(";", nextDeclarations) + quote;
        });
    }

    private String normalizeClosedStrokeOnlyShapeFills(String text) {
        return SHAPE_TAG_PATTERN.matcher(text).replaceAll((match) -> {
            String tagName = trimToEmpty(match.group(1)).toLowerCase(Locale.ROOT);
            String tag = match.group();
            if (!isClosedStrokeOnlyFillCandidate(tagName, tag)) {
                return tag;
            }
            return upsertTagFillPaint(tag, DEFAULT_SVG_FILL);
        });
    }

    private boolean isClosedStrokeOnlyFillCandidate(String tagName, String tag) {
        if (!("rect".equals(tagName) || "circle".equals(tagName) || "ellipse".equals(tagName) || "polygon".equals(tagName))) {
            return false;
        }
        String id = trimToEmpty(readAttribute(tag, "id")).toLowerCase(Locale.ROOT);
        if (!id.isBlank() && EXCLUDED_FILL_ID_PATTERN.matcher(id).find() && !PRIMARY_FILL_ID_PATTERN.matcher(id).matches()) {
            return false;
        }
        String fill = readAttribute(tag, "fill");
        String styleFill = readStyleProperty(tag, "fill");
        return (fill.isBlank() && styleFill.isBlank()) ||
            shouldPreservePaint(fill) ||
            shouldPreservePaint(styleFill);
    }

    private String upsertTagFillPaint(String tag, String fillValue) {
        String updated = upsertAttribute(tag, "fill", fillValue);
        return STYLE_ATTR_PATTERN.matcher(updated).replaceAll((match) -> {
            String quote = match.group(1);
            List<String> declarations = new ArrayList<>();
            boolean sawFill = false;
            for (String declaration : String.valueOf(match.group(2)).split(";")) {
                String trimmed = trimToEmpty(declaration);
                if (trimmed.isBlank()) {
                    continue;
                }
                int colonIndex = trimmed.indexOf(':');
                if (colonIndex <= 0) {
                    continue;
                }
                String property = trimToEmpty(trimmed.substring(0, colonIndex));
                String value = trimToEmpty(trimmed.substring(colonIndex + 1));
                if (property.isBlank() || value.isBlank()) {
                    continue;
                }
                if ("fill".equalsIgnoreCase(property)) {
                    declarations.add(property + ":" + fillValue);
                    sawFill = true;
                } else {
                    declarations.add(property + ":" + value);
                }
            }
            if (!sawFill) {
                return match.group();
            }
            if (declarations.isEmpty()) {
                return "";
            }
            return "style=" + quote + String.join(";", declarations) + quote;
        });
    }

    private String markPrimaryFillTarget(String text) {
        boolean[] markedAny = { false };
        String marked = SHAPE_TAG_PATTERN.matcher(text).replaceAll((match) -> {
            String tagName = trimToEmpty(match.group(1)).toLowerCase(Locale.ROOT);
            String tag = match.group();
            if (hasAttribute(tag, "data-vizi-fill-target")) {
                markedAny[0] = true;
                return tag;
            }
            if (shouldMarkFillTarget(tagName, tag)) {
                markedAny[0] = true;
                return upsertAttribute(tag, "data-vizi-fill-target", "true");
            }
            return tag;
        });

        if (markedAny[0]) {
            return marked;
        }

        Matcher matcher = SHAPE_TAG_PATTERN.matcher(marked);
        int bestStart = -1;
        int bestEnd = -1;
        int bestScore = Integer.MIN_VALUE;
        String bestTag = "";

        while (matcher.find()) {
            String tagName = trimToEmpty(matcher.group(1)).toLowerCase(Locale.ROOT);
            String tag = matcher.group();
            if (!isFillableShape(tagName) || shapeFillIsDisabled(tag)) {
                continue;
            }

            int score = scoreFillTarget(tag);
            if (score > bestScore) {
                bestStart = matcher.start();
                bestEnd = matcher.end();
                bestScore = score;
                bestTag = tag;
            }
        }

        if (bestStart < 0 || bestTag.isBlank()) {
            return marked;
        }

        String updatedTag = upsertAttribute(bestTag, "data-vizi-fill-target", "true");
        return marked.substring(0, bestStart) + updatedTag + marked.substring(bestEnd);
    }

    private boolean shouldMarkFillTarget(String tagName, String tag) {
        if (!isFillableShape(tagName) || shapeFillIsDisabled(tag)) {
            return false;
        }

        String id = trimToEmpty(readAttribute(tag, "id")).toLowerCase(Locale.ROOT);
        if (!id.isBlank() && EXCLUDED_FILL_ID_PATTERN.matcher(id).find() && !PRIMARY_FILL_ID_PATTERN.matcher(id).matches()) {
            return false;
        }
        if (!id.isBlank() && PRIMARY_FILL_ID_PATTERN.matcher(id).matches()) {
            return true;
        }

        String fill = readAttribute(tag, "fill");
        String styleFill = readStyleProperty(tag, "fill");
        return shouldNormalizeExternalFill(fill) ||
            shouldNormalizeExternalFill(styleFill) ||
            DEFAULT_SVG_FILL.equalsIgnoreCase(trimToEmpty(fill)) ||
            DEFAULT_SVG_FILL.equalsIgnoreCase(trimToEmpty(styleFill));
    }

    private boolean isFillableShape(String tagName) {
        return "path".equals(tagName) ||
            "rect".equals(tagName) ||
            "circle".equals(tagName) ||
            "ellipse".equals(tagName) ||
            "polygon".equals(tagName);
    }

    private int scoreFillTarget(String tag) {
        String id = trimToEmpty(readAttribute(tag, "id")).toLowerCase(Locale.ROOT);
        int score = 0;
        if (!id.isBlank() && PRIMARY_FILL_ID_PATTERN.matcher(id).matches()) {
            score += 1000;
        } else if (!id.isBlank() && EXCLUDED_FILL_ID_PATTERN.matcher(id).find()) {
            score -= 500;
        }

        String fill = readAttribute(tag, "fill");
        String styleFill = readStyleProperty(tag, "fill");
        if (DEFAULT_SVG_FILL.equalsIgnoreCase(trimToEmpty(fill)) || DEFAULT_SVG_FILL.equalsIgnoreCase(trimToEmpty(styleFill))) {
            score += 250;
        }
        if (fill.isBlank() && styleFill.isBlank()) {
            score += 50;
        }
        if (tag.toLowerCase(Locale.ROOT).startsWith("<path")) {
            score += 25;
        }
        return score;
    }

    private boolean shapeFillIsDisabled(String tag) {
        String fill = readAttribute(tag, "fill");
        if (shouldPreservePaint(fill)) {
            return true;
        }
        String styleFill = readStyleProperty(tag, "fill");
        return shouldPreservePaint(styleFill);
    }

    private String ensureShapeStrokeWidths(String text, String localStrokeWidth) {
        return SHAPE_TAG_PATTERN.matcher(text).replaceAll((match) -> {
            String attrs = String.valueOf(match.group(2));
            if (
                hasAttribute(attrs, "stroke-width") ||
                hasStyleProperty(attrs, "stroke-width") ||
                shapeStrokeIsDisabled(attrs)
            ) {
                return match.group();
            }
            return "<" + match.group(1) + attrs + " stroke-width=\"" + localStrokeWidth + "\"" + match.group(3) + ">";
        });
    }

    private String removeVectorEffect(String text) {
        String next = String.valueOf(text);
        next = next.replaceAll("\\s+vector-effect\\s*=\\s*([\"']).*?\\1", "");
        return next;
    }

    private SvgDimensions resolveSvgDimensions(String svgTag) {
        List<Double> viewBoxNumbers = readNumbers(readAttribute(svgTag, "viewBox"), 4);
        double viewBoxWidth = viewBoxNumbers.size() >= 4 ? viewBoxNumbers.get(2) : Double.NaN;
        double viewBoxHeight = viewBoxNumbers.size() >= 4 ? viewBoxNumbers.get(3) : Double.NaN;

        double width = firstNumber(readAttribute(svgTag, "width"));
        double height = firstNumber(readAttribute(svgTag, "height"));
        if (!isFinite(viewBoxWidth) || viewBoxWidth <= 0d) {
            viewBoxWidth = isFinite(width) && width > 0d ? width : 100d;
        }
        if (!isFinite(viewBoxHeight) || viewBoxHeight <= 0d) {
            viewBoxHeight = isFinite(height) && height > 0d ? height : viewBoxWidth;
        }

        double keyWidth = firstNumber(readAttribute(svgTag, "kewidth"));
        double keyHeight = firstNumber(readAttribute(svgTag, "keheight"));
        if (!isFinite(keyWidth) || keyWidth <= 0d) {
            keyWidth = 100d;
        }
        if (!isFinite(keyHeight) || keyHeight <= 0d) {
            keyHeight = viewBoxWidth > 0d ? keyWidth * (viewBoxHeight / viewBoxWidth) : keyWidth;
        }

        double scaleX = viewBoxWidth > 0d ? keyWidth / viewBoxWidth : 1d;
        double scaleY = viewBoxHeight > 0d ? keyHeight / viewBoxHeight : scaleX;
        double scale = (Math.abs(scaleX) + Math.abs(scaleY)) / 2d;
        if (!isFinite(scale) || scale <= 0d) {
            scale = 1d;
        }

        return new SvgDimensions(viewBoxWidth, viewBoxHeight, keyWidth, keyHeight, scale);
    }

    private String inferExternalEType(String relativePath) {
        String path = normalizeRelativePath(relativePath).toLowerCase(Locale.ROOT);
        if (path.startsWith("switches/") || path.contains("/switches/") || path.startsWith("dic/") || path.contains("/dic/")) {
            return "DIC";
        }
        if (path.startsWith("bins/") || path.contains("/bins/") || path.contains("bin")) {
            return "Bin";
        }
        if (path.contains("diverter") || path.contains("distributor") || path.contains("twoway") || path.contains("two_way")) {
            return "TwoWay_DiscreteV2";
        }

        String name = fallbackNameFromKey(path).replaceFirst("(?i)\\.svg$", "");
        String cleaned = name.replaceAll("[^A-Za-z0-9_]+", "_").replaceAll("_+", "_");
        cleaned = cleaned.replaceAll("^_+|_+$", "");
        return cleaned.isBlank() ? "DIC" : cleaned;
    }

    private boolean shouldNormalizeFill(String value) {
        String text = trimToEmpty(value);
        if (text.isBlank() || shouldPreservePaint(text)) {
            return false;
        }
        String lower = text.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
        if ("currentcolor".equals(lower) || "inherit".equals(lower)) {
            return false;
        }
        if (
            "#d7dade".equals(lower) ||
            "white".equals(lower) ||
            "gray".equals(lower) ||
            "grey".equals(lower) ||
            "silver".equals(lower) ||
            "lightgray".equals(lower) ||
            "lightgrey".equals(lower)
        ) {
            return true;
        }
        if (lower.matches("#[0-9a-f]{3}")) {
            int r = Integer.parseInt(lower.substring(1, 2) + lower.substring(1, 2), 16);
            int g = Integer.parseInt(lower.substring(2, 3) + lower.substring(2, 3), 16);
            int b = Integer.parseInt(lower.substring(3, 4) + lower.substring(3, 4), 16);
            return isLightNeutral(r, g, b);
        }
        if (lower.matches("#[0-9a-f]{6}")) {
            int r = Integer.parseInt(lower.substring(1, 3), 16);
            int g = Integer.parseInt(lower.substring(3, 5), 16);
            int b = Integer.parseInt(lower.substring(5, 7), 16);
            return isLightNeutral(r, g, b);
        }
        if (lower.startsWith("rgb(") || lower.startsWith("rgba(")) {
            List<Double> numbers = readNumbers(lower, 4);
            if (numbers.size() >= 3) {
                int r = (int) Math.round(numbers.get(0));
                int g = (int) Math.round(numbers.get(1));
                int b = (int) Math.round(numbers.get(2));
                return isLightNeutral(r, g, b);
            }
        }
        return false;
    }

    private boolean shouldNormalizeExternalFill(String value) {
        return isGradientPaint(value) || shouldNormalizeFill(value);
    }

    private boolean isGradientPaint(String value) {
        return trimToEmpty(value).replaceAll("\\s+", "").toLowerCase(Locale.ROOT).startsWith("url(");
    }

    private boolean isLightNeutral(int r, int g, int b) {
        int max = Math.max(r, Math.max(g, b));
        int min = Math.min(r, Math.min(g, b));
        return max >= 120 && max - min <= 12;
    }

    private boolean shouldPreservePaint(String value) {
        String lower = trimToEmpty(value).replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
        return lower.equals("none") ||
            lower.equals("transparent") ||
            lower.startsWith("url(") ||
            (lower.startsWith("rgba(") && lower.endsWith(",0)")) ||
            (lower.startsWith("hsla(") && lower.endsWith(",0)"));
    }

    private String readAttribute(String text, String name) {
        if (trimToEmpty(text).isBlank() || trimToEmpty(name).isBlank()) {
            return "";
        }
        Pattern pattern = Pattern.compile("\\b" + Pattern.quote(name) + "\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        Matcher matcher = pattern.matcher(text);
        return matcher.find() ? trimToEmpty(matcher.group(2)) : "";
    }

    private boolean hasExplicitEType(String svgTag) {
        return !trimToEmpty(readAttribute(svgTag, "eType")).isBlank() ||
            !trimToEmpty(readAttribute(svgTag, "etype")).isBlank() ||
            !trimToEmpty(readAttribute(svgTag, "data-etype")).isBlank();
    }

    private boolean hasAttribute(String text, String name) {
        if (trimToEmpty(text).isBlank() || trimToEmpty(name).isBlank()) {
            return false;
        }
        Pattern pattern = Pattern.compile("\\b" + Pattern.quote(name) + "\\s*=", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        return pattern.matcher(text).find();
    }

    private boolean hasStyleProperty(String attrs, String propertyName) {
        Matcher matcher = STYLE_ATTR_PATTERN.matcher(String.valueOf(attrs));
        if (!matcher.find()) {
            return false;
        }
        String target = trimToEmpty(propertyName).toLowerCase(Locale.ROOT);
        for (String declaration : String.valueOf(matcher.group(2)).split(";")) {
            int colonIndex = declaration.indexOf(':');
            if (colonIndex <= 0) {
                continue;
            }
            String property = trimToEmpty(declaration.substring(0, colonIndex)).toLowerCase(Locale.ROOT);
            if (target.equals(property)) {
                return true;
            }
        }
        return false;
    }

    private String readStyleProperty(String text, String propertyName) {
        Matcher matcher = STYLE_ATTR_PATTERN.matcher(String.valueOf(text));
        if (!matcher.find()) {
            return "";
        }
        String target = trimToEmpty(propertyName).toLowerCase(Locale.ROOT);
        for (String declaration : String.valueOf(matcher.group(2)).split(";")) {
            int colonIndex = declaration.indexOf(':');
            if (colonIndex <= 0) {
                continue;
            }
            String property = trimToEmpty(declaration.substring(0, colonIndex)).toLowerCase(Locale.ROOT);
            if (target.equals(property)) {
                return trimToEmpty(declaration.substring(colonIndex + 1));
            }
        }
        return "";
    }

    private boolean shapeStrokeIsDisabled(String attrs) {
        String stroke = readAttribute(attrs, "stroke");
        if (shouldPreservePaint(stroke)) {
            return true;
        }
        Matcher matcher = STYLE_ATTR_PATTERN.matcher(String.valueOf(attrs));
        if (!matcher.find()) {
            return false;
        }
        for (String declaration : String.valueOf(matcher.group(2)).split(";")) {
            int colonIndex = declaration.indexOf(':');
            if (colonIndex <= 0) {
                continue;
            }
            String property = trimToEmpty(declaration.substring(0, colonIndex)).toLowerCase(Locale.ROOT);
            if (!"stroke".equals(property)) {
                continue;
            }
            return shouldPreservePaint(declaration.substring(colonIndex + 1));
        }
        return false;
    }

    private String upsertAttribute(String tag, String name, String value) {
        String attr = name + "=\"" + value + "\"";
        Pattern pattern = Pattern.compile("\\b" + Pattern.quote(name) + "\\s*=\\s*([\"']).*?\\1", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        Matcher matcher = pattern.matcher(tag);
        if (matcher.find()) {
            return matcher.replaceFirst(Matcher.quoteReplacement(attr));
        }
        int insertIndex = tag.lastIndexOf('>');
        if (insertIndex < 0) {
            return tag;
        }
        if (insertIndex > 0 && tag.charAt(insertIndex - 1) == '/') {
            insertIndex -= 1;
        }
        return tag.substring(0, insertIndex) + " " + attr + tag.substring(insertIndex);
    }

    private List<Double> readNumbers(String value, int limit) {
        List<Double> numbers = new ArrayList<>();
        Matcher matcher = NUMBER_PATTERN.matcher(trimToEmpty(value));
        while (matcher.find() && numbers.size() < limit) {
            try {
                numbers.add(Double.parseDouble(matcher.group()));
            } catch (NumberFormatException _ignored) {
                // Skip malformed numeric fragments.
            }
        }
        return numbers;
    }

    private double firstNumber(String value) {
        List<Double> numbers = readNumbers(value, 1);
        return numbers.isEmpty() ? Double.NaN : numbers.get(0);
    }

    private boolean isFinite(double value) {
        return !Double.isNaN(value) && !Double.isInfinite(value);
    }

    private String formatSvgNumber(double value) {
        if (!isFinite(value)) {
            return "0";
        }
        String text = String.format(Locale.ROOT, "%.4f", value);
        while (text.contains(".") && text.endsWith("0")) {
            text = text.substring(0, text.length() - 1);
        }
        if (text.endsWith(".")) {
            text = text.substring(0, text.length() - 1);
        }
        return "-0".equals(text) ? "0" : text;
    }

    private String fallbackNameFromKey(String key) {
        String text = trimToEmpty(key).replace('\\', '/');
        int slashIndex = text.lastIndexOf('/');
        return slashIndex >= 0 ? text.substring(slashIndex + 1) : text;
    }

    private String sanitizeImportedFileName(String rawFileName) {
        String name = fallbackNameFromKey(trimToEmpty(rawFileName));
        name = name.replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
        name = name.replaceAll("\\s+", " ");
        while (name.startsWith(".")) {
            name = name.substring(1).trim();
        }
        return name;
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

    record SvgLibraryUploadResponse(
        boolean ok,
        String relativePath,
        SvgCatalogEntry entry,
        String externalDirectory,
        String error
    ) {
        static SvgLibraryUploadResponse error(String error, String externalDirectory) {
            return new SvgLibraryUploadResponse(false, "", null, externalDirectory, trimStatic(error));
        }

        private static String trimStatic(String value) {
            return value == null ? "" : value.trim();
        }
    }

    private record SvgDimensions(
        double viewBoxWidth,
        double viewBoxHeight,
        double keyWidth,
        double keyHeight,
        double scale
    ) {
    }

    private record BuiltinManifestEntry(
        String key,
        String name,
        String url
    ) {
    }
}
