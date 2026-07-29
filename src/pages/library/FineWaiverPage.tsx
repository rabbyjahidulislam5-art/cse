import { useState } from 'react';
import { Search, User, CheckCircle2, Loader2, MinusCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { libraryStudentLookup, waiveLibraryFine, type LibraryStudentLookupOutputType } from '@/lib/api';

type Student = LibraryStudentLookupOutputType['students'][0];
type Fine = Student['fines'][0];

export default function FineWaiverPage() {
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionFine, setActionFine] = useState<Fine | null>(null);
  const [actionType, setActionType] = useState<'waive' | 'reduce'>('waive');
  const [reduceAmt, setReduceAmt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await libraryStudentLookup({ query: query.trim() });
      setStudents(res.students);
      if (res.students.length === 1) setSelected(res.students[0]);
    } catch (e: any) { toast.error(e.message); }
    finally { setSearching(false); }
  };

  const handleAction = async () => {
    if (!actionFine) return;
    setSubmitting(true);
    try {
      const res = await waiveLibraryFine({ fineId: actionFine.id, action: actionType, newAmount: actionType === 'reduce' ? parseFloat(reduceAmt) : undefined });
      toast.success(res.message);
      setActionFine(null); setReduceAmt('');
      // Refresh
      if (selected) {
        const res2 = await libraryStudentLookup({ query: selected.studentId || selected.fullName });
        const found = res2.students.find(s => s.id === selected.id);
        if (found) setSelected(found);
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const pendingFines = selected?.fines.filter(f => f.status === 'Pending') || [];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <h1 className="text-xl font-bold text-foreground mb-6">Fine Waiver</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex gap-2 mb-4">
            <Input aria-label="Search student" placeholder="Search student..." value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} className="bg-accent/50 border-border/60" />
            <Button onClick={handleSearch} disabled={searching}>{searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</Button>
          </div>
          <div className="space-y-2">
            {students.map(s => (
              <button key={s.id} onClick={() => setSelected(s)}
                className={`w-full p-4 rounded-xl border-2 text-left flex items-center gap-3 ${selected?.id === s.id ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-muted-foreground/30'}`}>
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><User className="w-5 h-5 text-primary" /></div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{s.fullName}</p>
                  <p className="text-xs text-muted-foreground">{s.studentId} · Pending: ৳{s.totalPending.toLocaleString()}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          {!selected ? <p className="text-sm text-muted-foreground text-center py-16">Search and select a student to manage fines</p> : pendingFines.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-[hsl(var(--chart-3))]" />
              <p className="text-sm text-muted-foreground">This student has no pending fines to waive</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Pending Fines — {selected.fullName}</h2>
              {pendingFines.map(f => (
                <div key={f.id} className="p-4 rounded-xl border border-border/60 bg-card">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{f.label}</p>
                      <p className="text-xs text-muted-foreground">{f.fineType} · Due: {f.dueDate || '—'}</p>
                    </div>
                    <p className="text-base font-bold text-foreground tabular">৳{f.amount.toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 text-[hsl(var(--chart-3))] border-[hsl(var(--chart-3))]/30"
                      onClick={() => { setActionFine(f); setActionType('waive'); }}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Waive
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1"
                      onClick={() => { setActionFine(f); setActionType('reduce'); }}>
                      <MinusCircle className="w-3.5 h-3.5 mr-1.5" /> Reduce
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!actionFine} onOpenChange={() => { setActionFine(null); setReduceAmt(''); }}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{actionType === 'waive' ? 'Waive Fine' : 'Reduce Fine'}</AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === 'waive' ? `Completely waive the ৳${actionFine?.amount?.toLocaleString()} fine?` : 'Enter the reduced amount:'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionType === 'reduce' && (
            <Input type="number" value={reduceAmt} onChange={e => setReduceAmt(e.target.value)} placeholder={`Max: ${actionFine?.amount}`} className="bg-accent/50 border-border/60" min={1} max={(actionFine?.amount || 1) - 1} />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} disabled={submitting || (actionType === 'reduce' && !reduceAmt)}>
              {submitting ? 'Processing...' : actionType === 'waive' ? 'Waive' : 'Reduce'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
