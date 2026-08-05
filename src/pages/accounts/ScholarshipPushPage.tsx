import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileSpreadsheet, Download, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft, GraduationCap, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  downloadScholarshipTemplate, validateScholarshipImport, submitScholarshipBatch, executeScholarshipPush,
} from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import { FadeIn } from '@/components/PageTransition';
import BackButton from '@/components/BackButton';

type Step = 1 | 2 | 3 | 4;

interface ValidatedItem {
  studentId: string; studentName?: string; studentEmail?: string; amount: number; remark?: string;
  status: 'Valid' | 'Invalid' | 'Duplicate' | 'Error'; validationErrors: string[];
}

// Scholarship Push — 3-step flow (Upload+Validate -> Review -> Push), modeled visually on
// FeeWizardPage.tsx's stepper but simplified: direct upload-and-credit, no Maker/Checker/Approver
// chain, since the spec describes a direct flow, not a multi-stage one. Lives under Accounts
// Office (same as Fee Push) — Accounts Office is who pushes scholarships to students.
export default function ScholarshipPushPage() {
  const [step, setStep] = useState<Step>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ summary: any; items: ValidatedItem[] } | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [batch, setBatch] = useState<any>(null);

  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ pushedCount: number; batchNumber: string; skippedReasons: string[] } | null>(null);
  const [pushError, setPushError] = useState('');

  const reset = () => {
    setStep(1); setSelectedFile(null); setLabel(''); setValidationResult(null);
    setBatch(null); setPushResult(null); setPushError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleValidate = async () => {
    if (!selectedFile) { toast.error('Please select an Excel (.xlsx) or CSV file.'); return; }
    setValidating(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const res = await validateScholarshipImport(formData);
      setValidationResult(res);
      setStep(2);
      toast.success('File validation complete.');
    } catch (e: any) {
      toast.error(e.message || 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const handleCreateBatch = async () => {
    if (!validationResult) return;
    setSubmitting(true);
    try {
      const res = await submitScholarshipBatch({ label: label || undefined, items: validationResult.items });
      setBatch(res.batch);
      setStep(3);
    } catch (e: any) {
      toast.error(e.message || 'Failed to create batch');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePush = async () => {
    if (!batch) return;
    setPushing(true);
    setPushError('');
    try {
      const res = await executeScholarshipPush(batch.id);
      setPushResult(res);
      setStep(4);
      toast.success(res.message);
    } catch (e: any) {
      setPushError(e.message || 'Scholarship push failed');
    } finally {
      setPushing(false);
    }
  };

  const summary = validationResult?.summary;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-3xl">
      <FadeIn>
        <BackButton fallback="/accounts" />
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Scholarship Push</h1>
            <p className="text-xs text-muted-foreground">Upload an Excel/CSV file to credit scholarships directly to student wallets.</p>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="flex items-center gap-2 mb-6">
          {(['Upload', 'Review', 'Push', 'Completed'] as const).map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${step > i + 1 ? 'bg-primary text-primary-foreground' : step === i + 1 ? 'bg-primary/15 text-primary ring-2 ring-primary/30' : 'bg-accent text-muted-foreground'}`}>
                {step > i + 1 ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:inline ${step === i + 1 ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
              {i < 3 && <div className={`h-px flex-1 ${step > i + 1 ? 'bg-primary' : 'bg-border'}`} />}
            </div>
          ))}
        </div>
      </FadeIn>

      {step === 1 && (
        <FadeIn delay={0.1}>
          <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
            <div>
              <Label htmlFor="scholarship-label" className="text-xs">Batch Label (optional)</Label>
              <Input id="scholarship-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Fall 2026 Merit Scholarships" className="mt-1.5" />
            </div>

            <button
              type="button" onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border/70 rounded-xl p-8 text-center hover:border-primary/40 transition-colors"
            >
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2.5" />
              <p className="text-sm font-medium text-foreground">{selectedFile ? selectedFile.name : 'Click to select an .xlsx or .csv file'}</p>
              <p className="text-xs text-muted-foreground mt-1">Columns: Student ID, Student Name, Email, Amount, Remark</p>
            </button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={e => setSelectedFile(e.target.files?.[0] || null)} />

            <div className="flex items-center justify-between gap-3 pt-1">
              <Button type="button" variant="outline" size="sm" onClick={() => downloadScholarshipTemplate().catch(() => toast.error('Template download failed'))}>
                <Download className="w-4 h-4 mr-1.5" /> Download Template
              </Button>
              <Button type="button" onClick={handleValidate} disabled={!selectedFile || validating}>
                {validating ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 mr-1.5" />}
                Validate File
              </Button>
            </div>
          </div>
        </FadeIn>
      )}

      {step === 2 && validationResult && summary && (
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'Total Rows', value: summary.totalRows },
              { label: 'Valid', value: summary.validRows },
              { label: 'Invalid', value: summary.invalidRows },
              { label: 'Total Amount', value: formatCurrency(summary.totalAmount) },
            ].map(s => (
              <div key={s.label} className="rounded-2xl border border-border/60 bg-card p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-bold text-foreground tabular mt-0.5">{s.value}</p>
              </div>
            ))}
          </div>

          {summary.warnings?.length > 0 && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 mb-5 max-h-40 overflow-y-auto space-y-1.5">
              {summary.warnings.map((w: string, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-border/60 bg-card divide-y divide-border/60 max-h-96 overflow-y-auto mb-5">
            {validationResult.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{it.studentName || it.studentId}</p>
                  <p className="text-xs text-muted-foreground truncate">{it.studentId} · {it.studentEmail || '—'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold tabular text-foreground">{formatCurrency(it.amount)}</span>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${it.status === 'Valid' ? 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]' : 'bg-destructive/10 text-destructive'}`}>
                    {it.status}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
            <Button type="button" onClick={handleCreateBatch} disabled={submitting || summary.validRows === 0}>
              {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
              Continue <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </div>
        </FadeIn>
      )}

      {step === 3 && batch && (
        <FadeIn delay={0.1}>
          <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
            <p className="text-sm text-foreground font-semibold">Ready to push {batch.validRows} scholarship credit(s) totaling {formatCurrency(batch.totalAmount)}.</p>
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>Each matched student's Campus Wallet balance will be credited immediately.</li>
              <li>A transaction record and audit log entry will be created for every credit.</li>
              <li>Every credited student receives an in-system notification and an email.</li>
              <li>Rows that fail to match a student are skipped and reported, without blocking the rest of the batch.</li>
            </ul>
            {pushError && (
              <div className="rounded-xl bg-destructive/10 text-destructive text-sm px-3 py-2.5">{pushError}</div>
            )}
            <div className="flex items-center justify-between pt-1">
              <Button type="button" variant="outline" onClick={() => setStep(2)}><ArrowLeft className="w-4 h-4 mr-1.5" /> Back</Button>
              <Button type="button" onClick={handlePush} disabled={pushing}>
                {pushing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <GraduationCap className="w-4 h-4 mr-1.5" />}
                Execute Scholarship Push
              </Button>
            </div>
          </div>
        </FadeIn>
      )}

      {step === 4 && pushResult && (
        <FadeIn delay={0.1}>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="rounded-2xl border border-border/60 bg-card p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-[hsl(var(--chart-3))]/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7 text-[hsl(var(--chart-3))]" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-1">Scholarship Push Complete</h2>
            <p className="text-sm text-muted-foreground mb-5">{pushResult.pushedCount} student(s) credited under batch {pushResult.batchNumber}.</p>

            {pushResult.skippedReasons.length > 0 && (
              <div className="rounded-xl bg-destructive/5 text-left text-xs text-destructive p-3 mb-5 space-y-1 max-h-32 overflow-y-auto">
                {pushResult.skippedReasons.map((r, i) => <p key={i}>{r}</p>)}
              </div>
            )}

            <Button type="button" onClick={reset}><RefreshCw className="w-4 h-4 mr-1.5" /> Push Another Batch</Button>
          </motion.div>
        </FadeIn>
      )}
    </div>
  );
}
