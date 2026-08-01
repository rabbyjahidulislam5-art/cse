import { useState, useEffect } from 'react';
import { BookOpen, Search, ArrowUpRight, ArrowDownLeft, FileSpreadsheet, Download, RefreshCw, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getAccountsLedger } from '@/lib/api';

export default function LedgerPage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchStudentId, setSearchStudentId] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const res = await getAccountsLedger({
        studentId: searchStudentId || undefined,
        type: selectedType !== 'ALL' ? selectedType : undefined
      });
      setEntries(res.entries || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load ledger entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, [selectedType]);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-primary" /> account ledger
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchLedger} className="gap-1.5">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="glass-strong p-4 rounded-xl flex flex-col sm:flex-row items-center gap-3 border border-border/50">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search by Student ID or Name"
            placeholder="Search by Student ID or Name e.g. STU-2026-001"
            value={searchStudentId}
            onChange={e => setSearchStudentId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchLedger()}
            className="pl-9 bg-accent/40 border-border/60"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            aria-label="Filter by Entry Type"
            className="h-9 px-3 bg-accent/40 border border-border/60 text-foreground text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="ALL" className="bg-background text-foreground">All Entry Types</option>
            <option value="DEBIT_DUE" className="bg-background text-foreground">Debit Dues (৳)</option>
            <option value="CREDIT_PAYMENT" className="bg-background text-foreground">Credit Payments (৳)</option>
          </select>
          <Button onClick={fetchLedger} className="gap-1 font-semibold">
            <Filter className="w-4 h-4" /> Filter
          </Button>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="glass-strong rounded-2xl p-6 border border-border/60 shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-accent/60 text-muted-foreground uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-3">Entry Number</th>
                <th className="p-3">Student Info</th>
                <th className="p-3">Type</th>
                <th className="p-3">Description</th>
                <th className="p-3 text-right">Debit (৳)</th>
                <th className="p-3 text-right">Credit (৳)</th>
                <th className="p-3 text-right">Balance After (৳)</th>
                <th className="p-3 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    <RefreshCw className="w-4 h-4 animate-spin inline-block mr-2" /> Loading ledger entries...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    No ledger entries found.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-accent/20 transition-colors">
                    <td className="p-3 font-mono font-semibold text-foreground">{entry.entryNumber}</td>
                    <td className="p-3">
                      <p className="font-semibold text-foreground">{entry.student?.fullName || 'N/A'}</p>
                      <p className="text-[10px] text-muted-foreground">{entry.student?.studentId} • {entry.student?.department}</p>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${
                        entry.type === 'DEBIT_DUE' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                      }`}>
                        {entry.type}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground">{entry.description || 'Semester Fee'}</td>
                    <td className="p-3 text-right font-bold text-rose-400">
                      {entry.debitAmount > 0 ? `৳${entry.debitAmount.toLocaleString()}` : '-'}
                    </td>
                    <td className="p-3 text-right font-bold text-emerald-400">
                      {entry.creditAmount > 0 ? `৳${entry.creditAmount.toLocaleString()}` : '-'}
                    </td>
                    <td className="p-3 text-right font-bold text-foreground">
                      ৳{entry.balanceAfter.toLocaleString()}
                    </td>
                    <td className="p-3 text-right text-muted-foreground font-mono">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
