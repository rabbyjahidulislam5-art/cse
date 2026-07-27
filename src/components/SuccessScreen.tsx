import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReactNode } from 'react';

interface SuccessScreenProps {
  title: string;
  subtitle?: string;
  details?: { label: string; value: string }[];
  children?: ReactNode;
  actions?: { label: string; onClick: () => void; variant?: 'default' | 'outline' }[];
}

export default function SuccessScreen({ title, subtitle, details, children, actions }: SuccessScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 py-12">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
        className="relative mb-8"
      >
        <div className="absolute inset-0 rounded-full bg-[hsl(var(--chart-3))]/20 animate-pulse-ring" />
        <div className="w-24 h-24 rounded-full gradient-success flex items-center justify-center relative">
          <motion.div
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 260, damping: 20 }}
          >
            <CheckCircle2 className="w-12 h-12 text-white" strokeWidth={2.5} />
          </motion.div>
        </div>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="text-2xl font-bold text-foreground mb-2 text-center"
      >
        {title}
      </motion.h2>

      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="text-muted-foreground text-center max-w-sm"
        >
          {subtitle}
        </motion.p>
      )}

      {details && details.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="w-full max-w-sm mt-6 rounded-2xl border border-border bg-card p-4 space-y-3"
        >
          {details.map((d, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{d.label}</span>
              <span className="font-medium text-foreground">{d.value}</span>
            </div>
          ))}
        </motion.div>
      )}

      {children}

      {actions && actions.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="flex gap-3 mt-8"
        >
          {actions.map((a, i) => (
            <Button key={i} variant={a.variant || 'default'} onClick={a.onClick} className="min-w-[120px]">
              {a.label}
            </Button>
          ))}
        </motion.div>
      )}
    </div>
  );
}
