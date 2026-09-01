import { useState, useRef, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Scissors,
  ZoomIn,
  ImagePlus,
  Wrench,
  Upload,
  Download,
  Copy,
  ArrowRight,
  RefreshCw,
  ImageIcon,
  Clock,
  ChevronRight,
  Palette,
  Check,
  Sparkles,
  Pencil,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Image } from '@/components/ui/image';
import { cn } from '@/lib/utils';

type ToolId = 'cutout' | 'upscale' | 'bg' | 'repair';

const TOOLS: { id: ToolId; label: string; icon: typeof Scissors; desc: string }[] = [
  { id: 'cutout', label: '智能抠图', icon: Scissors, desc: '一键抠图，发丝级精准' },
  { id: 'upscale', label: '图片放大', icon: ZoomIn, desc: '超分辨率，无损放大' },
  { id: 'bg', label: '背景替换', icon: ImagePlus, desc: '替换背景，一键搞定' },
  { id: 'repair', label: '图片修复', icon: Wrench, desc: '消除瑕疵，修复旧照' },
];

const BG_PRESETS = [
  { id: 'white', label: '白底', css: 'bg-white' },
  { id: 'gray', label: '灰底', css: 'bg-stone-200' },
  { id: 'gradient', label: '渐变', css: 'bg-gradient-to-br from-purple-100 to-pink-100' },
  { id: 'living', label: '北欧客厅', css: 'bg-gradient-to-br from-amber-100 to-orange-200' },
  { id: 'desk', label: '简约桌面', css: 'bg-gradient-to-br from-stone-100 to-stone-200' },
  { id: 'outdoor', label: '户外自然', css: 'bg-gradient-to-br from-emerald-100 to-teal-200' },
  { id: 'studio', label: '工作室', css: 'bg-gradient-to-br from-slate-700 to-slate-900' },
];

import { PRODUCT_IMAGES } from '@/data/history';

const HISTORY_LABELS: Record<ToolId, string[]> = {
  cutout: ['产品图抠图', '人像抠图', '宠物抠图', '食物抠图', '鞋包抠图'],
  upscale: ['老照片放大', '产品图放大', '海报放大', '风景照放大', '插画放大'],
  bg: ['换白底', '换场景', '换渐变', '换户外', '换工作室'],
  repair: ['去瑕疵', '旧照修复', '去水印', '去路人', '补全画面'],
};

const HISTORY_TIMES: Record<ToolId, string[]> = {
  cutout: ['10分钟前', '1小时前', '昨天', '2天前', '3天前'],
  upscale: ['30分钟前', '2小时前', '昨天', '2天前', '3天前'],
  bg: ['20分钟前', '3小时前', '昨天', '2天前', '3天前'],
  repair: ['1小时前', '昨天', '2天前', '3天前', '4天前'],
};

function buildHistory(toolId: ToolId) {
  const labels = HISTORY_LABELS[toolId];
  const times = HISTORY_TIMES[toolId];
  return labels.map((label, i) => ({
    id: String(i + 1),
    thumb: PRODUCT_IMAGES[i % PRODUCT_IMAGES.length],
    time: times[i],
    label,
  }));
}

export default function ToolboxPage() {
  const navigate = useNavigate();
  const [activeTool, setActiveTool] = useState<ToolId>('cutout');
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultReady, setResultReady] = useState(false);

  // 放大倍数
  const [scale, setScale] = useState('4x');

  // 背景替换
  const [selectedBg, setSelectedBg] = useState('white');
  const [customColor, setCustomColor] = useState('#6366f1');

  // 图片修复 - 涂抹
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [repairMode, setRepairMode] = useState<'auto' | 'manual'>('auto');

  // 对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [comparePos, setComparePos] = useState(50);

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 类型校验：必须是图片文件
    if (!file.type?.startsWith('image/')) {
      toast.error('请上传图片文件（JPG / PNG / WEBP 等）');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      // 预加载校验内容有效性
      const img = new window.Image();
      img.onload = () => {
        setUploadedImage(url);
        setResultReady(false);
        setIsProcessing(true);
        setTimeout(() => {
          setIsProcessing(false);
          setResultReady(true);
          toast.success('处理完成');
        }, 2000);
      };
      img.onerror = () => {
        toast.error('图片文件损坏或格式不支持');
        e.target.value = '';
      };
      img.src = url;
    };
    reader.onerror = () => {
      toast.error('读取文件失败');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleReprocess = () => {
    if (!uploadedImage) return;
    setIsProcessing(true);
    setResultReady(false);
    setTimeout(() => {
      setIsProcessing(false);
      setResultReady(true);
      toast.success('重新处理完成');
    }, 2000);
  };

  const handleCopyToClipboard = () => {
    toast.success('已复制到剪贴板');
  };

  const handleUseForMasterplan = () => {
    toast.success('已带到主图生成，跳转中...');
    setTimeout(() => navigate('/'), 600);
  };

  const handleUseForDetail = () => {
    toast.success('已带到详情页生成，跳转中...');
    setTimeout(() => navigate('/'), 600);
  };

  const handleDownload = () => {
    if (!uploadedImage) return;
    const link = document.createElement('a');
    link.href = uploadedImage;
    link.download = `${activeTool}-result.png`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('开始下载');
  };

  // 涂抹画布
  const getCanvasPos = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (repairMode !== 'manual') return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || repairMode !== 'manual') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCanvasPos(e);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => {
    setIsDrawing(false);
  };

  const currentHistory = buildHistory(activeTool);
  const activeToolInfo = TOOLS.find((t) => t.id === activeTool)!;

  const renderCutout = () => (
    <div className="flex flex-col items-center gap-6">
      <div className="w-full grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
        {/* 左侧原图 */}
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            原图
          </div>
          <div className="aspect-square rounded-xl border border-border/60 bg-muted overflow-hidden relative">
            {uploadedImage ? (
              <Image src={uploadedImage} alt="原图" className="w-full h-full object-cover" />
            ) : (
              <label className="w-full h-full flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-muted/60 transition-colors">
                <div className="size-12 rounded-full bg-background flex items-center justify-center">
                  <Upload className="size-6 text-primary" />
                </div>
                <div className="text-sm text-muted-foreground text-center">
                  点击或拖拽上传图片
                </div>
                <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
              </label>
            )}
          </div>
        </div>

        {/* 中间箭头 */}
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          {isProcessing ? (
            <Loader2 className="size-6 animate-spin text-primary" />
          ) : (
            <ArrowRight className="size-6" />
          )}
          <span className="text-xs">
            {isProcessing ? 'AI智能抠图中...' : resultReady ? '抠图完成' : '等待上传'}
          </span>
        </div>

        {/* 右侧抠图结果 */}
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Scissors className="size-4 text-primary" />
            抠图结果
          </div>
          <div
            className="aspect-square rounded-xl border border-border/60 overflow-hidden relative"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #e5e7eb 25%, transparent 25%), linear-gradient(-45deg, #e5e7eb 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5e7eb 75%), linear-gradient(-45deg, transparent 75%, #e5e7eb 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            }}
          >
            {resultReady && uploadedImage ? (
              <Image
                src={uploadedImage}
                alt="抠图结果"
                className="w-full h-full object-contain"
                style={{
                  filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))',
                  maskImage: 'radial-gradient(ellipse at center, black 60%, transparent 85%)',
                  WebkitMaskImage: 'radial-gradient(ellipse at center, black 60%, transparent 85%)',
                }}
              />
            ) : isProcessing ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                <Loader2 className="size-6 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">AI智能抠图中...</span>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                上传图片后开始抠图
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部操作栏 */}
      {resultReady && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap justify-center gap-2"
        >
          <Button variant="secondary" size="sm" onClick={handleReprocess}>
            <RefreshCw className="size-3.5 mr-1.5" />
            重新抠图
          </Button>
          <Button size="sm" onClick={handleDownload}>
            <Download className="size-3.5 mr-1.5" />
            下载PNG
          </Button>
          <Button variant="secondary" size="sm" onClick={handleCopyToClipboard}>
            <Copy className="size-3.5 mr-1.5" />
            复制到剪贴板
          </Button>
          <Button variant="outline" size="sm" onClick={handleUseForMasterplan}>
            <Sparkles className="size-3.5 mr-1.5" />
            用于主图生成
          </Button>
        </motion.div>
      )}
    </div>
  );

  const renderUpscale = () => {
    const scaleMap: Record<string, number> = { '2x': 2, '4x': 4, '8x': 8 };
    const origSize = 800;
    const newSize = origSize * (scaleMap[scale] || 4);

    return (
      <div className="flex flex-col items-center gap-6">
        {/* 倍数选择 */}
        <div className="flex items-center gap-4">
          <Label className="text-sm font-medium">放大倍数</Label>
          <RadioGroup value={scale} onValueChange={setScale} className="flex gap-2">
            {['2x', '4x', '8x'].map((s) => (
              <div key={s} className="flex items-center space-x-2">
                <RadioGroupItem value={s} id={`scale-${s}`} />
                <Label htmlFor={`scale-${s}`} className="text-sm cursor-pointer">
                  {s}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="w-full grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
          {/* 原图 */}
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ImageIcon className="size-4 text-muted-foreground" />
                原图
              </span>
              <Badge variant="secondary" className="text-[10px] font-normal">
                {origSize} × {origSize}
              </Badge>
            </div>
            <div className="aspect-square rounded-xl border border-border/60 bg-muted overflow-hidden relative">
              {uploadedImage ? (
                <Image src={uploadedImage} alt="原图" className="w-full h-full object-cover" />
              ) : (
                <label className="w-full h-full flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-muted/60 transition-colors">
                  <div className="size-12 rounded-full bg-background flex items-center justify-center">
                    <Upload className="size-6 text-primary" />
                  </div>
                  <div className="text-sm text-muted-foreground text-center">
                    点击或拖拽上传图片
                  </div>
                  <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
                </label>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            {isProcessing ? (
              <Loader2 className="size-6 animate-spin text-primary" />
            ) : (
              <ArrowRight className="size-6" />
            )}
            <span className="text-xs">
              {isProcessing ? 'AI超分辨率放大中...' : resultReady ? '放大完成' : '等待上传'}
            </span>
          </div>

          {/* 结果 */}
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ZoomIn className="size-4 text-primary" />
                放大结果
              </span>
              <Badge variant="default" className="text-[10px] font-normal">
                {newSize} × {newSize}
              </Badge>
            </div>
            <div className="aspect-square rounded-xl border border-border/60 bg-muted overflow-hidden relative">
              {resultReady && uploadedImage ? (
                <div className="relative w-full h-full" style={{ overflow: 'hidden' }}>
                  <Image
                    src={uploadedImage}
                    alt="放大结果"
                    className="w-full h-full object-cover"
                    style={{
                      filter: `contrast(1.1) saturate(1.1) brightness(1.02)`,
                      transform: `scale(${1 + (scaleMap[scale] - 1) * 0.05})`,
                      imageRendering: 'auto',
                    }}
                  />
                  {/* 对比滑块 */}
                  {compareMode && (
                    <>
                      <div
                        className="absolute top-0 bottom-0 left-0 overflow-hidden pointer-events-none"
                        style={{ width: `${comparePos}%` }}
                      >
                        <Image
                          src={uploadedImage}
                          alt="原图对比"
                          className="w-full h-full object-cover"
                          style={{
                            width: `${100 * (100 / comparePos)}%`,
                            maxWidth: 'none',
                            filter: 'none',
                          }}
                        />
                      </div>
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg cursor-ew-resize"
                        style={{ left: `${comparePos}%` }}
                      >
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-6 rounded-full bg-white shadow-md flex items-center justify-center">
                          <div className="flex gap-0.5">
                            <div className="w-0.5 h-3 bg-muted-foreground/40" />
                            <div className="w-0.5 h-3 bg-muted-foreground/40" />
                          </div>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={comparePos}
                        onChange={(e) => setComparePos(Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
                      />
                    </>
                  )}
                </div>
              ) : isProcessing ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">AI超分辨率放大中...</span>
                </div>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                  上传图片后开始放大
                </div>
              )}
            </div>
          </div>
        </div>

        {resultReady && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap justify-center gap-2"
          >
            <Button variant="secondary" size="sm" onClick={handleReprocess}>
              <RefreshCw className="size-3.5 mr-1.5" />
              重新放大
            </Button>
            <Button size="sm" onClick={handleDownload}>
              <Download className="size-3.5 mr-1.5" />
              下载高清图
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCompareMode(!compareMode)}
            >
              {compareMode ? '退出对比' : '对比原图'}
            </Button>
          </motion.div>
        )}
      </div>
    );
  };

  const renderBgReplace = () => {
    const bgStyle = BG_PRESETS.find((b) => b.id === selectedBg);

    return (
      <div className="flex flex-col items-center gap-6 w-full">
        <div className="w-full grid grid-cols-1 md:grid-cols-[1fr_1.2fr_1fr] gap-4 items-start">
          {/* 左侧原图 */}
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <ImageIcon className="size-4 text-muted-foreground" />
              产品图
            </div>
            <div className="aspect-square rounded-xl border border-border/60 bg-muted overflow-hidden relative">
              {uploadedImage ? (
                <Image src={uploadedImage} alt="产品图" className="w-full h-full object-cover" />
              ) : (
                <label className="w-full h-full flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-muted/60 transition-colors">
                  <div className="size-12 rounded-full bg-background flex items-center justify-center">
                    <Upload className="size-6 text-primary" />
                  </div>
                  <div className="text-sm text-muted-foreground text-center">
                    上传产品图
                  </div>
                  <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
                </label>
              )}
            </div>
          </div>

          {/* 中间背景选择 */}
          <div className="space-y-3">
            <div className="text-sm font-medium flex items-center gap-2">
              <Palette className="size-4 text-primary" />
              选择背景
            </div>

            <div className="grid grid-cols-4 gap-2">
              {BG_PRESETS.map((bg) => (
                <button
                  key={bg.id}
                  type="button"
                  onClick={() => {
                    setSelectedBg(bg.id);
                    if (uploadedImage) {
                      setIsProcessing(true);
                      setResultReady(false);
                      setTimeout(() => {
                        setIsProcessing(false);
                        setResultReady(true);
                      }, 1500);
                    }
                  }}
                  className={cn(
                    'aspect-square rounded-lg border-2 overflow-hidden transition-all',
                    selectedBg === bg.id
                      ? 'border-primary ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  <div className={cn('w-full h-full', bg.css)} />
                  <div className="text-[10px] text-center p-1 bg-background/80 backdrop-blur-sm">
                    {bg.label}
                  </div>
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="text-xs font-medium text-muted-foreground">自定义颜色</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  className="size-8 rounded cursor-pointer border border-border"
                />
                <Input
                  value={customColor}
                  onChange={(e) => setCustomColor(e.target.value)}
                  className="flex-1 h-8 text-xs font-mono"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8"
                  onClick={() => {
                    setSelectedBg('custom');
                    if (uploadedImage) {
                      setIsProcessing(true);
                      setResultReady(false);
                      setTimeout(() => {
                        setIsProcessing(false);
                        setResultReady(true);
                      }, 1500);
                    }
                  }}
                >
                  应用
                </Button>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="text-xs font-medium text-muted-foreground">上传自定义背景</div>
              <label className="block w-full p-3 border border-dashed border-border rounded-lg text-center cursor-pointer hover:bg-muted/30 transition-colors">
                <Upload className="size-4 mx-auto text-muted-foreground" />
                <span className="text-xs text-muted-foreground mt-1 block">点击上传背景图</span>
                <input type="file" accept="image/*" className="hidden" />
              </label>
            </div>
          </div>

          {/* 右侧结果 */}
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              合成结果
            </div>
            <div className="aspect-square rounded-xl border border-border/60 overflow-hidden relative">
              {/* 背景层 */}
              <div
                className={cn(
                  'absolute inset-0',
                  selectedBg === 'custom' ? '' : bgStyle?.css,
                )}
                style={
                  selectedBg === 'custom'
                    ? { backgroundColor: customColor }
                    : undefined
                }
              />
              {/* 产品图层 */}
              {resultReady && uploadedImage && (
                <Image
                  src={uploadedImage}
                  alt="合成结果"
                  className="absolute inset-0 w-full h-full object-contain p-8"
                  style={{
                    filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.15))',
                  }}
                />
              )}
              {isProcessing && (
                <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
                  <Loader2 className="size-6 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">背景合成中...</span>
                </div>
              )}
              {!resultReady && !isProcessing && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm text-center p-4">
                  上传产品图并选择背景
                </div>
              )}
            </div>
          </div>
        </div>

        {resultReady && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-wrap justify-center gap-2"
          >
            <Button variant="secondary" size="sm" onClick={handleReprocess}>
              <RefreshCw className="size-3.5 mr-1.5" />
              重新生成
            </Button>
            <Button size="sm" onClick={handleDownload}>
              <Download className="size-3.5 mr-1.5" />
              下载图片
            </Button>
            <Button variant="outline" size="sm" onClick={handleUseForDetail}>
              <Sparkles className="size-3.5 mr-1.5" />
              用于详情页生成
            </Button>
          </motion.div>
        )}
      </div>
    );
  };

  const renderRepair = () => (
    <div className="flex flex-col items-center gap-6 w-full">
      {/* 修复模式选择 */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <RadioGroup
            value={repairMode}
            onValueChange={(v) => setRepairMode(v as 'auto' | 'manual')}
            className="flex gap-4"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="auto" id="repair-auto" />
              <Label htmlFor="repair-auto" className="text-sm cursor-pointer">
                智能修复（自动检测瑕疵）
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="manual" id="repair-manual" />
              <Label htmlFor="repair-manual" className="text-sm cursor-pointer">
                手动涂抹
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      <div className="w-full grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
        {/* 左侧原图 */}
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <ImageIcon className="size-4 text-muted-foreground" />
            原图
            {repairMode === 'manual' && (
              <Badge variant="outline" className="text-[10px]">
                涂抹要修复的区域
              </Badge>
            )}
          </div>
          <div className="aspect-square rounded-xl border border-border/60 bg-muted overflow-hidden relative">
            {uploadedImage ? (
              <>
                <Image
                  src={uploadedImage}
                  alt="原图"
                  className="w-full h-full object-cover"
                />
                {/* 瑕疵标注（自动模式） */}
                {repairMode === 'auto' && (
                  <>
                    <div className="absolute top-[25%] left-[30%] size-8 rounded-full border-2 border-red-500 animate-pulse" />
                    <div className="absolute top-[55%] right-[25%] size-6 rounded-full border-2 border-red-500 animate-pulse" />
                    <div className="absolute bottom-[30%] left-[50%] size-10 rounded-full border-2 border-red-500 animate-pulse" />
                  </>
                )}
                {/* 手动涂抹 canvas */}
                {repairMode === 'manual' && (
                  <canvas
                    ref={canvasRef}
                    width={400}
                    height={400}
                    className="absolute inset-0 w-full h-full cursor-crosshair"
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                  />
                )}
              </>
            ) : (
              <label className="w-full h-full flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-muted/60 transition-colors">
                <div className="size-12 rounded-full bg-background flex items-center justify-center">
                  <Upload className="size-6 text-primary" />
                </div>
                <div className="text-sm text-muted-foreground text-center">
                  点击或拖拽上传图片
                </div>
                <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
              </label>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          {isProcessing ? (
            <Loader2 className="size-6 animate-spin text-primary" />
          ) : (
            <ArrowRight className="size-6" />
          )}
          <span className="text-xs">
            {isProcessing ? 'AI智能修复中...' : resultReady ? '修复完成' : '等待上传'}
          </span>
        </div>

        {/* 右侧结果 */}
        <div className="space-y-2">
          <div className="text-sm font-medium flex items-center gap-2">
            <Wrench className="size-4 text-primary" />
            修复结果
          </div>
          <div className="aspect-square rounded-xl border border-border/60 bg-muted overflow-hidden relative">
            {resultReady && uploadedImage ? (
              <Image
                src={uploadedImage}
                alt="修复结果"
                className="w-full h-full object-cover"
                style={{
                  filter: 'brightness(1.05) contrast(1.05) saturate(1.05)',
                }}
              />
            ) : isProcessing ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                <Loader2 className="size-6 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">AI智能修复中...</span>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                上传图片后开始修复
              </div>
            )}
          </div>
        </div>
      </div>

      {resultReady && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap justify-center gap-2"
        >
          <Button variant="secondary" size="sm" onClick={handleReprocess}>
            <RefreshCw className="size-3.5 mr-1.5" />
            重新修复
          </Button>
          <Button size="sm" onClick={handleDownload}>
            <Download className="size-3.5 mr-1.5" />
            下载修复图
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setCompareMode(!compareMode)}>
            {compareMode ? '退出对比' : '对比原图'}
          </Button>
        </motion.div>
      )}
    </div>
  );

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wrench className="size-6 text-primary" />
            AI工具箱
          </h1>
          <p className="text-muted-foreground mt-1">
            {activeToolInfo.desc}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 主操作区 */}
          <div className="lg:col-span-3">
            <Card className="border-border/60">
              <CardContent className="p-6">
                <Tabs
                  value={activeTool}
                  onValueChange={(v) => {
                    setActiveTool(v as ToolId);
                    setUploadedImage(null);
                    setResultReady(false);
                    setIsProcessing(false);
                  }}
                  className="w-full"
                >
                  <TabsList className="w-full grid grid-cols-4 mb-6 h-auto">
                    {TOOLS.map((t) => {
                      const Icon = t.icon;
                      return (
                        <TabsTrigger
                          key={t.id}
                          value={t.id}
                          className="flex items-center gap-2 py-3 data-[state=active]:bg-background shadow-none"
                        >
                          <Icon className="size-4" />
                          <span className="text-sm">{t.label}</span>
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>

                  <TabsContent value="cutout" className="mt-0">
                    {renderCutout()}
                  </TabsContent>
                  <TabsContent value="upscale" className="mt-0">
                    {renderUpscale()}
                  </TabsContent>
                  <TabsContent value="bg" className="mt-0">
                    {renderBgReplace()}
                  </TabsContent>
                  <TabsContent value="repair" className="mt-0">
                    {renderRepair()}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>

          {/* 右侧历史记录 */}
          <div className="space-y-4">
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="size-4 text-primary" />
                  最近使用
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {currentHistory.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer group transition-colors"
                  >
                    <div className="size-12 shrink-0 rounded-lg overflow-hidden bg-muted border border-border/40">
                      <Image
                        src={item.thumb}
                        alt={item.label}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      <div className="text-xs text-muted-foreground">{item.time}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="size-7 opacity-0 group-hover:opacity-100 transition-opacity p-0"
                      onClick={() => toast.info('加载历史记录（模拟）')}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
