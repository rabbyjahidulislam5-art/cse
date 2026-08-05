import { useState, useEffect, useCallback } from 'react';
import { Search, User, BookX, Loader2, Plus, ListChecks, CheckCircle2, MinusCircle, Ban, History } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  libraryStudentLookup, assignLibraryFine, waiveLibraryFine, listLibraryFines, cancelLibraryFine, getLibraryFineHistory,
  type LibraryStudentLookupOutputType, type ListLibraryFinesOutputType, type LibraryFineHistoryOutputType,
} from '@/lib/api';
import { useDebouncedCallback } from 'use-debounce';
import { motion } from 'framer-motion';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';

type Student = LibraryStudentLookupOutputType['students'][0];
type WaiverFine = Student['fines'][0];
type IssuedFine = ListLibraryFinesOutputType['fines'][0];
type HistoryEntry = LibraryFineHistoryOutputType['history'][0];

function AssignFineTab() {
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [searching, setSearching] = useState(false);
  const [fineType, setFineType] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await libraryStudentLookup({ query: query.trim() });
      setStudents(res.students);
    } catch (e: any) { toast.error(e.message); }
    finally { setSearching(false); }
  };

  const handleSubmit = async () => {
    if (!selected || !fineType || !amount || !dueDate) { toast.error('Fill all required fields'); return; }
    setSubmitting(true);
    try {
      const res = await assignLibraryFine({ studentId: selected.id, fineType: fineType as any, amount: parseFloat(amount), dueDate, label: label || undefined });
      toast.success(res.message);
      setSelected(null); setFineType(''); setAmount(''); setDueDate(''); setLabel(''); setStudents([]);
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Search */}
      <div>
        <div className="flex gap-2 mb-4">
          <Input aria-label="Search student" placeholder="Search student..." value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} className="bg-accent/50 border-border/60" />
          <Button onClick={handleSearch} disabled={searching}>{searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}</Button>
        </div>

        {students.length === 0 && !selected && <p className="text-sm text-muted-foreground text-center py-8">Search a Student ID to begin</p>}

        <div className="space-y-2">
          {students.map(s => (
            <button key={s.id} onClick={() => setSelected(s)}
              className={`w-full p-4 rounded-xl border-2 text-left transition-all flex items-center gap-3 ${selected?.id === s.id ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-muted-foreground/30'}`}>
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><User className="w-5 h-5 text-primary" /></div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{s.fullName}</p>
                <p className="text-xs text-muted-foreground">{s.studentId} · {s.department}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: selected ? 1 : 0.4 }} className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <BookX className="w-5 h-5 text-destructive" />
          <h2 className="text-base font-bold text-foreground">Assign Fine</h2>
        </div>
        {selected && <p className="text-sm text-muted-foreground">To: <span className="text-foreground font-medium">{selected.fullName}</span> ({selected.studentId})</p>}

        <div>
          <Label className="text-xs text-muted-foreground">Fine Type *</Label>
          <Select value={fineType} onValueChange={setFineType}>
            <SelectTrigger className="mt-1.5 bg-accent/50 border-border/60"><SelectValue placeholder="Select type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Late Return">Late Return</SelectItem>
              <SelectItem value="Lost Book">Lost Book</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Amount (৳) *</Label>
          <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="mt-1.5 bg-accent/50 border-border/60" min={1} />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Due Date *</Label>
          <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1.5 bg-accent/50 border-border/60" />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Label (optional)</Label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Late Return — Introduction to CS" className="mt-1.5 bg-accent/50 border-border/60" />
        </div>
        <Button onClick={handleSubmit} disabled={!selected || !fineType || !amount || !dueDate || submitting} className="w-full h-11 font-semibold">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <BookX className="w-4 h-4 mr-2" />}
          {submitting ? 'Assigning...' : 'Assign Fine'}
        </Button>
      </motion.div>
    </div>
  );
}

// Library's own status monitor for fines it issued — mirrors Admin FinesPage's IssuedFinesTab,
// including Cancel (Pending only); LibraryFine has no separate "edit" endpoint, so only Cancel
// is offered here — amount changes go through the Waivers tab's Reduce action instead.
function IssuedFinesTab() {
  const [fines, setFines] = useState<IssuedFine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cancelTarget, setCancelTarget] = useState<IssuedFine | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback((q: string) => {
    setLoading(true);
    listLibraryFines({ search: q || undefined })
      .then(d => setFines(d.fines))
      .catch(() => toast.error('Failed to load issued fines'))
      .finally(() => setLoading(false));
  }, []);

  const debouncedLoad = useDebouncedCallback(load, 350);
  useEffect(() => { load(''); }, [load]);

  const doCancel = async () => {
    if (!cancelTarget) return;
    setActing(cancelTarget.id);
    try {
      await cancelLibraryFine({ fineId: cancelTarget.id, reason: cancelReason });
      toast.success('Fine cancelled');
      setCancelTarget(null); setCancelReason(''); load(search);
    } catch (e: any) { toast.error(e.message || 'Failed to cancel'); }
    finally { setActing(null); }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => { setSearch(e.target.value); debouncedLoad(e.target.value); }}
          placeholder="Search by student ID, name, or label..."
          className="pl-9 bg-accent/50 border-border/60"
        />
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : fines.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
          <ListChecks className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No fines issued yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {fines.map(f => (
            <motion.div key={f.id} layout className="rounded-xl border border-border/60 bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-foreground">{f.studentName}</p>
                    <span className="text-[10px] font-mono text-muted-foreground">{f.studentId}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.label}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">Ref: {f.reference} · Due: {f.dueDate || '—'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-foreground tabular">৳{f.amount.toLocaleString()}</p>
                  <StatusBadge status={f.status} />
                </div>
              </div>
              {f.status === 'Pending' && (
                <div className="flex gap-2 mt-3">
                  <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/20" onClick={() => setCancelTarget(f)} disabled={!!acting}>
                    <Ban className="w-3 h-3 mr-1" /> Cancel
                  </Button>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this fine?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget?.studentName} will no longer be able to pay this fine. This cannot be undone once cancelled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason for cancelling (optional)..." rows={3} className="bg-accent/50 border-border/60" />
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction onClick={doCancel} disabled={acting === cancelTarget?.id} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {acting === cancelTarget?.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Cancel Fine
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Search-and-manage a student's pending fines — waive outright or reduce to a lower amount.
function WaiversTab() {
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [searching, setSearching] = useState(false);
  const [actionFine, setActionFine] = useState<WaiverFine | null>(null);
  const [actionType, setActionType] = useState<'waive' | 'reduce'>('waive');
  const [reduceAmt, setReduceAmt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historySearch, setHistorySearch] = useState('');

  const loadHistory = () => {
    getLibraryFineHistory({})
      .then(d => setHistory(d.history))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  };
  useEffect(() => { loadHistory(); }, []);

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

  // "Reduce" asks the staff how much to knock off the fine, not what the final amount should be —
  // the API still wants the final amount, so that subtraction happens here before sending.
  const reduceBy = parseFloat(reduceAmt) || 0;
  const newAmountAfterReduce = actionFine ? actionFine.amount - reduceBy : 0;

  const handleAction = async () => {
    if (!actionFine) return;
    setSubmitting(true);
    try {
      const res = await waiveLibraryFine({ fineId: actionFine.id, action: actionType, newAmount: actionType === 'reduce' ? newAmountAfterReduce : undefined });
      toast.success(res.message);
      setActionFine(null); setReduceAmt('');
      loadHistory();
      if (selected) {
        const res2 = await libraryStudentLookup({ query: selected.studentId || selected.fullName });
        const found = res2.students.find(s => s.id === selected.id);
        if (found) setSelected(found);
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const pendingFines = selected?.fines.filter(f => f.status === 'Pending') || [];
  const filteredHistory = history.filter(h =>
    !historySearch.trim() || h.studentName.toLowerCase().includes(historySearch.toLowerCase()) || h.studentId.toLowerCase().includes(historySearch.toLowerCase())
  );

  return (
    <div className="space-y-8">
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

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" /> Recent Waivers &amp; Reductions
        </h2>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="Search activity by student ID or name..." className="pl-9 bg-accent/50 border-border/60" />
        </div>
        {historyLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : filteredHistory.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
            <History className="w-7 h-7 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">{historySearch.trim() ? 'No activity matches this search' : 'No waive, reduce, or cancel activity yet'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredHistory.map(h => (
              <div key={h.id} className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-border/60 bg-card">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{h.action.replace('Library Fine ', '')}</p>
                    {h.studentName && <span className="text-xs text-muted-foreground">{h.studentName}</span>}
                    {h.studentId && <span className="text-[10px] font-mono text-muted-foreground">{h.studentId}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{h.details}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-muted-foreground">{h.actorName}</p>
                  <p className="text-[10px] text-muted-foreground/70">{new Date(h.createdAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!actionFine} onOpenChange={() => { setActionFine(null); setReduceAmt(''); }}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{actionType === 'waive' ? 'Waive Fine' : 'Reduce Fine'}</AlertDialogTitle>
            <AlertDialogDescription>
              {actionType === 'waive' ? `Completely waive the ৳${actionFine?.amount?.toLocaleString()} fine?` : `Enter the amount to reduce off the current ৳${actionFine?.amount?.toLocaleString()} fine:`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionType === 'reduce' && (
            <div className="space-y-1.5">
              <Input type="number" value={reduceAmt} onChange={e => setReduceAmt(e.target.value)} placeholder={`Up to ৳${(actionFine?.amount || 1) - 1}`} className="bg-accent/50 border-border/60" min={1} max={(actionFine?.amount || 1) - 1} />
              {reduceAmt && <p className="text-xs text-muted-foreground">New fine amount: <span className="font-semibold text-foreground">৳{newAmountAfterReduce.toLocaleString()}</span></p>}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleAction} disabled={submitting || (actionType === 'reduce' && (!reduceAmt || newAmountAfterReduce <= 0))}>
              {submitting ? 'Processing...' : actionType === 'waive' ? 'Waive' : 'Reduce'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function FineImpositionPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <FadeIn>
        <BackButton fallback="/library" />
        <h1 className="text-xl font-bold text-foreground mb-6">Library Fines</h1>
      </FadeIn>

      <FadeIn delay={0.05}>
        <Tabs defaultValue="assign">
          <TabsList className="w-full bg-accent/50 p-1 rounded-xl mb-5">
            <TabsTrigger value="assign" className="flex-1 rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Assign Fine
            </TabsTrigger>
            <TabsTrigger value="issued" className="flex-1 rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <ListChecks className="w-3.5 h-3.5 mr-1.5" /> Issued Fines
            </TabsTrigger>
            <TabsTrigger value="waivers" className="flex-1 rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Waivers
            </TabsTrigger>
          </TabsList>
          <TabsContent value="assign"><AssignFineTab /></TabsContent>
          <TabsContent value="issued"><IssuedFinesTab /></TabsContent>
          <TabsContent value="waivers"><WaiversTab /></TabsContent>
        </Tabs>
      </FadeIn>
    </div>
  );
}
