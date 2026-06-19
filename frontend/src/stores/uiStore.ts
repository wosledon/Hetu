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
  setAppName: (name: string) => void;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSelectedNotebookId: (id?: string) => void;
  setSelectedTagId: (id?: string) => void;
  setSearchQuery: (query: string) => void;
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
      setAppName: (name) => set({ appName: name }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSelectedNotebookId: (id) => set({ selectedNotebookId: id, selectedTagId: undefined }),
      setSelectedTagId: (id) => set({ selectedTagId: id, selectedNotebookId: undefined }),
      setSearchQuery: (query) => set({ searchQuery: query }),
    }),
    {
      name: 'hetu-ui',
      partialize: (state) => ({
        appName: state.appName,
        theme: state.theme,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
