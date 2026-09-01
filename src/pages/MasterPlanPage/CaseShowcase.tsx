import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, ChevronDown, ChevronUp, Tag, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CaseData {
  id: string;
  title: string;
  category: string;
  style: string;
  count: string;
  gradient: string;
  accentColor: string;
  productShape: 'sofa' | 'headphone' | 'skincare';
  thumbnails: { title: string; gradient: string }[];
}

const CASES: CaseData[] = [
  {
    id: 'case-sofa',
    title: '云屿沙发详情页',
    category: '家居家具',
    style: '北欧简约',
    count: '8张',
    gradient: 'from-amber-50 via-orange-50 to-rose-100',
    accentColor: '#d97706',
    productShape: 'sofa',
    thumbnails: [
      { title: '首屏氛围', gradient: 'from-amber-900 to-orange-800' },
      { title: '卖点拆解', gradient: 'from-stone-50 to-amber-50' },
      { title: '材质特写', gradient: 'from-amber-100 to-orange-200' },
      { title: '场景展示', gradient: 'from-emerald-50 to-teal-100' },
    ],
  },
  {
    id: 'case-headphone',
    title: '无线耳机主图',
    category: '3C数码',
    style: '科技未来',
    count: '6张',
    gradient: 'from-slate-900 via-indigo-900 to-purple-900',
    accentColor: '#6366f1',
    productShape: 'headphone',
    thumbnails: [
      { title: '主图1', gradient: 'from-slate-900 to-indigo-900' },
      { title: '主图2', gradient: 'from-purple-900 to-slate-900' },
      { title: '功能介绍', gradient: 'from-indigo-50 to-purple-50' },
    ],
  },
  {
    id: 'case-skincare',
    title: '护肤品套装',
    category: '美妆护肤',
    style: '高级冷淡',
    count: '10张',
    gradient: 'from-stone-100 via-zinc-50 to-neutral-100',
    accentColor: '#78716c',
    productShape: 'skincare',
    thumbnails: [
      { title: '品牌大片', gradient: 'from-stone-900 to-zinc-800' },
      { title: '产品展示', gradient: 'from-stone-100 to-zinc-200' },
      { title: '成分解析', gradient: 'from-emerald-50 to-stone-50' },
      { title: '使用步骤', gradient: 'from-amber-50 to-rose-50' },
    ],
  },
];

function CaseProductVisual({ shape, gradient }: { shape: CaseData['productShape']; gradient: string }) {
  const base = `bg-gradient-to-br ${gradient}`;
  if (shape === 'sofa') {
    return (
      <div className={`w-full h-full ${base} relative overflow-hidden rounded-t-xl`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255_255_255_0.3),transparent_60%)]" />
        {/* 沙发形状 */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <div className="relative">
            {/* 靠背 */}
            <div className="w-40 h-16 bg-gradient-to-b from-amber-700 to-amber-800 rounded-t-2xl" />
            {/* 座垫 */}
            <div className="w-48 h-10 bg-gradient-to-b from-amber-600 to-amber-700 rounded-lg -mt-1 -ml-4 shadow-lg" />
            {/* 扶手 */}
            <div className="absolute left-0 top-4 w-6 h-14 bg-gradient-to-r from-amber-700 to-amber-600 rounded-l-lg" />
            <div className="absolute right-0 top-4 w-6 h-14 bg-gradient-to-l from-amber-700 to-amber-600 rounded-r-lg" />
            {/* 抱枕 */}
            <div className="absolute left-8 top-3 w-8 h-8 bg-gradient-to-br from-rose-200 to-rose-300 rounded-md rotate-[-8deg] shadow-sm" />
            <div className="absolute right-10 top-5 w-7 h-7 bg-gradient-to-br from-amber-200 to-amber-300 rounded-md rotate-[6deg] shadow-sm" />
          </div>
        </div>
        <div className="absolute top-5 left-5">
          <div className="text-xs text-amber-900/60 tracking-widest">NORDIC STYLE</div>
        </div>
      </div>
    );
  }
  if (shape === 'headphone') {
    return (
      <div className={`w-full h-full ${base} relative overflow-hidden rounded-t-xl`}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99_102_241_0.4),transparent_60%)]" />
        {/* 耳机形状 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            {/* 头梁 */}
            <div className="w-20 h-20 border-t-4 border-l-4 border-r-4 border-indigo-400/80 rounded-t-full -mt-8 mx-auto" />
            {/* 耳罩左 */}
            <div className="absolute -left-6 top-8 w-12 h-16 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-xl border border-slate-600/50 flex items-center justify-center">
              <div className="w-6 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600" />
            </div>
            {/* 耳罩右 */}
            <div className="absolute -right-6 top-8 w-12 h-16 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 shadow-xl border border-slate-600/50 flex items-center justify-center">
              <div className="w-6 h-8 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600" />
            </div>
          </div>
        </div>
        <div className="absolute top-5 left-5">
          <div className="text-xs text-indigo-300/60 tracking-widest">TECH FUTURE</div>
        </div>
      </div>
    );
  }
  // skincare
  return (
    <div className={`w-full h-full ${base} relative overflow-hidden rounded-t-xl`}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255_255_255_0.5),transparent_60%)]" />
      {/* 护肤品瓶 */}
      <div className="absolute inset-0 flex items-center justify-center gap-3">
        <div className="relative">
          <div className="w-8 h-3 bg-stone-700 rounded-t-sm mx-auto" />
          <div className="w-12 h-20 bg-gradient-to-b from-stone-200 to-stone-300 rounded-md shadow-lg flex items-center justify-center">
            <div className="w-8 h-1 bg-stone-400 rounded-full" />
          </div>
        </div>
        <div className="relative">
          <div className="w-6 h-4 bg-stone-800 rounded-t-sm mx-auto" />
          <div className="w-14 h-24 bg-gradient-to-b from-white to-stone-100 rounded-md shadow-xl flex items-center justify-center">
            <div className="w-10 h-1.5 bg-stone-400 rounded-full" />
          </div>
        </div>
        <div className="relative">
          <div className="w-7 h-3 bg-stone-600 rounded-t-sm mx-auto" />
          <div className="w-10 h-16 bg-gradient-to-b from-stone-300 to-stone-400 rounded-md shadow-lg flex items-center justify-center">
            <div className="w-6 h-1 bg-stone-500 rounded-full" />
          </div>
        </div>
      </div>
      <div className="absolute top-5 left-5">
        <div className="text-xs text-stone-500 tracking-widest">MINIMAL LUXURY</div>
      </div>
    </div>
  );
}

export default function CaseShowcase() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <aside className="w-72 shrink-0 h-full overflow-y-auto border-l border-border/50 bg-card/30 p-4 hidden xl:block">
      <div className="flex items-center gap-2 mb-4 sticky top-0 bg-card/80 backdrop-blur-sm -mx-4 -mt-4 px-4 py-3 border-b border-border/50 z-10">
        <div className="size-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <Lightbulb className="size-4 text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold">案例展示</div>
          <div className="text-xs text-muted-foreground">复杂商品与非常规版式</div>
        </div>
      </div>

      <div className="space-y-4">
        {CASES.map((c) => {
          const expanded = expandedId === c.id;
          return (
            <Card
              key={c.id}
              className={cn(
                'overflow-hidden border border-border/60 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group',
                expanded && 'ring-2 ring-primary/20',
              )}
              onClick={() => setExpandedId(expanded ? null : c.id)}
            >
              {/* 封面 */}
              <div className="aspect-[4/3] relative overflow-hidden">
                <CaseProductVisual shape={c.productShape} gradient={c.gradient} />
                <div className="absolute top-3 left-3">
                  <div className="px-2 py-0.5 rounded-full bg-black/40 backdrop-blur-sm text-white text-[10px] font-bold tracking-wider">
                    CASE
                  </div>
                </div>
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                  <div className="text-white text-sm font-semibold drop-shadow-md">
                    {c.title}
                  </div>
                  <div
                    className="size-6 rounded-full bg-white/90 flex items-center justify-center shadow-md"
                    style={{ color: c.accentColor }}
                  >
                    {expanded ? (
                      <ChevronUp className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </div>
                </div>
              </div>

              {/* 信息 */}
              <CardContent className="p-3 space-y-2">
                <div className="flex flex-wrap gap-1">
                  <Badge
                    variant="secondary"
                    className="text-[10px] font-normal px-1.5 py-0 h-4"
                  >
                    <Tag className="size-2.5 mr-0.5" />
                    {c.category}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-normal px-1.5 py-0 h-4"
                  >
                    {c.style}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-normal px-1.5 py-0 h-4"
                  >
                    <Layers className="size-2.5 mr-0.5" />
                    {c.count}
                  </Badge>
                </div>
              </CardContent>

              {/* 展开缩略图 */}
              {expanded && (
                <div className="px-3 pb-3 grid grid-cols-2 gap-1.5">
                  {c.thumbnails.map((t, i) => (
                    <div
                      key={i}
                      className={`relative aspect-video rounded-md overflow-hidden bg-gradient-to-br ${t.gradient} group/thumb`}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="size-6 rounded bg-white/20 backdrop-blur-sm" />
                      </div>
                      <div className="absolute bottom-1 left-1.5 text-[9px] text-white/90 font-medium drop-shadow">
                        {t.title}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </aside>
  );
}
