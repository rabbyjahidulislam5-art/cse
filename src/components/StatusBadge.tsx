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
  // Financial Dispute & Case Management System statuses
  open: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  investigating: 'bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))] ring-[hsl(var(--chart-2))]/20',
  waitingforstudent: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  waitingforshop: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  waitingforlibrary: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  waitingforadmin: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/20',
  resolved: 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))] ring-[hsl(var(--chart-3))]/20',
  rejected: 'bg-destructive/10 text-destructive ring-destructive/20',
  refunded: 'bg-secondary/10 text-secondary ring-secondary/20',
  closed: 'bg-muted text-muted-foreground ring-border',
};

// Human-friendly labels for the CamelCase status strings this module writes to the DB
// (e.g. "WaitingForStudent"), since StatusBadge's default title-casing can't insert spaces.
const DISPUTE_STATUS_LABELS: Record<string, string> = {
  waitingforstudent: 'Waiting For Student',
  waitingforshop: 'Waiting For Shop',
  waitingforlibrary: 'Waiting For Library',
  waitingforadmin: 'Waiting For Admin',
};

export default function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const label = DISPUTE_STATUS_LABELS[normalized] || status.replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1',
      variants[normalized] || variants.pending
    )}>
      {label}
    </span>
  );
}
