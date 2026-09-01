import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Keyboard,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SHORTCUTS = [
  { key: 'G', label: '跳转到生成', action: '打开 AI 主图详情全案' },
  { key: 'H', label: '返回工作台', action: '回到首页工作台' },
  { key: 'S', label: '风格库', action: '打开风格库' },
];

export default function GlobalShortcuts() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const stored = localStorage.getItem('__app_tujiang_shortcuts_dismissed');
    if (stored === '1') {
      setDismissed(true);
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 忽略输入框内的快捷键
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const key = e.key.toUpperCase();
      if (key === 'G') {
        e.preventDefault();
        navigate('/masterplan');
      } else if (key === 'H') {
        e.preventDefault();
        navigate('/');
      } else if (key === 'S') {
        e.preventDefault();
        navigate('/style-library');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    localStorage.setItem('__app_tujiang_shortcuts_dismissed', '1');
  };

  if (dismissed && location.pathname === '/') {
    return (
      <Button
        variant="secondary"
        size="icon"
        onClick={() => setVisible(true)}
        className={cn(
          'fixed bottom-6 right-6 size-10 rounded-full shadow-lg border border-border/60',
          'z-40 opacity-60 hover:opacity-100 transition-opacity',
        )}
        aria-label="快捷键提示"
      >
        <Keyboard className="size-4" />
      </Button>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-40 transition-all duration-300',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none',
      )}
    >
      <div className="w-64 rounded-xl border border-border/60 bg-card/95 backdrop-blur-md shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Keyboard className="size-4 text-primary" />
            快捷键
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="size-6 hover:bg-muted"
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <div className="p-2 space-y-1.5">
          {SHORTCUTS.map((sc) => (
            <div
              key={sc.key}
              className="flex items-center justify-between text-xs px-2 py-1.5 rounded-md hover:bg-muted/60"
            >
              <span className="text-muted-foreground">{sc.action}</span>
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/60 text-[10px] font-mono font-semibold tabular-nums">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
