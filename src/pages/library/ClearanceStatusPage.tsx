import { useState, useEffect } from 'react';
import { ClipboardCheck, Filter } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getLibraryClearance, generateClearanceReport, type GetLibraryClearanceOutputType } from '@/lib/api';
import { motion } from 'framer-motion';
import ExportButton from '@/components/ExportButton';

export default function ClearanceStatusPage() {
  const [data, setData] = useState<GetLibraryClearanceOutputType | null>(null);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState('');

  const load = (department?: string) => {
    setLoading(true);
    getLibraryClearance({ department: department || undefined }).then(setData).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDeptChange = (v: string) => {
    setDept(v);
    load(v === 'all' ? undefined : v);
  };

  if (loading && !data) return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl space-y-4">
      <Skeleton className="h-8 w-48" /><Skeleton className="h-10 w-64" />
      {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );

  const cleared = data?.students.filter(s => s.status === 'Cleared').length || 0;
  const unpaid = data?.students.filter(s => s.status === 'Unpaid').length || 0;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground">Clearance Status</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <Select value={dept} onValueChange={handleDeptChange}>
              <SelectTrigger className="w-48 bg-accent/50 border-border/60"><SelectValue placeholder="All Departments" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {(data?.departments || []).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ExportButton
            supportRoute="/library/disputes"
            onExport={(format) => generateClearanceReport({ format, department: dept && dept !== 'all' ? dept : undefined })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-4 rounded-xl border border-border/60 bg-card text-center">
          <p className="text-2xl font-bold text-[hsl(var(--chart-3))]">{cleared}</p>
          <p className="text-xs text-muted-foreground">Cleared</p>
        </div>
        <div className="p-4 rounded-xl border border-border/60 bg-card text-center">
          <p className="text-2xl font-bold text-destructive">{unpaid}</p>
          <p className="text-xs text-muted-foreground">Unpaid</p>
        </div>
      </div>

      {data?.students.length === 0 ? (
        <div className="text-center py-16"><ClipboardCheck className="w-12 h-12 mx-auto mb-3 text-muted-foreground/20" /><p className="text-sm text-muted-foreground">No students match this filter</p></div>
      ) : (
        <div className="space-y-2">
          {data?.students.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
              className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card">
              <div>
                <p className="text-sm font-semibold text-foreground">{s.fullName || 'Student'}</p>
                <p className="text-xs text-muted-foreground">{s.studentId} · {s.department}</p>
              </div>
              <div className="text-right flex items-center gap-3">
                {s.status === 'Unpaid' && <span className="text-xs text-muted-foreground tabular">৳{s.pendingAmount.toLocaleString()} ({s.pendingCount})</span>}
                <span className={`text-xs font-semibold px-3 py-1 rounded-full ${s.status === 'Cleared' ? 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]' : 'bg-destructive/10 text-destructive'}`}>
                  {s.status}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
