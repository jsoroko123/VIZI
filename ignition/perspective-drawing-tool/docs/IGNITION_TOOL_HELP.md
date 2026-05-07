# Ignition Tool Help

This guide covers the Vizi drawing tool inside Ignition Perspective Designer and Perspective runtime.

## Getting Started

- Use `Move` to select, drag, resize, rotate, flip, and edit canvas items.
- Use `Polyline` to draw process flow lines.
- Use `Text` to place a label or a live tag readout.
- Use `SVG Library` to place equipment symbols.
- Use `Widgets` to place buttons, readouts, charts, gauges, countdown bars, weather, and embedded view buttons.
- The toolbar stays visible while scrolling. Drag it to a better spot, or use `Dock` to return it to the default position.

## Selection And Editing

- Single click selects one item.
- `Shift` plus click adds or removes items from the current selection.
- Drag on empty space to marquee select multiple items.
- Double click an SVG, widget, line, or text item to open its properties.
- If the properties window is already open, selecting another item updates the contents without moving the window.
- The properties window can be dragged and resized.
- `Shift` plus `Delete` removes the current selection.
- `Page Up` moves selected SVGs forward in Z order.
- `Page Down` moves selected SVGs backward in Z order.
- Right click selected items for copy, cut, duplicate, delete, align, and tag path actions.
- Multi-select SVGs, right click, then use `Set Tag Path` to apply one tag path to all selected SVGs.
- Right click a tag in the tag picker to copy just the tag path.

## Drawing Lines

- Left click adds a new polyline segment.
- Right click removes the current segment while drawing.
- Double click or `Enter` finishes the line.
- `Shift` locks to the grid.
- `Alt` locks horizontal or vertical.
- `Ctrl` or `Cmd` locks to 45 degree angles.
- Polyline properties support solid, dashed, dotted, and wavy styles.
- Polyline properties support start and end arrows.
- Line crossings add a small gap only when one polyline crosses another polyline.
- Polylines light from connected equipment or from another lit polyline at the start point.

## SVGs And Equipment

- `SVG Library` opens the equipment drawer.
- Right click empty canvas space to open the compact SVG quick list.
- Type in the quick list search box to filter symbols.
- `Import SVG` copies an external SVG into the gateway external SVG library and refreshes the list.
- External SVGs are normalized on import so default fill, stroke, `eType`, and binding targets can work.
- `Tag Path` binds an SVG to an Ignition tag or UDT instance.
- `EType` is a dropdown populated from Ignition UDTs when available.
- `Static` makes an SVG non-clickable, removes the missing-tag bubble, and returns it to default static colors.
- `Flip` reverses an SVG.
- `Rotation` rotates an SVG.
- Corner resize handles keep aspect ratio.
- `Match Stroke` updates SVG stroke styling without adding decorative circles to symbols.
- Duplicate tag paths are highlighted in the tag bubbles.
- Connected SVGs that share the same tag can suppress duplicate bubbles so one connected equipment group is easier to read.

## HMI State, Styles, And UDTs

- HMI state style mapping is read from `hmi-state-style-maps.json`.
- Mapping can also be overridden with `props.hmiStateStyleMaps`.
- Common UDT mappings include `Motor`, `DOC`, `DIC`, `AIN`, `ScaleAdaptor`, `Distributor`, `LevelSwitch_Discrete`, `TwoWay`, `Diverter`, and `Gate`.
- Diverter SVGs use `TwoWay` popup routing and state logic.
- Gate SVGs can use gate visual styles while still opening the TwoWay UDT popup when that is how the Ignition UDT is modeled.
- TwoWay and Diverter internals use the mapped HMI state style for the active straight or divert path.
- SVG and polyline lighting depends on current live tag values, state mappings, and route connections.

## Tag Picker And Live Tags

- The tag picker searches by name, path, UDT, and provider.
- The tag picker scrolls to the selected tag when opened.
- UDT rows can be expanded to select child tags directly.
- Document tags are hidden from the tag picker.
- Text items can bind directly to any readable tag.
- Text tag readouts support `Scale`, `Decimals`, and `Units`.
- Hovering an SVG in preview or live mode shows the tag `Description` tooltip when available.

## Widgets

- `Widgets` opens the widget drawer.
- Widget text follows the current Perspective theme: `terra-dark` and `terra-light`.
- Widget font color and button text color can still be set manually in properties.
- `Push Button` and `On Off Button` support titles, title font size, press value, release value, write target, and button text color.
- `Open View` buttons open a Perspective view popup. Set the view path in widget properties.
- The opened view fills the popup content area, not the entire screen.
- Widget popups use the configured popup size when provided; otherwise they use a sensible centered size.
- Widgets support `Ignition Tag` and `Direct OPC` write targets when applicable.

## Embedded Views

- `Embedded View` adds a real Perspective view container onto the canvas.
- Set `View Path` to something like `Views/MyView`.
- `View Params JSON` passes parameters into the embedded view.
- `Runtime Interaction` controls whether the embedded view is clickable in preview and live mode.

## Gateway File Storage

- Gateway file storage lets authorized users edit and save graphics from the browser without opening Designer.
- Preferred properties:
  - `props.gatewayStorage.enabled`
  - `props.gatewayStorage.key`
  - `props.gatewayStorage.autoLoad`
  - `props.gatewayStorage.browserEditEnabled`
- Legacy aliases are still supported:
  - `props.drawingStorageEnabled`
  - `props.drawingStorageKey` or `props.gatewayStorageKey`
  - `props.drawingStorageAutoLoad`
  - `props.browserEditEnabled`
- `enabled` turns gateway-backed load/save on.
- `key` is the relative JSON file key for the drawing, for example `AirMakeup/bin-fans`.
- `autoLoad` loads the drawing from gateway storage when the component starts.
- `browserEditEnabled` shows edit tools in runtime. Bind it to an authorized user, role, or security level.
- Saved drawing JSON is stored on the gateway filesystem under the module's drawing storage area.
- Use Designer properties for controlled deployment; use browser editing for authorized runtime touchups.

## Theme And Runtime Behavior

- `props.sessionTheme`, `props.perspectiveTheme`, or `props.theme` can be bound to `session.props.theme`.
- `terra-dark` uses the dark canvas background.
- `terra-light` uses the light canvas background.
- Leave `canvasBackgroundColor` blank, `theme`, `auto`, or `session` to follow the Perspective session theme.
- Set `canvasBackgroundColor` to a real color only when a screen needs a manual override.
- Preview and live mode hide editing affordances unless `browserEditEnabled` is true.
- In live mode, clicking a status bubble hides that bubble for 30 seconds.

## External SVG Library

- Bundled SVGs live in the module resources.
- External SVGs can be dropped into the gateway external SVG library folder and loaded with `Refresh`.
- The import panel can copy a local SVG into the correct external folder for you.
- Imported SVGs should use the standard defaults:
  - fill `#D7DADE`
  - stroke `#808080`
  - fill targets marked with `data-vizi-fill-target="true"` where dynamic fill should apply
- Use `Static` for non-clickable background symbols or decorative symbols.

## Shortcuts

- `Shift + M` = Move
- `Shift + P` = Polyline
- `Shift + T` = Text
- `Shift + C` = Copy
- `Shift + V` = Paste
- `Shift + D` = Duplicate
- `Shift + Z` = Undo
- `Shift + Y` = Redo
- `Page Up` = Move selected SVGs forward
- `Page Down` = Move selected SVGs backward
- `Esc` = Close active popup, cancel draw/edit state, or clear temporary anchor

## Troubleshooting

- If new component properties do not show in Designer, install the newest `.modl`, restart/reopen Designer, and verify the loaded module version.
- If theme does not change the canvas, confirm `session.props.theme` is `terra-dark` or `terra-light`, and confirm `canvasBackgroundColor` is set to `theme`, `auto`, blank, or `session`.
- If SVGs briefly show the wrong color, confirm the SVG has standard default fill/stroke and a valid `eType`.
- If a line does not light, confirm the line start point is connected to the lit SVG or lit source line.
- If tags appear blank, verify the provider, UDT path, tag path, and live tag quality.
- If browser saves do not persist, confirm gateway file storage is enabled, the key is set, and the runtime user is authorized to edit.
- If the toolbar or help content does not update after a rebuild, fully close and reopen Designer.
