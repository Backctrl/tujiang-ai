import { Check, Image as ImageIcon, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

interface ImageTypeConfig {
  mainImage: {
    enabled: boolean;
    count: 1 | 6 | 9;
    noCopy: boolean;
    size: '2k-1-1' | '2k-3-4' | 'banana-2k-1-1';
  };
  detailImage: {
    enabled: boolean;
    count: 6 | 8 | 10;
    noCopy: boolean;
    size: '2k-3-4' | '1k-9-16' | '2k-9-16';
  };
}

interface Step1ImageTypeProps {
  config: ImageTypeConfig;
  onChange: (config: ImageTypeConfig) => void;
}

const MAIN_COUNTS: (1 | 6 | 9)[] = [1, 6, 9];
const DETAIL_COUNTS: (6 | 8 | 10)[] = [6, 8, 10];

const MAIN_SIZES = [
  { value: '2k-1-1', label: '2K 1:1' },
  { value: '2k-3-4', label: '2K 3:4' },
  { value: 'banana-2k-1-1', label: '香蕉模型 2K 1:1' },
] as const;

const DETAIL_SIZES = [
  { value: '2k-3-4', label: '2K 3:4' },
  { value: '1k-9-16', label: '1K 9:16' },
  { value: '2k-9-16', label: '2K 9:16' },
] as const;

export default function Step1ImageType({ config, onChange }: Step1ImageTypeProps) {
  const updateMain = (patch: Partial<ImageTypeConfig['mainImage']>) => {
    onChange({ ...config, mainImage: { ...config.mainImage, ...patch } });
  };

  const updateDetail = (patch: Partial<ImageTypeConfig['detailImage']>) => {
    onChange({ ...config, detailImage: { ...config.detailImage, ...patch } });
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-foreground">选择图片类型</h2>
        <p className="text-muted-foreground mt-2">选择你需要生成的图片类型和规格</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 商品主图卡片 */}
        <Card
          className={cn(
            'cursor-pointer transition-all hover:shadow-md',
            config.mainImage.enabled &&
              'border-primary ring-2 ring-primary/20 shadow-md shadow-primary/10',
          )}
          onClick={() => updateMain({ enabled: !config.mainImage.enabled })}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'size-10 rounded-lg flex items-center justify-center',
                    config.mainImage.enabled
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <ImageIcon className="size-5" />
                </div>
                <CardTitle className="text-lg">商品主图</CardTitle>
              </div>
              <div
                className={cn(
                  'size-6 rounded-full border-2 flex items-center justify-center transition-all',
                  config.mainImage.enabled
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/30',
                )}
              >
                {config.mainImage.enabled && <Check className="size-4" />}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            {/* 数量选择 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                生成数量
              </Label>
              <div className="flex gap-2">
                {MAIN_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateMain({ count });
                    }}
                    disabled={!config.mainImage.enabled}
                    className={cn(
                      'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all',
                      config.mainImage.count === count && config.mainImage.enabled
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground hover:bg-muted/80',
                      !config.mainImage.enabled && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {count} 张
                  </button>
                ))}
              </div>
            </div>

            {/* 尺寸选择 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                主图尺寸
              </Label>
              <RadioGroup
                value={config.mainImage.size}
                onValueChange={(v) =>
                  updateMain({ size: v as ImageTypeConfig['mainImage']['size'] })
                }
                onClick={(e) => e.stopPropagation()}
                className="space-y-1.5"
                disabled={!config.mainImage.enabled}
              >
                {MAIN_SIZES.map((size) => (
                  <div key={size.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={size.value} id={`main-${size.value}`} />
                    <Label htmlFor={`main-${size.value}`} className="text-sm cursor-pointer">
                      {size.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* 无文案模式 */}
            <div className="flex items-center space-x-2 pt-2 border-t border-border/50">
              <Checkbox
                id="main-nocopy"
                checked={config.mainImage.noCopy}
                onCheckedChange={(v) => updateMain({ noCopy: v === true })}
                onClick={(e) => e.stopPropagation()}
                disabled={!config.mainImage.enabled}
              />
              <Label
                htmlFor="main-nocopy"
                className={cn(
                  'text-sm cursor-pointer',
                  !config.mainImage.enabled && 'opacity-50',
                )}
              >
                无文案模式（仅生成图片，不加文字）
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* 产品详情图卡片 */}
        <Card
          className={cn(
            'cursor-pointer transition-all hover:shadow-md',
            config.detailImage.enabled &&
              'border-primary ring-2 ring-primary/20 shadow-md shadow-primary/10',
          )}
          onClick={() => updateDetail({ enabled: !config.detailImage.enabled })}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'size-10 rounded-lg flex items-center justify-center',
                    config.detailImage.enabled
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <FileText className="size-5" />
                </div>
                <CardTitle className="text-lg">产品详情图</CardTitle>
              </div>
              <div
                className={cn(
                  'size-6 rounded-full border-2 flex items-center justify-center transition-all',
                  config.detailImage.enabled
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-muted-foreground/30',
                )}
              >
                {config.detailImage.enabled && <Check className="size-4" />}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            {/* 数量选择 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                生成数量
              </Label>
              <div className="flex gap-2">
                {DETAIL_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateDetail({ count });
                    }}
                    disabled={!config.detailImage.enabled}
                    className={cn(
                      'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all',
                      config.detailImage.count === count && config.detailImage.enabled
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-foreground hover:bg-muted/80',
                      !config.detailImage.enabled && 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {count} 张
                  </button>
                ))}
              </div>
            </div>

            {/* 尺寸选择 */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">
                详情图尺寸
              </Label>
              <RadioGroup
                value={config.detailImage.size}
                onValueChange={(v) =>
                  updateDetail({ size: v as ImageTypeConfig['detailImage']['size'] })
                }
                onClick={(e) => e.stopPropagation()}
                className="space-y-1.5"
                disabled={!config.detailImage.enabled}
              >
                {DETAIL_SIZES.map((size) => (
                  <div key={size.value} className="flex items-center space-x-2">
                    <RadioGroupItem value={size.value} id={`detail-${size.value}`} />
                    <Label htmlFor={`detail-${size.value}`} className="text-sm cursor-pointer">
                      {size.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* 无文案模式 */}
            <div className="flex items-center space-x-2 pt-2 border-t border-border/50">
              <Checkbox
                id="detail-nocopy"
                checked={config.detailImage.noCopy}
                onCheckedChange={(v) => updateDetail({ noCopy: v === true })}
                onClick={(e) => e.stopPropagation()}
                disabled={!config.detailImage.enabled}
              />
              <Label
                htmlFor="detail-nocopy"
                className={cn(
                  'text-sm cursor-pointer',
                  !config.detailImage.enabled && 'opacity-50',
                )}
              >
                无文案模式（仅生成图片，不加文字）
              </Label>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export type { ImageTypeConfig };
