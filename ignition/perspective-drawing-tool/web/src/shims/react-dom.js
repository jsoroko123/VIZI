const ReactDOM = window.ReactDOM;

if (!ReactDOM) {
    throw new Error("Perspective global ReactDOM was not available.");
}

export default ReactDOM;
export const { createPortal } = ReactDOM;
