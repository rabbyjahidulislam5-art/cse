import { useState } from 'react';
import { Search, User, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { libraryStudentLookup, type LibraryStudentLookupOutputType } from '@/lib/api';
import { motion } from 'framer-motion';

type Student = LibraryStudentLookupOutputType['students'][0];

export default function StudentLookupPage() {
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await libraryStudentLookup({ query: query.trim() });
      setStudents(res.students);
      if (res.students.length === 0) toast.info('No students found');
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <h1 className="text-xl font-bold text-foreground mb-6">Student Lookup</h1>

      <div className="flex gap-2 mb-6">
        <Input placeholder="Search by name, Student ID, or email..." value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()} className="bg-accent/50 border-border/60" />
        <Button onClick={handleSearch} disabled={loading || !query.trim()}>
          {loading ? <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Search className="w-4 h-4" />}
        </Button>
      </div>

      {students.length === 0 && !loading && (
        <div className="text-center py-16">
          <BookOpen className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">Search a Student ID to check due status</p>
        </div>
      )}

      <div className="space-y-3">
        {students.map(s => (
          <motion.div key={s.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border/60 bg-card overflow-hidden">
            <button onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="w-full p-4 text-left flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{s.fullName || 'Student'}</p>
                <p className="text-xs text-muted-foreground">{s.studentId} · {s.department}</p>
              </div>
              <div className="text-right mr-2">
                <p className="text-sm font-bold text-foreground tabular">৳{s.totalPending.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{s.fines.length} fine(s)</p>
              </div>
              {expanded === s.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {expanded === s.id && (
              <div className="border-t border-border/40 p-4 space-y-2 bg-accent/20">
                {s.fines.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No fines on record</p> : s.fines.map(f => (
                  <div key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-card border border-border/40">
                    <div>
                      <p className="text-sm font-medium text-foreground">{f.label}</p>
                      <p className="text-xs text-muted-foreground">{f.fineType} · Due: {f.dueDate || '—'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold tabular">৳{f.amount.toLocaleString()}</p>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${f.status === 'Pending' ? 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))]' : f.status === 'Paid' ? 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]' : 'bg-muted text-muted-foreground'}`}>{f.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
