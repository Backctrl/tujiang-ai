import { useState, useMemo } from 'react';
import {
  Search,
  Heart,
  ArrowUpDown,
  Palette,
  Tag,
  Layers,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { scopedStorage } from '@lark-apaas/client-toolkit-lite';
import { MOCK_LIBRARY_STYLES, type ILibraryStyle } from '@/data/library-styles';
import { cn } from '@/lib/utils';
import { Image } from '@/components/ui/image';
import { useEffect } from 'react';

const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'home', label: '家居家具' },
  { value: 'digital', label: '3C数码' },
  { value: 'fashion', label: '服装服饰' },
  { value: 'beauty', label: '美妆护肤' },
  { value: 'food', label: '食品生鲜' },
  { value: 'mom', label: '母婴宠物' },
  { value: 'sports', label: '运动户外' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: '最新' },
  { value: 'hottest', label: '最热门' },
  { value: 'used', label: '使用最多' },
];

const FAV_KEY = '__app_tujiang_fav_styles';

function StylePreviewVisual({ style }: { style: ILibraryStyle }) {
  const base = `bg-gradient-to-br ${style.gradient} relative overflow-hidden`;
  const shape = style.previewStyle;

  const shapeEl = (() => {
    if (shape === 'sofa') {
      return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 scale-75">
          <div className="w-24 h-8 bg-gradient-to-b from-amber-700/80 to-amber-800/80 rounded-t-xl" />
          <div className="w-32 h-5 bg-gradient-to-b from-amber-600/80 to-amber-700/80 rounded-md -mt-0.5 -ml-4" />
        </div>
      );
    }
    if (shape === 'headphone') {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative scale-90">
            <div className="w-14 h-14 border-t-2 border-l-2 border-r-2 border-indigo-300/60 rounded-t-full -mt-6 mx-auto" />
            <div className="absolute -left-3 top-4 w-7 h-10 rounded-md bg-gradient-to-br from-slate-700/80 to-slate-900/80 shadow-lg" />
            <div className="absolute -right-3 top-4 w-7 h-10 rounded-md bg-gradient-to-br from-slate-700/80 to-slate-900/80 shadow-lg" />
          </div>
        </div>
      );
    }
    if (shape === 'dress') {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className="w-16 h-20 bg-gradient-to-b from-rose-300/80 to-pink-500/80 rounded-t-full rounded-b-3xl" />
            <div className="absolute -left-4 top-4 w-4 h-8 bg-gradient-to-b from-rose-300/60 to-pink-400/60 rounded-full" />
            <div className="absolute -right-4 top-4 w-4 h-8 bg-gradient-to-b from-rose-300/60 to-pink-400/60 rounded-full" />
          </div>
        </div>
      );
    }
    if (shape === 'skincare') {
      return (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5">
          <div className="relative">
            <div className="w-4 h-1.5 bg-stone-700/60 rounded-t-sm mx-auto" />
            <div className="w-6 h-12 bg-gradient-to-b from-white/80 to-stone-200/80 rounded-md shadow" />
          </div>
          <div className="relative">
            <div className="w-3 h-2 bg-stone-800/60 rounded-t-sm mx-auto" />
            <div className="w-7 h-14 bg-gradient-to-b from-white/90 to-stone-100/90 rounded-md shadow-lg" />
          </div>
          <div className="relative">
            <div className="w-3.5 h-1.5 bg-stone-600/60 rounded-t-sm mx-auto" />
            <div className="w-5 h-10 bg-gradient-to-b from-stone-200/80 to-stone-300/80 rounded-md shadow" />
          </div>
        </div>
      );
    }
    if (shape === 'food') {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="size-16 rounded-full bg-gradient-to-br from-orange-300/80 to-red-400/80 shadow-lg" />
        </div>
      );
    }
    if (shape === 'bottle') {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className="w-4 h-3 bg-stone-600/70 rounded-t-sm mx-auto" />
            <div className="w-8 h-16 bg-gradient-to-b from-cyan-200/80 to-blue-400/80 rounded-b-lg shadow-lg" />
          </div>
        </div>
      );
    }
    if (shape === 'sneaker') {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className="w-20 h-6 bg-gradient-to-b from-white/80 to-stone-100/80 rounded-t-2xl rounded-br-full" />
            <div className="w-24 h-3 bg-gradient-to-b from-stone-700/80 to-stone-900/80 rounded-b-xl -mt-0.5 -ml-2" />
          </div>
        </div>
      );
    }
    // abstract
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="size-16 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 rotate-12" />
        <div className="absolute size-12 rounded-full bg-white/10 -translate-x-6 translate-y-4" />
      </div>
    );
  })();

  return (
    <div className={`w-full h-full ${base}`}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255_255_255_0.25),transparent_60%)]" />
      {shapeEl}
      <div className="absolute top-2.5 left-2.5 text-[9px] font-medium text-white/70 tracking-widest drop-shadow">
        {style.tags[0]?.toUpperCase() || 'STYLE'}
      </div>
    </div>
  );
}

export default function StyleLibraryPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState('hottest');
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<ILibraryStyle | null>(null);

  // 加载收藏
  useEffect(() => {
    try {
      const saved = scopedStorage.getItem(FAV_KEY);
      if (saved) setFavorites(JSON.parse(saved));
    } catch {
      // ignore
    }
  }, []);

  const saveFavorites = (list: string[]) => {
    setFavorites(list);
    try {
      scopedStorage.setItem(FAV_KEY, JSON.stringify(list));
    } catch {
      // ignore
    }
  };

  const toggleFavorite = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = favorites.includes(id)
      ? favorites.filter((f) => f !== id)
      : [...favorites, id];
    saveFavorites(next);
    toast.success(
      favorites.includes(id) ? '已取消收藏' : '已加入收藏',
    );
  };

  const filteredStyles = useMemo(() => {
    let list = [...MOCK_LIBRARY_STYLES];

    if (showFavOnly) {
      list = list.filter((s) => favorites.includes(s.id));
    }
    if (category !== 'all') {
      list = list.filter((s) => s.category === category);
    }
    if (keyword.trim()) {
      const kw = keyword.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(kw) ||
          s.tags.some((t) => t.toLowerCase().includes(kw)),
      );
    }

    switch (sort) {
      case 'newest':
        list = list.reverse();
        break;
      case 'used':
        list = list.sort((a, b) => b.useCount - a.useCount);
        break;
      case 'hottest':
      default:
        list = list.sort((a, b) => b.useCount * 0.8 + Math.random() * 1000 - (a.useCount * 0.8 + Math.random() * 1000));
        break;
    }

    return list;
  }, [keyword, category, sort, showFavOnly, favorites]);

  const handleUseStyle = (style: ILibraryStyle) => {
    toast.success(`已选择「${style.name}」，即将跳转到生成页面`);
    setTimeout(() => {
      navigate('/');
      // 用 broadcast 或 storage 传入选中的风格 id
      try {
        scopedStorage.setItem('__app_tujiang_pending_style', style.id);
      } catch {
        // ignore
      }
    }, 500);
  };

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Palette className="size-6 text-primary" />
            风格库
          </h1>
          <p className="text-muted-foreground mt-1">
            精选电商详情页设计风格，一键应用到你的生成任务
          </p>
        </div>

        {/* 搜索 + 排序 + 收藏筛选 */}
        <div className="mb-6 flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          <div className="flex-1 relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="搜索风格名称或标签"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border/50">
              <Heart
                className={cn(
                  'size-4',
                  showFavOnly ? 'fill-rose-500 text-rose-500' : 'text-muted-foreground',
                )}
              />
              <span className="text-sm">我的收藏</span>
              <Switch checked={showFavOnly} onCheckedChange={setShowFavOnly} />
            </div>

            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 分类标签 */}
        <div className="mb-6 flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat.value}
              variant={category === cat.value ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setCategory(cat.value)}
              className={cn(
                'rounded-full transition-all',
                category === cat.value ? '' : 'bg-muted/60 hover:bg-muted',
              )}
            >
              {cat.label}
            </Button>
          ))}
        </div>

        {/* 风格卡片网格 */}
        {filteredStyles.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <div className="text-muted-foreground">
                {showFavOnly ? '还没有收藏的风格' : '没有找到匹配的风格'}
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {filteredStyles.map((style, i) => {
              const isFav = favorites.includes(style.id);
              return (
                <motion.div
                  key={style.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (i % 12) * 0.05, duration: 0.4 }}
                >
                  <Card
                    className="overflow-hidden border border-border/60 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group"
                    onClick={() => setSelectedStyle(style)}
                  >
                    <div className="aspect-square relative overflow-hidden">
                      <StylePreviewVisual style={style} />
                      {/* 收藏按钮 */}
                      <button
                        type="button"
                        onClick={(e) => toggleFavorite(style.id, e)}
                        className="absolute top-2 right-2 size-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-colors"
                      >
                        <Heart
                          className={cn(
                            'size-3.5',
                            isFav && 'fill-rose-500 text-rose-500',
                          )}
                        />
                      </button>
                      {/* 使用按钮 hover 显示 */}
                      <div className="absolute inset-x-2 bottom-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="sm"
                          className="w-full h-8 text-xs shadow-lg"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUseStyle(style);
                          }}
                        >
                          使用此风格
                        </Button>
                      </div>
                    </div>
                    <CardContent className="p-3">
                      <div className="text-sm font-semibold truncate">{style.name}</div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {style.tags.slice(0, 2).map((t) => (
                          <Badge
                            key={t}
                            variant="secondary"
                            className="text-[10px] font-normal px-1.5 py-0 h-4"
                          >
                            {t}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <Layers className="size-3" />
                        <span className="tabular-nums">
                          {style.useCount.toLocaleString()} 次使用
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* 风格详情弹窗 */}
      <AnimatePresence>
        {selectedStyle && (
          <Dialog open={!!selectedStyle} onOpenChange={(o) => !o && setSelectedStyle(null)}>
            <DialogContent className="max-w-2xl p-0 overflow-hidden">
              <div className="aspect-[16/9] relative">
                <StylePreviewVisual style={selectedStyle} />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(selectedStyle.id);
                  }}
                  className="absolute top-4 right-4 size-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/50 transition-colors"
                >
                  <Heart
                    className={cn(
                      'size-5',
                      favorites.includes(selectedStyle.id) &&
                        'fill-rose-500 text-rose-500',
                    )}
                  />
                </button>
              </div>
              <DialogHeader className="p-6 pb-0">
                <DialogTitle className="text-xl">{selectedStyle.name}</DialogTitle>
                <DialogDescription className="mt-1">
                  {selectedStyle.description}
                </DialogDescription>
              </DialogHeader>
              <div className="p-6 pt-4 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="text-xs text-muted-foreground mb-2">配色方案</div>
                    <div className="flex gap-2">
                      {selectedStyle.colors.map((c, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div
                            className="size-8 rounded-lg border border-border shadow-sm"
                            style={{ backgroundColor: c }}
                          />
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {c}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">适用品类</div>
                    <div className="font-medium flex items-center gap-1">
                      <Tag className="size-3.5 text-primary" />
                      {selectedStyle.categoryLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">使用次数</div>
                    <div className="font-medium flex items-center gap-1 tabular-nums">
                      <Layers className="size-3.5 text-primary" />
                      {selectedStyle.useCount.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">风格标签</div>
                    <div className="flex flex-wrap gap-1">
                      {selectedStyle.tags.slice(0, 2).map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px] font-normal">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter className="p-6 pt-0">
                <Button
                  variant="secondary"
                  onClick={() => setSelectedStyle(null)}
                >
                  <Eye className="size-4 mr-2" />
                  预览大图
                </Button>
                <Button onClick={() => handleUseStyle(selectedStyle)}>
                  <Palette className="size-4 mr-2" />
                  使用此风格
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
