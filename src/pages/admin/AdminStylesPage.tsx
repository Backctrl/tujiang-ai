import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  Plus,
  Search,
  Palette,
  Trash2,
  Edit,
  Eye,
  ToggleLeft,
  ToggleRight,
  LayoutGrid,
  Tag,
  Sparkles,
  FolderTree,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Image as UIImage } from '@/components/ui/image';
import { storage, delay } from '@/lib/storage';
import { STYLES_KEY, STYLE_CATEGORIES_KEY, type IStyleTemplate, type IStyleCategory } from '@/data/admin-models';
import { mockDataService } from '@/services/mockDataService';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Switch,
} from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

const COLOR_PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#06b6d4'];

export default function AdminStylesPage() {
  const [styles, setStyles] = useState<IStyleTemplate[]>([]);
  const [categories, setCategories] = useState<IStyleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<IStyleTemplate | null>(null);
  const [form, setForm] = useState({
    name: '',
    categoryId: '',
    tags: [] as string[],
    description: '',
    status: 'online' as 'online' | 'offline',
      previewImage: '',
    prompt: '',
    colors: ['#6366f1', '#8b5cf6'],
  });

  const [catOpen, setCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    setStyles(storage.get<IStyleTemplate[]>(STYLES_KEY, []));
    setCategories(storage.get<IStyleCategory[]>(STYLE_CATEGORIES_KEY, []));
    setLoading(false);
  }

  const filtered = useMemo(() => {
    let result = [...styles];
    if (keyword) {
      const kw = keyword.toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(kw) || s.description?.toLowerCase().includes(kw),
      );
    }
    if (categoryFilter !== 'all') {
      result = result.filter((s) => s.categoryId === categoryFilter);
    }
    if (statusFilter !== 'all') {
      result = result.filter((s) => s.status === statusFilter);
    }
    return result;
  }, [styles, keyword, categoryFilter, statusFilter]);

  function openCreate() {
    setEditing(null);
    setForm({
      name: '',
      categoryId: categories[0]?.id || '',
      tags: [],
      description: '',
      status: 'online',
      previewImage: '',
      prompt: '',
      colors: ['#6366f1', '#8b5cf6'],
    });
    setEditOpen(true);
  }

  function openEdit(item: IStyleTemplate) {
    setEditing(item);
    setForm({
      name: item.name,
      categoryId: item.categoryId,
      tags: item.tags || [],
      description: item.description || '',
      status: item.status,
      previewImage: item.previewImage,
      prompt: item.prompt || '',
      colors: item.colors || ['#6366f1', '#8b5cf6'],
    });
    setEditOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.categoryId) {
      toast.warning('请填写名称并选择分类');
      return;
    }
    setSubmitting(true);
    await delay(300);
    const all = storage.get<IStyleTemplate[]>(STYLES_KEY, []);

    if (editing) {
      const idx = all.findIndex((s) => s.id === editing.id);
      if (idx !== -1) {
        all[idx] = { ...all[idx], ...form };
      }
      toast.success('风格已更新');
    } else {
      const newItem: IStyleTemplate = {
        id: `style_${Date.now()}`,
        name: form.name,
        categoryId: form.categoryId,
        categoryName: categories.find((c) => c.id === form.categoryId)?.name || '',
        description: form.description,
        previewImage: form.previewImage,
        tags: form.tags,
        status: form.status,
        prompt: form.prompt,
        colors: form.colors,
        categories: [],
        usageCount: 0,
        favoriteCount: 0,
        createdAt: new Date().toISOString(),
      };
      all.unshift(newItem);
      toast.success('风格已创建');
    }
    storage.set(STYLES_KEY, all);
    setStyles(all);
    setSubmitting(false);
    setEditOpen(false);
  }

  function toggleStatus(item: IStyleTemplate) {
    const all = storage.get<IStyleTemplate[]>(STYLES_KEY, []);
    const idx = all.findIndex((s) => s.id === item.id);
    if (idx !== -1) {
      all[idx].status = all[idx].status === 'online' ? 'offline' : 'online';
      storage.set(STYLES_KEY, all);
      setStyles(all);
      toast.success(all[idx].status === 'online' ? '已上架' : '已下架');
    }
  }

  function handleDelete(item: IStyleTemplate) {
    if (!confirm(`确认删除风格「${item.name}」？`)) return;
    const all = storage.get<IStyleTemplate[]>(STYLES_KEY, []).filter((s) => s.id !== item.id);
    storage.set(STYLES_KEY, all);
    setStyles(all);
    toast.success('已删除');
  }

  function toggleColor(color: string) {
    setForm((prev) => {
      if (prev.colors.includes(color)) {
        return { ...prev, colors: prev.colors.filter((c) => c !== color) };
      }
      if (prev.colors.length >= 5) {
        toast.warning('最多选择5个颜色');
        return prev;
      }
      return { ...prev, colors: [...prev.colors, color] };
    });
  }

  function addCategory() {
    if (!newCatName.trim()) {
      toast.warning('请输入分类名称');
      return;
    }
    const cats = storage.get<IStyleCategory[]>(STYLE_CATEGORIES_KEY, []);
    if (cats.some((c) => c.name === newCatName.trim())) {
      toast.warning('分类已存在');
      return;
    }
    const newCat: IStyleCategory = {
      id: `cat_${Date.now()}`,
      name: newCatName.trim(),
      sort: cats.length + 1,
    };
    cats.push(newCat);
    storage.set(STYLE_CATEGORIES_KEY, cats);
    setCategories(cats);
    setNewCatName('');
    toast.success('分类已添加');
  }

  function deleteCategory(id: string) {
    if (!confirm('确认删除该分类？')) return;
    const cats = storage.get<IStyleCategory[]>(STYLE_CATEGORIES_KEY, []).filter((c) => c.id !== id);
    storage.set(STYLE_CATEGORIES_KEY, cats);
    setCategories(cats);
    // 相关风格移到默认分类
    const all = storage.get<IStyleTemplate[]>(STYLES_KEY, []);
    const defaultCat = cats[0]?.id;
    all.forEach((s) => {
      if (s.categoryId === id && defaultCat) s.categoryId = defaultCat;
    });
    storage.set(STYLES_KEY, all);
    setStyles(all);
    if (categoryFilter === id) setCategoryFilter('all');
    toast.success('已删除分类');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">风格模板管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理AI生图风格模板</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCatOpen(true)}>
            <FolderTree className="size-4 mr-1.5" />
            分类管理
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4 mr-1.5" />
            新增风格
          </Button>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索风格名称..."
            className="h-9 pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-32 h-9 text-sm">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-28 h-9 text-sm">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="online">已上架</SelectItem>
            <SelectItem value="offline">已下架</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 网格列表 */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card animate-pulse">
              <div className="aspect-square bg-muted/30 rounded-t-xl" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-muted/30 rounded w-2/3" />
                <div className="h-3 bg-muted/30 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <LayoutGrid className="size-12 mb-3 opacity-50" />
          <p>暂无风格数据</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((style) => (
            <Card
              key={style.id}
              className={`group overflow-hidden border transition-all hover:shadow-md ${
                style.status === 'offline' ? 'opacity-60' : 'border-border/50'
              }`}
            >
              <div className="relative aspect-square overflow-hidden">
                  <UIImage
                  src={style.previewImage}
                  alt={style.name}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                  <div className="flex gap-1 w-full">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 h-8 text-xs"
                      onClick={() => openEdit(style)}
                    >
                      <Edit className="size-3 mr-1" />
                      编辑
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8 px-2"
                      onClick={() => handleDelete(style)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
                {style.status === 'offline' && (
                  <div className="absolute top-2 left-2">
                    <Badge variant="outline" className="bg-background/90 text-foreground">已下架</Badge>
                  </div>
                )}
              </div>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium text-sm truncate flex-1">{style.name}</h3>
                  <button
                    onClick={() => toggleStatus(style)}
                    className="shrink-0"
                    title={style.status === 'online' ? '点击下架' : '点击上架'}
                  >
                    {style.status === 'online' ? (
                    <ToggleRight className="size-5 text-emerald-500" />
                    ) : (
                      <ToggleLeft className="size-5 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                  {style.description || '暂无描述'}
                </p>
                <div className="flex flex-wrap gap-1">
                  {style.tags?.slice(0, 2).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] h-5 px-1.5">
                      <Tag className="size-3 mr-0.5" />
                      {t}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/40">
                  <span className="flex items-center gap-1">
                    <Sparkles className="size-3" />
                    {style.usageCount.toLocaleString()} 次使用
                  </span>
                  <span>{format(new Date(style.createdAt), 'MM-dd')}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑风格' : '新增风格'}</DialogTitle>
            <DialogDescription>填写风格模板信息</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>风格名称 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例：北欧简约风"
              />
            </div>

            <div className="space-y-1.5">
              <Label>分类 *</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>预览图URL</Label>
              <Input
                value={form.previewImage}
                onChange={(e) => setForm({ ...form, previewImage: e.target.value })}
                placeholder="https://..."
              />
              {form.previewImage && (
                <UIImage src={form.previewImage} alt="预览" className="mt-2 w-20 h-20 rounded-lg object-cover border" />
              )}
            </div>

            <div className="space-y-1.5">
              <Label>描述</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="风格描述..."
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>英文提示词</Label>
              <Textarea
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                placeholder="minimalist style, clean background..."
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Palette className="size-4" />
                配色方案 <span className="text-muted-foreground font-normal">（选择3-5个）</span>
              </Label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    onClick={() => toggleColor(color)}
                    className={`size-8 rounded-full border-2 transition-all ${
                      form.colors.includes(color) ? 'border-foreground scale-110' : 'border-border'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div className="flex gap-1 mt-1">
                {form.colors.map((c, i) => (
                  <div key={i} className="px-2 py-0.5 rounded-full text-xs bg-muted" style={{ color: c }}>
                    {c}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-border/40">
              <Switch
                checked={form.status === 'online'}
                onCheckedChange={(c) => setForm({ ...form, status: c ? 'online' : 'offline' })}
                id="style-status"
              />
              <Label htmlFor="style-status" className="cursor-pointer">
                {form.status === 'online' ? '上架状态' : '下架状态'}
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={submitting}>
              {submitting && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 分类管理弹窗 */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>分类管理</DialogTitle>
            <DialogDescription>管理风格模板的分类</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="输入新分类名称"
                className="h-9"
                onKeyDown={(e) => e.key === 'Enter' && addCategory()}
              />
              <Button size="sm" onClick={addCategory}>
                <Plus className="size-4 mr-1" />
                添加
              </Button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {categories.map((cat) => {
                const count = styles.filter((s) => s.categoryId === cat.id).length;
                return (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border/40 bg-muted/10"
                  >
                    <div className="flex items-center gap-2">
                      <FolderTree className="size-4 text-muted-foreground" />
                      <span className="font-medium">{cat.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {count} 个风格
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                      onClick={() => deleteCategory(cat.id)}
                      disabled={categories.length <= 1}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setCatOpen(false)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
