import { useState, useRef, type ChangeEvent } from 'react';
import {
  Sparkles,
  Image as ImageIcon,
  Upload,
  Download,
  RefreshCw,
  Heart,
  Copy,
  Clock,
  Wand2,
  Palette,
  Star,
  Share2,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Image } from '@/components/ui/image';
import { PRODUCT_IMAGES } from '@/data/history';
import { cn } from '@/lib/utils';

type Mode = 'text2img' | 'img2img';
type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
type GenCount = 1 | 2 | 4;

const RATIO_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '4:3', label: '4:3' },
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
];

const STYLE_PRESETS = [
  '电商产品图',
  '生活方式场景',
  '白底图',
  '3D渲染',
  '插画',
  '摄影写实',
];

const HISTORY_ITEMS = PRODUCT_IMAGES.map((url, i) => ({
  id: `h-${i}`,
  url,
  title: `生成 ${i + 1}`,
  time: `${i + 1}小时前`,
}));

export default function CreateWorkshopPage() {
  const [mode, setMode] = useState<Mode>('text2img');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [stylePreset, setStylePreset] = useState('电商产品图');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [count, setCount] = useState<GenCount>(4);
  const [model, setModel] = useState<'gpt' | 'banana'>('banana');
  const [refImage, setRefImage] = useState<string | null>(null);
  const [refStrength, setRefStrength] = useState(70);

  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const costPerImage = 5;
  const totalCost = costPerImage * count;

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setRefImage(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = () => {
    if (!prompt.trim() && mode === 'text2img') {
      toast.warning('请输入提示词');
      return;
    }
    if (mode === 'img2img' && !refImage) {
      toast.warning('请上传参考图');
      return;
    }
    setIsGenerating(true);
    setProgress(0);
    setResults([]);

    // 模拟进度
    const timer = setInterval(() => {
      setProgress((p) => {
        const next = p + Math.random() * 8 + 2;
        if (next >= 100) {
          clearInterval(timer);
          return 100;
        }
        return next;
      });
    }, 150);

    // 模拟3秒生成
    setTimeout(() => {
      clearInterval(timer);
      setProgress(100);
      // 使用 PRODUCT_IMAGES 模拟结果
      const generated = Array.from({ length: count }, (_, i) => PRODUCT_IMAGES[i % PRODUCT_IMAGES.length]);
      setResults(generated);
      setIsGenerating(false);
      toast.success(`生成完成，共 ${count} 张`);
    }, 3000);
  };

  const handleDownload = (url: string, name: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('开始下载');
  };

  const handleDownloadAll = () => {
    results.forEach((url, i) => {
      setTimeout(() => handleDownload(url, `generate-${i + 1}.png`), i * 200);
    });
  };

  const ratioClass = {
    '1:1': 'aspect-square',
    '3:4': 'aspect-[3/4]',
    '4:3': 'aspect-[4/3]',
    '9:16': 'aspect-[9/16]',
    '16:9': 'aspect-[16/9]',
  }[aspectRatio];

  const gridCols = {
    1: 'grid-cols-1 max-w-md mx-auto',
    2: 'grid-cols-2 max-w-2xl mx-auto',
    4: 'grid-cols-2 max-w-3xl mx-auto',
  }[count];

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="size-6 text-primary" />
            AI创图工坊
          </h1>
          <p className="text-muted-foreground mt-1">文生图 / 图生图，自由创作你的专属图片</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* 左侧参数配置 */}
          <div className="space-y-4">
            <Card className="border-border/60 overflow-hidden">
              <CardContent className="p-0">
                <Tabs
                  value={mode}
                  onValueChange={(v) => setMode(v as Mode)}
                  className="w-full"
                >
                  <TabsList className="w-full grid grid-cols-2 rounded-none h-12 border-b border-border/40 bg-transparent">
                    <TabsTrigger
                      value="text2img"
                      className="data-[state=active]:bg-background data-[state=active]:shadow-none h-11 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                    >
                      <Wand2 className="size-4 mr-2" />
                      文生图
                    </TabsTrigger>
                    <TabsTrigger
                      value="img2img"
                      className="data-[state=active]:bg-background data-[state=active]:shadow-none h-11 rounded-none border-b-2 border-transparent data-[state=active]:border-primary"
                    >
                      <ImageIcon className="size-4 mr-2" />
                      图生图
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="p-5 space-y-5">
                  {/* 文生图模式 */}
                  {mode === 'text2img' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">提示词</Label>
                        <Textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="描述你想要生成的图片，例如：一张北欧风格的沙发产品图，白色背景，专业摄影，柔光..."
                          className="min-h-[100px] resize-none text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">负面提示词</Label>
                        <Textarea
                          value={negativePrompt}
                          onChange={(e) => setNegativePrompt(e.target.value)}
                          placeholder="不想要的内容，例如：模糊、低质量、水印..."
                          className="min-h-[60px] resize-none text-sm"
                        />
                      </div>
                    </>
                  )}

                  {/* 图生图模式 */}
                  {mode === 'img2img' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">参考图</Label>
                        <div className="aspect-video rounded-lg border border-dashed border-border/60 bg-muted/30 overflow-hidden">
                          {refImage ? (
                            <div className="relative w-full h-full">
                              <Image
                                src={refImage}
                                alt="参考图"
                                className="w-full h-full object-contain"
                              />
                              <Button
                                size="sm"
                                variant="destructive"
                                className="absolute top-2 right-2 size-7 p-0"
                                onClick={() => setRefImage(null)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <label className="w-full h-full flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-muted/60 transition-colors">
                              <Upload className="size-6 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">点击上传参考图</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={handleFile}
                                className="hidden"
                              />
                            </label>
                          )}
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">参考强度</Label>
                          <span className="text-xs text-muted-foreground tabular-nums">{refStrength}%</span>
                        </div>
                        <Slider
                          value={[refStrength]}
                          onValueChange={(v) => setRefStrength(v[0])}
                          max={100}
                          step={1}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          数值越高越接近参考图，越低创意自由度越高
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-sm font-medium">提示词</Label>
                        <Textarea
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="描述在参考图基础上要改变的内容..."
                          className="min-h-[60px] resize-none text-sm"
                        />
                      </div>
                    </>
                  )}

                  <Separator />

                  {/* 通用参数 */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">风格预设</Label>
                    <Select value={stylePreset} onValueChange={setStylePreset}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STYLE_PRESETS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">比例</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {RATIO_OPTIONS.map((r) => (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => setAspectRatio(r.value)}
                          className={cn(
                            'h-8 text-xs rounded-lg border transition-all',
                            aspectRatio === r.value
                              ? 'border-primary bg-primary/5 text-primary font-medium'
                              : 'border-border/60 hover:border-primary/40 text-muted-foreground',
                          )}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">数量</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 4].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setCount(n as GenCount)}
                          className={cn(
                            'h-9 text-sm rounded-lg border transition-all',
                            count === n
                              ? 'border-primary bg-primary/5 text-primary font-medium'
                              : 'border-border/60 hover:border-primary/40 text-muted-foreground',
                          )}
                        >
                          {n}张
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">模型</Label>
                    <RadioGroup
                      value={model}
                      onValueChange={(v) => setModel(v as 'gpt' | 'banana')}
                      className="flex gap-3"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="gpt" id="model-gpt" />
                        <Label htmlFor="model-gpt" className="text-sm cursor-pointer">
                          GPT模型
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="banana" id="model-banana" />
                        <Label htmlFor="model-banana" className="text-sm cursor-pointer">
                          香蕉模型
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <Button
                    className="w-full h-11 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white shadow-md"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="size-4 mr-2 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4 mr-2" />
                        生成 · 消耗 {totalCost} 积分
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 右侧结果展示区 */}
          <div className="space-y-4">
            <Card className="border-border/60 min-h-[400px]">
              <CardHeader className="pb-3 border-b border-border/40">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    {isGenerating ? (
                      <>
                        <Loader2 className="size-4 text-primary animate-spin" />
                        AI创作中...
                      </>
                    ) : results.length > 0 ? (
                      <>
                        <Sparkles className="size-4 text-primary" />
                        生成完成 · {results.length}张
                      </>
                    ) : (
                      <>
                        <Palette className="size-4 text-muted-foreground" />
                        等待生成
                      </>
                    )}
                  </CardTitle>
                  {results.length > 0 && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={handleDownloadAll}>
                        <Download className="size-3.5 mr-1.5" />
                        下载全部
                      </Button>
                      <Button size="sm" variant="secondary" onClick={handleGenerate}>
                        <RefreshCw className="size-3.5 mr-1.5" />
                        重新生成
                      </Button>
                    </div>
                  )}
                </div>
                {isGenerating && (
                  <div className="mt-3">
                    <Progress value={progress} className="h-1.5" />
                    <div className="flex justify-between mt-1.5 text-[11px] text-muted-foreground">
                      <span>正在生成你的创意图片...</span>
                      <span className="tabular-nums">{Math.round(progress)}%</span>
                    </div>
                  </div>
                )}
              </CardHeader>

              <CardContent className="p-5">
                {results.length === 0 && !isGenerating ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="size-16 rounded-full bg-gradient-to-br from-primary/10 to-purple-100 flex items-center justify-center mb-4">
                      <Wand2 className="size-8 text-primary" />
                    </div>
                    <div className="text-base font-medium">开始你的创作</div>
                    <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                      在左侧输入提示词，设置参数，点击生成按钮
                    </p>
                  </div>
                ) : isGenerating ? (
                  <div className={`grid ${gridCols} gap-4`}>
                    {Array.from({ length: count }).map((_, i) => (
                      <div
                        key={i}
                        className={`${ratioClass} rounded-xl bg-muted animate-pulse`}
                      />
                    ))}
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className={`grid ${gridCols} gap-4`}
                  >
                    {results.map((url, i) => (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.1 }}
                        className="group relative"
                      >
                        <div
                          className={cn(
                            ratioClass,
                            'rounded-xl overflow-hidden border border-border/60 bg-muted',
                          )}
                        >
                          <Image
                            src={url}
                            alt={`生成结果 ${i + 1}`}
                            className="w-full h-full object-cover transition-transform group-hover:scale-105"
                          />
                        </div>
                        {/* hover 操作按钮 */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all rounded-xl flex items-end justify-center pb-3 opacity-0 group-hover:opacity-100">
                          <div className="flex gap-1.5">
                            <Button
                              size="icon"
                              variant="secondary"
                              className="size-8 rounded-full"
                              onClick={() => handleDownload(url, `generate-${i + 1}.png`)}
                            >
                              <Download className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="size-8 rounded-full"
                              onClick={() => {
                                setResults((prev) => {
                                  const next = [...prev];
                                  next[i] = PRODUCT_IMAGES[(i + 2) % PRODUCT_IMAGES.length];
                                  return next;
                                });
                                toast.success('已重新生成');
                              }}
                            >
                              <RefreshCw className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="size-8 rounded-full"
                              onClick={() => toast.success('已用于详情页生成')}
                            >
                              <Share2 className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="secondary"
                              className="size-8 rounded-full"
                              onClick={() => toast.success('已收藏')}
                            >
                              <Heart className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </CardContent>
            </Card>

            {/* 历史记录 */}
            <Card className="border-border/60 overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setShowHistory(!showHistory)}
              >
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="size-4 text-primary" />
                  历史生成
                </CardTitle>
                <Button variant="ghost" size="icon" className="size-7">
                  {showHistory ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </Button>
              </div>
              <AnimatePresence initial={false}>
                {showHistory && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4">
                      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                        {HISTORY_ITEMS.map((item, i) => (
                          <div
                            key={item.id}
                            className="shrink-0 w-20 cursor-pointer group"
                            onClick={() => {
                              setResults(
                                Array.from(
                                  { length: count },
                                  (_, j) => PRODUCT_IMAGES[(i + j) % PRODUCT_IMAGES.length],
                                ),
                              );
                            }}
                          >
                            <div className="aspect-square rounded-lg overflow-hidden border border-border/60 group-hover:border-primary/40 transition-colors">
                              <Image
                                src={item.url}
                                alt={item.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-1 truncate text-center">
                              {item.time}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
