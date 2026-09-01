import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import StepIndicator from './StepIndicator';
import Step1ImageType, { type ImageTypeConfig } from './Step1ImageType';
import Step2Upload from './Step2Upload';
import Step3Style, { type CustomStyleResult } from './Step3Style';
import Step4ProductInfo, { type ProductInfo } from './Step4ProductInfo';
import Step5Result from './Step5Result';
import CaseShowcase from './CaseShowcase';

const DEFAULT_IMAGE_TYPES: ImageTypeConfig = {
  mainImage: {
    enabled: true,
    count: 6,
    noCopy: false,
    size: '2k-1-1',
  },
  detailImage: {
    enabled: true,
    count: 8,
    noCopy: false,
    size: '2k-3-4',
  },
};

const DEFAULT_PRODUCT_INFO: ProductInfo = {
  name: '',
  sellingPoints: [],
  params: [],
  platforms: [],
  noCopyMode: false,
};

export default function MasterPlanPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [imageTypes, setImageTypes] = useState<ImageTypeConfig>(DEFAULT_IMAGE_TYPES);
  const [productImages, setProductImages] = useState<string[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState('1');
  const [customStyle, setCustomStyle] = useState<CustomStyleResult | null>(null);
  const [productInfo, setProductInfo] = useState<ProductInfo>(DEFAULT_PRODUCT_INFO);

  const canGoNext = useCallback(() => {
    switch (currentStep) {
      case 1:
        return imageTypes.mainImage.enabled || imageTypes.detailImage.enabled;
      case 2:
        return productImages.length >= 1;
      case 3:
        return !!selectedStyleId;
      case 4:
        return productInfo.name.trim().length > 0;
      default:
        return true;
    }
  }, [currentStep, imageTypes, productImages.length, selectedStyleId, productInfo.name]);

  const handleNext = () => {
    if (!canGoNext()) {
      const messages: Record<number, string> = {
        1: '请至少选择一种图片类型',
        2: '请至少上传 1 张产品图片',
        3: '请选择一个风格模板',
        4: '请填写产品名称',
      };
      toast.warning(messages[currentStep] ?? '请完成当前步骤');
      return;
    }
    setCurrentStep((s) => Math.min(5, s + 1));
  };

  const handlePrev = () => {
    setCurrentStep((s) => Math.max(1, s - 1));
  };

  const handleRegenerate = () => {
    setCurrentStep(1);
    toast.info('已重置，请重新配置');
  };

  return (
    <div className="flex h-full">
      {/* 主内容区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 p-6 md:p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            {/* 步骤指示器 */}
            <div className="mb-10">
              <StepIndicator currentStep={currentStep} />
            </div>

             {/* 步骤内容 */}
             <div className="pb-32 relative min-h-[500px]">
               <AnimatePresence mode="wait">
                 <motion.div
                   key={currentStep}
                   initial={{ opacity: 0, x: 20 }}
                   animate={{ opacity: 1, x: 0 }}
                   exit={{ opacity: 0, x: -20 }}
                   transition={{ duration: 0.3, ease: 'easeOut' }}
                 >
                   {currentStep === 1 && (
                     <Step1ImageType config={imageTypes} onChange={setImageTypes} />
                   )}
                   {currentStep === 2 && (
                     <Step2Upload images={productImages} onChange={setProductImages} />
                   )}
                   {currentStep === 3 && (
                     <Step3Style
                       selectedStyleId={selectedStyleId}
                       onChange={setSelectedStyleId}
                       customStyle={customStyle}
                       onCustomStyleChange={setCustomStyle}
                     />
                   )}
                   {currentStep === 4 && (
                     <Step4ProductInfo info={productInfo} onChange={setProductInfo} />
                   )}
                   {currentStep === 5 && (
                     <Step5Result
                       imageTypes={imageTypes}
                       styleId={selectedStyleId}
                       customStyle={customStyle}
                       productInfo={productInfo}
                       onRegenerate={handleRegenerate}
                     />
                   )}
                 </motion.div>
               </AnimatePresence>
             </div>
          </div>
        </div>

        {/* 底部按钮栏 */}
        <div className="sticky bottom-0 border-t border-border/60 bg-background/90 backdrop-blur-md p-4 z-20">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <Button
              variant="secondary"
              onClick={handlePrev}
              disabled={currentStep === 1}
            >
              <ChevronLeft className="size-4 mr-1" />
              上一步
            </Button>

            {currentStep < 4 && (
              <Button onClick={handleNext}>
                下一步
                <ChevronRight className="size-4 ml-1" />
              </Button>
            )}

            {currentStep === 4 && (
              <Button onClick={handleNext}>
                <Play className="size-4 mr-1.5" />
                开始生成
              </Button>
            )}

            {currentStep === 5 && <div className="w-[100px]" />}
          </div>
        </div>
      </div>

      {/* 右侧案例展示区 */}
      <CaseShowcase />
    </div>
  );
}
