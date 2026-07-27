import { useState } from 'react';
import { Users, Building2, User, Loader2, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { pushSemesterFee } from '@/lib/api';

const targetTypes = [
  { key: 'single' as const, label: 'Single Student', icon: User, desc: 'By Student ID' },
  { key: 'batch' as const, label: 'Batch', icon: Users, desc: 'All students in a batch' },
  { key: 'department' as const, label: 'Department', icon: Building2, desc: 'All students in dept' },
];

export default function SemesterFeePushPage() {
  const [targetType, setTargetType] = useState<'single' | 'batch' | 'department'>('single');
  const [targetValue, setTargetValue] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [label, setLabel] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const amt = parseFloat(amount) || 0;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await pushSemesterFee({ targetType, targetValue, amount: amt, dueDate, label: label || undefined });
      toast.success(res.message);
      setTargetValue(''); setAmount(''); setDueDate(''); setLabel('');
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); setConfirmOpen(false); }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-2xl">
      <h1 className="text-xl font-bold text-foreground mb-6">Semester Fee Push</h1>

      <div className="space-y-5">
        <div>
          <Label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Target Type</Label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {targetTypes.map(t => (
              <button key={t.key} onClick={() => { setTargetType(t.key); setTargetValue(''); }}
                className={`p-3 rounded-xl border-2 text-center transition-all ${targetType === t.key ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-muted-foreground/30'}`}>
                <t.icon className={`w-5 h-5 mx-auto mb-1 ${targetType === t.key ? 'text-primary' : 'text-muted-foreground'}`} />
                <p className={`text-xs font-semibold ${targetType === t.key ? 'text-primary' : 'text-foreground'}`}>{t.label}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">{targetType === 'single' ? 'Student ID' : targetType === 'batch' ? 'Batch Name' : 'Department Name'} *</Label>
          <Input value={targetValue} onChange={e => setTargetValue(e.target.value)}
            placeholder={targetType === 'single' ? 'e.g. STU-2026-001' : targetType === 'batch' ? 'e.g. 2026' : 'e.g. Computer Science'}
            className="mt-1.5 bg-accent/50 border-border/60" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Amount (৳) *</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="mt-1.5 bg-accent/50 border-border/60" min={1} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Due Date *</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1.5 bg-accent/50 border-border/60" />
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Label (optional)</Label>
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Spring 2026 Tuition" className="mt-1.5 bg-accent/50 border-border/60" />
        </div>

        <Button onClick={() => setConfirmOpen(true)} disabled={!targetValue || !amt || !dueDate} className="w-full h-12 font-semibold">
          Push Fee
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="glass-strong rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-[hsl(var(--chart-4))]" /> Confirm Fee Push</AlertDialogTitle>
            <AlertDialogDescription>
              Push ৳{amt.toLocaleString()} to {targetType === 'single' ? `student ${targetValue}` : `all students in ${targetType} "${targetValue}"`}?
              {targetType !== 'single' && <span className="block mt-1 text-[hsl(var(--chart-4))] font-medium">This may affect many students.</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Pushing...' : 'Confirm Push'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
