import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Search, Filter, GraduationCap, Users, RefreshCw, Loader2,
  Calendar, Building2, BookOpen, Layers, CheckCircle2, Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { searchPushRecords, type PushRecordItem } from '@/lib/api';
import { formatCurrency } from '@/lib/mock-data';
import StatusBadge from '@/components/StatusBadge';
import { FadeIn } from '@/components/PageTransition';
import { toast } from 'sonner';

const DEPARTMENTS = [
  'All Departments',
  'Computer Science',
  'Business Administration',
  'Electrical Engineering',
  'Civil Engineering',
  'Law',
  'English',
  'Pharmacy',
];

const SEMESTERS = ['All Semesters', 'Spring', 'Summer', 'Fall'];

export default function PushRecordsPage() {
  const navigate = useNavigate();

  // Filter state
  const [category, setCategory] = useState<'fee' | 'scholarship'>('fee');
  const [department, setDepartment] = useState('All Departments');
  const [program, setProgram] = useState<'All' | 'Undergraduate' | 'Postgraduate'>('All');
  const [semester, setSemester] = useState('All Semesters');
  const [academicYear, setAcademicYear] = useState('2026');
  const [searchQuery, setSearchQuery] = useState('');

  // Data & loading state
  const [records, setRecords] = useState<PushRecordItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const res = await searchPushRecords({
        category,
        department: department === 'All Departments' ? undefined : department,
        program: program === 'All' ? undefined : program,
        semester: semester === 'All Semesters' ? undefined : semester,
        academicYear: academicYear.trim() || undefined,
        search: searchQuery.trim() || undefined,
      });
      setRecords(res.records || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to fetch push records');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [category, department, program, semester, academicYear]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRecords();
  };

  const totalAmount = records.reduce((sum, r) => sum + (r.amount || 0), 0);

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6 max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-xl hover:bg-accent transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">Push Records & Allocation Search</h1>
          <p className="text-xs text-muted-foreground">
            Search and filter fee pushes and scholarship allocations across departments, semesters, and programs.
          </p>
        </div>
      </div>

      <FadeIn>
        {/* Step 1 Style Metadata & Filter Box (Matching Screenshot 2) */}
        <div className="rounded-2xl border border-border/60 bg-card p-5 sm:p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Filter className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Metadata & Search Filters</h2>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={fetchRecords}
              className="text-xs gap-1 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          <form onSubmit={handleSearchSubmit} className="space-y-4">
            {/* View Category Dropdown Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-primary" /> View Category *
                </Label>
                <Select value={category} onValueChange={(v: 'fee' | 'scholarship') => setCategory(v)}>
                  <SelectTrigger className="bg-accent/40 border-border/60 text-sm">
                    <SelectValue placeholder="Select Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fee">See Fee Push</SelectItem>
                    <SelectItem value="scholarship">See Scholarship Push</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Department Dropdown */}
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5" /> Department *
                </Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="bg-accent/40 border-border/60 text-sm">
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Program Selector */}
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5" /> Program *
                </Label>
                <div className="grid grid-cols-3 gap-1 bg-accent/40 p-1 rounded-lg border border-border/60">
                  {(['All', 'Undergraduate', 'Postgraduate'] as const).map((p) => (
                    <button
                      type="button"
                      key={p}
                      onClick={() => setProgram(p)}
                      className={`text-[11px] font-medium py-1.5 px-2 rounded-md transition-all truncate ${
                        program === p
                          ? 'bg-card text-foreground font-semibold shadow-xs border border-border/50'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {p === 'Undergraduate' ? 'Undergrad' : p === 'Postgraduate' ? 'Postgrad' : 'All'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 2: Semester, Year & Student Search */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Semester Dropdown */}
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> Semester *
                </Label>
                <Select value={semester} onValueChange={setSemester}>
                  <SelectTrigger className="bg-accent/40 border-border/60 text-sm">
                    <SelectValue placeholder="Select Semester" />
                  </SelectTrigger>
                  <SelectContent>
                    {SEMESTERS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Academic Year Input */}
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Academic Year *
                </Label>
                <Input
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  placeholder="e.g. 2026"
                  className="bg-accent/40 border-border/60 text-sm"
                />
              </div>

              {/* Student Search */}
              <div>
                <Label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5" /> Search Student
                </Label>
                <div className="relative">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Student ID, Name or Email..."
                    className="bg-accent/40 border-border/60 text-sm pr-9"
                  />
                  <button
                    type="submit"
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-primary transition-colors"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        {/* Stats Summary Tiles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <div className="p-4 rounded-xl border border-border/60 bg-card flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Filtered Records</p>
              <p className="text-xl font-bold text-foreground mt-0.5">{records.length} Student(s)</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <Users className="w-5 h-5" />
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/60 bg-card flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Total Pushed Amount</p>
              <p className="text-xl font-bold text-foreground mt-0.5">{formatCurrency(totalAmount)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary">
              <span className="font-bold text-lg leading-none">৳</span>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/60 bg-card flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Push Type Active</p>
              <p className="text-base font-semibold text-foreground mt-0.5">
                {category === 'fee' ? 'Fee Push Records' : 'Scholarship Allocation'}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-[hsl(var(--chart-4))]/10 flex items-center justify-center text-[hsl(var(--chart-4))]">
              {category === 'fee' ? <Users className="w-5 h-5" /> : <GraduationCap className="w-5 h-5" />}
            </div>
          </div>
        </div>

        {/* Table / Results List */}
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden mt-6 shadow-sm">
          <div className="p-4 border-b border-border/40 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">
              {category === 'fee' ? 'Fee Push Allocations' : 'Scholarship Pushed Students'} ({records.length})
            </h3>
            {category === 'fee' ? (
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
                Fee Push Records
              </span>
            ) : (
              <span className="text-xs px-2.5 py-1 rounded-full bg-secondary/10 text-secondary font-medium">
                Scholarship Push Records
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3 text-muted-foreground">
                <Search className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">No records found matching filters</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                Try selecting a different department, semester, or academic year, or clear your student search.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-accent/40 border-b border-border/40 text-muted-foreground uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-3 px-4">Student ID</th>
                    <th className="py-3 px-4">Student Name</th>
                    <th className="py-3 px-4">Dept / Program</th>
                    <th className="py-3 px-4">Label / Description</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-right">Push Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 text-foreground">
                  {records.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/20 transition-colors">
                      <td className="py-3 px-4 font-mono font-semibold text-primary">{r.studentId}</td>
                      <td className="py-3 px-4">
                        <div className="font-medium">{r.studentName}</div>
                        <div className="text-[10px] text-muted-foreground">{r.studentEmail}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div>{r.department}</div>
                        <div className="text-[10px] text-muted-foreground">{r.program}</div>
                      </td>
                      <td className="py-3 px-4 font-medium">{r.label}</td>
                      <td className="py-3 px-4 text-right font-bold tabular">{formatCurrency(r.amount)}</td>
                      <td className="py-3 px-4 text-center">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-3 px-4 text-right text-muted-foreground tabular">
                        {new Date(r.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </FadeIn>
    </div>
  );
}
