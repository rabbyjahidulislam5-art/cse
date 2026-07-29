import { useState } from 'react';
import { FileText, Download, FileSpreadsheet, BarChart3, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { generateCollectionAnalyticsReport, exportAdvisingFees } from '@/lib/api';

export default function AccountsReportsPage() {
  const [downloading, setDownloading] = useState(false);

  const handleDownloadCollectionReport = async (format: 'excel' | 'csv' | 'pdf') => {
    setDownloading(true);
    try {
      toast.info(`Generating Collection Analytics Report (${format.toUpperCase()})...`);
      const res = await generateCollectionAnalyticsReport({ format });
      if (res.url) {
        window.open(res.url, '_blank');
        toast.success('Report ready for download.');
      }
    } catch (e: any) {
      toast.error(e.message || 'Report generation failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" /> Accounts Reports & Financial Audit
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Generate phase reports, advising summaries, collection progress, and audit logs</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Phase 1 Advising Export Reports */}
        <div className="glass-strong rounded-2xl p-6 space-y-4 border border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">P1</div>
            <div>
              <h3 className="font-bold text-base text-foreground">Phase 1 — Advising Export Reports</h3>
              <p className="text-xs text-muted-foreground">Student ID, Name, Email, Department, Program, Semester, Credit, Tuition, Waiver, Final Amount</p>
            </div>
          </div>

          <div className="pt-2 grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => exportAdvisingFees('excel')} className="gap-1.5 text-xs">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Excel (.xlsx)
            </Button>
            <Button variant="outline" onClick={() => exportAdvisingFees('csv')} className="gap-1.5 text-xs">
              <FileText className="w-4 h-4 text-blue-400" /> CSV (.csv)
            </Button>
            <Button variant="outline" onClick={() => exportAdvisingFees('pdf')} className="gap-1.5 text-xs">
              <Download className="w-4 h-4 text-rose-400" /> PDF Report
            </Button>
          </div>
        </div>

        {/* Phase 2 Accounts Collection Reports */}
        <div className="glass-strong rounded-2xl p-6 space-y-4 border border-border/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">P2</div>
            <div>
              <h3 className="font-bold text-base text-foreground">Phase 2 — Fee Collection Analytics</h3>
              <p className="text-xs text-muted-foreground">Department-wise collections, outstanding dues, payment status counts, and revenue totals</p>
            </div>
          </div>

          <div className="pt-2 grid grid-cols-3 gap-2">
            <Button variant="outline" onClick={() => handleDownloadCollectionReport('excel')} disabled={downloading} className="gap-1.5 text-xs">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" /> Excel (.xlsx)
            </Button>
            <Button variant="outline" onClick={() => handleDownloadCollectionReport('csv')} disabled={downloading} className="gap-1.5 text-xs">
              <FileText className="w-4 h-4 text-blue-400" /> CSV (.csv)
            </Button>
            <Button variant="outline" onClick={() => handleDownloadCollectionReport('pdf')} disabled={downloading} className="gap-1.5 text-xs">
              <Download className="w-4 h-4 text-rose-400" /> PDF Report
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
