import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS = [
  { id: 1, label: '图片类型' },
  { id: 2, label: '上传产品' },
  { id: 3, label: '选择风格' },
  { id: 4, label: '产品信息' },
  { id: 5, label: '生成结果' },
];

interface StepIndicatorProps {
  currentStep: number;
}

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center w-full">
      {STEPS.map((step, index) => {
        const isCompleted = step.id < currentStep;
        const isActive = step.id === currentStep;

        return (
          <div key={step.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'size-9 rounded-full flex items-center justify-center text-sm font-semibold transition-all',
                  isCompleted && 'bg-primary text-primary-foreground',
                  isActive &&
                    'bg-primary text-primary-foreground ring-4 ring-primary/20 shadow-lg shadow-primary/30',
                  !isCompleted && !isActive && 'bg-muted text-muted-foreground',
                )}
              >
                {isCompleted ? <Check className="size-4" /> : step.id}
              </div>
              <span
                className={cn(
                  'text-xs font-medium whitespace-nowrap',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>

            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-0.5 flex-1 mx-2 md:mx-4 rounded-full transition-all',
                  isCompleted ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
