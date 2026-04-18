const React = window.React;

if (!React) {
    throw new Error("Perspective global React was not available.");
}

export default React;
export const {
    Children,
    Component,
    Fragment,
    PureComponent,
    Suspense,
    cloneElement,
    createContext,
    createElement,
    forwardRef,
    isValidElement,
    lazy,
    memo,
    startTransition,
    use,
    useActionState,
    useCallback,
    useContext,
    useDebugValue,
    useDeferredValue,
    useEffect,
    useId,
    useImperativeHandle,
    useInsertionEffect,
    useLayoutEffect,
    useMemo,
    useOptimistic,
    useReducer,
    useRef,
    useState,
    useSyncExternalStore,
    useTransition
} = React;
