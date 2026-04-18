import React from "./react";

export const Fragment = React.Fragment;

function withKey(props, key) {
    if (key === undefined) {
        return props;
    }
    return {
        ...(props || {}),
        key
    };
}

export function jsx(type, props, key) {
    return React.createElement(type, withKey(props, key));
}

export const jsxs = jsx;
export const jsxDEV = jsx;
