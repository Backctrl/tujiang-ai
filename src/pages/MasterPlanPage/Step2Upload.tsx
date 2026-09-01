import UploadZone from '@/components/UploadZone';

interface Step2UploadProps {
  images: string[];
  onChange: (images: string[]) => void;
}

export default function Step2Upload({ images, onChange }: Step2UploadProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-foreground">上传产品图</h2>
        <p className="text-muted-foreground mt-2">
          上传 1-5 张商品原图，作为生图强参考
        </p>
      </div>

      <UploadZone
        files={images}
        onChange={onChange}
        maxFiles={5}
        hint="上传1-5张商品原图，支持 JPG、PNG 格式，单张不超过 10MB"
        className="max-w-2xl mx-auto"
      />

      <div className="max-w-2xl mx-auto mt-8">
        <div className="rounded-lg bg-muted/50 border border-border/50 p-4">
          <div className="text-sm font-medium text-foreground mb-2">📷 上传建议</div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>产品主体清晰，背景干净，最好是白底图</li>
            <li>多角度拍摄，正面、侧面、细节各一张</li>
            <li>图片分辨率不低于 1000×1000 像素</li>
            <li>避免图片过小或模糊，会影响生成效果</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
