import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GraduationCap, BookOpen, ShieldAlert, Clock, ChevronRight, Loader2, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { getDues, type GetDuesOutputType } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import StatusBadge from '@/components/StatusBadge';

// The single payment-category chooser used both from the Accounts Office QR scan and the student
// dashboard's "Pay" entry point. Deliberately does NOT reimplement payment — selecting an item
// deep-links into DuesPage's existing single-item Pay flow (PIN/OTP/PaymentConfirmModal/receipt),
// unchanged, via `/student/dues?focus=<source>:<id>`.

type Source = 'semester' | 'library' | 'admin' | 'payLater';

const CATEGORY_META: Record<Source, { label: string; icon: typeof GraduationCap }> = {
  semester: { label: 'Semester Fee', icon: GraduationCap },
  library: { label: 'Library Fine', icon: BookOpen },
  admin: { label: 'Administrative Fine', icon: ShieldAlert },
  payLater: { label: 'Shop Due', icon: Clock },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PaymentCategoryModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [dues, setDues] = useState<GetDuesOutputType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getDues({}).then(setDues).catch(() => {}).finally(() => setLoading(false));
  }, [open]);

  const groups: Array<{ source: Source; items: GetDuesOutputType['semester'] }> = dues ? [
    { source: 'semester', items: dues.semester.filter(i => i.status === 'pending') },
    { source: 'admin', items: dues.admin.filter(i => i.status === 'pending') },
    { source: 'library', items: dues.library.filter(i => i.status === 'pending') },
    { source: 'payLater', items: dues.payLater.filter(i => i.status === 'pending') },
  ] : [];

  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  const selectItem = (source: Source, id: string) => {
    onOpenChange(false);
    navigate(`/student/dues?focus=${source}:${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong rounded-2xl sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What would you like to pay?</DialogTitle>
          <DialogDescription>Select a due to continue — semester fee, fines, or shop dues.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div>
        ) : totalItems === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-[hsl(var(--chart-3))]/40" />
            <p className="text-sm font-medium text-muted-foreground">You have no pending payments</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.filter(g => g.items.length > 0).map(g => {
              const meta = CATEGORY_META[g.source];
              return (
                <div key={g.source}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <meta.icon className="w-3.5 h-3.5" /> {meta.label}{g.items.length > 1 ? `s (${g.items.length})` : ''}
                  </p>
                  <div className="space-y-1.5">
                    {g.items.map((item, idx) => (
                      <motion.button
                        key={item.id} type="button" onClick={() => selectItem(g.source, item.id)}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-card hover:border-primary/30 transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <meta.icon className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{item.label}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {item.dueDate && <span className="text-[10px] text-muted-foreground">Due: {item.dueDate}</span>}
                            <StatusBadge status={item.status} />
                          </div>
                        </div>
                        <span className="text-sm font-bold text-foreground tabular shrink-0">{formatCurrency(item.amount)}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </motion.button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
