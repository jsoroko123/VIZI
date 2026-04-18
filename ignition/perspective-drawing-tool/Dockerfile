ARG IGNITION_VERSION=8.3.4
FROM inductiveautomation/ignition:${IGNITION_VERSION}

# Bake the signed module into the built-in module location so a fresh gateway
# comes up with the component already available.
COPY build/MesoraPerspectiveDrawingTool.modl /usr/local/bin/ignition/user-lib/modules/
