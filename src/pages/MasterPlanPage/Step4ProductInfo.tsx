import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Plus, X, CheckSquare, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductInfo {
  name: string;
  sellingPoints: string[];
  params: { key: string; value: string }[];
  platforms: string[];
  noCopyMode: boolean;
}

interface Step4ProductInfoProps {
  info: ProductInfo;
  onChange: (info: ProductInfo) => void;
}

const PLATFORMS = [
  { value: 'taobao', label: '淘宝' },
  { value: 'jd', label: '京东' },
  { value: 'douyin', label: '抖音' },
  { value: 'amazon', label: '亚马逊' },
  { value: 'pdd', label: '拼多多' },
];

export default function Step4ProductInfo({ info, onChange }: Step4ProductInfoProps) {
  const [paramInput, setParamInput] = useState({ key: '', value: '' });

  const updateInfo = (patch: Partial<ProductInfo>) => {
    onChange({ ...info, ...patch });
  };

  const handleSellingPointsChange = (value: string) => {
    const lines = value.split('\n').filter((l) => l.trim() !== '');
    updateInfo({ sellingPoints: lines });
  };

  const addParam = () => {
    if (paramInput.key.trim() && paramInput.value.trim()) {
      updateInfo({
        params: [...info.params, { key: paramInput.key.trim(), value: paramInput.value.trim() }],
      });
      setParamInput({ key: '', value: '' });
    }
  };

  const removeParam = (index: number) => {
    updateInfo({
      params: info.params.filter((_, i) => i !== index),
    });
  };

  const togglePlatform = (platform: string) => {
    const has = info.platforms.includes(platform);
    updateInfo({
      platforms: has
        ? info.platforms.filter((p) => p !== platform)
        : [...info.platforms, platform],
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-foreground">填写产品信息</h2>
        <p className="text-muted-foreground mt-2">
          填写产品的基本信息，AI 将根据这些信息生成文案和图片
        </p>
      </div>

      {/* 无文案模式开关 */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 border border-border/50">
        <div>
          <div className="text-sm font-medium">无文案模式</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            开启后只生成图片，不添加任何文字内容
          </div>
        </div>
        <Switch checked={info.noCopyMode} onCheckedChange={(v) => updateInfo({ noCopyMode: v })} />
      </div>

      {/* 产品名称 */}
      <div className="space-y-2">
        <Label htmlFor="product-name" className="text-sm font-medium">
          产品名称 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="product-name"
          placeholder="请输入产品名称，如：北欧简约实木餐桌"
          value={info.name}
          onChange={(e) => updateInfo({ name: e.target.value })}
        />
      </div>

      {!info.noCopyMode && (
        <>
          {/* 核心卖点 */}
          <div className="space-y-2">
            <Label htmlFor="selling-points" className="text-sm font-medium">
              核心卖点
            </Label>
            <Textarea
              id="selling-points"
              placeholder="每行输入一个卖点，如：&#10;100% 进口橡木&#10;环保水性漆&#10;三年质保"
              rows={5}
              value={info.sellingPoints.join('\n')}
              onChange={(e) => handleSellingPointsChange(e.target.value)}
              className="resize-none"
            />
            <div className="text-xs text-muted-foreground">每行一个卖点，建议 3-5 条</div>
          </div>

          {/* 产品参数 */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">产品参数</Label>

            {info.params.length > 0 && (
              <div className="space-y-2">
                {info.params.map((param, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg"
                  >
                    <span className="text-sm font-medium min-w-[80px]">{param.key}</span>
                    <span className="text-foreground/80 flex-1 text-sm">{param.value}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => removeParam(index)}
                    >
                      <X className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                placeholder="参数名，如：尺寸"
                value={paramInput.key}
                onChange={(e) => setParamInput({ ...paramInput, key: e.target.value })}
                className="flex-1"
              />
              <Input
                placeholder="参数值，如：120×60×75cm"
                value={paramInput.value}
                onChange={(e) => setParamInput({ ...paramInput, value: e.target.value })}
                className="flex-1"
              />
              <Button type="button" variant="secondary" onClick={addParam}>
                <Plus className="size-4 mr-1" /> 添加
              </Button>
            </div>
          </div>

          {/* 目标平台 */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">目标平台（多选）</Label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const selected = info.platforms.includes(p.value);
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => togglePlatform(p.value)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground hover:bg-muted/80',
                    )}
                  >
                    {selected ? (
                      <CheckSquare className="size-4" />
                    ) : (
                      <Square className="size-4" />
                    )}
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { ProductInfo };
