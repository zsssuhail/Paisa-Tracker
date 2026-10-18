import { useEffect } from 'react';
import { useData } from '@/data/store';

/** Applies the theme setting: `system` follows the OS, otherwise a fixed stamp on <html>. */
export function useTheme() {
  const theme = useData((s) => s.settings.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0F0F11' : '#FAFAFA'));
  }, [theme]);
}
