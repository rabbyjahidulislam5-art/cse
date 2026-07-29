import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

export type ExportFormat = 'csv' | 'excel' | 'pdf';

const DEFAULT_LABELS: Record<ExportFormat, string> = { csv: 'CSV', excel: 'Excel', pdf: 'PDF' };

interface ExportButtonProps {
  formats?: ExportFormat[];
  onExport: (format: ExportFormat) => Promise<{ url: string }>;
  labels?: Partial<Record<ExportFormat, string>>;
  /** Where "Contact Support" routes to — this app's real escalation channel is its dispute system, not a fabricated inbox. */
  supportRoute: string;
}

// Shared export control used by every Export/Download button in the app — one place to keep the
// CSV/Excel/PDF button group and the failure UI consistent, instead of every page reimplementing
// its own try/catch + toast.
export default function ExportButton({ formats = ['csv', 'excel', 'pdf'], onExport, labels, supportRoute }: ExportButtonProps) {
  const navigate = useNavigate();
  const [loadingFormat, setLoadingFormat] = useState<ExportFormat | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [lastFailedFormat, setLastFailedFormat] = useState<ExportFormat | null>(null);

  const runExport = async (format: ExportFormat) => {
    setLoadingFormat(format);
    try {
      const { url } = await onExport(format);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setLastFailedFormat(format);
      setErrorOpen(true);
    } finally {
      setLoadingFormat(null);
    }
  };

  return (
    <>
      <div className="flex gap-1.5 flex-wrap">
        {formats.map(format => (
          <Button key={format} variant="outline" size="sm" disabled={!!loadingFormat} onClick={() => runExport(format)}>
            {loadingFormat === format ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (labels?.[format] || DEFAULT_LABELS[format])}
          </Button>
        ))}
      </div>

      <AlertDialog open={errorOpen} onOpenChange={setErrorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unable to Generate Report</AlertDialogTitle>
            <AlertDialogDescription>
              We couldn't generate your requested file at the moment. Please try again in a few moments. If the problem continues, contact system support.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => navigate(supportRoute)}>Contact Support</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (lastFailedFormat) runExport(lastFailedFormat); }}>Retry Download</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
