import { useState, useEffect } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft,
  ShieldCheck, Send, RefreshCw, FileText, Download, Building2, User, Calendar, Edit3, Trash2, Check, X, CreditCard
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  downloadFeeImportTemplate,
  validateFeeImport,
  submitFeeBatch,
  updateFeeBatchItem,
  processFeeBatchApproval,
  executeFeePushBatch,
  exportAdvisingFees
} from '@/lib/api';

const DEPARTMENTS = [
  'Computer Science', 'EEE', 'BBA', 'Economics', 'English', 'Pharmacy', 'Law', 'Architecture', 'Civil Engineering', 'Social Relations'
];

const PROGRAMS = ['Undergraduate', 'Postgraduate'];
const SEMESTERS = ['Spring', 'Summer', 'Fall'];
const ACADEMIC_YEARS = ['2026', '2027', '2028'];

export default function FeeWizardPage() {
  // Wizard Step: 1 = Import, 2 = Validate, 3 = Review, 4 = Approve, 5 = Push, 6 = Completed
  const [currentStep, setCurrentStep] = useState(1);

  // Metadata
  const [department, setDepartment] = useState('Computer Science');
  const [program, setProgram] = useState('Undergraduate');
  const [semester, setSemester] = useState('Spring');
  const [academicYear, setAcademicYear] = useState('2026');
  const [autoFeeLabel, setAutoFeeLabel] = useState('Spring 2026 Semester Fee');

  // File & Validation state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<any>(null);

  // Batch & Review state
  const [batchData, setBatchData] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ amount: string; feeLabel: string; dueDate: string; lateFee: string; waiverAdjustment: string; remark: string }>({
    amount: '', feeLabel: '', dueDate: '', lateFee: '0', waiverAdjustment: '0', remark: ''
  });

  // Approval state
  const [userRole, setUserRole] = useState<'Maker' | 'Checker' | 'Approver'>('Maker');
  const [rejectionReason, setRejectionReason] = useState('');

  // Push state
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<any>(null);

  // Auto generate fee label whenever semester or academic year changes
  useEffect(() => {
    setAutoFeeLabel(`${semester} ${academicYear} Semester Fee`);
  }, [semester, academicYear]);

  // Phase 1 export handlers
  const handleExportAdvising = async (format: 'excel' | 'csv' | 'pdf') => {
    try {
      toast.info(`Generating Phase 1 Advising Fee Report (${format.toUpperCase()})...`);
      await exportAdvisingFees(format);
      toast.success(`Advising export downloaded successfully!`);
    } catch (e: any) {
      toast.error(e.message || 'Export failed');
    }
  };

  // Step 1 -> Step 2: Validate File
  const handleValidateFile = async () => {
    if (!selectedFile) {
      toast.error('Please select an Excel (.xlsx) or CSV file to import.');
      return;
    }

    setValidating(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('department', department);
      formData.append('program', program);
      formData.append('semester', semester);
      formData.append('academicYear', academicYear);

      const res = await validateFeeImport(formData);
      setValidationResult(res);
      setCurrentStep(2);
      toast.success('File validation complete.');
    } catch (e: any) {
      toast.error(e.message || 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  // Step 2 -> Step 3: Create Batch & Go to Review
  const handleCreateBatch = async () => {
    if (!validationResult || !validationResult.items) return;
    setSubmitting(true);
    try {
      const res = await submitFeeBatch({
        department,
        program,
        semester,
        academicYear,
        items: validationResult.items,
      });
      setBatchData(res.batch);
      setCurrentStep(3);
      toast.success('Fee batch created. Proceeding to Review step.');
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit batch');
    } finally {
      setSubmitting(false);
    }
  };

  // Inline Item Edit on Step 3 Review Page
  const startEditingItem = (item: any) => {
    setEditingItemId(item.id);
    setEditForm({
      amount: String(item.finalAmount || item.tuition || 0),
      feeLabel: item.feeLabel || autoFeeLabel,
      dueDate: item.dueDate || '2026-08-30',
      lateFee: String(item.lateFee || 0),
      waiverAdjustment: String(item.waiverAdjustment || 0),
      remark: item.remark || '',
    });
  };

  const saveEditedItem = async (itemId: string) => {
    try {
      const res = await updateFeeBatchItem({
        itemId,
        amount: parseFloat(editForm.amount) || 0,
        feeLabel: editForm.feeLabel,
        dueDate: editForm.dueDate,
        lateFee: parseFloat(editForm.lateFee) || 0,
        waiverAdjustment: parseFloat(editForm.waiverAdjustment) || 0,
        remark: editForm.remark,
      });

      if (batchData && batchData.items) {
        setBatchData({
          ...batchData,
          items: batchData.items.map((it: any) => (it.id === itemId ? res.item : it)),
        });
      }
      setEditingItemId(null);
      toast.success('Item updated successfully.');
    } catch (e: any) {
      toast.error(e.message || 'Update failed');
    }
  };

  // Step 3 -> Step 4: Proceed to Fee Push
  const handleReviewToPush = () => {
    if (!batchData) return;
    setCurrentStep(4);
    toast.success('Proceeding to Fee Push.');
  };

  // Step 4: Execute Fee Push
  const [pushError, setPushError] = useState<string | null>(null);

  const handleExecutePush = async () => {
    if (!batchData) return;
    setPushing(true);
    setPushError(null);
    try {
      const res = await executeFeePushBatch(batchData.id);
      setPushResult(res);
      setCurrentStep(5);
      toast.success(res.message || 'Fee push execution completed!');
    } catch (e: any) {
      const errMsg = e.message || 'Push failed';
      setPushError(errMsg);
      toast.error(errMsg);
    } finally {
      setPushing(false);
    }
  };

  const wizardSteps = [
    { num: 1, label: 'Import Excel' },
    { num: 2, label: 'Validate' },
    { num: 3, label: 'Review' },
    { num: 4, label: 'Push Fees' },
    { num: 5, label: 'Completed' },
  ];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-6xl">
      {/* Header */}
      <div className="mb-8 text-center sm:text-left">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Semester Fee Management</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Automated File Validation & Direct Fee Push</p>
      </div>

      {/* Step Wizard Progress Bar */}
      <div className="glass-strong rounded-2xl p-4 sm:p-6 mb-8 shadow-xl">
        <div className="flex items-center justify-between relative">
          {/* Connector line */}
          <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-border/60 -translate-y-1/2 z-0" />
          <div
            className="absolute top-1/2 left-4 h-0.5 bg-primary transition-all duration-500 -translate-y-1/2 z-0"
            style={{ width: `${((currentStep - 1) / (wizardSteps.length - 1)) * 100}%` }}
          />

          {wizardSteps.map((step) => {
            const isDone = currentStep > step.num;
            const isCurrent = currentStep === step.num;

            return (
              <div key={step.num} className="relative z-10 flex flex-col items-center gap-2">
                <div
                  className={`w-10 h-10 rounded-xl font-bold text-xs flex items-center justify-center transition-all duration-300 shadow-md ${
                    isDone
                      ? 'bg-primary text-primary-foreground shadow-primary/20 scale-105'
                      : isCurrent
                      ? 'bg-gradient-to-br from-primary to-primary/80 text-primary-foreground ring-4 ring-primary/20 scale-110'
                      : 'bg-card text-muted-foreground border border-border'
                  }`}
                >
                  {isDone ? <CheckCircle2 className="w-5 h-5" /> : step.num}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${isCurrent ? 'text-foreground font-bold' : isDone ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── STEP 1: IMPORT SEMESTER FEES ─── */}
      {currentStep === 1 && (
        <div className="max-w-4xl mx-auto glass-strong rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div className="pb-4 border-b border-border/50">
            <h2 className="text-lg font-bold flex items-center gap-2"><Upload className="w-5 h-5 text-primary" /> Step 1: Metadata & File Upload</h2>
          </div>

          {/* Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Department *</Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="mt-1.5 bg-accent/40"><SelectValue /></SelectTrigger>
                <SelectContent className="glass-strong">
                  {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Program *</Label>
              <div className="grid grid-cols-2 gap-2 mt-1.5">
                {PROGRAMS.map(p => (
                  <button key={p} type="button" onClick={() => setProgram(p)}
                    className={`p-2.5 rounded-xl border text-xs font-semibold transition-all ${program === p ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground'}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Semester *</Label>
              <Select value={semester} onValueChange={setSemester}>
                <SelectTrigger className="mt-1.5 bg-accent/40"><SelectValue /></SelectTrigger>
                <SelectContent className="glass-strong">
                  {SEMESTERS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-semibold text-muted-foreground">Academic Year *</Label>
              <Select value={academicYear} onValueChange={setAcademicYear}>
                <SelectTrigger className="mt-1.5 bg-accent/40"><SelectValue /></SelectTrigger>
                <SelectContent className="glass-strong">
                  {ACADEMIC_YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* File Upload Zone */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">Upload Excel / CSV File *</Label>
            <div className="mt-2 border-2 border-dashed border-border/80 hover:border-primary/60 rounded-2xl p-8 text-center bg-accent/20 transition-all cursor-pointer relative">
              <input
                type="file"
                accept=".xlsx, .csv"
                onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <FileSpreadsheet className="w-12 h-12 mx-auto text-primary/80 mb-3" />
              {selectedFile ? (
                <div>
                  <p className="font-semibold text-foreground text-sm">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{(selectedFile.size / 1024).toFixed(1)} KB — Ready for validation</p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-foreground text-sm">Drop your student fee file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports Excel (.xlsx) and CSV files</p>
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <button onClick={downloadFeeImportTemplate} type="button" className="text-primary hover:underline font-semibold flex items-center gap-1">
                <Download className="w-3.5 h-3.5" /> Download Standard Template (.xlsx)
              </button>
              <div className="flex items-center gap-2">
                <button onClick={() => handleExportAdvising('excel')} type="button" className="text-xs text-muted-foreground hover:text-foreground">Excel</button>
                <span>·</span>
                <button onClick={() => handleExportAdvising('csv')} type="button" className="text-xs text-muted-foreground hover:text-foreground">CSV</button>
                <span>·</span>
                <button onClick={() => handleExportAdvising('pdf')} type="button" className="text-xs text-muted-foreground hover:text-foreground">PDF</button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end pt-4 border-t border-border/50">
            <Button onClick={handleValidateFile} disabled={validating || !selectedFile} className="h-11 px-8 font-semibold gap-2">
              {validating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {validating ? 'Validating File...' : 'Validate File'}
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 2: VALIDATE FILE RESULTS ─── */}
      {currentStep === 2 && validationResult && (
        <div className="glass-strong rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-border/50">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-400" /> Step 2: Automated Validation Results</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Department: {department} · Program: {program} · Semester: {semester} {academicYear}</p>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-accent/40 p-4 rounded-xl border border-border/50">
              <p className="text-xs text-muted-foreground font-semibold">Total Rows</p>
              <p className="text-2xl font-black text-foreground mt-1">{validationResult.summary.totalRows}</p>
            </div>
            <div className="bg-emerald-500/10 p-4 rounded-xl border border-emerald-500/20">
              <p className="text-xs text-emerald-400 font-semibold">Valid Rows</p>
              <p className="text-2xl font-black text-emerald-400 mt-1">{validationResult.summary.validRows}</p>
            </div>
            <div className="bg-destructive/10 p-4 rounded-xl border border-destructive/20">
              <p className="text-xs text-destructive font-semibold">Error Rows</p>
              <p className="text-2xl font-black text-destructive mt-1">{validationResult.summary.errorRows || 0}</p>
            </div>
            <div className="bg-primary/10 p-4 rounded-xl border border-primary/20">
              <p className="text-xs text-primary font-semibold">Total Amount</p>
              <p className="text-2xl font-black text-primary mt-1">৳{(validationResult.summary.totalAmount || 0).toLocaleString()}</p>
            </div>
          </div>

          {/* Validation Warnings/Errors */}
          {validationResult.errors && validationResult.errors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/30 p-4 rounded-xl space-y-2">
              <h4 className="font-bold text-xs text-destructive uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> Validation Issues Found ({validationResult.errors.length})
              </h4>
              <div className="max-h-40 overflow-y-auto space-y-1 text-xs text-destructive font-mono">
                {validationResult.errors.map((err: any, idx: number) => (
                  <p key={idx}>Row {err.row}: {err.error} (Student: {err.studentId || 'N/A'})</p>
                ))}
              </div>
            </div>
          )}

          {/* Items Preview Table */}
          <div className="border border-border/60 rounded-xl overflow-hidden">
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-accent/60 text-muted-foreground uppercase tracking-wider font-semibold sticky top-0">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">Student ID</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Tuition Fee</th>
                    <th className="p-3">Lab Fee</th>
                    <th className="p-3">Total Fee</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {validationResult.items?.map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-accent/20 transition-colors">
                      <td className="p-3 text-muted-foreground">{idx + 1}</td>
                      <td className="p-3 font-mono font-semibold text-foreground">{item.studentId}</td>
                      <td className="p-3 text-foreground">{item.studentName}</td>
                      <td className="p-3 font-mono">৳{(item.tuition || 0).toLocaleString()}</td>
                      <td className="p-3 font-mono text-muted-foreground">৳{(item.lab || 0).toLocaleString()}</td>
                      <td className="p-3 font-mono font-bold text-primary">৳{(item.total || 0).toLocaleString()}</td>
                      <td className="p-3">
                        {item.valid ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-semibold text-[10px]">Valid</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-destructive/20 text-destructive font-semibold text-[10px]">{item.error || 'Invalid'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border/50">
            <Button variant="ghost" onClick={() => setCurrentStep(1)}>Back</Button>
            <Button onClick={handleCreateBatch} disabled={submitting || validationResult.summary.validRows === 0} className="h-11 px-8 font-semibold gap-2">
              {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {submitting ? 'Creating Batch...' : 'Proceed to Review'}
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: REVIEW PAGE ─── */}
      {currentStep === 3 && batchData && (
        <div className="glass-strong rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-border/50">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2"><Edit3 className="w-5 h-5 text-primary" /> Step 3: Review & Adjust Fee Batch</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Batch Code: <span className="font-mono text-foreground font-semibold">{batchData.batchNumber}</span> · Total Students: {batchData.items?.length || 0}</p>
            </div>
          </div>

          {/* Data Table */}
          <div className="border border-border/60 rounded-xl overflow-hidden">
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-accent/60 text-muted-foreground uppercase tracking-wider font-semibold sticky top-0">
                  <tr>
                    <th className="p-3">Student ID & Name</th>
                    <th className="p-3">Fee Label</th>
                    <th className="p-3">Amount (৳)</th>
                    <th className="p-3">Waiver (৳)</th>
                    <th className="p-3">Final Amount</th>
                    <th className="p-3">Due Date</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {batchData.items.map((item: any) => (
                    <tr key={item.id} className="hover:bg-accent/20 transition-colors">
                      <td className="p-3">
                        <p className="font-mono font-bold text-foreground">{item.studentId}</p>
                        <p className="text-[11px] text-muted-foreground">{item.studentName}</p>
                      </td>
                      <td className="p-3 text-muted-foreground font-medium">{item.feeLabel || autoFeeLabel}</td>
                      <td className="p-3 font-mono">৳{(item.amount || 0).toLocaleString()}</td>
                      <td className="p-3 font-mono text-emerald-400">৳{(item.waiverAdjustment || 0).toLocaleString()}</td>
                      <td className="p-3 font-mono font-bold text-primary">৳{(item.finalAmount || 0).toLocaleString()}</td>
                      <td className="p-3 text-muted-foreground">{item.dueDate || '2026-08-30'}</td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => startEditingItem(item)} className="h-8 px-2 text-primary hover:bg-primary/10">
                          <Edit3 className="w-3.5 h-3.5 mr-1" /> Adjust
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Inline Edit Drawer */}
          {editingItemId && (
            <div className="bg-accent/40 p-5 rounded-xl border border-primary/30 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <h4 className="font-bold text-xs text-primary uppercase tracking-wider flex items-center gap-1.5"><Edit3 className="w-4 h-4" /> Edit Student Fee Adjustment</h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Fee Amount (৳)</Label>
                  <Input value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} className="mt-1 h-9 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Fee Label</Label>
                  <Input value={editForm.feeLabel} onChange={e => setEditForm({ ...editForm, feeLabel: e.target.value })} className="mt-1 h-9 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Waiver Adj. (৳)</Label>
                  <Input value={editForm.waiverAdjustment} onChange={e => setEditForm({ ...editForm, waiverAdjustment: e.target.value })} className="mt-1 h-9 text-xs font-mono" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Due Date</Label>
                  <Input type="date" value={editForm.dueDate} onChange={e => setEditForm({ ...editForm, dueDate: e.target.value })} className="mt-1 h-9 text-xs" />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button size="sm" variant="ghost" onClick={() => setEditingItemId(null)}>Cancel</Button>
                <Button size="sm" onClick={() => saveEditedItem(editingItemId)}>Save Adjustments</Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-border/50">
            <Button variant="ghost" onClick={() => setCurrentStep(2)}>Back</Button>
            <Button onClick={handleReviewToPush} className="h-11 px-8 font-semibold gap-2">
              Proceed to Fee Push <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── STEP 4: FEE PUSH EXECUTION ─── */}
      {currentStep === 4 && batchData && (
        <div className="glass-strong rounded-2xl p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-border/50">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2"><Send className="w-5 h-5 text-primary" /> Step 4: Execute Fee Push to Student Wallet & Ledger</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Automated creation of Invoices, Ledger Entries, Dues & Gateway Sessions</p>
            </div>
          </div>

          <div className="bg-primary/10 border border-primary/30 p-6 rounded-xl space-y-4">
            <h4 className="font-bold text-sm text-primary flex items-center gap-2"><CheckCircle2 className="w-4.5 h-4.5" /> Ready for Fee Push Execution</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-muted-foreground">
              {['Create Formal Fee Invoices with Invoice Numbers', 'Create Double-Entry Ledger Debit Entries', 'Publish Semester Fee Due to Student App Cards', 'Initialize Locked Payment Gateway Sessions', 'Generate Accounts Audit Logs', 'Dispatch Student Email & In-App Notifications'].map((op, i) => (
                <div key={i} className="flex items-center gap-2 bg-accent/40 p-2.5 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{op}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border/50">
            <Button variant="ghost" onClick={() => setCurrentStep(3)}>Back</Button>
            <Button onClick={handleExecutePush} disabled={pushing} className="h-12 px-10 text-base font-bold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/25 gap-2">
              {pushing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              {pushing ? 'Pushing Fees to Students...' : 'Execute Fee Push'}
            </Button>
            {pushError && (
              <p className="mt-2 text-sm text-destructive-foreground">{pushError}</p>
            )}
          </div>
        </div>
      )}

      {/* ─── STEP 5: COMPLETED STAGE ─── */}
      {currentStep === 5 && pushResult && (
        <div className="glass-strong rounded-2xl p-8 text-center max-w-2xl mx-auto space-y-6">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto shadow-xl shadow-emerald-500/10">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-foreground">Fee Push Completed Successfully!</h2>
            <p className="text-sm text-muted-foreground mt-2">{pushResult.message}</p>
          </div>

          <div className="bg-accent/30 p-4 rounded-xl border border-border/50 text-left text-xs space-y-2">
            <p className="flex justify-between text-muted-foreground"><span className="font-medium">Pushed Student Count:</span> <strong className="text-foreground">{pushResult.pushedCount}</strong></p>
            <p className="flex justify-between text-muted-foreground"><span className="font-medium">Fee Label:</span> <strong className="text-primary">{autoFeeLabel}</strong></p>
            <p className="flex justify-between text-muted-foreground"><span className="font-medium">Student App Status:</span> <strong className="text-emerald-400">Semester Fee Due Active</strong></p>
          </div>

          <div className="flex items-center justify-center gap-4 pt-4">
            <Button variant="outline" onClick={() => setCurrentStep(1)}>Import Another Batch</Button>
            <Button onClick={() => window.location.href = '/accounts/ledger'} className="gap-2 font-semibold">View Accounts Ledger <ArrowRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
