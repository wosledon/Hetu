import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { applyAccent, applyBackground } from './appearance';

export function useTheme() {
  const theme = useUIStore((state) => state.theme);
  const accent = useUIStore((state) => state.accent);
  const background = useUIStore((state) => state.background);
  const glass = useUIStore((state) => state.glass);

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mediaQuery.matches);
      root.classList.toggle('dark', isDark);
      root.style.colorScheme = isDark ? 'dark' : 'light';
      // 主题配色与画布背景跟随明暗一起落地
      applyAccent(accent);
      applyBackground(background, isDark);
      // 毛玻璃（亚克力）材质开关
      root.setAttribute('data-glass', glass ? 'on' : 'off');
    };

    applyTheme();

    if (theme !== 'system') {
      return;
    }

    mediaQuery.addEventListener('change', applyTheme);
    return () => mediaQuery.removeEventListener('change', applyTheme);
  }, [theme, accent, background, glass]);

  return theme;
}
