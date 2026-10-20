import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccentKey, BackgroundKey } from '../utils/appearance';

type Theme = 'light' | 'dark' | 'system';
type SecondaryMenuStyle = 'flat' | 'collapsed';
type NavStyle = 'top' | 'vertical';
/** 项目树分组依据：分类 / 项目分组 / 连接方式 / 不分组 */
export type ProjectGroupBy = 'category' | 'group' | 'connection' | 'none';
/** 项目树排序依据：手动排序 / 名称 / 更新时间 / 会话数 */
export type ProjectSortBy = 'manual' | 'name' | 'updated' | 'sessions';

interface UIState {
  appName: string;
  assistantName: string;
  assistantPersona: string;
  theme: Theme;
  /** 主题配色（全软件强调色） */
  accent: AccentKey;
  /** 画布背景 */
  background: BackgroundKey;
  /** 毛玻璃（亚克力）材质开关 */
  glass: boolean;
  sidebarCollapsed: boolean;
  secondaryMenuStyle: SecondaryMenuStyle;
  /** Code 页项目树的分组方式 */
  projectGroupBy: ProjectGroupBy;
  /** Code 页项目树的排序方式 */
  projectSortBy: ProjectSortBy;
  navStyle: NavStyle;
  /** 笔记页当前浏览的父级笔记；为空表示根级 */
  selectedNoteParentId?: string;
  /** 当前打开的笔记 Id（跨侧栏 / 列表 / 编辑器联动） */
  selectedNoteId?: string;
  selectedTagId?: string;
  searchQuery: string;
  pinnedNavItems: string[];
  lastMoreItem: string | null;
  setAppName: (name: string) => void;
  setAssistantName: (name: string) => void;
  setAssistantPersona: (persona: string) => void;
  setTheme: (theme: Theme) => void;
  setAccent: (accent: AccentKey) => void;
  setBackground: (background: BackgroundKey) => void;
  setGlass: (glass: boolean) => void;
  toggleSidebar: () => void;
  setSecondaryMenuStyle: (style: SecondaryMenuStyle) => void;
  setProjectGroupBy: (groupBy: ProjectGroupBy) => void;
  setProjectSortBy: (sortBy: ProjectSortBy) => void;
  setNavStyle: (style: NavStyle) => void;
  setSelectedNoteParentId: (id?: string) => void;
  setSelectedNoteId: (id?: string) => void;
  setSelectedTagId: (id?: string) => void;
  setSearchQuery: (query: string) => void;
  setPinnedNavItems: (items: string[]) => void;
  setLastMoreItem: (path: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      appName: 'Hetu',
      assistantName: 'AI 助手',
      assistantPersona: '',
      theme: 'light',
      accent: 'blue',
      background: 'solid',
      glass: true,
      sidebarCollapsed: false,
      secondaryMenuStyle: 'flat',
      projectGroupBy: 'category',
      projectSortBy: 'manual',
      navStyle: 'top',
      selectedNoteParentId: undefined,
      selectedNoteId: undefined,
      selectedTagId: undefined,
      searchQuery: '',
      pinnedNavItems: [],
      lastMoreItem: null,
      setAppName: (name) => set({ appName: name }),
      setAssistantName: (name) => set({ assistantName: name }),
      setAssistantPersona: (persona) => set({ assistantPersona: persona }),
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setBackground: (background) => set({ background }),
      setGlass: (glass) => set({ glass }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSecondaryMenuStyle: (style) => set({ secondaryMenuStyle: style }),
      setProjectGroupBy: (groupBy) => set({ projectGroupBy: groupBy }),
      setProjectSortBy: (sortBy) => set({ projectSortBy: sortBy }),
      setNavStyle: (style) => set({ navStyle: style }),
      setSelectedNoteParentId: (id) => set({ selectedNoteParentId: id, selectedTagId: undefined }),
      setSelectedNoteId: (id) => set({ selectedNoteId: id }),
      setSelectedTagId: (id) => set({ selectedTagId: id, selectedNoteParentId: undefined }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setPinnedNavItems: (items) => set({ pinnedNavItems: items }),
      setLastMoreItem: (path) => set({ lastMoreItem: path }),
    }),
    {
      name: 'hetu-ui',
      version: 6,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { pinnedNavItems?: string[] } | null
        if (state && Array.isArray(state.pinnedNavItems)) {
          if (version < 2) {
            state.pinnedNavItems = state.pinnedNavItems.flatMap((p) =>
              p === '/tasks' ? ['/tasks/background', '/tasks/scheduled'] : [p]
            )
          }
          // v3：导航菜单默认全部关闭，清空历史固定项
          if (version < 3) state.pinnedNavItems = []
          // v5：Work 页更名 Code，路由从 /work 迁到 /code
          if (version < 5) {
            state.pinnedNavItems = state.pinnedNavItems.map((p) => (p === '/work' ? '/code' : p))
          }
        }
        // v6：新增项目树分组/排序偏好，旧状态缺字段，走默认值
        return state as Partial<UIState>
      },
      partialize: (state) => ({
        appName: state.appName,
        assistantName: state.assistantName,
        assistantPersona: state.assistantPersona,
        theme: state.theme,
        accent: state.accent,
        background: state.background,
        sidebarCollapsed: state.sidebarCollapsed,        secondaryMenuStyle: state.secondaryMenuStyle,
        projectGroupBy: state.projectGroupBy,
        projectSortBy: state.projectSortBy,
        navStyle: state.navStyle,
        pinnedNavItems: state.pinnedNavItems,
        glass: state.glass,
      }),
    }
  )
);
