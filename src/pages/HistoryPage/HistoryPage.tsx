import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  History,
  Image,
  Copy,
  Sparkles,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Inbox,
} from 'lucide-react';
import { recordsService } from '@/services/recordsService';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Image as UIImage } from '@/components/ui/image';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const TYPE_MAP: Record<string, { label: string; icon: typeof Image; color: string }> = {
  masterplan: { label: '主图全案', icon: Image, color: 'bg-indigo-500' },
  clone: { label: '克隆大师', icon: Copy, color: 'bg-purple-500' },
  workshop: { label: '创图工坊', icon: Sparkles, color: 'bg-pink-500' },
};

const PAGE_SIZE = 10;

export default function HistoryPage() {
  const { isLoggedIn } = useAuth();
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('desc');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn) return;
    setLoading(true);
    recordsService
      .getRecords({
        page,
        pageSize: PAGE_SIZE,
        type: type === 'all' ? 'all' : (type as any),
        sort: sort as 'asc' | 'desc',
      })
      .then((res) => {
        if (res.code === 0 && res.data) {
          setRecords(res.data.list);
          setTotal(res.data.total);
        }
      })
      .finally(() => setLoading(false));
  }, [page, type, sort, keyword, isLoggedIn]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleDelete = async () => {
    if (!deleteId) return;
    const res = await recordsService.deleteRecord(deleteId);
    if (res.code === 0) {
      toast.success('记录已删除');
      setDeleteId(null);
      // 刷新列表
      setLoading(true);
      recordsService
        .getRecords({
          page,
          pageSize: PAGE_SIZE,
          type: type === 'all' ? 'all' : (type as any),
          sort: sort as 'asc' | 'desc',
        })
        .then((res) => {
          if (res.code === 0 && res.data) {
            setRecords(res.data.list);
            setTotal(res.data.total);
          }
        })
        .finally(() => setLoading(false));
    } else {
      toast.error(res.message || '删除失败');
    }
  };

  const formattedRecords = useMemo(
    () =>
    records.map((r) => ({
      ...r,
      name: r.config?.style || r.typeLabel || '未命名',
      description: r.typeLabel,
      imageUrls: r.images,
      creditsUsed: r.creditsCost,
      date: format(new Date(r.createdAt), 'yyyy-MM-dd HH:mm', { locale: zhCN }),
      typeInfo: TYPE_MAP[r.type] || TYPE_MAP.masterplan,
    })),
    [records],
  );

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="size-6 text-primary" />
          历史记录
        </h1>
        <p className="text-muted-foreground mt-1">查看和管理所有生成记录，共 {total} 条</p>
      </div>

      {/* 筛选栏 */}
      <Card className="mb-6 border-border/60">
        <CardContent className="pt-6 flex flex-wrap gap-3 items-center">
          <div className="w-full md:w-64">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索记录名称或描述..."
                className="pl-9 h-10"
              />
            </div>
          </div>
          <div className="w-36">
            <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                <SelectItem value="masterplan">主图全案</SelectItem>
                <SelectItem value="clone">克隆大师</SelectItem>
                <SelectItem value="workshop">创图工坊</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="排序方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">最新优先</SelectItem>
                <SelectItem value="asc">最早优先</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 列表 */}
      {loading && records.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : records.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="py-20 flex flex-col items-center justify-center text-center">
            <div className="size-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <Inbox className="size-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">暂无生成记录</p>
            <p className="text-xs text-muted-foreground mt-1">去生成你的第一张AI图片吧</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {formattedRecords.map((record) => {
            const Icon = record.typeInfo.icon;
            return (
              <Card key={record.id} className="border-border/60 hover:border-border transition-colors">
                <CardContent className="p-4 flex items-center gap-4">
                  {/* 缩略图 */}
                  <div className="size-20 rounded-lg overflow-hidden bg-muted shrink-0 relative">
                    {record.imageUrls && record.imageUrls.length > 0 ? (
                      <UIImage
                        src={record.imageUrls[0]}
                        alt={record.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/50">
                        <Image className="size-6" />
                      </div>
                    )}
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                      <span
                        className={`size-5 rounded-md ${record.typeInfo.color} text-white flex items-center justify-center`}
                      >
                        <Icon className="size-3" />
                      </span>
                    </div>
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium truncate">{record.name}</h3>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {record.typeInfo.label}
                      </Badge>
                      {record.status === 'completed' && (
                        <Badge variant="outline" className="text-xs text-success border-success/30 shrink-0">
                          已完成
                        </Badge>
                      )}
                      {record.status === 'processing' && (
                        <Badge variant="outline" className="text-xs text-info border-info/30 shrink-0">
                          生成中
                        </Badge>
                      )}
                      {record.status === 'failed' && (
                        <Badge variant="outline" className="text-xs text-destructive border-destructive/30 shrink-0">
                          失败
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate mb-1.5">
                      {record.description || '暂无描述'}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{record.date}</span>
                      <span>共 {record.imageUrls?.length || 0} 张</span>
                      <span>消耗 {record.creditsUsed || 0} 积分</span>
                    </div>
                  </div>

                  {/* 操作 */}
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm">
                      查看详情
                    </Button>
                    <AlertDialog open={deleteId === record.id} onOpenChange={(v) => !v && setDeleteId(null)}>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteId(record.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle>确认删除</AlertDialogTitle>
                        <AlertDialogDescription>
                          确定要删除这条生成记录吗？删除后无法恢复。
                        </AlertDialogDescription>
                        <AlertDialogFooter>
                          <AlertDialogCancel onClick={() => setDeleteId(null)}>
                            取消
                          </AlertDialogCancel>
                          <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                            确认删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <div className="text-sm text-muted-foreground px-2">
                第 {page} / {totalPages} 页
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
