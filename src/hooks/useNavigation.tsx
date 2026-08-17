import { createContext, useContext, useEffect, useRef } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";

type NavigationHistory = { path: string; params: Record<string, string> }[];

interface NavigationState {
  history: NavigationHistory;
  index: number;
  canGoBack: boolean;
  canGoForward: boolean;
  currentPath: string;
  params: Record<string, string>;
  setParams: (params: Record<string, string>) => void;
  push: (path: string, params?: Record<string, string>) => void;
  back: () => void;
  forward: () => void;
}

function createNavigationStore(initialPath: string) {
  return createStore<NavigationState>((set, get) => ({
    history: [{ path: initialPath, params: {} }],
    index: 0,
    canGoBack: false,
    canGoForward: false,
    currentPath: initialPath,
    params: {},
    setParams: (params: Record<string, string>) => {
      set((state: any) => ({
        params: { ...state.params, ...params },
        history: [
          ...state.history.slice(0, state.index + 1),
          { path: state.currentPath, params: { ...state.params, ...params } },
        ],
      }));
    },
    push: (path: string, params?: Record<string, string>) => {
      if (path === get().currentPath) return;

      const prevIndex = get().history.findIndex((h) => h.path === path);
      if (prevIndex !== -1) {
        set((state) => ({
          index: prevIndex,
          canGoBack: prevIndex > 0,
          canGoForward: prevIndex < state.history.length - 1,
          currentPath: path,
          params: params || {},
        }));
        return;
      }
      set((state) => ({
        history: [
          ...state.history.slice(0, state.index + 1),
          { path, params: params || {} },
        ],
        index: state.index + 1,
        canGoBack: state.index + 1 > 0,
        canGoForward: state.index + 1 < state.history.length - 1,
        currentPath: path,
        params: params || {},
      }));
    },
    back: () => {
      set((state) => ({
        ...(state.index > 0 && { index: state.index - 1 }),
        canGoBack: state.index - 1 > 0,
        canGoForward: state.index - 1 < state.history.length - 1,
        currentPath: state.history[state.index - 1].path,
        params: state.history[state.index - 1].params,
      }));
    },
    forward: () => {
      set((state) => ({
        ...(state.index < state.history.length - 1 && {
          index: state.index + 1,
        }),
        canGoBack: state.index + 1 > 0,
        canGoForward: state.index + 1 < state.history.length - 1,
        currentPath: state.history[state.index + 1].path,
        params: state.history[state.index + 1].params,
      }));
    },
  }));
}

const NavigationContext = createContext<StoreApi<NavigationState> | null>(null);

export function NavigationProvider({
  children,
  initialPath,
}: {
  children: React.ReactNode;
  initialPath: string;
}) {
  const storeRef = useRef<StoreApi<NavigationState>>();

  if (!storeRef.current) {
    storeRef.current = createNavigationStore(initialPath);
  }

  const back = useStore(storeRef.current).back;
  const forward = useStore(storeRef.current).forward;

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button === 3) {
        back();
      }
      if (event.button === 4) {
        forward();
      }
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [back, forward]);

  return (
    <NavigationContext.Provider value={storeRef.current}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation<T>(selector: (state: NavigationState) => T): T {
  const store = useContext(NavigationContext);
  if (!store) {
    throw new Error("useNavigation must be used within NavigationProvider");
  }
  return useStore(store, selector);
}
