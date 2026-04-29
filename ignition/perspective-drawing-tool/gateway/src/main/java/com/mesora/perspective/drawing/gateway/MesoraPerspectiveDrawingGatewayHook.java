package com.mesora.perspective.drawing.gateway;

import static com.mesora.perspective.drawing.common.MesoraPerspectiveDrawing.URL_ALIAS;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import jakarta.servlet.http.HttpServletResponse;

import com.inductiveautomation.ignition.common.browsing.BrowseFilter;
import com.inductiveautomation.ignition.common.browsing.Results;
import com.inductiveautomation.ignition.common.gson.Gson;
import com.inductiveautomation.ignition.common.gson.GsonBuilder;
import com.inductiveautomation.ignition.common.licensing.LicenseState;
import com.inductiveautomation.ignition.common.model.values.BasicQualifiedValue;
import com.inductiveautomation.ignition.common.model.values.QualifiedValue;
import com.inductiveautomation.ignition.common.tags.browsing.NodeDescription;
import com.inductiveautomation.ignition.common.tags.config.types.TagObjectType;
import com.inductiveautomation.ignition.common.tags.model.TagPath;
import com.inductiveautomation.ignition.common.tags.model.TagProvider;
import com.inductiveautomation.ignition.common.tags.paths.BasicTagPath;
import com.inductiveautomation.ignition.common.tags.paths.parser.TagPathParser;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.gateway.dataroutes.AccessControlStrategy;
import com.inductiveautomation.ignition.gateway.dataroutes.RouteGroup;
import com.inductiveautomation.ignition.gateway.model.AbstractGatewayModuleHook;
import com.inductiveautomation.ignition.gateway.model.GatewayContext;
import com.inductiveautomation.ignition.gateway.tags.model.GatewayTagManager;
import com.inductiveautomation.ignition.gateway.util.BasicWriteRequest;
import com.inductiveautomation.perspective.common.api.ComponentRegistry;
import com.inductiveautomation.perspective.gateway.api.PerspectiveContext;
import com.mesora.perspective.drawing.common.comp.DrawingTool;

public class MesoraPerspectiveDrawingGatewayHook extends AbstractGatewayModuleHook {

    private static final LoggerEx logger =
        LoggerEx.newBuilder().build("com.mesora.perspective.drawing.gateway");
    private static final Gson gson = new GsonBuilder().create();
    private static final int BROWSE_BATCH_SIZE = 5000;
    private static final long BROWSE_TIMEOUT_SECONDS = 5;
    private static final int BROWSE_PAGE_GUARD = 100;
    private static final String SYSTEM_PROVIDER_NAME = "System";
    private static final String DEFAULT_OPC_SERVER_NAME = "Ignition OPC UA Server";
    private static final String EMPTY_RESPONSE = "";

    private GatewayContext gatewayContext;
    private ComponentRegistry componentRegistry;
    private SvgLibraryGatewayService svgLibraryGatewayService;

    @Override
    public void setup(GatewayContext context) {
        this.gatewayContext = context;
        this.svgLibraryGatewayService = new SvgLibraryGatewayService(context, logger);
        logger.info("Setting up Mesora Perspective Drawing module.");
    }

    @Override
    public void startup(LicenseState activationState) {
        PerspectiveContext perspectiveContext = PerspectiveContext.get(this.gatewayContext);
        this.componentRegistry = perspectiveContext == null ? null : perspectiveContext.getComponentRegistry();

        if (this.componentRegistry != null) {
            logger.info("Registering Vizi Drawing Tool Perspective component.");
            this.componentRegistry.registerComponent(DrawingTool.DESCRIPTOR);
        } else {
            logger.error("Perspective component registry was unavailable.");
        }
    }

    @Override
    public void shutdown() {
        if (this.componentRegistry != null) {
            this.componentRegistry.removeComponent(DrawingTool.COMPONENT_ID);
        }
    }

    @Override
    public Optional<String> getMountedResourceFolder() {
        return Optional.of("mounted");
    }

    @Override
    public Optional<String> getMountPathAlias() {
        return Optional.of(URL_ALIAS);
    }

    @Override
    public void mountRouteHandlers(RouteGroup routes) {
        routes.newRoute("/ignition-tags")
            .handler((request, response) -> browseIgnitionTags())
            .renderer(gson::toJson)
            .type(RouteGroup.TYPE_JSON)
            .accessControl(AccessControlStrategy.OPEN_ROUTE)
            .nocache()
            .mount();

        routes.newRoute("/ignition-tag-values")
            .handler((request, response) -> readIgnitionTagValues(request == null ? null : request.getParameter("paths")))
            .renderer(gson::toJson)
            .type(RouteGroup.TYPE_JSON)
            .accessControl(AccessControlStrategy.OPEN_ROUTE)
            .nocache()
            .mount();

        routes.newRoute("/ignition-tag-write")
            .handler((request, response) -> writeIgnitionTagValue(
                request == null ? null : request.getParameter("path"),
                request == null ? null : request.getParameter("value")
            ))
            .renderer(gson::toJson)
            .type(RouteGroup.TYPE_JSON)
            .accessControl(AccessControlStrategy.OPEN_ROUTE)
            .nocache()
            .mount();

        routes.newRoute("/opc-write")
            .handler((request, response) -> writeOpcValue(
                request == null ? null : request.getParameter("server"),
                request == null ? null : request.getParameter("path"),
                request == null ? null : request.getParameter("value")
            ))
            .renderer(gson::toJson)
            .type(RouteGroup.TYPE_JSON)
            .accessControl(AccessControlStrategy.OPEN_ROUTE)
            .nocache()
            .mount();

        routes.newRoute("/svg-library-catalog")
            .handler((request, response) -> svgLibraryCatalog())
            .renderer(gson::toJson)
            .type(RouteGroup.TYPE_JSON)
            .accessControl(AccessControlStrategy.OPEN_ROUTE)
            .nocache()
            .mount();

        routes.newRoute("/svg-library-file")
            .handler((request, response) -> readExternalSvg(
                request == null ? null : request.getParameter("path"),
                response
            ))
            .renderer((value) -> value == null ? EMPTY_RESPONSE : String.valueOf(value))
            .type(RouteGroup.TYPE_IMG_SVG_XML)
            .accessControl(AccessControlStrategy.OPEN_ROUTE)
            .nocache()
            .mount();
    }

    @Override
    public boolean isFreeModule() {
        return true;
    }

    private SvgLibraryGatewayService.SvgLibraryCatalogResponse svgLibraryCatalog() {
        if (svgLibraryGatewayService == null) {
            return new SvgLibraryGatewayService.SvgLibraryCatalogResponse(
                List.of(),
                "",
                0,
                0,
                "SVG library service was unavailable."
            );
        }
        return svgLibraryGatewayService.getCatalog();
    }

    private String readExternalSvg(String rawRelativePath, HttpServletResponse response) {
        if (svgLibraryGatewayService == null) {
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            return EMPTY_RESPONSE;
        }

        try {
            String svg = svgLibraryGatewayService.readExternalSvg(rawRelativePath);
            if (svg == null || svg.isBlank()) {
                response.setStatus(HttpServletResponse.SC_NOT_FOUND);
                return EMPTY_RESPONSE;
            }
            response.setCharacterEncoding("UTF-8");
            return svg;
        } catch (Exception e) {
            logger.warnf(
                "Failed to read external SVG '%s': %s",
                String.valueOf(rawRelativePath),
                String.valueOf(e.getMessage())
            );
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            return EMPTY_RESPONSE;
        }
    }

    private IgnitionTagBrowseResponse browseIgnitionTags() {
        GatewayTagManager tagManager = this.gatewayContext == null ? null : this.gatewayContext.getTagManager();
        if (tagManager == null) {
            return new IgnitionTagBrowseResponse(List.of(), List.of(), "Ignition tag manager was unavailable.");
        }

        List<String> providers = new ArrayList<>(tagManager.getTagProviderNames());
        providers.removeIf((provider) -> !isBrowsableIgnitionProvider(provider));
        providers.sort(String.CASE_INSENSITIVE_ORDER);

        if (providers.isEmpty()) {
            return new IgnitionTagBrowseResponse(
                List.of(),
                List.of(),
                "No Ignition tag providers were available."
            );
        }

        LinkedHashMap<String, IgnitionTagBrowseItem> byPath = new LinkedHashMap<>();
        for (String provider : providers) {
            browseProviderTags(tagManager, provider, byPath);
        }

        List<IgnitionTagBrowseItem> tags = new ArrayList<>(byPath.values());
        tags.sort(
            Comparator.comparing(IgnitionTagBrowseItem::provider, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(IgnitionTagBrowseItem::path, String.CASE_INSENSITIVE_ORDER)
        );

        return new IgnitionTagBrowseResponse(tags, providers, "");
    }

    private IgnitionTagValueResponse readIgnitionTagValues(String rawPathsParam) {
        GatewayTagManager tagManager = this.gatewayContext == null ? null : this.gatewayContext.getTagManager();
        if (tagManager == null) {
            return new IgnitionTagValueResponse(List.of(), "Ignition tag manager was unavailable.");
        }

        List<String> requestedPaths = parseRequestedTagPaths(rawPathsParam);
        if (requestedPaths.isEmpty()) {
            return new IgnitionTagValueResponse(List.of(), "");
        }

        LinkedHashMap<String, RequestedTagPath> byPath = new LinkedHashMap<>();
        for (String rawPath : requestedPaths) {
            String pathText = String.valueOf(rawPath).trim();
            if (pathText.isBlank()) {
                continue;
            }

            TagPath parsedPath = TagPathParser.parseSafe(pathText);
            if (parsedPath == null) {
                byPath.put(
                    pathText.toLowerCase(),
                    new RequestedTagPath(pathText, null, inferProviderFromPath(pathText))
                );
                continue;
            }

            String provider = String.valueOf(parsedPath.getSource()).trim();
            if (provider.isBlank()) {
                provider = inferProviderFromPath(pathText);
            }

            byPath.put(
                pathText.toLowerCase(),
                new RequestedTagPath(pathText, parsedPath, provider)
            );
        }

        if (byPath.isEmpty()) {
            return new IgnitionTagValueResponse(List.of(), "");
        }

        LinkedHashMap<String, List<RequestedTagPath>> pathsByProvider = new LinkedHashMap<>();
        List<IgnitionTagValueItem> values = new ArrayList<>();

        for (RequestedTagPath request : byPath.values()) {
            if (request.path() == null) {
                values.add(new IgnitionTagValueItem(request.rawPath(), null, "", "", "Failed to parse Ignition tag path."));
                continue;
            }

            String provider = String.valueOf(request.provider()).trim();
            if (!isBrowsableIgnitionProvider(provider)) {
                values.add(new IgnitionTagValueItem(request.rawPath(), null, "", "", "Ignition tag provider was unavailable."));
                continue;
            }

            pathsByProvider.computeIfAbsent(provider, ignored -> new ArrayList<>()).add(request);
        }

        for (String provider : pathsByProvider.keySet()) {
            TagProvider tagProvider = tagManager.getTagProvider(provider);
            List<RequestedTagPath> requests = pathsByProvider.get(provider);
            if (tagProvider == null) {
                for (RequestedTagPath request : requests) {
                    values.add(new IgnitionTagValueItem(request.rawPath(), null, "", "", "Ignition tag provider was unavailable."));
                }
                continue;
            }

            List<TagPath> tagPaths = requests.stream()
                .map(RequestedTagPath::path)
                .filter(Objects::nonNull)
                .toList();

            try {
                List<QualifiedValue> qualifiedValues = tagProvider
                    .readAsync(tagPaths, null)
                    .get(BROWSE_TIMEOUT_SECONDS, TimeUnit.SECONDS);

                for (int index = 0; index < requests.size(); index += 1) {
                    RequestedTagPath request = requests.get(index);
                    QualifiedValue qualifiedValue = index < qualifiedValues.size() ? qualifiedValues.get(index) : null;
                    values.add(
                        new IgnitionTagValueItem(
                            request.rawPath(),
                            normalizeQualifiedValue(qualifiedValue == null ? null : qualifiedValue.getValue()),
                            qualifiedValue == null || qualifiedValue.getQuality() == null ? "" : String.valueOf(qualifiedValue.getQuality()),
                            qualifiedValue == null || qualifiedValue.getTimestamp() == null ? "" : String.valueOf(qualifiedValue.getTimestamp()),
                            ""
                        )
                    );
                }
            } catch (Exception e) {
                logger.warnf(
                    "Failed to read Ignition tag values for provider '%s': %s",
                    provider,
                    String.valueOf(e.getMessage())
                );
                for (RequestedTagPath request : requests) {
                    values.add(new IgnitionTagValueItem(request.rawPath(), null, "", "", String.valueOf(e.getMessage())));
                }
            }
        }

        return new IgnitionTagValueResponse(values, "");
    }

    private IgnitionTagWriteResponse writeIgnitionTagValue(String rawPath, String rawValue) {
        GatewayTagManager tagManager = this.gatewayContext == null ? null : this.gatewayContext.getTagManager();
        if (tagManager == null) {
            return new IgnitionTagWriteResponse(String.valueOf(rawPath).trim(), null, "", "Ignition tag manager was unavailable.");
        }

        String pathText = String.valueOf(rawPath).trim();
        if (pathText.isBlank()) {
            return new IgnitionTagWriteResponse("", null, "", "Ignition tag path is required.");
        }

        TagPath parsedPath = TagPathParser.parseSafe(pathText);
        if (parsedPath == null) {
            return new IgnitionTagWriteResponse(pathText, null, "", "Failed to parse Ignition tag path.");
        }

        String provider = String.valueOf(parsedPath.getSource()).trim();
        if (provider.isBlank()) {
            provider = inferProviderFromPath(pathText);
        }
        if (!isBrowsableIgnitionProvider(provider)) {
            return new IgnitionTagWriteResponse(pathText, null, "", "Ignition tag provider was unavailable.");
        }

        TagProvider tagProvider = tagManager.getTagProvider(provider);
        if (tagProvider == null) {
            return new IgnitionTagWriteResponse(pathText, null, "", "Ignition tag provider was unavailable.");
        }

        Object normalizedValue = parseIncomingWriteValue(rawValue);

        try {
            List<QualifiedValue> values = List.of(new BasicQualifiedValue(normalizedValue));
            List<?> results = tagProvider
                .writeAsync(List.of(parsedPath), values, null)
                .get(BROWSE_TIMEOUT_SECONDS, TimeUnit.SECONDS);

            String quality = "";
            String error = "";
            if (results != null && !results.isEmpty() && results.get(0) != null) {
                Object result = results.get(0);
                quality = String.valueOf(result);
                try {
                    Object good = result.getClass().getMethod("isGood").invoke(result);
                    if (good instanceof Boolean && !((Boolean) good)) {
                        error = quality.isBlank() ? "Ignition write failed." : quality;
                    }
                } catch (Exception _ignored) {
                }
            }

            return new IgnitionTagWriteResponse(pathText, normalizeQualifiedValue(normalizedValue), quality, error);
        } catch (Exception e) {
            logger.warnf(
                "Failed to write Ignition tag value for '%s': %s",
                pathText,
                String.valueOf(e.getMessage())
            );
            return new IgnitionTagWriteResponse(pathText, normalizeQualifiedValue(normalizedValue), "", String.valueOf(e.getMessage()));
        }
    }

    private OpcWriteResponse writeOpcValue(String rawServerName, String rawPath, String rawValue) {
        String serverName = rawServerName == null ? "" : String.valueOf(rawServerName).trim();
        if (serverName.isBlank()) {
            serverName = DEFAULT_OPC_SERVER_NAME;
        }

        String pathText = rawPath == null ? "" : String.valueOf(rawPath).trim();
        if (pathText.isBlank()) {
            return new OpcWriteResponse(serverName, "", null, "", "OPC item path is required.");
        }

        if (this.gatewayContext == null || this.gatewayContext.getOpcManager() == null) {
            return new OpcWriteResponse(serverName, pathText, null, "", "OPC manager was unavailable.");
        }

        Object normalizedValue = parseIncomingWriteValue(rawValue);

        try {
            List<com.inductiveautomation.ignition.gateway.util.OPCWriteRequest> requests = List.of(
                new BasicWriteRequest(serverName, pathText, normalizedValue)
            );
            List<com.inductiveautomation.ignition.common.model.values.QualityCode> results =
                this.gatewayContext.getOpcManager().write(requests);

            String quality = "";
            String error = "";
            if (results != null && !results.isEmpty() && results.get(0) != null) {
                com.inductiveautomation.ignition.common.model.values.QualityCode result = results.get(0);
                quality = String.valueOf(result);
                if (!result.isGood()) {
                    error = quality.isBlank() ? "OPC write failed." : quality;
                }
            }

            return new OpcWriteResponse(serverName, pathText, normalizeQualifiedValue(normalizedValue), quality, error);
        } catch (Exception e) {
            logger.warnf(
                "Failed to write OPC value for server '%s' path '%s': %s",
                serverName,
                pathText,
                String.valueOf(e.getMessage())
            );
            return new OpcWriteResponse(
                serverName,
                pathText,
                normalizeQualifiedValue(normalizedValue),
                "",
                String.valueOf(e.getMessage())
            );
        }
    }

    private void browseProviderTags(
        GatewayTagManager tagManager,
        String provider,
        LinkedHashMap<String, IgnitionTagBrowseItem> byPath
    ) {
        if (provider == null || provider.isBlank()) {
            return;
        }

        TagProvider tagProvider = tagManager.getTagProvider(provider);
        if (tagProvider == null) {
            logger.warnf("No Ignition tag provider named '%s' was available for browse.", provider);
            return;
        }

        TagPath rootPath = TagPathParser.parseSafe("[" + provider + "]");
        if (rootPath == null) {
            rootPath = new BasicTagPath(provider);
        }
        Deque<TagPath> pendingFolders = new ArrayDeque<>();
        Set<String> visitedFolders = new HashSet<>();
        pendingFolders.add(rootPath);
        visitedFolders.add(normalizePathKey(rootPath, provider));

        while (!pendingFolders.isEmpty()) {
            TagPath currentPath = pendingFolders.removeFirst();
            String continuationPoint = null;
            String previousContinuationPoint = null;
            int pageCount = 0;

            do {
                BrowseFilter browseFilter = new BrowseFilter()
                    .setRecursive(false)
                    .setMaxResults(BROWSE_BATCH_SIZE);

                if (continuationPoint != null && !continuationPoint.isBlank()) {
                    browseFilter.setContinuationPoint(continuationPoint);
                }

                Results<NodeDescription> results;
                try {
                    results = tagProvider
                        .browseAsync(currentPath, browseFilter)
                        .get(BROWSE_TIMEOUT_SECONDS, TimeUnit.SECONDS);
                } catch (Exception e) {
                    logger.warnf(
                        "Failed to browse Ignition tags for provider '%s' at '%s': %s",
                        provider,
                        describePath(currentPath, provider),
                        String.valueOf(e.getMessage())
                    );
                    break;
                }

                addBrowseResults(
                    provider,
                    currentPath,
                    results == null ? null : results.getResults(),
                    pendingFolders,
                    visitedFolders,
                    byPath
                );

                continuationPoint = results == null ? null : results.getContinuationPoint();
                pageCount += 1;

                if (
                    continuationPoint != null
                    && !continuationPoint.isBlank()
                    && Objects.equals(previousContinuationPoint, continuationPoint)
                ) {
                    logger.warnf(
                        "Ignition tag browse continuation did not advance for provider '%s' at '%s'.",
                        provider,
                        describePath(currentPath, provider)
                    );
                    break;
                }
                previousContinuationPoint = continuationPoint;

                if (pageCount >= BROWSE_PAGE_GUARD) {
                    logger.warnf(
                        "Ignition tag browse hit the page guard for provider '%s' at '%s'.",
                        provider,
                        describePath(currentPath, provider)
                    );
                    break;
                }
            } while (continuationPoint != null && !continuationPoint.isBlank());
        }
    }

    private boolean isBrowsableIgnitionProvider(String provider) {
        String candidate = String.valueOf(provider).trim();
        return !candidate.isBlank() && !SYSTEM_PROVIDER_NAME.equalsIgnoreCase(candidate);
    }

    private List<String> parseRequestedTagPaths(String rawPathsParam) {
        String raw = String.valueOf(rawPathsParam).trim();
        if (raw.isBlank()) {
            return List.of();
        }

        try {
            String[] parsed = gson.fromJson(raw, String[].class);
            if (parsed != null) {
                List<String> out = new ArrayList<>();
                for (String entry : parsed) {
                    String path = String.valueOf(entry).trim();
                    if (!path.isBlank()) {
                        out.add(path);
                    }
                }
                return out;
            }
        } catch (Exception _ignored) {
        }

        List<String> out = new ArrayList<>();
        for (String entry : raw.split(",")) {
            String path = String.valueOf(entry).trim();
            if (!path.isBlank()) {
                out.add(path);
            }
        }
        return out;
    }

    private String inferProviderFromPath(String rawPath) {
        String path = String.valueOf(rawPath).trim();
        int start = path.indexOf('[');
        int end = path.indexOf(']');
        if (start == 0 && end > start + 1) {
            return path.substring(start + 1, end).trim();
        }
        return "";
    }

    private Object normalizeQualifiedValue(Object rawValue) {
        if (rawValue == null) {
            return null;
        }
        if (
            rawValue instanceof Number
            || rawValue instanceof Boolean
            || rawValue instanceof String
        ) {
            return rawValue;
        }
        return String.valueOf(rawValue);
    }

    private Object parseIncomingWriteValue(String rawValue) {
        String text = String.valueOf(rawValue).trim();
        if (text.isBlank()) {
            return "";
        }
        if ("true".equalsIgnoreCase(text)) {
            return Boolean.TRUE;
        }
        if ("false".equalsIgnoreCase(text)) {
            return Boolean.FALSE;
        }
        try {
            if (text.contains(".") || text.contains("e") || text.contains("E")) {
                return Double.parseDouble(text);
            }
            return Long.parseLong(text);
        } catch (NumberFormatException _ignored) {
        }
        return text;
    }

    private void addBrowseResults(
        String provider,
        TagPath parentPath,
        Collection<NodeDescription> results,
        Deque<TagPath> pendingFolders,
        Set<String> visitedFolders,
        LinkedHashMap<String, IgnitionTagBrowseItem> byPath
    ) {
        if (results == null || results.isEmpty()) {
            return;
        }

        for (NodeDescription node : results) {
            if (node == null) {
                continue;
            }

            TagPath fullPath = coerceNodePath(parentPath, node);
            String fullPathString = fullPath == null ? "" : String.valueOf(fullPath.toStringFull()).trim();
            if (fullPathString.isBlank()) {
                continue;
            }

            if (node.getObjectType() == TagObjectType.Folder) {
                String folderKey = fullPathString.toLowerCase();
                if (visitedFolders.add(folderKey)) {
                    pendingFolders.add(fullPath);
                }
                continue;
            }

            String key = fullPathString.toLowerCase();
            if (byPath.containsKey(key)) {
                continue;
            }

            String objectType = String.valueOf(node.getObjectType() == null ? "" : node.getObjectType()).trim();
            if ("UdtType".equalsIgnoreCase(objectType)) {
                continue;
            }

            String typeId = String.valueOf(node.getSubTypeId() == null ? "" : node.getSubTypeId()).trim();
            String dataType = readNodeText(node, "getDataType", "getDataTypeId");

            byPath.put(
                key,
                new IgnitionTagBrowseItem(
                    fullPathString,
                    provider,
                    String.valueOf(node.getName() == null ? "" : node.getName()).trim(),
                    objectType,
                    typeId,
                    dataType,
                    node.hasChildren()
                )
            );
        }
    }

    private String readNodeText(NodeDescription node, String... methodNames) {
        if (node == null || methodNames == null) {
            return "";
        }

        for (String methodName : methodNames) {
            String name = String.valueOf(methodName).trim();
            if (name.isBlank()) {
                continue;
            }
            try {
                Object value = node.getClass().getMethod(name).invoke(node);
                String text = String.valueOf(value == null ? "" : value).trim();
                if (!text.isBlank()) {
                    return text;
                }
            } catch (Exception _ignored) {
            }
        }

        return "";
    }

    private TagPath coerceNodePath(TagPath parentPath, NodeDescription node) {
        if (node == null) {
            return null;
        }

        TagPath fullPath = node.getFullPath();
        if (fullPath != null) {
            return fullPath;
        }

        String name = String.valueOf(node.getName() == null ? "" : node.getName()).trim();
        if (name.isBlank()) {
            return parentPath;
        }
        if (parentPath == null) {
            return new BasicTagPath(name);
        }
        return BasicTagPath.append(parentPath, name);
    }

    private String normalizePathKey(TagPath path, String provider) {
        return describePath(path, provider).toLowerCase();
    }

    private String describePath(TagPath path, String provider) {
        String fullPath = path == null ? "" : String.valueOf(path.toStringFull()).trim();
        if (!fullPath.isBlank()) {
            return fullPath;
        }
        String providerName = String.valueOf(provider).trim();
        return providerName.isBlank() ? "<root>" : "[" + providerName + "]";
    }

    private record IgnitionTagBrowseItem(
        String path,
        String provider,
        String name,
        String objectType,
        String typeId,
        String dataType,
        boolean hasChildren
    ) {
    }

    private record IgnitionTagBrowseResponse(
        List<IgnitionTagBrowseItem> tags,
        List<String> providers,
        String error
    ) {
    }

    private record RequestedTagPath(
        String rawPath,
        TagPath path,
        String provider
    ) {
    }

    private record IgnitionTagValueItem(
        String path,
        Object value,
        String quality,
        String timestamp,
        String error
    ) {
    }

    private record IgnitionTagValueResponse(
        List<IgnitionTagValueItem> values,
        String error
    ) {
    }

    private record IgnitionTagWriteResponse(
        String path,
        Object value,
        String quality,
        String error
    ) {
    }

    private record OpcWriteResponse(
        String server,
        String path,
        Object value,
        String quality,
        String error
    ) {
    }
}
