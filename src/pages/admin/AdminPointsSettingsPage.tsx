import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Coins,
  Gift,
  RefreshCcw,
  Save,
  Plus,
  X,
  Edit2,
  Trash2,
  Sparkles,
  Users,
  Share2,
  Heart,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { storage, delay } from '@/lib/storage';

const POINTS_KEY = '__app_tujiang_admin_settings_points';

interface ConsumeRule {
  id: string;
  name: string;
  billingType: 'per-image' | 'per-call';
  basePoints: number;
  sizeMarkup: { '1k': number; '2k': number; '4k': number };
  modelMarkup: { model: string; points: number }[];
  enabled: boolean;
}

interface StreakReward {
  days: number;
  points: number;
}

const DEFAULT_CONSUME_RULES: ConsumeRule[] = [
  {
    id: 'masterplan',
    name: '主图全案生成',
    billingType: 'per-image',
    basePoints: 10,
    sizeMarkup: { '1k': 0, '2k': 5, '4k': 20 },
    modelMarkup: [
      { model: 'flux-pro', points: 15 },
      { model: 'flux-dev', points: 8 },
      { model: 'sdxl', points: 3 },
    ],
    enabled: true,
  },
  {
    id: 'clone',
    name: '克隆大师生成',
    billingType: 'per-image',
    basePoints: 15,
    sizeMarkup: { '1k': 0, '2k': 8, '4k': 25 },
    modelMarkup: [
      { model: 'flux-pro', points: 20 },
      { model: 'flux-dev', points: 10 },
    ],
    enabled: true,
  },
  {
    id: 'text2img',
    name: '创图工坊文生图',
    billingType: 'per-image',
    basePoints: 5,
    sizeMarkup: { '1k': 0, '2k': 3, '4k': 10 },
    modelMarkup: [
      { model: 'flux-pro', points: 8 },
      { model: 'sdxl', points: 2 },
    ],
    enabled: true,
  },
  {
    id: 'img2img',
    name: '创图工图图生图',
    billingType: 'per-image',
    basePoints: 8,
    sizeMarkup: { '1k': 0, '2k': 4, '4k': 12 },
    modelMarkup: [
      { model: 'flux-pro', points: 10 },
      { model: 'sdxl', points: 3 },
    ],
    enabled: true,
  },
  {
    id: 'matting',
    name: '智能抠图',
    billingType: 'per-image',
    basePoints: 2,
    sizeMarkup: { '1k': 0, '2k': 1, '4k': 3 },
    modelMarkup: [],
    enabled: true,
  },
  {
    id: 'upscale',
    name: '图片放大',
    billingType: 'per-image',
    basePoints: 3,
    sizeMarkup: { '1k': 0, '2k': 2, '4k': 5 },
    modelMarkup: [],
    enabled: true,
  },
  {
    id: 'bg-replace',
    name: '背景替换',
    billingType: 'per-image',
    basePoints: 5,
    sizeMarkup: { '1k': 0, '2k': 3, '4k': 8 },
    modelMarkup: [],
    enabled: true,
  },
  {
    id: 'restore',
    name: '图片修复',
    billingType: 'per-image',
    basePoints: 4,
    sizeMarkup: { '1k': 0, '2k': 2, '4k': 6 },
    modelMarkup: [],
    enabled: true,
  },
  {
    id: 'hd-enhance',
    name: '高清增强',
    billingType: 'per-image',
    basePoints: 6,
    sizeMarkup: { '1k': 0, '2k': 4, '4k': 10 },
    modelMarkup: [],
    enabled: true,
  },
];

const DEFAULT_REWARD = {
  newUserPoints: 100,
  dailyFirstLogin: 5,
  streakRewards: [
    { days: 3, points: 10 },
    { days: 7, points: 30 },
    { days: 15, points: 80 },
    { days: 30, points: 200 },
  ] as StreakReward[],
  inviteRegisterInviter: 50,
  inviteRegisterInvitee: 30,
  inviteFirstRechargePercent: 10,
  inviteRecurringPercent: 5,
  collectReward: 2,
  shareReward: 3,
};

const DEFAULT_REFUND = {
  failRefund: true,
  qualityRefund: true,
  refundTimeLimit: 24,
  refundDeductPercent: 100,
  pointsValidityMonths: 12,
  expireReminder: true,
  expireReminderDays: 7,
};

const MODEL_OPTIONS = ['flux-pro', 'flux-dev', 'sdxl', 'dalle-3', 'wanx-v1', 'stable-diffusion'];

export default function AdminPointsSettingsPage() {
  const [consumeRules, setConsumeRules] = useState<ConsumeRule[]>(DEFAULT_CONSUME_RULES);
  const [reward, setReward] = useState<any>(DEFAULT_REWARD);
  const [refund, setRefund] = useState<any>(DEFAULT_REFUND);
  const [saving, setSaving] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ConsumeRule | null>(null);
  const [editForm, setEditForm] = useState<any>({});

  useEffect(() => {
    const saved = storage.get<any>(POINTS_KEY, null);
    if (saved) {
      setConsumeRules(saved.consumeRules || DEFAULT_CONSUME_RULES);
      setReward(saved.reward || DEFAULT_REWARD);
      setRefund(saved.refund || DEFAULT_REFUND);
    }
  }, []);

  async function handleSave() {
    setSaving(true);
    await delay(500);
    storage.set(POINTS_KEY, { consumeRules, reward, refund });
    setSaving(false);
    toast.success('积分规则已保存');
  }

  function openEdit(rule: ConsumeRule) {
    setEditingRule(rule);
    setEditForm(JSON.parse(JSON.stringify(rule)));
    setEditOpen(true);
  }

  function saveEdit() {
    setConsumeRules((prev) => prev.map((r) => (r.id === editingRule?.id ? editForm : r)));
    setEditOpen(false);
    toast.success('规则已更新');
  }

  function toggleRule(id: string) {
    setConsumeRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  function addStreak() {
    setReward((prev: any) => ({
      ...prev,
      streakRewards: [...prev.streakRewards, { days: 60, points: 500 }],
    }));
  }

  function updateStreak(idx: number, key: string, value: number) {
    setReward((prev: any) => {
      const updated = [...prev.streakRewards];
      updated[idx] = { ...updated[idx], [key]: value };
      return { ...prev, streakRewards: updated };
    });
  }

  function removeStreak(idx: number) {
    setReward((prev: any) => ({
      ...prev,
      streakRewards: prev.streakRewards.filter((_: any, i: number) => i !== idx),
    }));
  }

  function addModelMarkup() {
    setEditForm((prev: any) => ({
      ...prev,
      modelMarkup: [...prev.modelMarkup, { model: MODEL_OPTIONS[0], points: 5 }],
    }));
  }

  function updateModelMarkup(idx: number, key: string, value: any) {
    setEditForm((prev: any) => {
      const updated = [...prev.modelMarkup];
      updated[idx] = { ...updated[idx], [key]: value };
      return { ...prev, modelMarkup: updated };
    });
  }

  function removeModelMarkup(idx: number) {
    setEditForm((prev: any) => ({
      ...prev,
      modelMarkup: prev.modelMarkup.filter((_: any, i: number) => i !== idx),
    }));
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">积分规则</h1>
          <p className="text-sm text-muted-foreground mt-0.5">配置积分消耗、奖励及退款规则</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving && (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
          )}
          <Save className="size-4 mr-1.5" />
          保存规则
        </Button>
      </div>

      <div className="space-y-5 max-w-5xl">
        {/* 消耗规则 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Coins className="size-4 text-indigo-600" />
              </div>
              <CardTitle className="text-base">生成消耗规则</CardTitle>
            </div>
            <CardDescription>各功能的积分消耗标准，可按尺寸和模型加价</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">功能名称</th>
                    <th className="text-left py-2.5 px-2 font-medium text-muted-foreground">计费方式</th>
                    <th className="text-center py-2.5 px-2 font-medium text-muted-foreground">基础积分</th>
                    <th className="text-center py-2.5 px-2 font-medium text-muted-foreground">1K加价</th>
                    <th className="text-center py-2.5 px-2 font-medium text-muted-foreground">2K加价</th>
                    <th className="text-center py-2.5 px-2 font-medium text-muted-foreground">4K加价</th>
                    <th className="text-center py-2.5 px-2 font-medium text-muted-foreground">模型加价</th>
                    <th className="text-center py-2.5 px-2 font-medium text-muted-foreground">状态</th>
                    <th className="text-center py-2.5 px-2 font-medium text-muted-foreground">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {consumeRules.map((rule) => (
                    <tr key={rule.id} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="py-2.5 px-2 font-medium">{rule.name}</td>
                      <td className="py-2.5 px-2">
                        <Badge variant="outline" className="h-5 text-[10px]">
                          {rule.billingType === 'per-image' ? '按张' : '按次'}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-2 text-center tabular-nums">{rule.basePoints}</td>
                      <td className="py-2.5 px-2 text-center tabular-nums text-muted-foreground">+{rule.sizeMarkup['1k']}</td>
                      <td className="py-2.5 px-2 text-center tabular-nums text-indigo-600 font-medium">+{rule.sizeMarkup['2k']}</td>
                      <td className="py-2.5 px-2 text-center tabular-nums text-violet-600 font-medium">+{rule.sizeMarkup['4k']}</td>
                      <td className="py-2.5 px-2 text-center">
                        {rule.modelMarkup.length > 0 ? (
                          <span className="text-muted-foreground">{rule.modelMarkup.length}种模型</span>
                        ) : (
                          <span className="text-muted-foreground/60">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <Switch checked={rule.enabled} onCheckedChange={() => toggleRule(rule.id)} />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(rule)}>
                          <Edit2 className="size-3.5 text-indigo-600" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* 奖励规则 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Gift className="size-4 text-emerald-600" />
              </div>
              <CardTitle className="text-base">奖励规则</CardTitle>
            </div>
            <CardDescription>配置各类积分奖励活动</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-muted/20 rounded-lg space-y-1.5">
                <div className="flex items-center gap-2">
                  <Users className="size-4 text-indigo-500" />
                  <Label className="text-sm">新用户注册赠送</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={reward.newUserPoints}
                    onChange={(e) => setReward({ ...reward, newUserPoints: Number(e.target.value) })}
                    min={0}
                    className="h-9"
                  />
                  <span className="text-sm text-muted-foreground">积分</span>
                </div>
              </div>
              <div className="p-3 bg-muted/20 rounded-lg space-y-1.5">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-amber-500" />
                  <Label className="text-sm">每日首次登录赠送</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={reward.dailyFirstLogin}
                    onChange={(e) => setReward({ ...reward, dailyFirstLogin: Number(e.target.value) })}
                    min={0}
                    className="h-9"
                  />
                  <span className="text-sm text-muted-foreground">积分</span>
                </div>
              </div>
            </div>

            {/* 连续登录 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">连续登录奖励</Label>
                <Button size="sm" variant="outline" className="h-7" onClick={addStreak}>
                  <Plus className="size-3.5 mr-1" />添加
                </Button>
              </div>
              <div className="space-y-2">
                {reward.streakRewards.map((s: StreakReward, idx: number) => (
                  <div key={idx} className="flex items-center gap-3 p-2 bg-muted/15 rounded-lg">
                    <span className="text-xs text-muted-foreground w-12">第{idx + 1}档</span>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs text-muted-foreground">连续</span>
                      <Input
                        type="number"
                        value={s.days}
                        onChange={(e) => updateStreak(idx, 'days', Number(e.target.value))}
                        min={1}
                        className="h-8 w-20 text-center"
                      />
                      <span className="text-xs text-muted-foreground">天 赠送</span>
                      <Input
                        type="number"
                        value={s.points}
                        onChange={(e) => updateStreak(idx, 'points', Number(e.target.value))}
                        min={0}
                        className="h-8 w-24 text-center"
                      />
                      <span className="text-xs text-muted-foreground">积分</span>
                    </div>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500" onClick={() => removeStreak(idx)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* 邀请奖励 */}
            <div>
              <Label className="text-sm font-medium mb-2 block">邀请奖励</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">邀请人注册奖励</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={reward.inviteRegisterInviter}
                      onChange={(e) => setReward({ ...reward, inviteRegisterInviter: Number(e.target.value) })}
                      className="h-8"
                    />
                    <span className="text-xs text-muted-foreground">积分</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">被邀请人注册奖励</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={reward.inviteRegisterInvitee}
                      onChange={(e) => setReward({ ...reward, inviteRegisterInvitee: Number(e.target.value) })}
                      className="h-8"
                    />
                    <span className="text-xs text-muted-foreground">积分</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">好友首次充值奖励</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={reward.inviteFirstRechargePercent}
                      onChange={(e) => setReward({ ...reward, inviteFirstRechargePercent: Number(e.target.value) })}
                      min={0}
                      max={100}
                      className="h-8"
                    />
                    <span className="text-xs text-muted-foreground">%（按充值金额）</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">好友复购奖励</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      value={reward.inviteRecurringPercent}
                      onChange={(e) => setReward({ ...reward, inviteRecurringPercent: Number(e.target.value) })}
                      min={0}
                      max={100}
                      className="h-8"
                    />
                    <span className="text-xs text-muted-foreground">%（按充值金额）</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 互动奖励 */}
            <div>
              <Label className="text-sm font-medium mb-2 block">互动奖励</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-muted/20 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Heart className="size-4 text-rose-500" />
                    <span className="text-sm">作品被收藏奖励</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={reward.collectReward}
                      onChange={(e) => setReward({ ...reward, collectReward: Number(e.target.value) })}
                      min={0}
                      className="h-8 w-20 text-center"
                    />
                    <span className="text-xs text-muted-foreground">积分/次</span>
                  </div>
                </div>
                <div className="p-3 bg-muted/20 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Share2 className="size-4 text-blue-500" />
                    <span className="text-sm">作品被分享奖励</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      value={reward.shareReward}
                      onChange={(e) => setReward({ ...reward, shareReward: Number(e.target.value) })}
                      min={0}
                      className="h-8 w-20 text-center"
                    />
                    <span className="text-xs text-muted-foreground">积分/次</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 扣减与退款 */}
        <Card className="border border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="size-8 rounded-lg bg-amber-100 flex items-center justify-center">
                <RefreshCcw className="size-4 text-amber-600" />
              </div>
              <CardTitle className="text-base">扣减与退款规则</CardTitle>
            </div>
            <CardDescription>生成失败退款及积分有效期配置</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
              <div>
                <Label className="text-sm font-medium">生成失败退还积分</Label>
                <p className="text-xs text-muted-foreground mt-0.5">AI生图失败时自动退还已扣积分</p>
              </div>
              <Switch checked={refund.failRefund} onCheckedChange={(c) => setRefund({ ...refund, failRefund: c })} />
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
              <div>
                <Label className="text-sm font-medium">质量不满意可申请退款</Label>
                <p className="text-xs text-muted-foreground mt-0.5">用户可对不满意的生成结果申请退款</p>
              </div>
              <Switch checked={refund.qualityRefund} onCheckedChange={(c) => setRefund({ ...refund, qualityRefund: c })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>退款申请时效</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={refund.refundTimeLimit}
                    onChange={(e) => setRefund({ ...refund, refundTimeLimit: Number(e.target.value) })}
                    min={1}
                  />
                  <span className="text-sm text-muted-foreground">小时</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>退款扣减比例</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={refund.refundDeductPercent}
                    onChange={(e) => setRefund({ ...refund, refundDeductPercent: Number(e.target.value) })}
                    min={0}
                    max={100}
                  />
                  <span className="text-sm text-muted-foreground">%（100%=全额扣回）</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>积分有效期</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={refund.pointsValidityMonths}
                    onChange={(e) => setRefund({ ...refund, pointsValidityMonths: Number(e.target.value) })}
                    min={0}
                  />
                  <span className="text-sm text-muted-foreground">月（0=永久有效）</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                <div>
                  <Label className="text-sm">过期提醒</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">提前 {refund.expireReminderDays} 天提醒</p>
                </div>
                <Switch checked={refund.expireReminder} onCheckedChange={(c) => setRefund({ ...refund, expireReminder: c })} />
              </div>
            </div>

            {refund.expireReminder && (
              <div className="space-y-1.5">
                <Label>提前提醒天数</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={refund.expireReminderDays}
                    onChange={(e) => setRefund({ ...refund, expireReminderDays: Number(e.target.value) })}
                    min={1}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">天</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 编辑弹窗 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑规则 - {editingRule?.name}</DialogTitle>
            <DialogDescription>调整积分消耗标准</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>功能名称</Label>
              <Input value={editForm.name || ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </div>

            <div className="space-y-1.5">
              <Label>计费方式</Label>
              <Select value={editForm.billingType} onValueChange={(v) => setEditForm({ ...editForm, billingType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="per-image">按张计费</SelectItem>
                  <SelectItem value="per-call">按次计费</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>基础消耗积分</Label>
              <Input
                type="number"
                value={editForm.basePoints || 0}
                onChange={(e) => setEditForm({ ...editForm, basePoints: Number(e.target.value) })}
                min={0}
              />
            </div>

            <div>
              <Label className="text-sm mb-2 block">尺寸加价</Label>
              <div className="grid grid-cols-3 gap-2">
                {(['1k', '2k', '4k'] as const).map((size) => (
                  <div key={size} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{size.toUpperCase()} 加价</Label>
                    <Input
                      type="number"
                      value={editForm.sizeMarkup?.[size] || 0}
                      onChange={(e) => setEditForm({ ...editForm, sizeMarkup: { ...editForm.sizeMarkup, [size]: Number(e.target.value) } })}
                      min={0}
                      className="h-9"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm">模型加价</Label>
                <Button size="sm" variant="outline" className="h-7" onClick={addModelMarkup}>
                  <Plus className="size-3.5 mr-1" />添加
                </Button>
              </div>
              <div className="space-y-2">
                {(editForm.modelMarkup || []).map((m: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select value={m.model} onValueChange={(v) => updateModelMarkup(idx, 'model', v)}>
                      <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      value={m.points}
                      onChange={(e) => updateModelMarkup(idx, 'points', Number(e.target.value))}
                      min={0}
                      className="h-8 w-24"
                    />
                    <span className="text-xs text-muted-foreground">积分</span>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500" onClick={() => removeModelMarkup(idx)}>
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
                {(!editForm.modelMarkup || editForm.modelMarkup.length === 0) && (
                  <p className="text-xs text-muted-foreground/60 text-center py-2">暂无模型加价配置</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
              <Label className="!m-0">启用此规则</Label>
              <Switch
                checked={!!editForm.enabled}
                onCheckedChange={(c) => setEditForm({ ...editForm, enabled: c })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={saveEdit}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
