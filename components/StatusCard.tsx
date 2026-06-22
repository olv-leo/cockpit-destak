'use client';

import { cn } from '@/lib/cn';
import { type LucideIcon } from 'lucide-react';

interface StatusCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'neutral';
}

const variantStyles = {
  default: { icon: '#40916C', bg: '#D8F3DC', border: '#B7E4C7' },
  success: { icon: '#1B4332', bg: '#D8F3DC', border: '#40916C' },
  warning: { icon: '#C49A00', bg: '#FFFBEB', border: '#FDE68A' },
  danger:  { icon: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  neutral: { icon: '#6B7280', bg: '#F9FAFB', border: '#E5E7EB' },
};

export default function StatusCard({ icon: Icon, label, value, sub, variant = 'default' }: StatusCardProps) {
  const styles = variantStyles[variant];

  return (
    <div className={cn(
      "bg-white rounded-xl p-5 flex items-start gap-4 shadow-sm border transition-shadow hover:shadow-md fade-in-up"
    )} style={{ borderColor: styles.border }}>
      <div className="rounded-xl p-2.5 flex-shrink-0" style={{ background: styles.bg }}>
        <Icon className="w-5 h-5" style={{ color: styles.icon }} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>{label}</p>
        <p className="text-xl font-bold mt-0.5 truncate" style={{ color: '#1A2E23' }}>{value}</p>
        {sub && <p className="text-xs mt-0.5 truncate" style={{ color: '#6B7280' }}>{sub}</p>}
      </div>
    </div>
  );
}
