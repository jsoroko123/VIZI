package com.mesora.perspective.drawing.designer;

import com.inductiveautomation.ignition.common.BundleUtil;
import com.inductiveautomation.ignition.common.licensing.LicenseState;
import com.inductiveautomation.ignition.common.util.LoggerEx;
import com.inductiveautomation.ignition.designer.model.AbstractDesignerModuleHook;
import com.inductiveautomation.ignition.designer.model.DesignerContext;
import com.inductiveautomation.perspective.designer.DesignerComponentRegistry;
import com.inductiveautomation.perspective.designer.api.PerspectiveDesignerInterface;
import com.mesora.perspective.drawing.common.MesoraPerspectiveDrawing;
import com.mesora.perspective.drawing.common.comp.DrawingTool;

public class MesoraPerspectiveDrawingDesignerHook extends AbstractDesignerModuleHook {

    private static final LoggerEx logger =
        LoggerEx.newBuilder().build("com.mesora.perspective.drawing.designer");

    static {
        BundleUtil.get().addBundle(
            MesoraPerspectiveDrawing.URL_ALIAS,
            MesoraPerspectiveDrawingDesignerHook.class.getClassLoader(),
            MesoraPerspectiveDrawing.URL_ALIAS
        );
    }

    private DesignerComponentRegistry registry;

    @Override
    public void startup(DesignerContext context, LicenseState activationState) {
        try {
            PerspectiveDesignerInterface perspectiveDesigner = PerspectiveDesignerInterface.get(context);
            this.registry = perspectiveDesigner == null ? null : perspectiveDesigner.getDesignerComponentRegistry();

            if (this.registry != null) {
                logger.infof(
                    "Registering Vizi Drawing Tool in the Perspective Designer. id=%s category=%s paletteEntries=%d",
                    DrawingTool.DESCRIPTOR.id(),
                    DrawingTool.DESCRIPTOR.paletteCategory(),
                    DrawingTool.DESCRIPTOR.paletteEntries().size()
                );
                this.registry.registerComponent(DrawingTool.DESCRIPTOR);
            } else {
                logger.error("Perspective designer component registry was unavailable.");
            }
        } catch (Exception e) {
            logger.error("Failed to register the Vizi Drawing Tool in the Perspective Designer.", e);
        }
    }

    @Override
    public void shutdown() {
        if (this.registry != null) {
            this.registry.removeComponent(DrawingTool.COMPONENT_ID);
        }
        BundleUtil.get().removeBundle(MesoraPerspectiveDrawing.URL_ALIAS);
    }
}
