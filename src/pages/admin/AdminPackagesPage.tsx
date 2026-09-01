import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Edit,
  Trash2,
  Sparkles,
  Crown,
  Gift,
  ArrowUpDown,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { storage, delay } from '@/lib/storage';
import { PACKAGES_KEY, type IRechargePackage } from '@/data/admin-models';
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

interface PackageForm {
  name: string;
  price: number;
  baseCredits: number;
  bonusCredits: number;
  description: string;
  tag: string;
  status: 'online' | 'offline';
  sort: number;
}

const TAG_COLORS: Record<string, string> = {
  hot: 'bg-rose-500 text-white',
  value: 'bg-emerald-500 text-white',
  new: 'bg-blue-500 text-white',
};

const TAG_LABELS: Record<string, string> = {
  hot: '🔥 热门',
  value: '💰 超值',
  new: '✨ 新品',
};

export default function AdminPackagesPage() {
  const [packages, setPackages] = useState<IRechargePackage[]>([]);
  const [loading, setLoading] = useState(true);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<IRechargePackage | null>(null);
  const [form, setForm] = useState<PackageForm>({
    name: '',
    price: 0,
    baseCredits: 0,
    bonusCredits: 0,
    description: '',
    tag: 'none',
    status: 'online',
    sort: 1,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    mockDataService.initMockData();
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    await delay(200);
    const list = storage.get<IRechargePackage[]>(PACKAGES_KEY, []);
    setPackages([...list].sort((a, b) => a.sort - b.sort));
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      name: '',
      price: 0,
      baseCredits: 0,
      bonusCredits: 0,
      description: '',
      tag: 'none',
      status: 'online',
      sort: packages.length + 1,
    });
    setEditOpen(true);
  }

  function openEdit(pkg: IRechargePackage) {
    setEditing(pkg);
    setForm({
      name: pkg.name,
      price: pkg.price,
      baseCredits: pkg.baseCredits,
      bonusCredits: pkg.bonusCredits,
      description: pkg.description || '',
      tag: pkg.tag || 'none',
      status: pkg.status,
      sort: pkg.sort,
    });
    setEditOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim() || form.price <= 0 || form.baseCredits <= 0) {
      toast.warning('请填写完整的套餐信息');
      return;
    }
    setSubmitting(true);
    await delay(300);
    const all = storage.get<IRechargePackage[]>(PACKAGES_KEY, []);

    if (editing) {
      const idx = all.findIndex((p) => p.id === editing.id);
      if (idx !== -1) {
        all[idx] = {
          ...all[idx],
          name: form.name,
          price: form.price,
          baseCredits: form.baseCredits,
          bonusCredits: form.bonusCredits,
          totalCredits: form.baseCredits + form.bonusCredits,
          description: form.description,
          tag: form.tag === 'none' ? undefined : form.tag,
          status: form.status,
          sort: form.sort,
        };
      }
      toast.success('套餐已更新');
    } else {
      const newPkg: IRechargePackage = {
        id: `pkg_${Date.now()}`,
        name: form.name,
        price: form.price,
        baseCredits: form.baseCredits,
        bonusCredits: form.bonusCredits,
        totalCredits: form.baseCredits + form.bonusCredits,
        description: form.description,
        tag: form.tag === 'none' ? undefined : form.tag,
        status: form.status,
        sort: form.sort,
        createdAt: new Date().toISOString(),
      };
      all.push(newPkg);
      toast.success('套餐已创建');
    }
    storage.set(PACKAGES_KEY, all);
    setPackages([...all].sort((a, b) => a.sort - b.sort));
    setSubmitting(false);
    setEditOpen(false);
  }

  function toggleStatus(pkg: IRechargePackage) {
    const all = storage.get<IRechargePackage[]>(PACKAGES_KEY, []);
    const idx = all.findIndex((p) => p.id === pkg.id);
    if (idx !== -1) {
      all[idx].status = all[idx].status === 'online' ? 'offline' : 'online';
      storage.set(PACKAGES_KEY, all);
      setPackages([...all].sort((a, b) => a.sort - b.sort));
      toast.success(all[idx].status === 'online' ? '已上架' : '已下架');
    }
  }

  function handleDelete(pkg: IRechargePackage) {
    if (!confirm(`确认删除套餐「${pkg.name}」？`)) return;
    const all = storage.get<IRechargePackage[]>(PACKAGES_KEY, []).filter((p) => p.id !== pkg.id);
    storage.set(PACKAGES_KEY, all);
    setPackages([...all].sort((a, b) => a.sort - b.sort));
    toast.success('已删除');
  }

  function moveSort(pkg: IRechargePackage, dir: 'up' | 'down') {
    const sorted = [...packages].sort((a, b) => a.sort - b.sort);
    const idx = sorted.findIndex((p) => p.id === pkg.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const tmpSort = sorted[idx].sort;
    sorted[idx].sort = sorted[swapIdx].sort;
    sorted[swapIdx].sort = tmpSort;

    storage.set(PACKAGES_KEY, sorted);
    setPackages([...sorted].sort((a, b) => a.sort - b.sort));
  }

  const activePackages = packages.filter((p) => p.status === 'online');

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">充值套餐管理</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理平台充值积分套餐</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4 mr-1.5" />
          新增套餐
        </Button>
      </div>

      {/* 概览 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Gift className="size-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{packages.length}</div>
              <div className="text-xs text-muted-foreground">套餐总数</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <Check className="size-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-600">{activePackages.length}</div>
              <div className="text-xs text-muted-foreground">在售套餐</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Sparkles className="size-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-600 tabular-nums">
                {activePackages.reduce((s, p) => s + p.bonusCredits, 0).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">总赠送积分</div>
            </div>
          </CardContent>
        </Card>
        <Card className="border border-border/50">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="size-10 rounded-lg bg-rose-100 flex items-center justify-center">
              <Crown className="size-5 text-rose-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-rose-600 tabular-nums">
                ¥{activePackages.reduce((s, p) => s + p.price, 0)}
              </div>
              <div className="text-xs text-muted-foreground">套餐总价 (在售)</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 套餐卡片列表 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card p-5 animate-pulse h-52" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {packages.map((pkg, idx) => {
            const tagLabel = pkg.tag ? TAG_LABELS[pkg.tag] || '' : '';
            const tagClass = pkg.tag ? TAG_COLORS[pkg.tag] || '' : '';
            return (
              <Card
                key={pkg.id}
                className={`relative overflow-hidden transition-all hover:shadow-lg ${
                  pkg.status === 'offline' ? 'opacity-60' : ''
                } ${pkg.tag === 'hot' ? 'border-rose-300' : pkg.tag === 'value' ? 'border-emerald-300' : 'border-border/50'}`}
              >
                {tagLabel && (
                  <div className={`absolute top-3 right-3 px-2 py-0.5 rounded-full text-xs font-medium ${tagClass}`}>
                    {tagLabel}
                  </div>
                )}
                <CardContent className="p-5 space-y-4">
                  <div>
                    <div className="font-bold text-lg">{pkg.name}</div>
                    {pkg.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{pkg.description}</p>
                    )}
                  </div>

                  <div className="flex items-end gap-1">
                    <span className="text-3xl font-black text-foreground">¥{pkg.price}</span>
                    <span className="text-xs text-muted-foreground mb-1.5">/ 套</span>
                  </div>

                  <div className="space-y-1.5 pt-3 border-t border-border/40">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">基础积分</span>
                      <span className="font-medium tabular-nums">{pkg.baseCredits.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Gift className="size-3.5 text-amber-500" />
                        赠送积分
                      </span>
                      <span className="font-medium text-amber-600 tabular-nums">
                        +{pkg.bonusCredits.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 border-t border-border/40">
                      <span className="text-xs text-muted-foreground">合计到账</span>
                      <span className="font-bold text-indigo-600 tabular-nums">
                        {pkg.totalCredits.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-border/40">
                    <div className="flex items-center gap-1">
                      <Badge
                        variant="outline"
                        className={pkg.status === 'online'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                        }
                      >
                        {pkg.status === 'online' ? '在售' : '下架'}
                      </Badge>
                      <Badge variant="outline" className="bg-muted/30">
                        排序 {pkg.sort}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => moveSort(pkg, 'up')}
                        disabled={idx === 0}
                      >
                        <ArrowUpDown className="size-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex gap-1.5 pt-1">
                    <Button variant="outline" size="sm" className="flex-1 h-8 text-xs" onClick={() => openEdit(pkg)}>
                      <Edit className="size-3 mr-1" />
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`h-8 px-2 text-xs ${
                        pkg.status === 'online'
                          ? 'text-amber-600 hover:bg-amber-50 hover:text-amber-700'
                          : 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700'
                      }`}
                      onClick={() => toggleStatus(pkg)}
                    >
                      {pkg.status === 'online' ? '下架' : '上架'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                      onClick={() => handleDelete(pkg)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑套餐' : '新增套餐'}</DialogTitle>
            <DialogDescription>设置充值套餐的价格和积分</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>套餐名称 *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例：入门超值套餐"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>价格（元）*</Label>
                <Input
                  type="number"
                  value={form.price || ''}
                  onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
                  placeholder="49"
                  min={0}
                />
              </div>
              <div className="space-y-1.5">
                <Label>排序</Label>
                <Input
                  type="number"
                  value={form.sort || ''}
                  onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })}
                  placeholder="1"
                  min={1}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>基础积分 *</Label>
                <Input
                  type="number"
                  value={form.baseCredits || ''}
                  onChange={(e) => setForm({ ...form, baseCredits: Number(e.target.value) })}
                  placeholder="3300"
                  min={0}
                />
              </div>
              <div className="space-y-1.5">
                <Label>赠送积分</Label>
                <Input
                  type="number"
                  value={form.bonusCredits || ''}
                  onChange={(e) => setForm({ ...form, bonusCredits: Number(e.target.value) })}
                  placeholder="0"
                  min={0}
                />
              </div>
            </div>

            <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100">
              <div className="flex items-center justify-between text-sm">
                <span className="text-indigo-700">合计到账积分</span>
                <span className="font-bold text-indigo-700 tabular-nums">
                  {(form.baseCredits + form.bonusCredits).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-indigo-500">每元积分比</span>
                <span className="font-medium text-indigo-600 tabular-nums">
                  {form.price > 0 ? ((form.baseCredits + form.bonusCredits) / form.price).toFixed(1) : 0} 积分/元
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>推荐标签</Label>
              <Select value={form.tag} onValueChange={(v) => setForm({ ...form, tag: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无标签</SelectItem>
                  <SelectItem value="hot">🔥 热门</SelectItem>
                  <SelectItem value="value">💰 超值</SelectItem>
                  <SelectItem value="new">✨ 新品</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>套餐描述</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="简单描述套餐特点..."
                rows={2}
              />
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-border/40">
              <Switch
                checked={form.status === 'online'}
                onCheckedChange={(c) => setForm({ ...form, status: c ? 'online' : 'offline' })}
                id="pkg-status"
              />
              <Label htmlFor="pkg-status" className="cursor-pointer">
                {form.status === 'online' ? '上架销售' : '下架状态'}
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
    </div>
  );
}
