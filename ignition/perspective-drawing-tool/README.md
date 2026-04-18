# Perspective Drawing Tool Module

This module adds a custom Perspective component that renders a drawing document and a separate bound data object.

The component is designed so Ignition Perspective handles bindings through the normal property editor and built-in tag browser. The component itself just renders the drawing and resolves element bindings against `props.data`.

## Component Model

Component type:

`com.mesora.perspective.drawingtool`

Important props:

- `document`: drawing definition JSON
- `data`: runtime values object used by element bindings
- `backgroundColor`: canvas background
- `showGrid`: optional SVG grid overlay
- `gridSize`: grid spacing in drawing units
- `preserveAspectRatio`: passed to the root SVG
- `panZoomEnabled`: reserved for the next iteration

Example `document`:

```json
{
  "viewBox": "0 0 1200 800",
  "elements": [
    {
      "id": "title",
      "type": "text",
      "x": 48,
      "y": 72,
      "text": "Process Area",
      "fontSize": 40,
      "fontWeight": 700,
      "fill": "#f8fafc"
    },
    {
      "id": "tank-shell",
      "type": "rect",
      "x": 84,
      "y": 160,
      "width": 240,
      "height": 360,
      "rx": 24,
      "ry": 24,
      "fill": "#1f2937",
      "stroke": "#475569",
      "strokeWidth": 4
    },
    {
      "id": "tank-fill",
      "type": "rect",
      "x": 104,
      "y": 260,
      "width": 200,
      "height": 180,
      "fill": "#22c55e",
      "bindings": {
        "fill": "tank.fillColor"
      }
    },
    {
      "id": "tank-label",
      "type": "text",
      "x": 204,
      "y": 236,
      "text": "Tank 1",
      "textAnchor": "middle",
      "fontSize": 24,
      "fontWeight": 600,
      "fill": "#e2e8f0",
      "bindings": {
        "text": "tank.label"
      }
    }
  ]
}
```

Example `data`:

```json
{
  "tank": {
    "fillColor": "#38bdf8",
    "label": "Tank 1"
  }
}
```

## Binding Pattern

Use Perspective bindings on `props.data` or on nested properties under `props.data`. The component resolves each element's `bindings` map against that object using dot-path lookup.

Examples:

- `bindings.fill = "tank.fillColor"`
- `bindings.text = "tank.label"`
- `bindings.visible = "tank.visible"`

## Build

This scaffold follows the Ignition 8.3 Perspective component examples and targets Java 17 toolchains.

Typical local commands:

```powershell
cd ignition\perspective-drawing-tool
.\gradlew build
.\gradlew buildModl
```

If you want to install unsigned modules on a dev gateway, enable:

`-Dignition.allowunsignedmodules=true`

## Signing

The build is now signing-aware:

- If `sign.props` exists in the module root, Gradle will produce a signed `.modl`.
- If `sign.props` does not exist, Gradle will keep producing an unsigned `.modl`.

Setup:

1. Copy `sign.props.example` to `sign.props`.
2. Update `key.file` to your signing `.pfx` or `.p12`.
3. Update `cert.file` to your certificate chain `.p7b`.
4. Fill in `key.pass`, `cert.alias`, and `cert.pass`.

For a local dev certificate chain on Windows, you can generate a root CA + signer pair with:

```powershell
.\scripts\generate-dev-signing-chain.ps1 -Password "replace-this-password"
```

That writes `private/mykeys.pfx`, `private/certificates.p7b`, and a matching local `sign.props`.

Useful commands:

```powershell
.\gradlew signingStatus
.\gradlew build
.\gradlew buildSigned
```

With signing configured, the signed module will be emitted from `build/` instead of only `MesoraPerspectiveDrawingTool.unsigned.modl`.

## Docker Dev Gateway

This module folder now includes a derived Ignition image that bakes the signed `.modl` into the container image, plus a compose file for a local dev gateway.

Files:

- `Dockerfile`
- `docker-compose.yml`
- `scripts/docker-dev-up.ps1`

Typical workflow:

```powershell
cd ignition\perspective-drawing-tool
.\gradlew buildSigned
docker compose build gateway
docker compose up -d gateway
```

Or use the helper:

```powershell
.\scripts\docker-dev-up.ps1
```

Default dev gateway URL:

- `http://localhost:9088`

Default dev credentials in `docker-compose.yml`:

- username: `admin`
- password: `mesora-dev-password`

## Next Step

This module gives you the Perspective-native component boundary. The next iteration is extracting the drawing-only core from [CanvasSvg.jsx](c:\Projects\Vizi\app\src\components\CanvasSvg.jsx) and either:

1. serializing that editor's output into `document`, or
2. porting the editor interactions into this module's browser component.
