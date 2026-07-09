'use client';

import { useState, useEffect } from 'react';

interface CountdownTimerProps {
  targetDate: Date | string;
  label?: string;
  onExpire?: () => void;
  className?: string;
  compact?: boolean;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatCountdown(ms: number, compact: boolean): string {
  if (ms <= 0) return compact ? '00:00' : 'Jetzt!';

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (compact) {
    if (days > 0) return `${days}T ${pad(hours)}:${pad(minutes)}`;
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  if (days > 0) return `${days}T ${pad(hours)}Std ${pad(minutes)}Min`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export default function CountdownTimer({
  targetDate,
  label,
  onExpire,
  className = '',
  compact = false,
}: CountdownTimerProps) {
  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const [remaining, setRemaining] = useState(() => target.getTime() - Date.now());
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (target.getTime() - Date.now() <= 0) {
      setExpired(true);
      onExpire?.();
      return;
    }

    const tick = setInterval(() => {
      const diff = target.getTime() - Date.now();
      setRemaining(diff);
      if (diff <= 0) {
        clearInterval(tick);
        setExpired(true);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [target.getTime()]);

  const isUrgent = remaining > 0 && remaining < 5 * 60 * 1000;
  const display = formatCountdown(remaining, compact);

  return (
    <span
      className={`font-mono tabular-nums ${
        expired
          ? 'text-red-400 animate-pulse'
          : isUrgent
          ? 'text-orange-400'
          : 'text-slate-300'
      } ${className}`}
      title={label}
    >
      {expired ? (compact ? '!' : 'Fällig!') : display}
    </span>
  );
}
