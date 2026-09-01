import { useEffect, useState, useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
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
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Download,
  Image as ImageIcon,
  RefreshCw,
  Coins,
  Sparkles,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Star,
  ShieldCheck,
  Truck,
  Package,
  Settings,
  Heart,
  Crop,
  Type,
  Wand2,
  ChevronDown,
  Palette,
  X,
  ZoomIn,
  Copy,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { ImageTypeConfig } from './Step1ImageType';
import type { ProductInfo } from './Step4ProductInfo';
import { MOCK_STYLES } from '@/data/styles';
import type { CustomStyleResult } from './Step3Style';

interface Step5ResultProps {
  imageTypes: ImageTypeConfig;
  styleId: string;
  customStyle: CustomStyleResult | null;
  productInfo: ProductInfo;
  onRegenerate: () => void;
}

interface MockDetailSlide {
  id: string;
  title: string;
  type: 'hero' | 'selling' | 'detail' | 'param' | 'scene' | 'brand';
  bgGradient: string;
}

// 主图用 SVG 模拟电商主图
function MainImageCard({ index, styleName, seedOffset = 0 }: { index: number; styleName: string; seedOffset?: number }) {
  const actualIdx = (index + seedOffset * 3) % 8;
  const gradientMap: Record<number, string> = {
    0: 'from-sky-100 via-blue-50 to-indigo-100',
    1: 'from-amber-50 via-orange-50 to-rose-50',
    2: 'from-emerald-50 via-teal-50 to-cyan-50',
    3: 'from-purple-50 via-pink-50 to-rose-50',
    4: 'from-slate-100 via-zinc-50 to-neutral-100',
    5: 'from-rose-50 via-pink-50 to-purple-50',
  };
  const gradient = gradientMap[actualIdx % 6];

  const productName = productNameForIndex(actualIdx);
  const tagline = taglineForIndex(actualIdx);

  return (
    <div className="relative aspect-square rounded-xl overflow-hidden bg-gradient-to-br shadow-md border border-border/40">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
      {/* 光晕 */}
      <div className="absolute top-8 left-1/2 -translate-x-1/2 size-40 rounded-full bg-white/40 blur-3xl" />
      {/* 模拟产品图形 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <div className="size-36 md:size-44 rounded-[40%] bg-gradient-to-br from-white/90 to-white/60 shadow-2xl backdrop-blur-sm flex items-center justify-center">
            <div className="size-28 md:size-32 rounded-[35%] bg-gradient-to-br from-primary/80 to-purple-600/80 shadow-inner flex items-center justify-center">
              <Package className="size-12 text-white/90" />
            </div>
          </div>
          <div className="absolute -top-3 -right-3 size-10 rounded-full bg-amber-400 text-white text-xs font-bold flex items-center justify-center shadow-lg rotate-12">
            HOT
          </div>
        </div>
      </div>
      {/* 顶部文案 */}
      <div className="absolute top-5 left-5 right-5">
        <div className="inline-block px-2 py-0.5 rounded-full bg-primary/90 text-primary-foreground text-[10px] font-medium">
          {styleName}
        </div>
        <div className="mt-2 text-lg md:text-xl font-bold text-foreground drop-shadow-sm line-clamp-2">
          {productName}
        </div>
      </div>
      {/* 底部卖点 */}
      <div className="absolute bottom-5 left-5 right-5">
        <div className="text-xs text-muted-foreground mb-1">{tagline}</div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-destructive">¥{99 + index * 50}</span>
          <span className="text-xs text-muted-foreground line-through">
            ¥{199 + index * 80}
          </span>
        </div>
      </div>
      {/* 标签 */}
      <div className="absolute bottom-5 right-5 flex gap-1">
        <div className="px-1.5 py-0.5 rounded bg-emerald-500/90 text-white text-[10px] font-medium">
          正品
        </div>
        <div className="px-1.5 py-0.5 rounded bg-rose-500/90 text-white text-[10px] font-medium">
          包邮
        </div>
      </div>
    </div>
  );
}

function productNameForIndex(i: number) {
  const names = [
    '轻奢无线蓝牙耳机 · 降噪旗舰',
    '北欧风实木餐桌 · 进口橡木',
    '玻尿酸精华液 · 深层补水',
    '智能扫地机器人 · 激光导航',
    '真丝连衣裙 · 法式优雅',
    '即热式饮水机 · 速热科技',
    '高端护肤套装 · 抗皱紧致',
    '人体工学办公椅 · 久坐不累',
  ];
  return names[i % names.length];
}

function taglineForIndex(i: number) {
  const taglines = [
    '全新升级 · 主动降噪 40dB',
    '匠心工艺 · 6 人位可伸缩',
    '72小时长效保湿 · 深层修护',
    '智能规划 · 扫拖一体',
    '100%桑蚕丝 · 轻盈飘逸',
    '3秒速热 · 即热即饮',
    '专柜同款 · 买一送五',
    '12档调节 · 护腰护颈',
  ];
  return taglines[i % taglines.length];
}

// 详情页模块
function DetailHeroSlide({ index }: { index: number }) {
  const titles = [
    '重新定义品质生活',
    '匠心之作 为你而来',
    '科技美学 浑然一体',
  ];
  const subtitles = [
    'REDEFINING QUALITY LIVING',
    'CRAFTED FOR YOU',
    'TECH MEETS AESTHETICS',
  ];
  const gradients = [
    'from-slate-900 via-slate-800 to-indigo-900',
    'from-amber-900 via-orange-800 to-rose-900',
    'from-emerald-900 via-teal-800 to-cyan-900',
  ];
  const i = index % 3;
  return (
    <div className={`relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-b ${gradients[i]} rounded-xl`}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255_255_255_0.15),transparent_60%)]" />
      <div className="absolute top-10 left-8 right-8 text-white">
        <div className="text-xs tracking-[0.3em] text-white/60">{subtitles[i]}</div>
        <div className="text-3xl md:text-4xl font-bold mt-3 leading-tight">{titles[i]}</div>
        <div className="mt-4 h-0.5 w-16 bg-amber-400" />
      </div>
      {/* 模拟大产品 */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="size-52 md:size-64 rounded-full bg-gradient-to-br from-white/20 to-white/5 backdrop-blur-sm border border-white/20 flex items-center justify-center">
          <div className="size-40 md:size-52 rounded-[40%] bg-gradient-to-br from-amber-300/80 to-orange-500/60 shadow-2xl flex items-center justify-center">
            <Package className="size-16 text-white/80" />
          </div>
        </div>
      </div>
      <div className="absolute bottom-10 left-8 right-8 text-white/80 text-sm">
        <div className="inline-block px-3 py-1 rounded-full border border-white/30 text-xs">
          旗舰新品 · 限量首发
        </div>
      </div>
    </div>
  );
}

function DetailSellingSlide() {
  const points = [
    { icon: ShieldCheck, title: '品质保障', desc: '严格质检 · 正品承诺' },
    { icon: Truck, title: '极速发货', desc: '24小时内 · 顺丰包邮' },
    { icon: Star, title: '口碑之选', desc: '99%好评 · 10万+选择' },
  ];
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-b from-slate-50 to-white rounded-xl border border-border/40">
      <div className="p-8">
        <div className="text-center mb-8">
          <div className="text-xs text-primary font-medium tracking-wider">CORE ADVANTAGES</div>
          <div className="text-2xl font-bold mt-2">核心卖点</div>
          <div className="mt-3 h-0.5 w-12 bg-primary mx-auto rounded-full" />
        </div>
        <div className="space-y-6">
          {points.map((p, i) => {
            const Icon = p.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex items-start gap-4 p-4 rounded-xl bg-white shadow-sm border border-border/30"
              >
                <div className="size-12 shrink-0 rounded-xl bg-gradient-to-br from-primary to-purple-500 text-white flex items-center justify-center shadow-md">
                  <Icon className="size-6" />
                </div>
                <div>
                  <div className="font-semibold text-foreground">{p.title}</div>
                  <div className="text-sm text-muted-foreground mt-1">{p.desc}</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-primary/5 to-transparent" />
    </div>
  );
}

function DetailCloseupSlide() {
  const details = [
    { label: '精密工艺', desc: '0.1mm 精准切割' },
    { label: '高端材质', desc: '进口原料 安全环保' },
    { label: '细节打磨', desc: '手工抛光 触感细腻' },
  ];
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-br from-stone-100 via-amber-50 to-stone-200 rounded-xl">
      <div className="p-8">
        <div className="text-center">
          <div className="text-xs text-amber-700 font-medium tracking-wider">CLOSE UP</div>
          <div className="text-2xl font-bold text-stone-800 mt-2">细节特写</div>
          <div className="text-sm text-stone-500 mt-1">每一处细节都经得起推敲</div>
        </div>
      </div>
      {/* 大圆形产品特写 */}
      <div className="flex justify-center mt-4">
        <div className="relative size-56 md:size-64">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-200 to-orange-300 shadow-2xl" />
          <div className="absolute inset-6 rounded-full bg-gradient-to-br from-stone-100 to-stone-300 border-4 border-white/50 shadow-inner flex items-center justify-center">
            <Settings className="size-20 text-stone-600" />
          </div>
          {/* 标注 */}
          {details.map((d, i) => {
            const positions = [
              'top-0 left-1/2 -translate-x-1/2 -translate-y-2',
              'top-1/2 right-0 translate-x-2 -translate-y-1/2',
              'bottom-0 left-1/2 -translate-x-1/2 translate-y-2',
            ];
            return (
              <div
                key={i}
                className={`absolute ${positions[i]} bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-lg border border-amber-200/50 min-w-[100px] text-center`}
              >
                <div className="text-xs font-semibold text-stone-800">{d.label}</div>
                <div className="text-[10px] text-stone-500">{d.desc}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DetailParamSlide() {
  const params = [
    ['产品名称', '轻奢旗舰款'],
    ['产品尺寸', '120 × 80 × 60 cm'],
    ['产品重量', '2.5 kg'],
    ['材质工艺', '进口合金 + 手工打磨'],
    ['适用场景', '家居 / 办公 / 送礼'],
    ['包装清单', '主机 × 1 / 配件 × 3 / 说明书 × 1'],
    ['保修期限', '官方质保 2 年'],
  ];
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-b from-slate-50 to-white rounded-xl border border-border/40">
      <div className="p-8">
        <div className="text-center mb-6">
          <div className="text-xs text-primary font-medium tracking-wider">SPECIFICATIONS</div>
          <div className="text-2xl font-bold mt-2">产品参数</div>
          <div className="mt-3 h-0.5 w-12 bg-primary mx-auto rounded-full" />
        </div>
        <div className="rounded-xl overflow-hidden border border-border/40 shadow-sm">
          <table className="w-full text-sm">
            <tbody>
              {params.map(([k, v], i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-muted/30'}>
                  <td className="py-3 px-4 text-muted-foreground w-1/3 border-r border-border/40">
                    {k}
                  </td>
                  <td className="py-3 px-4 font-medium text-foreground">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DetailSceneSlide() {
  const scenes = [
    { name: '客厅', desc: '融入现代家居' },
    { name: '书房', desc: '提升工作效率' },
    { name: '卧室', desc: '营造舒适氛围' },
    { name: '阳台', desc: '享受惬意时光' },
  ];
  const gradients = [
    'from-amber-100 to-orange-200',
    'from-blue-100 to-indigo-200',
    'from-rose-100 to-pink-200',
    'from-emerald-100 to-teal-200',
  ];
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-b from-stone-50 to-white rounded-xl border border-border/40">
      <div className="p-8">
        <div className="text-center mb-6">
          <div className="text-xs text-primary font-medium tracking-wider">SCENES</div>
          <div className="text-2xl font-bold mt-2">多场景适配</div>
          <div className="text-sm text-muted-foreground mt-1">融入生活的每个角落</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {scenes.map((s, i) => (
            <div key={i} className="space-y-2">
              <div
                className={`aspect-square rounded-xl bg-gradient-to-br ${gradients[i]} shadow-sm flex items-center justify-center relative overflow-hidden`}
              >
                <div className="size-16 rounded-2xl bg-white/70 backdrop-blur-sm flex items-center justify-center">
                  <Heart className="size-7 text-rose-400" />
                </div>
              </div>
              <div>
                <div className="text-sm font-semibold">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DetailBrandSlide() {
  const badges = [
    'ISO 9001 认证',
    '国家专利',
    '3C 认证',
    '质检合格',
  ];
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden bg-gradient-to-b from-slate-900 to-indigo-900 rounded-xl text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(99_102_241_0.4),transparent_60%)]" />
      <div className="relative p-8 h-full flex flex-col items-center justify-center text-center">
        <div className="size-20 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-2xl shadow-amber-500/30 mb-6">
          <ShieldCheck className="size-10 text-white" />
        </div>
        <div className="text-2xl font-bold">品牌实力 值得信赖</div>
        <div className="text-sm text-white/60 mt-2 max-w-xs">
          专注品质 10 年，服务超 100 万用户
        </div>
        <div className="flex flex-wrap gap-2 mt-6 justify-center">
          {badges.map((b, i) => (
            <div
              key={i}
              className="px-3 py-1.5 rounded-full border border-white/20 bg-white/5 text-xs backdrop-blur-sm"
            >
              ✓ {b}
            </div>
          ))}
        </div>
        <div className="mt-8 text-xs text-white/40">
          售后无忧 · 7天无理由 · 正品保障
        </div>
      </div>
    </div>
  );
}

function renderDetailSlide(slide: MockDetailSlide) {
  switch (slide.type) {
    case 'hero':
      return <DetailHeroSlide index={parseInt(slide.id.split('-')[1])} />;
    case 'selling':
      return <DetailSellingSlide />;
    case 'detail':
      return <DetailCloseupSlide />;
    case 'param':
      return <DetailParamSlide />;
    case 'scene':
      return <DetailSceneSlide />;
    case 'brand':
      return <DetailBrandSlide />;
    default:
      return <DetailHeroSlide index={0} />;
  }
}

export default function Step5Result({
  imageTypes,
  styleId,
  customStyle,
  productInfo,
  onRegenerate,
}: Step5ResultProps) {
  const [progress, setProgress] = useState(0);
  const [isGenerating, setIsGenerating] = useState(true);
  const [previewIndex, setPreviewIndex] = useState<{ kind: 'main' | 'detail'; idx: number } | null>(
    null,
  );
  const [regenMap, setRegenMap] = useState<Record<string, boolean>>({});
  const [regenSeed, setRegenSeed] = useState<Record<string, number>>({});
  const [currentFilter, setCurrentFilter] = useState('none');
  const [styleAdjustOpen, setStyleAdjustOpen] = useState(false);
  const [isStyleAdjusting, setIsStyleAdjusting] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [selectedCrop, setSelectedCrop] = useState('original');
  const [textOverlay, setTextOverlay] = useState('');
  const [textOpen, setTextOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const mainScrollRef = (el: HTMLDivElement | null) => {
    // placeholder for potential scroll logic
    void el;
  };

  const styleName = useMemo(() => {
    if (customStyle) return customStyle.name;
    return MOCK_STYLES.find((s) => s.id === styleId)?.name ?? '未选择';
  }, [styleId, customStyle]);

  const mainCount = imageTypes.mainImage.enabled ? imageTypes.mainImage.count : 0;
  const detailCount = imageTypes.detailImage.enabled ? imageTypes.detailImage.count : 0;
  const totalCount = mainCount + detailCount;
  const estimatedCredits = mainCount * 5 + detailCount * 3;

  // 模拟生成进度
  useEffect(() => {
    setProgress(0);
    setIsGenerating(true);

    const startTime = Date.now();
    const duration = 3000;

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const next = Math.min(100, (elapsed / duration) * 100);
      setProgress(next);

      if (next >= 100) {
        clearInterval(timer);
        setIsGenerating(false);
        toast.success('生成完成！共生成 ' + totalCount + ' 张图片');
      }
    }, 50);

    return () => clearInterval(timer);
  }, [totalCount, styleId, customStyle]);

  // 构造详情图序列
  const detailSlides: MockDetailSlide[] = useMemo(() => {
    const types: MockDetailSlide['type'][] = [
      'hero',
      'selling',
      'detail',
      'param',
      'scene',
      'brand',
    ];
    return Array.from({ length: detailCount }, (_, i) => ({
      id: `detail-${i}`,
      title: `详情图 ${i + 1}`,
      type: types[i % types.length],
      bgGradient: '',
    }));
  }, [detailCount]);

  // canvas 下载模拟图
  const handleDownload = (kind: 'main' | 'detail', idx: number, name: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = kind === 'main' ? 800 : 1067;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 渐变背景
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    const colors =
      kind === 'main'
        ? ['#eff6ff', '#dbeafe', '#e0e7ff']
        : ['#0f172a', '#1e1b4b', '#312e81'];
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(0.5, colors[1]);
    grad.addColorStop(1, colors[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 模拟产品图形
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 150, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    ctx.fillStyle = '#6366f1';
    ctx.fillRect(canvas.width / 2 - 60, canvas.height / 2 - 60, 120, 120);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(productInfo.name || '产品名称', canvas.width / 2, 80);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('开始下载：' + name);
    }, 'image/png');
  };

  const handleBatchDownload = () => {
    toast.info(`准备下载 ${totalCount} 张图片（模拟批量打包）`);
    let idx = 0;
    for (let i = 0; i < mainCount; i++) {
      setTimeout(() => handleDownload('main', i, `主图-${i + 1}.png`), idx * 400);
      idx++;
    }
    for (let i = 0; i < detailCount; i++) {
      setTimeout(() => handleDownload('detail', i, `详情图-${i + 1}.png`), idx * 400);
      idx++;
    }
  };

  const scrollMain = (dir: -1 | 1) => {
    const container = document.getElementById('main-scroll-container');
    if (container) {
      container.scrollBy({ left: dir * 280, behavior: 'smooth' });
    }
  };

  // 单张重新生成
  const handleSingleRegen = (kind: 'main' | 'detail', idx: number) => {
    const key = `${kind}-${idx}`;
    setRegenMap((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => {
      setRegenSeed((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
      setRegenMap((prev) => ({ ...prev, [key]: false }));
      toast.success('已重新生成，消耗 10 积分');
    }, 2000);
  };

  // 批量调整风格
  const handleBulkStyleAdjust = (targetStyle: string) => {
    setIsStyleAdjusting(true);
    setStyleAdjustOpen(false);
    setTimeout(() => {
      setIsStyleAdjusting(false);
      toast.success(`已应用「${targetStyle}」风格，消耗 50 积分`);
    }, 2000);
  };

  // 裁剪比例
  const CROP_RATIOS = [
    { value: 'original', label: '原始比例' },
    { value: '1:1', label: '1:1' },
    { value: '3:4', label: '3:4' },
    { value: '9:16', label: '9:16' },
    { value: '4:3', label: '4:3' },
    { value: '16:9', label: '16:9' },
  ];

  const handleCrop = (ratio: string) => {
    setSelectedCrop(ratio);
    setCropOpen(false);
    toast.success(`已调整为 ${ratio} 比例`);
  };

  // 添加文字
  const handleAddText = () => {
    if (!textOverlay.trim()) {
      toast.warning('请输入文字内容');
      return;
    }
    setTextOpen(false);
    toast.success('已添加文字，可拖动调整位置（模拟）');
  };

  // 滤镜
  const FILTERS = [
    { value: 'none', label: '原图', css: 'none' },
    { value: 'bright', label: '明亮', css: 'brightness(1.15) contrast(1.05) saturate(1.1)' },
    { value: 'soft', label: '柔和', css: 'brightness(1.05) contrast(0.95) saturate(0.9)' },
    { value: 'vintage', label: '复古', css: 'sepia(0.4) contrast(1.1) saturate(0.8)' },
    { value: 'cool', label: '冷色调', css: 'hue-rotate(15deg) saturate(0.9) brightness(1.05)' },
    { value: 'warm', label: '暖色调', css: 'sepia(0.2) saturate(1.2) hue-rotate(-10deg)' },
    { value: 'bw', label: '黑白', css: 'grayscale(1) contrast(1.1)' },
  ];

  const getFilterCss = () => {
    return FILTERS.find((f) => f.value === currentFilter)?.css || 'none';
  };

  const handleFilter = (value: string) => {
    setCurrentFilter(value);
    setFilterOpen(false);
    const label = FILTERS.find((f) => f.value === value)?.label || '';
    if (value !== 'none') {
      toast.success(`已应用「${label}」滤镜`);
    }
  };

  // 导出选项
  const handleExportOption = (option: string) => {
    switch (option) {
      case 'png':
        handleBatchDownload();
        break;
      case 'jpg':
        toast.info('准备下载 JPG 格式（模拟）');
        break;
      case 'main-only':
        toast.info(`准备下载 ${mainCount} 张主图（模拟）`);
        break;
      case 'detail-only':
        toast.info(`准备下载 ${detailCount} 张详情图（模拟）`);
        break;
      case 'copy-link':
        toast.success('已复制图片链接');
        break;
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-foreground">生成结果</h2>
        <p className="text-muted-foreground mt-2">
          {isGenerating ? 'AI 正在努力生成中，请稍候...' : '图片生成完成，点击可预览大图'}
        </p>
      </div>

      {/* 任务概览 */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            任务概览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">图片类型</div>
              <div className="font-medium mt-1">
                {imageTypes.mainImage.enabled && '商品主图'}
                {imageTypes.mainImage.enabled && imageTypes.detailImage.enabled && ' + '}
                {imageTypes.detailImage.enabled && '产品详情图'}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">生成数量</div>
              <div className="font-medium mt-1 tabular-nums">{totalCount} 张</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">选择风格</div>
              <div className="font-medium mt-1">{styleName}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">预计消耗</div>
              <div className="font-medium mt-1 flex items-center gap-1 text-amber-600">
                <Coins className="size-4" />
                {estimatedCredits} 积分
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 进度条 */}
      {isGenerating && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between text-sm mb-3">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 text-primary animate-spin" />
                <span className="font-medium">AI 生成中</span>
              </div>
              <span className="text-primary font-semibold tabular-nums">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>分析产品特征</span>
              <span>生成创意构图</span>
              <span>渲染高清图片</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 生成结果 */}
      {!isGenerating && (
        <div className="space-y-8">
          {/* 编辑工具栏 */}
          <Card className="border-border/50">
            <CardContent className="py-3 px-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground mr-2">图片编辑</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setStyleAdjustOpen(true)}
                  disabled={isStyleAdjusting}
                >
                  <Palette className="size-4 mr-1.5" />
                  调整风格
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCropOpen(true)}
                >
                  <Crop className="size-4 mr-1.5" />
                  裁剪
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setTextOpen(true)}
                >
                  <Type className="size-4 mr-1.5" />
                  添加文字
                </Button>
                <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm">
                      <Wand2 className="size-4 mr-1.5" />
                      滤镜
                      <ChevronDown className="size-3 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-36">
                    {FILTERS.map((f) => (
                      <DropdownMenuItem
                        key={f.value}
                        onClick={() => handleFilter(f.value)}
                        className="flex items-center justify-between"
                      >
                        {f.label}
                        {currentFilter === f.value && (
                          <Check className="size-3.5 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="flex-1" />

                <div className="flex items-center gap-2">
                  {isStyleAdjusting && (
                    <Badge variant="secondary" className="text-xs">
                      <Loader2 className="size-3 mr-1 animate-spin" />
                      风格调整中...
                    </Badge>
                  )}
                  {currentFilter !== 'none' && (
                    <Badge variant="outline" className="text-xs">
                      滤镜：{FILTERS.find((f) => f.value === currentFilter)?.label}
                    </Badge>
                  )}
                  {selectedCrop !== 'original' && (
                    <Badge variant="outline" className="text-xs">
                      比例：{selectedCrop}
                    </Badge>
                  )}
                  {textOverlay && (
                    <Badge variant="outline" className="text-xs">
                      文字：{textOverlay.slice(0, 6)}
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 主图结果 - 横向滚动 */}
          {mainCount > 0 && (
            <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="size-4 text-primary" />
                  <h3 className="text-lg font-semibold">商品主图</h3>
                  <span className="text-sm text-muted-foreground">({mainCount} 张)</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="size-8"
                    onClick={() => scrollMain(-1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="size-8"
                    onClick={() => scrollMain(1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="relative">
                <div
                  id="main-scroll-container"
                  ref={mainScrollRef}
                  className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin snap-x snap-mandatory"
                >
                  {Array.from({ length: mainCount }, (_, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.08, duration: 0.5 }}
                      className="shrink-0 w-56 md:w-64 snap-start group relative cursor-zoom-in"
                      onClick={() => setPreviewIndex({ kind: 'main', idx: i })}
                    >
                      <div
                        className={cn(
                          'transition-all duration-300',
                          isStyleAdjusting && 'blur-sm opacity-80',
                        )}
                        style={{ filter: getFilterCss() }}
                      >
                        <MainImageCard
                          index={i}
                          styleName={styleName}
                          seedOffset={regenSeed[`main-${i}`] || 0}
                        />
                        {/* 文字叠加模拟 */}
                        {textOverlay && (
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                            <span className="text-white font-bold text-xl drop-shadow-lg whitespace-nowrap">
                              {textOverlay}
                            </span>
                          </div>
                        )}
                        {/* 重新生成loading */}
                        {regenMap[`main-${i}`] && (
                          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white rounded-xl">
                            <Loader2 className="size-6 animate-spin" />
                            <span className="text-xs mt-2">重新生成中...</span>
                          </div>
                        )}
                      </div>
                      <div className="text-center text-sm font-medium mt-2 text-muted-foreground">
                        主图 {i + 1}
                      </div>
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="shadow-md"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSingleRegen('main', i);
                          }}
                          disabled={regenMap[`main-${i}`]}
                          title="重新生成"
                        >
                          <RefreshCw className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="shadow-md"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload('main', i, `主图-${i + 1}.png`);
                          }}
                          title="下载"
                        >
                          <Download className="size-3.5" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 详情图结果 - 竖向排列 */}
          {detailCount > 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ImageIcon className="size-4 text-primary" />
                <h3 className="text-lg font-semibold">产品详情图</h3>
                <span className="text-sm text-muted-foreground">({detailCount} 张)</span>
              </div>
              <div className="space-y-6 max-w-xl mx-auto">
                {detailSlides.map((slide, i) => (
                  <motion.div
                      key={slide.id}
                      initial={{ opacity: 0, y: 30 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-50px' }}
                      transition={{ duration: 0.5 }}
                      className="group relative cursor-zoom-in"
                      onClick={() => setPreviewIndex({ kind: 'detail', idx: i })}
                    >
                      <div
                        className={cn(
                          'transition-all duration-300',
                          isStyleAdjusting && 'blur-sm opacity-80',
                        )}
                        style={{ filter: getFilterCss() }}
                      >
                        {renderDetailSlide(slide)}
                        {textOverlay && (
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
                            <span className="text-white font-bold text-2xl drop-shadow-lg whitespace-nowrap">
                              {textOverlay}
                            </span>
                          </div>
                        )}
                        {regenMap[`detail-${i}`] && (
                          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center text-white rounded-xl z-20">
                            <Loader2 className="size-6 animate-spin" />
                            <span className="text-xs mt-2">重新生成中...</span>
                          </div>
                        )}
                      </div>
                      <div className="text-center text-sm font-medium mt-2 text-muted-foreground">
                        详情图 {i + 1}
                      </div>
                      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="shadow-md"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSingleRegen('detail', i);
                          }}
                          disabled={regenMap[`detail-${i}`]}
                          title="重新生成"
                        >
                          <RefreshCw className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="shadow-md"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload('detail', i, `详情图-${i + 1}.png`);
                          }}
                          title="下载"
                        >
                          <Download className="size-3.5" />
                        </Button>
                      </div>
                    </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 底部按钮 */}
      {!isGenerating && (
        <div className="flex justify-center gap-4 pt-4 flex-wrap">
          <Button variant="secondary" onClick={onRegenerate}>
            <RefreshCw className="size-4 mr-2" />
            重新生成
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Download className="size-4 mr-2" />
                一键打包下载
                <ChevronDown className="size-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => handleExportOption('png')}>
                下载全部（PNG）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportOption('jpg')}>
                下载全部（JPG）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportOption('main-only')}>
                仅下载主图
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportOption('detail-only')}>
                仅下载详情图
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportOption('copy-link')}>
                <Copy className="size-4 mr-2" />
                复制图片链接
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* 风格调整弹窗 */}
      <Dialog open={styleAdjustOpen} onOpenChange={setStyleAdjustOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">调整风格</DialogTitle>
            <p className="text-sm text-muted-foreground">
              选择一个新风格应用到所有图片，消耗 50 积分
            </p>
          </DialogHeader>
          <div className="grid grid-cols-3 md:grid-cols-4 gap-3 py-2">
            {MOCK_STYLES.slice(0, 12).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleBulkStyleAdjust(s.name)}
                className="relative aspect-square rounded-lg overflow-hidden border border-border hover:border-primary/60 hover:shadow-md transition-all group"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-sky-100 via-blue-50 to-indigo-100" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Palette className="size-8 text-primary/40" />
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 backdrop-blur-sm px-2 py-1.5 text-white text-xs text-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {s.name}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setStyleAdjustOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 裁剪比例弹窗 */}
      <Dialog open={cropOpen} onOpenChange={setCropOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">选择裁剪比例</DialogTitle>
            <p className="text-sm text-muted-foreground">
              选择目标图片比例（模拟，不实际裁剪图片）
            </p>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-2">
            {CROP_RATIOS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => handleCrop(r.value)}
                className={cn(
                  'p-4 rounded-lg border-2 text-center transition-all',
                  selectedCrop === r.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border hover:border-primary/40 hover:bg-muted/30',
                )}
              >
                <div className="font-semibold text-sm">{r.label}</div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 添加文字弹窗 */}
      <Dialog open={textOpen} onOpenChange={setTextOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">添加文字</DialogTitle>
            <p className="text-sm text-muted-foreground">
              输入要叠加在图片上的文字（模拟，文字居中显示）
            </p>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="输入文字内容"
              value={textOverlay}
              onChange={(e) => setTextOverlay(e.target.value)}
              maxLength={20}
            />
            <div className="text-xs text-muted-foreground text-right">
              {textOverlay.length}/20
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTextOpen(false)}>
              取消
            </Button>
            <Button onClick={handleAddText}>应用</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 图片预览弹窗 */}
      <Dialog
        open={!!previewIndex}
        onOpenChange={(o) => !o && setPreviewIndex(null)}
      >
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle className="text-base">
              {previewIndex
                ? `${previewIndex.kind === 'main' ? '主图' : '详情图'} ${previewIndex.idx + 1}`
                : '图片预览'}
            </DialogTitle>
          </DialogHeader>
          <div className="p-4 flex justify-center">
            {previewIndex && (
              <div
                className={`${
                  previewIndex.kind === 'main'
                    ? 'w-full max-w-md'
                    : 'w-full max-w-md'
                }`}
              >
                {previewIndex.kind === 'main' ? (
                  <MainImageCard index={previewIndex.idx} styleName={styleName} />
                ) : (
                  renderDetailSlide(detailSlides[previewIndex.idx])
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 p-4 pt-0">
            <Button
              variant="secondary"
              onClick={() =>
                previewIndex &&
                handleDownload(
                  previewIndex.kind,
                  previewIndex.idx,
                  `${previewIndex.kind === 'main' ? '主图' : '详情图'}-${previewIndex.idx + 1}.png`,
                )
              }
            >
              <Download className="size-4 mr-2" />
              下载此图
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
