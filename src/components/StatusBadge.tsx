import { cn } from '@/lib/utils';

const variants: Record<string, string> = {
  pending: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  paid: 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))] ring-[hsl(var(--chart-3))]/20',
  success: 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))] ring-[hsl(var(--chart-3))]/20',
  waived: 'bg-muted text-muted-foreground ring-border',
  under_review: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  'under review': 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  failed: 'bg-destructive/10 text-destructive ring-destructive/20',
  cancelled: 'bg-muted text-muted-foreground ring-border',
  overdue: 'bg-destructive/10 text-destructive ring-destructive/20',
  active: 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))] ring-[hsl(var(--chart-3))]/20',
  suspended: 'bg-destructive/10 text-destructive ring-destructive/20',
  removed: 'bg-muted text-muted-foreground ring-border',
};

export default function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const label = status.replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1',
      variants[normalized] || variants.pending
    )}>
      {label}
    </span>
  );
}
