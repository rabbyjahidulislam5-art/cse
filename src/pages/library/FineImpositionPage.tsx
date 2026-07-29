import { useState } from 'react';
import { Search, User, BookX, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { libraryStudentLookup, assignLibraryFine, type LibraryStudentLookupOutputType } from '@/lib/api';
import { motion } from 'framer-motion';

type Student = LibraryStudentLookupOutputType['students'][0];

export default function FineImpositionPage() {
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
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <h1 className="text-xl font-bold text-foreground mb-6">Fine Imposition</h1>

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
    </div>
  );
}
