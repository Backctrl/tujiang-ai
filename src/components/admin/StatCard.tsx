import { memo, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: string | number; up?: boolean; down?: boolean };
  icon: ReactNode;
  iconBg?: string;
  iconColor?: string;
  children?: ReactNode;
}

export default memo(function StatCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  iconBg = 'bg-indigo-100',
  iconColor = 'text-indigo-600',
  children,
}: StatCardProps) {
  return (
    <Card className="border border-border/50 bg-card/80 backdrop-blur-sm hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1.5 text-foreground tabular-nums tracking-tight">
              {value}
            </p>
            {(subtitle || trend) && (
              <div className="flex items-center gap-2 mt-1.5 text-xs">
                {trend && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-0.5 font-medium',
                      trend.up ? 'text-emerald-600' : trend.down ? 'text-rose-600' : 'text-muted-foreground',
                    )}
                  >
                    {trend.up ? '↑' : trend.down ? '↓' : ''}
                    {trend.value}
                  </span>
                )}
                {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
              </div>
            )}
          </div>
          <div className={cn('size-11 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
            <div className={cn('size-5', iconColor)}>{icon}</div>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
});
