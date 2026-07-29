import { useState } from 'react';
import { Search, User, CheckCircle2, Loader2, MinusCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { searchStudents, getDues, adjustSemesterFee, type GetDuesOutputType } from '@/lib/api';

type Fee = GetDuesOutputType['semester'][0];

export default function FeeAdjustmentsPage() {
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<{ id: string; fullName: string; studentId: string; department: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [fees, setFees] = useState<Fee[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingFees, setLoadingFees] = useState(false);
  const [actionFee, setActionFee] = useState<Fee | null>(null);
  const [actionType, setActionType] = useState<'waive' | 'reduce'>('waive');
  const [reduceAmt, setReduceAmt] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchStudents({ query: query.trim() });
      setStudents(res.students.map(u => ({ id: u.id, fullName: u.fullName, studentId: u.studentId, department: u.department })));
    } catch (e: any) { toast.error(e.message); }
    finally { setSearching(false); }
  };

  const selectStudent = async (id: string) => {
    setSelected(id); setLoadingFees(true);
    try {
      const res = await getDues({ studentId: id });
      setFees(res.semester.filter(f => f.status === 'pending'));
    } catch { setFees([]); }
    finally { setLoadingFees(false); }
  };

  const handleAction = async () => {
    if (!actionFee || !reason.trim()) { toast.error('Reason is required'); return; }
    setSubmitting(true);
    try {
      const res = await adjustSemesterFee({
        feeId: actionFee.id, action: actionType, reason,
        newAmount: actionType === 'reduce' ? parseFloat(reduceAmt) : undefined,
        newStatus: actionType === 'waive' ? 'Waived' : undefined,
      });
      toast.success(res.message);
      setActionFee(null); setReduceAmt(''); setReason('');
      setFees(prev => prev.filter(f => f.id !== actionFee.id));
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <h1 className="text-xl font-bold text-foreground mb-6">Fee Adjustments</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex gap-2 mb-4">
            <Input placeholder="Search student..." value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} className="bg-accent/50 border-border/60" />
            <Button onClick={handleSearch} disabled={searching}>{searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</Button>
          </div>
          <div className="space-y-2">
            {students.map(s => (
              <button key={s.id} onClick={() => selectStudent(s.id)}
                className={`w-full p-4 rounded-xl border-2 text-left flex items-center gap-3 ${selected === s.id ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-muted-foreground/30'}`}>
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><User className="w-5 h-5 text-primary" /></div>
                <div><p className="text-sm font-semibold text-foreground">{s.fullName}</p><p className="text-xs text-muted-foreground">{s.studentId} · {s.department}</p></div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected ? <p className="text-sm text-muted-foreground text-center py-16">Search and select a student</p> :
          loadingFees ? <div className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /></div> :
          fees.length === 0 ? <div className="text-center py-16"><CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-[hsl(var(--chart-3))]" /><p className="text-sm text-muted-foreground">No pending fees to adjust</p></div> :
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Pending Semester Fees</h2>
            {fees.map(f => (
              <div key={f.id} className="p-4 rounded-xl border border-border/60 bg-card">
                <div className="flex items-center justify-between mb-3">
                  <div><p className="text-sm font-semibold text-foreground">{f.label}</p><p className="text-xs text-muted-foreground">Due: {f.dueDate || '—'}</p></div>
                  <p className="text-base font-bold text-foreground tabular">৳{f.amount.toLocaleString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-[hsl(var(--chart-3))] border-[hsl(var(--chart-3))]/30"
                    onClick={() => { setActionFee(f); setActionType('waive'); }}><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Waive</Button>
                  <Button size="sm" variant="outline" className="flex-1"
                    onClick={() => { setActionFee(f); setActionType('reduce'); }}><MinusCircle className="w-3.5 h-3.5 mr-1.5" /> Reduce</Button>
                </div>
              </div>
            ))}
          </div>}
        </div>
      </div>

      <AlertDialog open={!!actionFee} onOpenChange={() => { setActionFee(null); setReduceAmt(''); setReason(''); }}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{actionType === 'waive' ? 'Waive Fee' : 'Reduce Fee'}</AlertDialogTitle>
            <AlertDialogDescription>{actionType === 'waive' ? `Waive ৳${actionFee?.amount?.toLocaleString()}?` : 'Enter reduced amount:'}</AlertDialogDescription>
          </AlertDialogHeader>
          {actionType === 'reduce' && <Input type="number" value={reduceAmt} onChange={e => setReduceAmt(e.target.value)} placeholder={`Max: ${actionFee?.amount}`} className="bg-accent/50 border-border/60" />}
          <div><Label className="text-xs text-muted-foreground">Reason (required)</Label><Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Scholarship, billing correction" className="mt-1.5 bg-accent/50 border-border/60" rows={2} /></div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} disabled={submitting || !reason.trim()}>{submitting ? 'Processing...' : 'Confirm'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
