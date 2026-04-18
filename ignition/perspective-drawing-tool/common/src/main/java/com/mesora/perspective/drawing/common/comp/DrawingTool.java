package com.mesora.perspective.drawing.common.comp;

import com.inductiveautomation.ignition.common.jsonschema.JsonSchema;
import com.inductiveautomation.perspective.common.api.ComponentDescriptor;
import com.inductiveautomation.perspective.common.api.ComponentDescriptorImpl;
import com.mesora.perspective.drawing.common.MesoraPerspectiveDrawing;

public final class DrawingTool {

    public static final String COMPONENT_ID = "com.mesora.perspective.drawingtool";

    public static final JsonSchema SCHEMA =
        JsonSchema.parse(DrawingTool.class.getResourceAsStream("/drawingtool.props.json"));

    public static final ComponentDescriptor DESCRIPTOR = ComponentDescriptorImpl.ComponentBuilder.newBuilder()
        .setPaletteCategory(MesoraPerspectiveDrawing.COMPONENT_CATEGORY)
        .setId(COMPONENT_ID)
        .setModuleId(MesoraPerspectiveDrawing.MODULE_ID)
        .setSchema(SCHEMA)
        .setName("Vizi Drawing Tool")
        .addPaletteEntry("", "Vizi Drawing Tool", "Renders a bindable drawing document.", null, null)
        .setDefaultMetaName("drawingTool")
        .setResources(MesoraPerspectiveDrawing.BROWSER_RESOURCES)
        .build();

    private DrawingTool() {
    }
}
