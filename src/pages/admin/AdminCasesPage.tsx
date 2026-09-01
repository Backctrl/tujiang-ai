import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Image,
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  ArrowUp,
  ArrowDown,
  X,
  Upload,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Image as ImageComponent } from '@/components/ui/image';
import { storage, delay } from '@/lib/storage';
import { CASES_KEY, type ICase } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';
import { bannerImages } from '@lark-apaas/client-toolkit-lite';

const CATEGORIES = [
  { value: 'all', label: '全部品类' },
  { value: 'home', label: '家居家具' },
  { value: '3c', label: '3C数码' },
  { value: 'clothing', label: '服装服饰' },
  { value: 'beauty', label: '美妆护肤' },
  { value: 'food', label: '食品生鲜' },
];

const STYLES = [
  { value: 'all', label: '全部风格' },
  { value: 'nordic', label: '北欧简约' },
  { value: 'japanese', label: '日式原木' },
  { value: 'luxury', label: '现代轻奢' },
  { value: 'tech', label: '科技未来' },
  { value: 'minimal', label: '极简黑白' },
  { value: 'cyberpunk', label: '赛博朋克' },
  { value: 'magazine', label: '杂志大片' },
];

export default function AdminCasesPage() {
  const [cases, setCases] = useState<ICase[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [styleFilter, setStyleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [editOpen, setEditOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<ICase | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewCase, setPreviewCase] = useState<ICase | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const PAGE_SIZE = 9;

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(300);
    const list = storage.get<ICase[]>(CASES_KEY, []);
    setCases(list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    return cases.filter((c) => {
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (styleFilter !== 'all' && c.style !== styleFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (keyword.trim() && !c.name.toLowerCase().includes(keyword.trim().toLowerCase())) return false;
      return true;
    });
  }, [cases, categoryFilter, styleFilter, statusFilter, keyword]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [keyword, categoryFilter, styleFilter, statusFilter]);

  const totalCount = cases.length;
  const onlineCount = cases.filter((c) => c.status === 'online').length;
  const offlineCount = cases.filter((c) => c.status === 'offline').length;
  const monthNew = cases.filter((c) => {
    const d = new Date(c.createdAt);
    return d.getMonth() === new Date().getMonth();
  }).length;

  function openNew() {
    setEditingCase(null);
    setEditForm({
      name: '',
      category: 'home',
      style: 'nordic',
      description: '',
      coverImage: '',
      detailImages: [],
      status: 'online',
      imageCount: 0,
    });
    setEditOpen(true);
  }

  function openEdit(c: ICase) {
    setEditingCase(c);
    setEditForm({ ...c });
    setEditOpen(true);
  }

  function openPreview(c: ICase) {
    setPreviewCase(c);
    setPreviewIndex(0);
    setPreviewOpen(true);
  }

  async function handleSave() {
    if (!editForm.name.trim()) {
      toast.warning('请输入案例名称');
      return;
    }
    setSaving(true);
    await delay(500);

    if (editingCase) {
      const all = storage.get<ICase[]>(CASES_KEY, []);
      const idx = all.findIndex((c) => c.id === editingCase.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...editForm, imageCount: editForm.detailImages?.length || 0 };
        storage.set(CASES_KEY, all);
        setCases([...all]);
      }
      toast.success('案例已更新');
    } else {
      const newCase: ICase = {
        id: `case_${Date.now()}`,
        ...editForm,
        imageCount: editForm.detailImages?.length || 0,
        createdAt: new Date().toISOString(),
      };
      const all = storage.get<ICase[]>(CASES_KEY, []);
      all.push(newCase);
      storage.set(CASES_KEY, all);
      setCases([newCase, ...all]);
      toast.success('案例已创建');
    }
    setSaving(false);
    setEditOpen(false);
  }

  function toggleStatus(c: ICase) {
    const all = storage.get<ICase[]>(CASES_KEY, []);
    const idx = all.findIndex((x) => x.id === c.id);
    if (idx !== -1) {
      all[idx].status = all[idx].status === 'online' ? 'offline' : 'online';
      storage.set(CASES_KEY, all);
      setCases([...all]);
      toast.success(all[idx].status === 'online' ? '已上架' : '已下架');
    }
  }

  function handleDelete(c: ICase) {
    if (!confirm(`确认删除案例「${c.name}」？`)) return;
    const all = storage.get<ICase[]>(CASES_KEY, []).filter((x) => x.id !== c.id);
    storage.set(CASES_KEY, all);
    setCases(all);
    toast.success('已删除');
  }

  const previewImages = previewCase
    ? [previewCase.coverImage, ...(previewCase.detailImages || [])].filter(Boolean)
    : [];

  function addDetailImage() {
    const img = Object.values(bannerImages)[Math.floor(Math.random() * Object.values(bannerImages).length)];
    setEditForm((prev: any) => ({
      ...prev,
      detailImages: [...(prev.detailImages || []), img],
    }));
  }

  function removeDetailImage(idx: number) {
    setEditForm((prev: any) => ({
      ...prev,
      detailImages: prev.detailImages.filter((_: string, i: number) => i !== idx),
    }));
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">案例展示管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理前台展示的优秀作品案例</p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="size-4 mr-1.5" />
          新增案例
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Image className="size-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{totalCount}</div>
              <div className="text-xs text-muted-foreground">总案例数</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-emerald-200/60 bg-emerald-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              <ArrowUp className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-700 tabular-nums">{onlineCount}</div>
              <div className="text-xs text-emerald-600">已上架</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-slate-200/60 bg-slate-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-slate-400 flex items-center justify-center">
              <ArrowDown className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-600 tabular-nums">{offlineCount}</div>
              <div className="text-xs text-slate-500">已下架</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-violet-200/60 bg-violet-50/30">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-violet-500 flex items-center justify-center">
              <Plus className="size-5 text-white" />
            </div>
            <div>
              <div className="text-2xl font-bold text-violet-700 tabular-nums">{monthNew}</div>
              <div className="text-xs text-violet-600">本月新增</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 筛选 */}
      <Card className="border border-border/50 mb-4">
        <CardContent className="p-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索案例名称..."
              className="bg-background pl-9 h-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={styleFilter} onValueChange={setStyleFilter}>
            <SelectTrigger className="h-9 w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STYLES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="online">上架</SelectItem>
              <SelectItem value="offline">下架</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* 卡片网格 */}
      <Card className="border border-border/50 p-4">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[4/3] rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            暂无案例数据
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paged.map((c) => (
              <div
                key={c.id}
                className="group relative rounded-xl overflow-hidden border border-border/40 bg-card hover:border-indigo-300 hover:shadow-md transition-all"
              >
                <div className="aspect-[4/3] bg-muted/20 relative overflow-hidden">
                  <ImageComponent
                    src={c.coverImage || ''}
                    alt={c.name}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute top-2 left-2 flex gap-1">
                    <Badge variant="outline" className="bg-white/90 backdrop-blur text-xs h-5">
                      {CATEGORIES.find((cat) => cat.value === c.category)?.label}
                    </Badge>
                    <Badge variant="outline" className="bg-white/90 backdrop-blur text-xs h-5">
                      {STYLES.find((s) => s.value === c.style)?.label}
                    </Badge>
                  </div>
                  <div className="absolute top-2 right-2">
                    <Badge
                      variant="outline"
                      className={c.status === 'online'
                        ? 'bg-emerald-500 text-white border-0 text-xs h-5'
                        : 'bg-slate-500 text-white border-0 text-xs h-5'
                      }
                    >
                      {c.status === 'online' ? '上架中' : '已下架'}
                    </Badge>
                  </div>

                  {/* hover操作按钮 */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button size="sm" variant="secondary" className="h-8" onClick={() => openPreview(c)}>
                      <Eye className="size-3.5 mr-1" />预览
                    </Button>
                    <Button size="sm" variant="secondary" className="h-8" onClick={() => openEdit(c)}>
                      <Edit className="size-3.5 mr-1" />编辑
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      onClick={() => handleDelete(c)}
                    >
                      <Trash2 className="size-3.5 mr-1" />删除
                    </Button>
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium truncate">{c.name}</h3>
                    <Badge variant="outline" className="shrink-0 text-xs h-5">
                      {c.imageCount || 0} 张
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center justify-between">
                    <span>{format(new Date(c.createdAt), 'yyyy-MM-dd')}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-indigo-600"
                      onClick={() => toggleStatus(c)}
                    >
                      {c.status === 'online' ? '下架' : '上架'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/40">
            <div className="text-sm text-muted-foreground">
              共 <span className="font-medium text-foreground">{filtered.length}</span> 个案例
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                上一页
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                下一页
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCase ? '编辑案例' : '新增案例'}</DialogTitle>
            <DialogDescription>填写案例信息，保存后可在前台展示</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>案例名称 *</Label>
              <Input
                value={editForm.name || ''}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="例：北欧风实木餐桌主图"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>所属品类</Label>
                <Select value={editForm.category || 'home'} onValueChange={(v) => setEditForm({ ...editForm, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.filter((c) => c.value !== 'all').map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>风格</Label>
                <Select value={editForm.style || 'nordic'} onValueChange={(v) => setEditForm({ ...editForm, style: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STYLES.filter((s) => s.value !== 'all').map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>案例描述</Label>
              <Textarea
                value={editForm.description || ''}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="描述该案例的特点和亮点..."
                rows={3}
              />
            </div>

            <div className="space-y-1.5">
              <Label>封面图 *</Label>
              {editForm.coverImage ? (
                <div className="relative rounded-lg overflow-hidden border border-border/40 aspect-video">
                  <ImageComponent src={editForm.coverImage} alt="封面" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setEditForm({ ...editForm, coverImage: '' })}
                    className="absolute top-2 right-2 size-7 rounded-full bg-rose-500 text-white flex items-center justify-center"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => {
                    const img = Object.values(bannerImages)[Math.floor(Math.random() * Object.values(bannerImages).length)];
                    setEditForm({ ...editForm, coverImage: img });
                  }}
                  className="border-2 border-dashed border-border/60 rounded-lg p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
                >
                  <Upload className="size-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">点击上传封面图</p>
                  <p className="text-xs text-muted-foreground mt-1">建议尺寸 1200x900</p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>详情图（{editForm.detailImages?.length || 0}张）</Label>
                <Button variant="outline" size="sm" className="h-7" onClick={addDetailImage}>
                  <Plus className="size-3.5 mr-1" />添加
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {(editForm.detailImages || []).map((img: string, idx: number) => (
                  <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-border/40 group">
                    <ImageComponent src={img} alt={`详情${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeDetailImage(idx)}
                      className="absolute top-1 right-1 size-6 rounded-full bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3" />
                    </button>
                    {idx === 0 && (
                      <div className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                        第{idx + 1}张
                      </div>
                    )}
                  </div>
                ))}
                {(editForm.detailImages?.length || 0) === 0 && (
                  <div
                    onClick={addDetailImage}
                    className="aspect-square border-2 border-dashed border-border/60 rounded-lg flex items-center justify-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors"
                  >
                    <Plus className="size-6 text-muted-foreground" />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                拖拽可调整顺序（模拟），建议尺寸 750x1000 或 1080x1920
              </p>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
              <div>
                <Label>上架状态</Label>
                <p className="text-xs text-muted-foreground mt-0.5">上架后将在前台案例展示区显示</p>
              </div>
              <Switch checked={editForm.status === 'online'} onCheckedChange={(c) => setEditForm({ ...editForm, status: c ? 'online' : 'offline' })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              {editingCase ? '保存修改' : '创建案例'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 预览弹窗 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-border/40">
            <DialogTitle className="text-base">{previewCase?.name}</DialogTitle>
            <DialogDescription>
              预览案例展示效果 · 共 {previewImages.length} 张图片
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto bg-slate-900 p-4">
            <div className="space-y-4 max-w-md mx-auto">
              {previewImages.map((img, idx) => (
                <div key={idx} className="relative">
                  <div className="text-xs text-white/60 mb-1">第 {idx + 1} 张</div>
                  <div className="rounded-lg overflow-hidden bg-slate-800">
                    <ImageComponent
                      src={img}
                      alt={`预览 ${idx + 1}`}
                      className="w-full object-contain"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="px-4 py-3 border-t border-border/40">
            <div className="flex-1 text-sm text-muted-foreground">
              {previewCase && (
                <>
                  {CATEGORIES.find((c) => c.value === previewCase.category)?.label} · {STYLES.find((s) => s.value === previewCase.style)?.label}
                </>
              )}
            </div>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
