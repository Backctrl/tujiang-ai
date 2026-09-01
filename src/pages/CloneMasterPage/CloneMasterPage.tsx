import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PRODUCT_IMAGES } from '@/data/history';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Wand2,
  FileEdit,
  ImageOff,
  Package,
  Upload,
  Coins,
  Play,
  Download,
  CheckCircle2,
  Loader2,
  HelpCircle,
  RefreshCw,
  ZoomIn,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import UploadZone from '@/components/UploadZone';
import { cn } from '@/lib/utils';
import { Image } from '@/components/ui/image';

type CloneMode = 'one-click' | 'custom' | 'no-copy';

const MODES = [
  {
    value: 'one-click' as CloneMode,
    title: '一键克隆',
    description: '自动识别竞品图文，按原版式生成',
    icon: Wand2,
    color: 'from-blue-500 to-purple-600',
  },
  {
    value: 'custom' as CloneMode,
    title: '自定义克隆',
    description: '填写产品名，替换为自家卖点',
    icon: FileEdit,
    color: 'from-purple-500 to-pink-600',
  },
  {
    value: 'no-copy' as CloneMode,
    title: '无文案克隆',
    description: '只复刻构图，不生成文字',
    icon: ImageOff,
    color: 'from-orange-500 to-red-500',
  },
];

const ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '21:9',
  '9:21',
  '1:2',
];

const PLATFORMS = ['淘宝', '京东', '抖音', '亚马逊', '拼多多'];

interface CloneResult {
  id: string;
  url: string;
  hue: number;
  saturation: number;
}

export default function CloneMasterPage() {
  const [mode, setMode] = useState<CloneMode>('one-click');
  const [productImages, setProductImages] = useState<string[]>([]);
  const [competitorImages, setCompetitorImages] = useState<string[]>([]);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [highCopyMode, setHighCopyMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stage1Progress, setStage1Progress] = useState(0); // 克隆词分析
  const [stage2Progress, setStage2Progress] = useState(0); // 成图生成
  const [resultImages, setResultImages] = useState<CloneResult[]>([]);
  const [previewImage, setPreviewImage] = useState<CloneResult | null>(null);

  // 自定义克隆表单
  const [productName, setProductName] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

  const estimatedCredits = useMemo(() => {
    const base = competitorImages.length * 100;
    return highCopyMode ? Math.round(base * 1.5) : base;
  }, [competitorImages.length, highCopyMode]);

  const canStart = productImages.length >= 1 && competitorImages.length >= 1;

  const totalProgress = useMemo(() => {
    return Math.round((stage1Progress * 0.4 + stage2Progress * 0.6));
  }, [stage1Progress, stage2Progress]);

  const handleStartClone = () => {
    if (!canStart) {
      toast.warning('请先上传产品图和竞品营销图');
      return;
    }

    setIsGenerating(true);
    setStage1Progress(0);
    setStage2Progress(0);
    setResultImages([]);

    // 第一阶段：克隆词分析（约 2 秒）
    const stage1Duration = 2000;
    const startTime = Date.now();
    const timer1 = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const next = Math.min(100, (elapsed / stage1Duration) * 100);
      setStage1Progress(next);
      if (next >= 100) {
        clearInterval(timer1);
        // 第二阶段：成图生成（约 3 秒）
        const stage2Duration = 3000;
        const stage2Start = Date.now();
        const timer2 = setInterval(() => {
          const elapsed2 = Date.now() - stage2Start;
          const next2 = Math.min(100, (elapsed2 / stage2Duration) * 100);
          setStage2Progress(next2);
          if (next2 >= 100) {
            clearInterval(timer2);
            const count = Math.min(competitorImages.length, 8);
            const results: CloneResult[] = Array.from(
              { length: count },
              (_, i) => ({
                id: `clone-${Date.now()}-${i}`,
                url: PRODUCT_IMAGES[i % PRODUCT_IMAGES.length],
                hue: (i * 35) % 360,
                saturation: 0.7 + Math.random() * 0.3,
              }),
            );
            setResultImages(results);
            setIsGenerating(false);
            toast.success(`克隆完成！共生成 ${count} 张图片`);
          }
        }, 50);
      }
    }, 50);
  };

  const handleBatchDownload = () => {
    toast.info(`准备下载 ${resultImages.length} 张图片`);
    resultImages.forEach((img, i) => {
      setTimeout(() => {
        const link = document.createElement('a');
        link.href = img.url;
        link.download = `clone-${i + 1}.jpg`;
        link.target = '_blank';
        link.rel = 'noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }, i * 200);
    });
  };

  const handleDownloadSingle = (img: CloneResult) => {
    const link = document.createElement('a');
    link.href = img.url;
    link.download = `${img.id}.jpg`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('开始下载');
  };

  const handleReClone = () => {
    handleStartClone();
  };

  const moreCount = competitorImages.length > 8 ? competitorImages.length - 8 : 0;

  const platformToggle = (p: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="p-6 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Sparkles className="size-6 text-primary" />
              AI 克隆大师
            </h1>
            <p className="text-muted-foreground mt-1">
              参考竞品图片，快速生成自家产品的营销图
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* 左侧配置区 */}
            <div className="lg:col-span-3 space-y-5">
              {/* 克隆模式选择 */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">选择克隆模式</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {MODES.map((m) => {
                      const Icon = m.icon;
                      const isSelected = mode === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => setMode(m.value)}
                          className={cn(
                            'relative text-left p-4 rounded-xl border transition-all',
                            isSelected
                              ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                              : 'border-border hover:border-primary/40 hover:bg-muted/30',
                          )}
                        >
                          <div
                            className={cn(
                              'size-10 rounded-lg bg-gradient-to-br flex items-center justify-center text-white mb-3',
                              m.color,
                            )}
                          >
                            <Icon className="size-5" />
                          </div>
                          <div className="font-semibold text-sm">{m.title}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {m.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* 素材上传区 */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">上传素材</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <Package className="size-4 text-primary" />
                        自己产品图
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {productImages.length}/5
                        </Badge>
                      </div>
                      <UploadZone
                        files={productImages}
                        onChange={setProductImages}
                        maxFiles={5}
                        hint="上传自家产品的清晰图"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <Upload className="size-4 text-orange-500" />
                        竞品营销图
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {competitorImages.length}/20
                        </Badge>
                      </div>
                      <UploadZone
                        files={competitorImages}
                        onChange={setCompetitorImages}
                        maxFiles={20}
                        hint="上传想要参考的竞品图"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 自定义克隆表单 */}
              <AnimatePresence mode="wait">
                {mode === 'custom' && (
                  <motion.div
                    key="custom-form"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">产品信息</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">产品名称</label>
                          <Input
                            placeholder="输入你的产品名称"
                            value={productName}
                            onChange={(e) => setProductName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">
                            核心卖点
                            <span className="text-xs text-muted-foreground font-normal ml-2">
                              每行一个
                            </span>
                          </label>
                          <Textarea
                            placeholder={'卖点1\n卖点2\n卖点3'}
                            rows={4}
                            value={sellingPoints}
                            onChange={(e) => setSellingPoints(e.target.value)}
                            className="resize-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">目标平台</label>
                          <div className="flex flex-wrap gap-3">
                            {PLATFORMS.map((p) => (
                              <label
                                key={p}
                                className="flex items-center gap-2 cursor-pointer text-sm"
                              >
                                <Checkbox
                                  checked={selectedPlatforms.includes(p)}
                                  onCheckedChange={() => platformToggle(p)}
                                />
                                {p}
                              </label>
                            ))}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}

                {mode === 'no-copy' && (
                  <motion.div
                    key="no-copy-hint"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <Card className="border-amber-200 bg-amber-50/50">
                      <CardContent className="pt-6 flex items-start gap-3">
                        <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <div className="text-sm font-medium text-amber-900">
                            无文案克隆模式
                          </div>
                          <div className="text-xs text-amber-700 mt-1">
                            将只复刻竞品图的构图和版式，不会在生成图片上添加任何文字内容。
                            适合只需要参考视觉布局的场景。
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 参数配置 */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">参数配置</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">图片比例</label>
                      <Select value={aspectRatio} onValueChange={setAspectRatio}>
                        <SelectTrigger>
                          <SelectValue placeholder="选择比例" />
                        </SelectTrigger>
                        <SelectContent>
                          {ASPECT_RATIOS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-2">
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="text-sm font-medium">高仿模式</div>
                            <div className="text-xs text-muted-foreground">
                              竞品图作为参考图发给生图模型
                            </div>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="size-4 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-xs">
                                开启后，生图阶段会把竞品图作为参考图一并发给生图模型，
                                更贴近竞品的构图与版式；关闭则仅用产品图生图。
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <Switch checked={highCopyMode} onCheckedChange={setHighCopyMode} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 开始按钮 */}
              <div className="flex justify-center pt-2">
                <Button
                  size="lg"
                  onClick={handleStartClone}
                  disabled={isGenerating || !canStart}
                  className="px-10 min-w-64 h-12 text-base"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="size-5 mr-2 animate-spin" />
                      克隆进行中...
                    </>
                  ) : (
                    <>
                      <Play className="size-5 mr-2" />
                      开始克隆
                    </>
                  )}
                </Button>
              </div>
              {!canStart && !isGenerating && (
                <p className="text-center text-xs text-muted-foreground -mt-2">
                  请先上传产品图和竞品营销图
                </p>
              )}
            </div>

            {/* 右侧任务面板 */}
            <div className="lg:col-span-2 space-y-4">
              {/* 任务概览 */}
              <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">任务概览</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">克隆模式</span>
                    <Badge variant="secondary" className="font-normal">
                      {MODES.find((m) => m.value === mode)?.title}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">产品图数</span>
                    <span className="font-medium tabular-nums">
                      {productImages.length} 张
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">竞品图数</span>
                    <span className="font-medium tabular-nums">
                      {competitorImages.length} 张
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">图片比例</span>
                    <span className="font-medium tabular-nums">{aspectRatio}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">高仿模式</span>
                    <span className={cn(
                      'font-medium',
                      highCopyMode ? 'text-amber-600' : 'text-muted-foreground',
                    )}>
                      {highCopyMode ? '已开启' : '未开启'}
                    </span>
                  </div>
                  <div className="pt-2 border-t border-border/40 flex justify-between text-sm">
                    <span className="text-muted-foreground">预计消耗积分</span>
                    <span className="font-semibold flex items-center gap-1 text-amber-600">
                      <Coins className="size-3.5" />
                      {estimatedCredits}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* 生成进度 */}
              {(isGenerating || resultImages.length > 0) && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">生成进度</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* 阶段1 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          {stage1Progress >= 100 || resultImages.length > 0 ? (
                            <CheckCircle2 className="size-4 text-green-500" />
                          ) : isGenerating ? (
                            <Loader2 className="size-4 text-primary animate-spin" />
                          ) : (
                            <div className="size-4 rounded-full border border-border" />
                          )}
                          <span
                            className={
                              stage1Progress >= 100 || resultImages.length > 0
                                ? 'text-green-600 font-medium'
                                : ''
                            }
                          >
                            克隆词分析
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {Math.round(stage1Progress)}%
                        </span>
                      </div>
                      <Progress value={stage1Progress} className="h-1.5" />
                      <p className="text-xs text-muted-foreground pl-6">
                        分析竞品图的构图、文案、风格
                      </p>
                    </div>

                    {/* 阶段2 */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          {stage2Progress >= 100 || resultImages.length > 0 ? (
                            <CheckCircle2 className="size-4 text-green-500" />
                          ) : isGenerating && stage1Progress >= 100 ? (
                            <Loader2 className="size-4 text-primary animate-spin" />
                          ) : (
                            <div className="size-4 rounded-full border border-border" />
                          )}
                          <span
                            className={
                              stage2Progress >= 100 || resultImages.length > 0
                                ? 'text-green-600 font-medium'
                                : ''
                            }
                          >
                            成图生成
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {Math.round(stage2Progress)}%
                        </span>
                      </div>
                      <Progress value={stage2Progress} className="h-1.5" />
                      <p className="text-xs text-muted-foreground pl-6">
                        生成新的产品营销图
                      </p>
                    </div>

                    {isGenerating && (
                      <div className="pt-2 border-t border-border/40">
                        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                          <span>总进度</span>
                          <span className="font-medium text-primary tabular-nums">
                            {totalProgress}%
                          </span>
                        </div>
                        <Progress value={totalProgress} className="h-2" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* 生成结果 */}
              {resultImages.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span>生成结果</span>
                      <Badge variant="default" className="text-xs">
                        {resultImages.length} 张
                        {moreCount > 0 && ` (+${moreCount})`}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {resultImages.map((img) => (
                        <div
                          key={img.id}
                          className="relative aspect-square rounded-lg overflow-hidden border border-border/60 bg-muted group cursor-pointer"
                          onClick={() => setPreviewImage(img)}
                        >
                          {/* CSS 模拟克隆效果：图片 + 色调叠加 */}
                          <Image
                            src={img.url}
                            alt="克隆结果"
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                            style={{
                              filter: `hue-rotate(${img.hue}deg) saturate(${img.saturation})`,
                            }}
                          />
                          <div
                            className="absolute inset-0 mix-blend-overlay opacity-30 pointer-events-none"
                            style={{
                              background: `linear-gradient(135deg, hsl(${img.hue} 70% 60% / 0.5), transparent 60%)`,
                            }}
                          />
                          {/* hover 操作 */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              className="size-8 rounded-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewImage(img);
                              }}
                            >
                              <ZoomIn className="size-4" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="secondary"
                              className="size-8 rounded-full"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownloadSingle(img);
                              }}
                            >
                              <Download className="size-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {moreCount > 0 && (
                      <p className="text-xs text-center text-muted-foreground">
                        还有 {moreCount} 张结果图已生成，点击下载查看全部
                      </p>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={handleBatchDownload}
                      >
                        <Download className="size-3.5 mr-1.5" />
                        一键打包下载
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={handleReClone}
                        disabled={isGenerating}
                      >
                        <RefreshCw className="size-3.5 mr-1.5" />
                        重新克隆
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 图片预览弹窗 */}
      <Dialog open={!!previewImage} onOpenChange={(o) => !o && setPreviewImage(null)}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden">
          {previewImage && (
            <>
              <DialogHeader className="p-4">
                <DialogTitle className="text-base">克隆结果预览</DialogTitle>
                <DialogDescription>
                  产品图 × 竞品图风格融合效果
                </DialogDescription>
              </DialogHeader>
              <div className="px-4 pb-4">
                <div className="relative rounded-lg overflow-hidden aspect-square bg-muted">
                  <Image
                    src={previewImage.url}
                    alt="克隆结果预览"
                    className="w-full h-full object-cover"
                    style={{
                      filter: `hue-rotate(${previewImage.hue}deg) saturate(${previewImage.saturation})`,
                    }}
                  />
                  <div
                    className="absolute inset-0 mix-blend-overlay opacity-30 pointer-events-none"
                    style={{
                      background: `linear-gradient(135deg, hsl(${previewImage.hue} 70% 60% / 0.5), transparent 60%)`,
                    }}
                  />
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPreviewImage(null)}
                  >
                    关闭
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleDownloadSingle(previewImage)}
                  >
                    <Download className="size-4 mr-1.5" />
                    下载此图
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
