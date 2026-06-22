'use client';

import { useEffect, useRef } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';
import { useState } from 'react';

export interface LogLine {
  ts: string;
  msg: string;
  level: 'info' | 'success' | 'error' | 'warn';
}

interface LogViewerProps {
  logs: LogLine[];
  isRunning: boolean;
}

const levelColors: Record<LogLine['level'], string> = {
  info:    '#74C69D',
  success: '#95D5B2',
  error:   '#FC8181',
  warn:    '#F6C90E',
};

const levelPrefixes: Record<LogLine['level'], string> = {
  info:    'INFO ',
  success: 'OK   ',
  error:   'ERR  ',
  warn:    'WARN ',
};

export default function LogViewer({ logs, isRunning }: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  function copyLogs() {
    const text = logs.map(l => `[${l.ts}] ${levelPrefixes[l.level]}${l.msg}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-xl overflow-hidden border shadow-sm" style={{ borderColor: '#2D6A4F' }}>
      {/* Header do terminal */}
      <div className="flex items-center justify-between px-4 py-3"
        style={{ background: '#0d1f14', borderBottom: '1px solid #1B4332' }}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: '#FC8181' }} />
            <span className="w-3 h-3 rounded-full" style={{ background: '#F6C90E' }} />
            <span className="w-3 h-3 rounded-full" style={{ background: '#68D391' }} />
          </div>
          <Terminal className="w-3.5 h-3.5 ml-2" style={{ color: '#40916C' }} />
          <span className="text-xs font-mono" style={{ color: '#40916C' }}>logs de execução</span>
        </div>
        <button onClick={copyLogs}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors"
          style={{ color: '#74C69D', background: 'rgba(64,145,108,0.15)' }}
          title="Copiar logs">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Área de logs */}
      <div ref={containerRef} className="log-terminal h-72 overflow-y-auto p-4 font-mono text-xs"
        style={{ background: '#0a1a10' }}>
        {logs.length === 0 ? (
          <p style={{ color: '#2D6A4F' }} className="select-none">
            {isRunning ? '▶ Iniciando...' : '$ aguardando execução...'}
          </p>
        ) : (
          <>
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3 mb-0.5">
                <span className="flex-shrink-0 select-none" style={{ color: '#1B4332' }}>
                  {log.ts}
                </span>
                <span className="flex-shrink-0 select-none font-bold" style={{ color: levelColors[log.level] }}>
                  {levelPrefixes[log.level]}
                </span>
                <span style={{ color: levelColors[log.level] }}>{log.msg}</span>
              </div>
            ))}
            {isRunning && (
              <div className="flex gap-3 mb-0.5">
                <span style={{ color: '#1B4332' }}>{'  '.repeat(0)}</span>
                <span className="cursor-blink" style={{ color: '#40916C' }}>&nbsp;</span>
              </div>
            )}
          </>
        )}
        <div />
      </div>
    </div>
  );
}
