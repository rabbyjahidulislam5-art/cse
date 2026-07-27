import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Search, Plus, Check, X, Minus, Loader2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';
import {
  searchStudents, assignFine, getWaivers, updateWaiver,
  type SearchStudentsOutputType, type GetWaiversOutputType,
} from '@/lib/api';
import { FadeIn } from '@/components/PageTransition';

type Student = SearchStudentsOutputType['students'][0];
type Waiver = GetWaiversOutputType['waivers'][0];

function AssignFineTab() {
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Student | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [incidentDate, setIncidentDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);

  const doSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchStudents({ query });
      setStudents(res.students);
    } catch { toast.error('Search failed'); }
    finally { setSearching(false); }
  };

  const handleAssign = async () => {
    if (!selected) { toast.error('Select a student'); return; }
    if (!reason.trim() || reason.length < 5) { toast.error('Reason must be at least 5 characters'); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast.error('Enter a valid amount'); return; }

    setSaving(true);
    try {
      await assignFine({
        studentId: selected.id,
        studentEmail: selected.email,
        studentName: selected.fullName,
        reason,
        amount: amt,
        incidentDate,
      });
      toast.success(`Fine assigned to ${selected.fullName}`);
      setSelected(null); setReason(''); setAmount(''); setStudents([]); setQuery('');
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {/* Student Search */}
      <div>
        <Label className="text-xs text-muted-foreground">Search Student</Label>
        <div className="flex gap-2 mt-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && doSearch()} placeholder="Student ID, name or email" className="pl-9 bg-accent/50" />
          </div>
          <Button onClick={doSearch} disabled={searching} variant="outline" size="sm" className="h-10 px-4">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
          </Button>
        </div>
      </div>

      {/* Results */}
      {students.length > 0 && !selected && (
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden divide-y divide-border/30">
          {students.map(s => (
            <button key={s.id} onClick={() => setSelected(s)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left">
              <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{s.fullName}</p>
                <p className="text-xs text-muted-foreground">{s.studentId} · {s.department}</p>
              </div>
              <StatusBadge status={s.status} />
            </button>
          ))}
        </div>
      )}

      {/* Selected student + fine form */}
      {selected && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
              <span className="text-sm font-bold text-primary-foreground">{selected.fullName.charAt(0)}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">{selected.fullName}</p>
              <p className="text-xs text-muted-foreground">{selected.studentId} · {selected.department} · Batch {selected.batch}</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelected(null)}><X className="w-4 h-4" /></Button>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Reason *</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Disciplinary violation details..." className="mt-1.5 bg-accent/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Amount (৳) *</Label>
              <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="mt-1.5 bg-accent/50 tabular" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Incident Date</Label>
              <Input type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)} className="mt-1.5 bg-accent/50" />
            </div>
          </div>
          <Button onClick={handleAssign} disabled={saving} className="w-full">
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldAlert className="w-4 h-4 mr-2" />}
            Assign Fine
          </Button>
        </motion.div>
      )}

      {!selected && students.length === 0 && (
        <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
          <Search className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Search a Student ID to begin</p>
        </div>
      )}
    </div>
  );
}

function WaiversTab() {
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [reduceId, setReduceId] = useState<string | null>(null);
  const [reduceAmount, setReduceAmount] = useState('');
  const [acting, setActing] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getWaivers({ status: 'Under Review' })
      .then(d => setWaivers(d.waivers))
      .catch(() => toast.error('Failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const act = async (waiver: Waiver, action: 'approve' | 'reduce' | 'reject') => {
    if (action === 'reduce') {
      const amt = parseFloat(reduceAmount);
      if (!amt || amt <= 0 || amt >= waiver.amount) { toast.error('Enter a valid reduced amount'); return; }
    }
    setActing(waiver.id);
    try {
      await updateWaiver({
        fineId: waiver.id,
        action,
        reducedAmount: action === 'reduce' ? parseFloat(reduceAmount) : undefined,
        studentEmail: waiver.studentEmail,
        studentName: waiver.studentName,
      });
      toast.success(`Waiver ${action === 'approve' ? 'approved' : action === 'reduce' ? 'reduced' : 'rejected'}`);
      setReduceId(null);
      load();
    } catch (e: any) { toast.error(e.message || 'Failed'); }
    finally { setActing(null); }
  };

  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>;

  if (waivers.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card p-10 text-center">
        <Check className="w-8 h-8 text-[hsl(var(--chart-3))]/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No pending appeals</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {waivers.map(w => (
        <motion.div key={w.id} layout className="rounded-xl border border-border/60 bg-card p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{w.studentName}</p>
                <span className="text-[10px] font-mono text-muted-foreground">{w.studentId}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{w.reason}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-foreground tabular">৳{w.amount.toLocaleString()}</p>
              <StatusBadge status={w.status} />
            </div>
          </div>

          {reduceId === w.id ? (
            <div className="flex gap-2 mt-2">
              <Input type="number" value={reduceAmount} onChange={e => setReduceAmount(e.target.value)} placeholder="New amount" className="bg-accent/50 tabular flex-1" />
              <Button size="sm" onClick={() => act(w, 'reduce')} disabled={acting === w.id}>
                {acting === w.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Apply'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReduceId(null)}><X className="w-3 h-3" /></Button>
            </div>
          ) : (
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" className="flex-1 text-[hsl(var(--chart-3))] border-[hsl(var(--chart-3))]/20" onClick={() => act(w, 'approve')} disabled={!!acting}>
                <Check className="w-3 h-3 mr-1" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { setReduceId(w.id); setReduceAmount(''); }} disabled={!!acting}>
                <Minus className="w-3 h-3 mr-1" /> Reduce
              </Button>
              <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/20" onClick={() => act(w, 'reject')} disabled={!!acting}>
                <X className="w-3 h-3 mr-1" /> Reject
              </Button>
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

export default function FinesPage() {
  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <FadeIn>
        <h1 className="text-xl font-bold text-foreground mb-1">Disciplinary Fines</h1>
        <p className="text-sm text-muted-foreground mb-6">Assign fines and manage student appeals</p>
      </FadeIn>

      <FadeIn delay={0.05}>
        <Tabs defaultValue="assign">
          <TabsList className="w-full bg-accent/50 p-1 rounded-xl mb-5">
            <TabsTrigger value="assign" className="flex-1 rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Assign Fine
            </TabsTrigger>
            <TabsTrigger value="waivers" className="flex-1 rounded-lg data-[state=active]:gradient-primary data-[state=active]:text-primary-foreground">
              <ShieldAlert className="w-3.5 h-3.5 mr-1.5" /> Waivers
            </TabsTrigger>
          </TabsList>
          <TabsContent value="assign"><AssignFineTab /></TabsContent>
          <TabsContent value="waivers"><WaiversTab /></TabsContent>
        </Tabs>
      </FadeIn>
    </div>
  );
}
