# Ignition Tool Help

This guide covers the Vizi drawing tool inside Ignition Perspective Designer.

## Getting Started

- `Move` selects, drags, resizes, and opens properties for items on the canvas.
- `Polyline` draws process flow lines.
- `Text` places a label or a live tag readout.

## Selection And Editing

- Single click selects one item.
- `Shift` plus click adds or removes items from the current selection.
- Drag on empty space to marquee select multiple items.
- Double click an SVG, widget, or text item to open its properties.
- `Shift` plus `Delete` removes the current selection.

## Drawing Lines

- Left click adds a new polyline segment.
- Right click removes the current segment while drawing.
- Double click or `Enter` finishes the line.
- `Shift` locks to the grid.
- `Alt` locks horizontal or vertical.
- `Ctrl` or `Cmd` locks to 45 degree angles.

## SVGs And Equipment

- `SVG Library` opens the Mesora equipment drawer.
- `Tag Path` binds an SVG to an Ignition tag.
- `EType` controls diverters and popup routing.
- Polylines light from the SVG or line connected at their start point.

## Widgets

- `Widgets` opens the Mesora widget drawer.
- Widgets support `Ignition Tag` or `Direct OPC` write targets when applicable.
- `Push Button` and `On Off Button` support titles, title font size, press value, and release value.

## Text Tag Readouts

- Text items can bind directly to an Ignition tag with `Tag Path`.
- `Scale` multiplies the live numeric value.
- `Decimals` controls numeric precision.
- `Units` appends a unit suffix to the displayed value.

## Shortcuts

- `Shift + M` = Move
- `Shift + P` = Polyline
- `Shift + T` = Text
- `Shift + C` = Copy
- `Shift + V` = Paste
- `Shift + D` = Duplicate
- `Shift + Z` = Undo
- `Shift + Y` = Redo

## Notes

- In design mode the toolbar and editing tools are visible.
- In preview and live mode the canvas should behave as runtime only.
- If the toolbar does not update after a rebuild, fully close and reopen the Designer.
