package com.mesora.perspective.drawing.common;

import java.util.Set;

import com.inductiveautomation.perspective.common.api.BrowserResource;

public final class MesoraPerspectiveDrawing {

    public static final String MODULE_ID = "com.mesora.perspective.drawing";
    public static final String URL_ALIAS = "mesora-drawing";
    public static final String COMPONENT_CATEGORY = "Vizi";
    public static final String RESOURCE_VERSION = "0.1.191";
    public static final String RESOURCE_FILE_NAME = String.format("drawingtool-%s.js", RESOURCE_VERSION);

    public static final Set<BrowserResource> BROWSER_RESOURCES =
        Set.of(
            new BrowserResource(
                String.format("mesora-drawing-tool-js-%s", RESOURCE_VERSION),
                String.format("/res/%s/js/%s", URL_ALIAS, RESOURCE_FILE_NAME),
                BrowserResource.ResourceType.JS
            )
        );

    private MesoraPerspectiveDrawing() {
    }
}
