import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileBarChart, Loader2, Download, FileSpreadsheet, FileText, FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { FadeIn } from '@/components/PageTransition';
import { generateDisputeReport, DISPUTE_STATUSES } from '@/lib/disputeApi';

const FORMATS: { value: 'csv' | 'excel' | 'pdf'; label: string; icon: typeof FileText }[] = [
  { value: 'csv', label: 'CSV', icon: FileJson },
  { value: 'excel', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
  { value: 'pdf', label: 'PDF', icon: FileText },
];

export default function DisputeReportsPage() {
  const navigate = useNavigate();
  const [format, setFormat] = useState<'csv' | 'excel' | 'pdf'>('excel');
  const [status, setStatus] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { url } = await generateDisputeReport({ format, status: status === 'all' ? undefined : status, fromDate: fromDate || undefined, toDate: toDate || undefined });
      window.open(url, '_blank', 'noopener,noreferrer');
      toast.success('Report generated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate report.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/accounts/disputes')} className="p-2 rounded-xl hover:bg-accent transition-colors">
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2"><FileBarChart className="w-5 h-5 text-primary" /> Dispute Reports</h1>
          <p className="text-xs text-muted-foreground">Export case data for offline analysis</p>
        </div>
      </div>

      <FadeIn>
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 block">Format</Label>
            <div className="grid grid-cols-3 gap-2">
              {FORMATS.map(f => (
                <button key={f.value} onClick={() => setFormat(f.value)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-semibold transition-all ${format === f.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border/60 hover:border-primary/40'}`}>
                  <f.icon className="w-5 h-5" /> {f.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">Status Filter</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="bg-accent/50 border-border/60"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {DISPUTE_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">From</Label>
              <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="bg-accent/50 border-border/60" />
            </div>
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 block">To</Label>
              <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="bg-accent/50 border-border/60" />
            </div>
          </div>

          <Button onClick={handleGenerate} disabled={generating} className="w-full font-semibold gap-2">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {generating ? 'Generating...' : 'Generate & Download'}
          </Button>
        </div>
      </FadeIn>
    </div>
  );
}
