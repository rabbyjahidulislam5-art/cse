import { motion } from 'framer-motion';
import { XCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorScreenProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  onBack?: () => void;
  retryLabel?: string;
}

export default function ErrorScreen({ title = 'Something went wrong', message, onRetry, onBack, retryLabel = 'Try Again' }: ErrorScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] px-4 py-12">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mb-6"
      >
        <XCircle className="w-10 h-10 text-destructive" />
      </motion.div>
      <motion.h2
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-xl font-bold text-foreground mb-2 text-center"
      >
        {title}
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-muted-foreground text-center max-w-sm mb-8"
      >
        {message}
      </motion.p>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex gap-3"
      >
        {onBack && <Button variant="outline" onClick={onBack}>Go Back</Button>}
        {onRetry && (
          <Button onClick={onRetry}>
            <RotateCcw className="w-4 h-4 mr-2" /> {retryLabel}
          </Button>
        )}
      </motion.div>
    </div>
  );
}
