import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { Upload, X, ImagePlus, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Image } from '@/components/ui/image';
import { toast } from 'sonner';

interface UploadZoneProps {
  files: string[];
  onChange: (files: string[]) => void;
  maxFiles?: number;
  hint?: string;
  accept?: string;
  className?: string;
}

export default function UploadZone({
  files,
  onChange,
  maxFiles = 5,
  hint = '点击或拖拽图片到此处上传',
  accept = 'image/*',
  className,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const [failedIndices, setFailedIndices] = useState<Set<number>>(new Set());

  const isImageFile = (file: File) => {
    if (file.type?.startsWith('image/')) return true;
    // 兜底：按扩展名判断（部分系统文件 type 可能为空）
    const name = file.name.toLowerCase();
    return /\.(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif)$/.test(name);
  };

  const readFiles = useCallback(
    (fileList: FileList | File[]) => {
      const remaining = maxFiles - files.length;
      if (remaining <= 0) return;

      const allFiles = Array.from(fileList);
      const imageFiles = allFiles.filter(isImageFile);
      const skipped = allFiles.length - imageFiles.length;

      if (skipped > 0) {
        toast.error(`${skipped} 个文件不是图片，已跳过`);
      }

      if (imageFiles.length === 0) return;

      const filesToRead = imageFiles.slice(0, remaining);
      const readers = filesToRead.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            // 用 Image 预加载验证文件内容是否是有效图片
            const reader = new FileReader();
            reader.onload = (e) => {
              const dataUrl = e.target?.result as string;
              const img = new window.Image();
              img.onload = () => resolve(dataUrl);
              img.onerror = () => reject(new Error(`无效图片：${file.name}`));
              img.src = dataUrl;
            };
            reader.onerror = () => reject(new Error(`读取失败：${file.name}`));
            reader.readAsDataURL(file);
          }),
      );

      Promise.allSettled(readers).then((results) => {
        const urls: string[] = [];
        let failedCount = 0;
        results.forEach((r) => {
          if (r.status === 'fulfilled') {
            urls.push(r.value);
          } else {
            failedCount += 1;
          }
        });
        if (failedCount > 0) {
          toast.error(`${failedCount} 张图片读取失败，已跳过`);
        }
        if (urls.length > 0) {
          onChange([...files, ...urls]);
        }
      });
    },
    [files, maxFiles, onChange],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) {
        readFiles(e.dataTransfer.files);
      }
    },
    [readFiles],
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        readFiles(e.target.files);
        e.target.value = '';
      }
    },
    [readFiles],
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(files.filter((_, i) => i !== index));
    },
    [files, onChange],
  );

  const canUpload = files.length < maxFiles;

  return (
    <div className={cn('space-y-4', className)}>
      {canUpload && (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all',
            isDragging
              ? 'border-primary bg-primary/5 scale-[1.01]'
              : 'border-border hover:border-primary/60 hover:bg-muted/30',
          )}
        >
          <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Upload className="size-6 text-primary" />
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-foreground">点击上传或拖拽图片</div>
            <div className="text-xs text-muted-foreground mt-1">{hint}</div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple
            onChange={handleChange}
            className="hidden"
          />
        </div>
      )}

      {files.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {files.map((url, index) => (
            <div
              key={index}
              className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted"
            >
              {failedIndices.has(index) ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground p-2 text-center">
                  <FileWarning className="size-6" />
                  <span className="text-xs">加载失败</span>
                </div>
              ) : (
                <Image
                  src={url}
                  alt={`上传图片 ${index + 1}`}
                  className="w-full h-full object-cover"
                  onError={() => {
                    setFailedIndices((prev) => {
                      const next = new Set(prev);
                      next.add(index);
                      return next;
                    });
                  }}
                />
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="size-7 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(index);
                  }}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                {index + 1}
              </div>
            </div>
          ))}
          {canUpload && files.length < maxFiles && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary/60 hover:bg-muted/30 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary transition-colors"
            >
              <ImagePlus className="size-5" />
              <span className="text-xs">添加图片</span>
            </button>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground">
        已上传 {files.length} / {maxFiles} 张
      </div>
    </div>
  );
}
