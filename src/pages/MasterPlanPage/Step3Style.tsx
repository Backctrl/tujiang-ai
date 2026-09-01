import { useState, useMemo, useRef, type DragEvent } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Check, Link, Upload, X, Palette, Tag, Sparkles, Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MOCK_STYLES, type IStyle } from '@/data/styles';
import { cn } from '@/lib/utils';
import { Image } from '@/components/ui/image';
import { toast } from 'sonner';

interface Step3StyleProps {
  selectedStyleId: string;
  onChange: (styleId: string) => void;
  customStyle: CustomStyleResult | null;
  onCustomStyleChange: (style: CustomStyleResult | null) => void;
}

interface CustomStyleResult {
  name: string;
  colors: string[];
  tags: string[];
  category: string;
  source: 'link' | 'upload';
}

const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'home', label: '家居家具' },
  { value: 'digital', label: '3C数码' },
  { value: 'fashion', label: '服装服饰' },
  { value: 'beauty', label: '美妆护肤' },
  { value: 'food', label: '食品生鲜' },
];

// 模拟风格分析结果池
const MOCK_ANALYSIS_RESULTS: CustomStyleResult[] = [
  {
    name: '北欧简约风',
    colors: ['#F5F1EB', '#D4C5A9', '#8B7355', '#4A4A4A'],
    tags: ['简约', '自然光', '大量留白', '木质调'],
    category: '家居家具',
    source: 'link',
  },
  {
    name: '轻奢高级感',
    colors: ['#1A1A1A', '#C9A961', '#F5F5F0', '#8B7355'],
    tags: ['高级', '质感', '低饱和', '暗调'],
    category: '美妆护肤',
    source: 'upload',
  },
  {
    name: '科技未来感',
    colors: ['#0A0E27', '#3B82F6', '#60A5FA', '#E0F2FE'],
    tags: ['科技', '未来感', '冷色调', '光效'],
    category: '3C数码',
    source: 'link',
  },
];

export default function Step3Style({
  selectedStyleId,
  onChange,
  customStyle,
  onCustomStyleChange,
}: Step3StyleProps) {
  const [category, setCategory] = useState('all');
  const [refTab, setRefTab] = useState<'link' | 'upload'>('link');
  const [linkUrl, setLinkUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<CustomStyleResult | null>(null);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredStyles = useMemo(() => {
    if (category === 'all') return MOCK_STYLES;
    return MOCK_STYLES.filter((s) => s.category === category);
  }, [category]);

  const handleAnalyzeLink = () => {
    if (!linkUrl.trim()) {
      toast.warning('请输入竞品链接');
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult(null);

    setTimeout(() => {
      const result = MOCK_ANALYSIS_RESULTS[0];
      setAnalysisResult(result);
      setIsAnalyzing(false);
      toast.success('风格分析完成');
    }, 2000);
  };

  const handleFileDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files?.length) {
      handleFiles(files);
    }
  };

  const handleFiles = (fileList: FileList) => {
    const remaining = 3 - uploadedImages.length;
    if (remaining <= 0) {
      toast.warning('最多上传 3 张参考图');
      return;
    }
    const files = Array.from(fileList).slice(0, remaining);
    const readers = files.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        }),
    );
    Promise.all(readers).then((urls) => {
      setUploadedImages((prev) => [...prev, ...urls]);
    });
  };

  const removeUploadedImage = (index: number) => {
    setUploadedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAnalyzeUpload = () => {
    if (uploadedImages.length === 0) {
      toast.warning('请先上传参考图');
      return;
    }
    setIsAnalyzing(true);
    setAnalysisResult(null);

    setTimeout(() => {
      const result = MOCK_ANALYSIS_RESULTS[1];
      setAnalysisResult(result);
      setIsAnalyzing(false);
      toast.success('风格分析完成');
    }, 2000);
  };

  const applyCustomStyle = () => {
    if (!analysisResult) return;
    onCustomStyleChange(analysisResult);
    onChange('custom');
    toast.success(`已应用「${analysisResult.name}」风格`);
  };

  const handlePresetClick = (id: string) => {
    onChange(id);
    onCustomStyleChange(null);
  };

  const useCustom = selectedStyleId === 'custom' && customStyle;

  return (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-foreground">选择风格模板</h2>
        <p className="text-muted-foreground mt-2">选择预设风格或自定义风格参考</p>
      </div>

      {/* 自定义风格参考区域 */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/[0.03] to-background overflow-hidden">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shadow-md">
              <Wand2 className="size-5" />
            </div>
            <div>
              <div className="font-semibold text-foreground">自定义风格参考（可选）</div>
              <div className="text-xs text-muted-foreground">
                输入竞品链接或上传参考图，AI 自动分析并复刻其设计风格
              </div>
            </div>
          </div>

          <Tabs value={refTab} onValueChange={(v) => setRefTab(v as 'link' | 'upload')}>
            <TabsList className="grid grid-cols-2 w-full max-w-xs">
              <TabsTrigger value="link" className="data-[state=active]:shadow-sm">
                <Link className="size-3.5 mr-1.5" />
                链接提取
              </TabsTrigger>
              <TabsTrigger value="upload" className="data-[state=active]:shadow-sm">
                <Upload className="size-3.5 mr-1.5" />
                上传参考图
              </TabsTrigger>
            </TabsList>

            <TabsContent value="link" className="mt-4 space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="粘贴竞品详情页链接，如淘宝/京东/亚马逊商品链接"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeLink()}
                  className="flex-1"
                />
                <Button onClick={handleAnalyzeLink} disabled={isAnalyzing}>
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4 mr-2" />
                      分析风格
                    </>
                  )}
                </Button>
              </div>

              {isAnalyzing && (
                <div className="p-4 rounded-lg bg-muted/50 border border-border/50 flex items-center gap-3">
                  <Loader2 className="size-5 text-primary animate-spin" />
                  <div>
                    <div className="text-sm font-medium">正在分析页面风格...</div>
                    <div className="text-xs text-muted-foreground">
                      识别配色、排版、视觉元素中，请稍候
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="upload" className="mt-4 space-y-4">
              <div
                onDrop={handleFileDrop}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-lg p-6 cursor-pointer transition-all text-center',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/60 hover:bg-muted/30',
                )}
              >
                <Upload className="size-6 mx-auto text-muted-foreground mb-2" />
                <div className="text-sm font-medium">点击或拖拽上传参考图</div>
                <div className="text-xs text-muted-foreground mt-1">
                  上传 1-3 张风格参考图，支持 JPG/PNG
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
              </div>

              {uploadedImages.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {uploadedImages.map((url, i) => (
                    <div
                      key={i}
                      className="relative size-16 rounded-md overflow-hidden border border-border group"
                    >
                      <Image
                        src={url}
                        alt={`参考图 ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeUploadedImage(i);
                        }}
                        className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-white flex items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  {uploadedImages.length < 3 && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="size-16 rounded-md border-2 border-dashed border-border hover:border-primary/60 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Upload className="size-4" />
                    </button>
                  )}
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="text-xs text-muted-foreground">
                  已上传 {uploadedImages.length}/3 张
                </span>
                <Button
                  size="sm"
                  onClick={handleAnalyzeUpload}
                  disabled={isAnalyzing || uploadedImages.length === 0}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      分析中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4 mr-2" />
                      分析风格
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>
          </Tabs>

          {/* 分析结果卡片 */}
          {analysisResult && (
            <div className="p-4 rounded-lg border border-primary/30 bg-primary/[0.03] space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette className="size-4 text-primary" />
                  <span className="font-semibold">{analysisResult.name}</span>
                  <Badge variant="outline" className="text-xs font-normal border-primary/30">
                    {analysisResult.category}
                  </Badge>
                </div>
                <Button size="sm" onClick={applyCustomStyle}>
                  <Check className="size-3.5 mr-1" />
                  应用此风格
                </Button>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">配色分析</div>
                <div className="flex gap-2">
                  {analysisResult.colors.map((color, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <div
                        className="size-6 rounded-md border border-border shadow-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-xs font-mono text-muted-foreground">{color}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">风格标签</div>
                <div className="flex flex-wrap gap-1.5">
                  {analysisResult.tags.map((tag, i) => (
                    <Badge key={i} variant="secondary" className="text-xs font-normal">
                      <Tag className="size-3 mr-1" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 自定义风格已应用提示 */}
      {useCustom && (
        <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
          <Sparkles className="size-4 text-purple-600" />
          <span className="text-sm font-medium text-purple-700">
            当前使用自定义风格：{customStyle?.name}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-500/10"
            onClick={() => {
              onChange('1');
              onCustomStyleChange(null);
            }}
          >
            切换到预设风格
          </Button>
        </div>
      )}

      {/* 预设风格分类 */}
      <Tabs value={category} onValueChange={setCategory} className="w-full">
        <TabsList className="w-full max-w-xl mx-auto grid grid-cols-3 md:grid-cols-6 h-auto p-1">
          {CATEGORIES.map((cat) => (
            <TabsTrigger
              key={cat.value}
              value={cat.value}
              className="py-2 data-[state=active]:shadow-sm"
            >
              {cat.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* 风格卡片网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-2">
        {filteredStyles.map((style: IStyle) => {
          const isSelected = selectedStyleId === style.id;
          return (
            <div
              key={style.id}
              onClick={() => handlePresetClick(style.id)}
              className={cn(
                'group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-lg',
                isSelected
                  ? 'ring-2 ring-primary ring-offset-2 shadow-lg shadow-primary/20'
                  : 'border border-border/60',
                useCustom && 'opacity-60',
              )}
            >
              <div className="aspect-square overflow-hidden bg-muted">
                <Image
                  src={style.previewUrl}
                  alt={style.name}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-3 bg-card">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{style.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {style.description}
                    </div>
                  </div>
                  {isSelected && (
                    <div className="size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                      <Check className="size-4" />
                    </div>
                  )}
                </div>
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2 size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
                  <Check className="size-4" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { CustomStyleResult };
