import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

interface UIState {
  appName: string;
  theme: Theme;
  sidebarCollapsed: boolean;
  selectedNotebookId?: string;
  selectedTagId?: string;
  searchQuery: string;
  pinnedNavItems: string[];
  lastMoreItem: string | null;
  setAppName: (name: string) => void;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSelectedNotebookId: (id?: string) => void;
  setSelectedTagId: (id?: string) => void;
  setSearchQuery: (query: string) => void;
  setPinnedNavItems: (items: string[]) => void;
  setLastMoreItem: (path: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      appName: 'Hetu',
      theme: 'light',
      sidebarCollapsed: false,
      selectedNotebookId: undefined,
      selectedTagId: undefined,
      searchQuery: '',
      pinnedNavItems: ['/tags', '/agents', '/skills', '/knowledge-base', '/graph', '/tasks/background', '/tasks/scheduled', '/memories', '/models'],
      lastMoreItem: null,
      setAppName: (name) => set({ appName: name }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSelectedNotebookId: (id) => set({ selectedNotebookId: id, selectedTagId: undefined }),
      setSelectedTagId: (id) => set({ selectedTagId: id, selectedNotebookId: undefined }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setPinnedNavItems: (items) => set({ pinnedNavItems: items }),
      setLastMoreItem: (path) => set({ lastMoreItem: path }),
    }),
    {
      name: 'hetu-ui',
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { pinnedNavItems?: string[] } | null
        if (state && Array.isArray(state.pinnedNavItems) && version < 2) {
          state.pinnedNavItems = state.pinnedNavItems.flatMap((p) =>
            p === '/tasks' ? ['/tasks/background', '/tasks/scheduled'] : [p]
          )
        }
        return state as Partial<UIState>
      },
      partialize: (state) => ({
        appName: state.appName,
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
        pinnedNavItems: state.pinnedNavItems,
      }),
    }
  )
);
