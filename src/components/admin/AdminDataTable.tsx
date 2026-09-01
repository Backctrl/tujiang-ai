import { memo, useState, type ReactNode } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  ChevronDown,
  Filter,
  Search,
  Download,
  Plus,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface Column<T> {
  key: string;
  title: string;
  dataIndex?: keyof T;
  render?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  rowKey?: (row: T, index: number) => string;
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  };
  actions?: {
    label: string;
    icon?: React.ReactNode;
    variant?: 'default' | 'outline' | 'secondary' | 'ghost';
    onClick: () => void;
  }[];
  toolbar?: React.ReactNode;
  emptyText?: string;
  rowClassName?: (row: T, index: number) => string;
  selectable?: boolean;
  selectedKeys?: string[];
  onSelectChange?: (keys: string[]) => void;
  batchActions?: React.ReactNode;
  sortField?: string;
  sortOrder?: 'asc' | 'desc' | null;
  onSortChange?: (field: string, order: 'asc' | 'desc' | null) => void;
}

function DataTableImpl<T extends Record<string, any>>({
  columns,
  data,
  loading = false,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  rowKey,
  search,
  actions,
  toolbar,
  emptyText = '暂无数据',
  rowClassName,
  selectable = false,
  selectedKeys = [],
  onSelectChange,
  batchActions,
  sortField,
  sortOrder,
  onSortChange,
}: DataTableProps<T>) {
  const [pageSizeLocal, setPageSizeLocal] = useState(pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSizeLocal));

  function getKey(row: T, i: number): string {
    if (rowKey) return rowKey(row, i);
    if (typeof row.id === 'string') return row.id;
    return String(i);
  }

  function handleSort(key: string) {
    if (!onSortChange) return;
    if (sortField !== key) {
      onSortChange(key, 'asc');
    } else if (sortOrder === 'asc') {
      onSortChange(key, 'desc');
    } else {
      onSortChange(key, null);
    }
  }

  function toggleAll() {
    if (!onSelectChange) return;
    if (selectedKeys.length === data.length && data.length > 0) {
      onSelectChange([]);
    } else {
      onSelectChange(data.map((r, i) => getKey(r, i)));
    }
  }

  function toggleRow(key: string) {
    if (!onSelectChange) return;
    if (selectedKeys.includes(key)) {
      onSelectChange(selectedKeys.filter((k) => k !== key));
    } else {
      onSelectChange([...selectedKeys, key]);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {(search || actions || toolbar) && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            {search && (
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  type="search"
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder={search.placeholder || '搜索...'}
                  className="pl-9 h-9 text-sm"
                />
              </div>
            )}
            {toolbar}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {actions?.map((action, i) => (
              <Button
                key={i}
                variant={action.variant || 'default'}
                size="sm"
                onClick={action.onClick}
                className="h-9"
              >
                {action.icon && <span className="mr-1.5 size-4">{action.icon}</span>}
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Batch actions */}
      {selectable && selectedKeys.length > 0 && batchActions && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-sm">
          <span className="text-indigo-600 font-medium">已选 {selectedKeys.length} 项</span>
          {batchActions}
        </div>
      )}

      {/* Table */}
      <div className="border border-border/50 rounded-xl bg-card/50 overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                {selectable && (
                  <th className="w-10 px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={data.length > 0 && selectedKeys.length === data.length}
                      onChange={toggleAll}
                      className="size-4 rounded border-border text-primary focus:ring-primary"
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      'px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap',
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                      col.sortable && 'cursor-pointer select-none hover:text-foreground',
                      col.className,
                    )}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.title}
                      {col.sortable && (
                        <span className="inline-flex flex-col leading-none">
                          <ChevronUp
                            className={cn(
                              'size-3 -mb-1',
                              sortField === col.key && sortOrder === 'asc'
                                ? 'text-primary'
                                : 'text-border',
                            )}
                          />
                          <ChevronDown
                            className={cn(
                              'size-3 -mt-1',
                              sortField === col.key && sortOrder === 'desc'
                                ? 'text-primary'
                                : 'text-border',
                            )}
                          />
                        </span>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td
                    colSpan={columns.length + (selectable ? 1 : 0)}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    <div className="inline-flex items-center gap-2">
                      <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      加载中...
                    </div>
                  </td>
                </tr>
              )}

              {!loading && data.length === 0 && (
                <tr>
                  <td
                    colSpan={columns.length + (selectable ? 1 : 0)}
                    className="px-4 py-16 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <div className="size-12 rounded-full bg-muted/50 flex items-center justify-center">
                        <Filter className="size-5 text-muted-foreground/70" />
                      </div>
                      <p className="text-sm">{emptyText}</p>
                    </div>
                  </td>
                </tr>
              )}

              {!loading &&
                data.map((row, i) => {
                  const key = getKey(row, i);
                  const isSelected = selectedKeys.includes(key);
                  return (
                    <tr
                      key={key}
                      className={cn(
                        'border-b border-border/30 last:border-0 hover:bg-muted/30 transition-colors',
                        isSelected && 'bg-indigo-50/60 hover:bg-indigo-50/80',
                        rowClassName?.(row, i),
                      )}
                    >
                      {selectable && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(key)}
                            className="size-4 rounded border-border text-primary focus:ring-primary"
                          />
                        </td>
                      )}
                      {columns.map((col) => {
                        const content = col.render
                          ? col.render(row, i)
                          : col.dataIndex
                          ? (row[col.dataIndex] as React.ReactNode)
                          : null;
                        return (
                          <td
                            key={col.key}
                            className={cn(
                              'px-4 py-3 text-foreground/90 align-middle',
                              col.align === 'center' && 'text-center',
                              col.align === 'right' && 'text-right',
                              col.className,
                            )}
                          >
                            {content}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border/50 bg-muted/20">
          <div className="text-xs text-muted-foreground">
            共 <span className="font-medium text-foreground">{total}</span> 条记录，第{' '}
            <span className="font-medium text-foreground">{page}</span> /{' '}
            <span className="font-medium text-foreground">{totalPages}</span> 页
          </div>

          <div className="flex items-center gap-2">
            {onPageSizeChange && (
              <select
                value={pageSizeLocal}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPageSizeLocal(v);
                  onPageSizeChange?.(v);
                  onPageChange(1);
                }}
                className="h-8 px-2 text-xs rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} 条/页
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={() => onPageChange(1)}
                disabled={page <= 1}
              >
                <ChevronsLeft className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="size-3.5" />
              </Button>

              <span className="px-2 text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                onClick={() => onPageChange(totalPages)}
                disabled={page >= totalPages}
              >
                <ChevronsRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(DataTableImpl) as <T extends Record<string, any>>(
  props: DataTableProps<T>,
) => ReactNode;
