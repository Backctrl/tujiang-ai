import { memo } from 'react';
import { Construction, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface AdminPlaceholderProps {
  title: string;
  description?: string;
}

export default memo(function AdminPlaceholder({ title, description }: AdminPlaceholderProps) {
  const navigate = useNavigate();
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="h-8">
          <ArrowLeft className="size-4 mr-1.5" />
          返回
        </Button>
      </div>
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="size-20 rounded-full bg-muted/50 flex items-center justify-center mb-4">
          <Construction className="size-10 text-muted-foreground/60" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {description || '该功能模块正在开发中，敬请期待...'}
        </p>
      </div>
    </div>
  );
});
