'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Leaf, LogOut, Play, RefreshCw, Clock, CheckCircle2,
  AlertTriangle, Database, ExternalLink, History, Wifi, WifiOff,
  ChevronDown, ChevronUp, Rocket, Sheet, ShieldCheck, Save,
  ServerCrash, Calculator, Flag, BarChart2, LogIn, type LucideIcon,
} from 'lucide-react';
import { clearAuth, getExpiryInfo } from '@/lib/auth';
import { loadPBISession, clearPBISession, isSessionValid, type PBISession, type DatasetStatus } from '@/lib/pbi-client';
import StatusCard from '@/components/StatusCard';
import LogViewer, { type LogLine } from '@/components/LogViewer';
import { cn } from '@/lib/cn';

interface WorkflowRun {
  id: number;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting';
  conclusion: 'success' | 'failure' | 'cancelled' | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

interface DashboardProps {
  onLogout: () => void;
}

const PIPELINE_STEPS: { label: string; Icon: LucideIcon; startSec: number; endSec: number }[] = [
  { label: 'Iniciando ambiente',        Icon: Rocket,     startSec: 0,   endSec: 15  },
  { label: 'Lendo Google Sheets',       Icon: Sheet,      startSec: 15,  endSec: 75  },
  { label: 'Validando dados',           Icon: ShieldCheck, startSec: 75, endSec: 150 },
  { label: 'Salvando no Sheets',        Icon: Save,       startSec: 150, endSec: 300 },
  { label: 'Salvando no PostgreSQL',    Icon: ServerCrash, startSec: 300, endSec: 420 },
  { label: 'Calculando estoque (FIFO)', Icon: Calculator, startSec: 420, endSec: 510 },
  { label: 'Atualizando Power BI',      Icon: BarChart2,  startSec: 510, endSec: 630 },
  { label: 'Finalizando',               Icon: Flag,       startSec: 630, endSec: 660 },
];

const TOTAL_SECONDS = 660;

function calcProgress(run: WorkflowRun | null): { pct: number; stepIdx: number } {
  if (!run || run.status === 'queued') return { pct: 0, stepIdx: -1 };
  if (run.status === 'completed') {
    return { pct: 100, stepIdx: run.conclusion === 'success' ? PIPELINE_STEPS.length - 1 : -1 };
  }
  const elapsed = (Date.now() - new Date(run.created_at).getTime()) / 1000;
  const pct = Math.min(95, (elapsed / TOTAL_SECONDS) * 100);
  const stepIdx = PIPELINE_STEPS.findIndex(s => elapsed >= s.startSec && elapsed < s.endSec);
  return { pct, stepIdx: stepIdx === -1 ? PIPELINE_STEPS.length - 2 : stepIdx };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'agora mesmo';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function buildLogsFromRun(run: WorkflowRun | null): LogLine[] {
  if (!run) return [];
  const ts = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (run.status === 'queued') return [{ ts: ts(), msg: 'Workflow enfileirado no GitHub Actions...', level: 'info' }];
  if (run.status === 'in_progress') {
    const elapsed = (Date.now() - new Date(run.created_at).getTime()) / 1000;
    const logs: LogLine[] = [{ ts: ts(), msg: 'Workflow iniciado no GitHub Actions', level: 'info' }];
    PIPELINE_STEPS.forEach(s => {
      if (elapsed >= s.startSec) logs.push({ ts: ts(), msg: `${s.label}...`, level: 'info' });
    });
    return logs;
  }
  if (run.status === 'completed' && run.conclusion === 'success') {
    return [
      { ts: ts(), msg: 'Pipeline concluido com sucesso', level: 'success' },
      { ts: ts(), msg: 'Dados validados, Sheets, PostgreSQL e Power BI atualizados.', level: 'success' },
      { ts: ts(), msg: `Log completo: ${run.html_url}`, level: 'info' },
    ];
  }
  if (run.status === 'completed' && run.conclusion === 'failure') {
    return [
      { ts: ts(), msg: 'Workflow falhou. Verifique os logs no GitHub Actions.', level: 'error' },
      { ts: ts(), msg: `Detalhes: ${run.html_url}`, level: 'error' },
    ];
  }
  return [];
}

export default function Dashboard({ onLogout }: DashboardProps) {
  const [runs, setRuns]             = useState<WorkflowRun[]>([]);
  const [triggering, setTriggering] = useState(false);
  const [logs, setLogs]             = useState<LogLine[]>([]);
  const [online, setOnline]         = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [progress, setProgress]     = useState({ pct: 0, stepIdx: -1 });
  const [pbiSession, setPBISession]       = useState<PBISession | null>(null);
  const [pbiError, setPBIError]           = useState<string | null>(null);
  const [dsStatuses, setDsStatuses]       = useState<DatasetStatus[]>([]);
  const [dsLoading, setDsLoading]         = useState(false);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiry = getExpiryInfo();

  const fetchDatasets = useCallback(async () => {
    setDsLoading(true);
    try {
      const r = await fetch('/api/powerbi/datasets');
      if (r.ok) { const d = await r.json(); setDsStatuses(d.datasets); }
    } catch { /* ignore */ }
    setDsLoading(false);
  }, []);

  // Load Power BI session + catch OAuth errors from URL
  useEffect(() => {
    const session = loadPBISession();
    const valid = session && isSessionValid(session) ? session : null;
    setPBISession(valid);
    if (valid?.hasPermission) fetchDatasets();

    const params = new URLSearchParams(window.location.search);
    const err = params.get('pbi_error');
    if (err) {
      setPBIError(decodeURIComponent(err));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [fetchDatasets]);

  const latestRun = runs[0] ?? null;
  const isRunning = latestRun?.status === 'queued' || latestRun?.status === 'in_progress';

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) return;
      setRuns(await res.json());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [isRunning, fetchStatus]);

  useEffect(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (isRunning && latestRun) {
      const tick = () => setProgress(calcProgress(latestRun));
      tick();
      progressTimerRef.current = setInterval(tick, 1000);
    } else {
      setProgress(calcProgress(latestRun));
    }
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, [isRunning, latestRun]);

  useEffect(() => { setLogs(buildLogsFromRun(latestRun)); }, [latestRun, progress]);

  async function handleExecute() {
    if (triggering || isRunning) return;
    setTriggering(true);
    setLogs([{ ts: new Date().toLocaleTimeString('pt-BR'), msg: 'Disparando workflow no GitHub Actions...', level: 'info' }]);
    setProgress({ pct: 0, stepIdx: -1 });
    try {
      const res = await fetch('/api/trigger', { method: 'POST' });
      if (res.ok) {
        await new Promise(r => setTimeout(r, 3000));
        await fetchStatus();
      } else {
        const err = await res.json().catch(() => ({}));
        setLogs([{ ts: new Date().toLocaleTimeString('pt-BR'), msg: (err as { error?: string }).error || 'Erro ao disparar workflow.', level: 'error' }]);
      }
    } catch {
      setLogs([{ ts: new Date().toLocaleTimeString('pt-BR'), msg: 'Erro de conexão.', level: 'error' }]);
    } finally {
      setTriggering(false);
    }
  }

  function handleLogout() { clearAuth(); onLogout(); }

  function handlePBILogout() { clearPBISession(); setPBISession(null); setPBIError(null); }

  const lastSuccess  = runs.find(r => r.status === 'completed' && r.conclusion === 'success');
  const successRuns  = runs.filter(r => r.conclusion === 'success').length;
  const isSuccess    = latestRun?.status === 'completed' && latestRun.conclusion === 'success';
  const isFailure    = latestRun?.status === 'completed' && latestRun.conclusion === 'failure';
  const canExecute   = !!pbiSession && pbiSession.hasPermission && !triggering && !isRunning;
  const pbiConnected = !!pbiSession && isSessionValid(pbiSession);

  return (
    <div className="min-h-screen" style={{ background: '#F8F4ED' }}>
      {/* Navbar */}
      <header className="sticky top-0 z-50 shadow-sm"
        style={{ background: 'linear-gradient(135deg, #1B4332 0%, #2D6A4F 100%)' }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.15)' }}>
              <Leaf className="w-4 h-4 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-none tracking-wide">COCKPIT DESTAK</h1>
              <p className="text-xs leading-none mt-0.5" style={{ color: 'rgba(255,255,255,0.55)' }}>Gestão de Rebanho</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {expiry && (
              <span className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.65)' }}>
                <Clock className="w-3 h-3" />{expiry.daysLeft}d restantes
              </span>
            )}
            {online
              ? <Wifi className="w-4 h-4 hidden sm:block" style={{ color: 'rgba(255,255,255,0.35)' }} />
              : <WifiOff className="w-4 h-4 hidden sm:block" style={{ color: '#FC8181' }} />}
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors hover:bg-white/10"
              style={{ color: 'rgba(255,255,255,0.8)' }}>
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Cards */}
        <div className="grid grid-cols-3 gap-3">
          <StatusCard icon={Clock} label="Última Execução"
            value={lastSuccess ? timeAgo(lastSuccess.created_at) : '—'}
            sub={lastSuccess ? formatDate(lastSuccess.created_at) : 'Nenhuma ainda'}
            variant="default" />
          <StatusCard
            icon={isRunning ? RefreshCw : isSuccess ? CheckCircle2 : isFailure ? AlertTriangle : CheckCircle2}
            label="Status"
            value={isRunning ? 'Executando' : isSuccess ? 'Concluído' : isFailure ? 'Com falha' : 'Aguardando'}
            sub={isRunning ? 'Processando dados...' : latestRun ? timeAgo(latestRun.updated_at) : 'Pronto'}
            variant={isRunning ? 'warning' : isSuccess ? 'success' : isFailure ? 'danger' : 'neutral'} />
          <StatusCard icon={CheckCircle2} label="Execuções OK"
            value={runs.length > 0 ? `${successRuns}/${runs.length}` : '—'}
            sub={runs.length > 0 ? `${successRuns} com sucesso` : 'Sem histórico'}
            variant="default" />
        </div>

        {/* Power BI Connection + Datasets Card */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E5E7EB' }}>
          <div className="px-6 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: '#EFF6FF' }}>
                  <BarChart2 className="w-4.5 h-4.5" style={{ color: '#0078D4' }} />
                </div>
                <div>
                  <p className="font-semibold text-sm" style={{ color: '#1B4332' }}>Power BI</p>
                  {pbiConnected ? (
                    <p className="text-xs" style={{ color: pbiSession!.hasPermission ? '#40916C' : '#DC2626' }}>
                      {pbiSession!.name} · {pbiSession!.datasets.length} dataset{pbiSession!.datasets.length !== 1 ? 's' : ''}
                    </p>
                  ) : (
                    <p className="text-xs" style={{ color: '#9CA3AF' }}>Login necessário para executar</p>
                  )}
                </div>
              </div>

              {pbiConnected ? (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => fetchDatasets()} title="Atualizar status"
                    className="p-1.5 rounded-lg transition-colors hover:bg-gray-100">
                    <RefreshCw className={cn("w-3.5 h-3.5", dsLoading && "spinner")} style={{ color: '#9CA3AF' }} />
                  </button>
                  <button onClick={handlePBILogout}
                    className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-gray-50"
                    style={{ color: '#6B7280', borderColor: '#E5E7EB' }}>
                    Desconectar
                  </button>
                </div>
              ) : (
                <a href="/api/auth/powerbi"
                  className="flex-shrink-0 flex items-center gap-2 text-sm px-4 py-2 rounded-xl font-semibold text-white transition-all hover:shadow-md active:scale-[0.97]"
                  style={{ background: '#0078D4', boxShadow: '0 2px 8px rgba(0,120,212,0.2)' }}>
                  <LogIn className="w-4 h-4" />
                  Conectar
                </a>
              )}
            </div>

            {/* Dataset status list */}
            {pbiConnected && pbiSession!.hasPermission && dsStatuses.length > 0 && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {dsStatuses.map((ds) => {
                  const status  = ds.lastRefresh?.status;
                  const ok      = status === 'Completed';
                  const fail    = status === 'Failed';
                  const running = status === 'Unknown';
                  return (
                    <div key={ds.id} className="flex items-center gap-3 px-3.5 py-3 rounded-xl border"
                      style={{ borderColor: '#F3F4F6', background: '#FAFAFA' }}>
                      <div className="flex-shrink-0">
                        {ok      && <CheckCircle2 className="w-4 h-4" style={{ color: '#40916C' }} />}
                        {fail    && <AlertTriangle className="w-4 h-4" style={{ color: '#DC2626' }} />}
                        {running && <RefreshCw className="w-4 h-4 spinner" style={{ color: '#C49A00' }} />}
                        {!ok && !fail && !running && <Clock className="w-4 h-4" style={{ color: '#D1D5DB' }} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: '#1B4332' }}>{ds.name}</p>
                        <p className="text-xs" style={{ color: '#9CA3AF' }}>
                          {ok      ? timeAgo(ds.lastRefresh!.endTime)
                           : fail  ? 'Falha no refresh'
                           : running ? 'Atualizando...'
                           : status === 'Disabled' ? 'Refresh desabilitado'
                           : ds.lastRefresh?.endTime ? timeAgo(ds.lastRefresh.endTime)
                           : 'Sem histórico de refresh'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Loading */}
            {pbiConnected && pbiSession!.hasPermission && dsStatuses.length === 0 && dsLoading && (
              <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: '#9CA3AF' }}>
                <RefreshCw className="w-3.5 h-3.5 spinner" />
                Carregando datasets...
              </div>
            )}

            {/* OAuth error */}
            {pbiError && (
              <div className="mt-3 flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg"
                style={{ background: '#FEF2F2', color: '#991B1B' }}>
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>Erro ao conectar: {pbiError}</span>
              </div>
            )}

            {/* No permission warning */}
            {pbiConnected && !pbiSession!.hasPermission && (
              <div className="mt-3 flex items-start gap-2 text-xs px-3 py-2.5 rounded-lg"
                style={{ background: '#FFFBEB', color: '#92400E' }}>
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>
                  A conta <strong>{pbiSession!.email}</strong> não tem acesso aos datasets.
                  Verifique se a conta tem permissão no workspace do Power BI.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Painel principal de execução */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#B7E4C7' }}>
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="font-bold text-lg" style={{ color: '#1B4332' }}>Validação de Dados</h2>
                <p className="text-sm mt-0.5" style={{ color: '#6B7280' }}>
                  Valida as planilhas, detecta erros e atualiza Sheets, PostgreSQL e Power BI.
                </p>
              </div>
              <div className="flex-shrink-0 flex flex-col items-end gap-1">
                <button
                  onClick={handleExecute}
                  disabled={!canExecute}
                  title={!pbiConnected ? 'Conecte ao Power BI para executar' : !pbiSession!.hasPermission ? 'Conta sem permissão no dataset' : undefined}
                  className={cn(
                    "flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-white text-sm transition-all duration-200",
                    !canExecute
                      ? "opacity-60 cursor-not-allowed"
                      : "hover:shadow-lg active:scale-[0.97]",
                  )}
                  style={{
                    background: !canExecute
                      ? 'linear-gradient(135deg, #2D6A4F 0%, #40916C 100%)'
                      : 'linear-gradient(135deg, #1B4332 0%, #40916C 100%)',
                    boxShadow: canExecute ? '0 4px 14px rgba(27,67,50,0.3)' : 'none',
                  }}>
                  {triggering || isRunning ? (
                    <><svg className="spinner w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>{triggering ? 'Iniciando...' : 'Executando'}</>
                  ) : (
                    <><Play className="w-4 h-4" fill="currentColor" />Executar</>
                  )}
                </button>
                {!pbiConnected && (
                  <p className="text-xs" style={{ color: '#9CA3AF' }}>Requer login no Power BI</p>
                )}
              </div>
            </div>

            {/* Barra de progresso */}
            {(isRunning || isSuccess || isFailure || triggering) && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: isFailure ? '#DC2626' : '#1B4332' }}>
                    {isFailure ? (
                      <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />Falha na execução</span>
                    ) : isSuccess ? (
                      <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#40916C' }} />Concluído com sucesso</span>
                    ) : progress.stepIdx >= 0 ? (
                      <span className="flex items-center gap-1.5">
                        {(() => { const S = PIPELINE_STEPS[progress.stepIdx]; return <S.Icon className="w-3.5 h-3.5" />; })()}
                        {PIPELINE_STEPS[progress.stepIdx].label}...
                      </span>
                    ) : 'Iniciando...'}
                  </span>
                  <span className="font-bold tabular-nums" style={{ color: isFailure ? '#DC2626' : '#40916C' }}>
                    {Math.round(progress.pct)}%
                  </span>
                </div>

                <div className="relative h-3 rounded-full overflow-hidden" style={{ background: '#E5E7EB' }}>
                  <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ease-linear"
                    style={{
                      width: `${progress.pct}%`,
                      background: isFailure
                        ? 'linear-gradient(90deg, #EF4444, #DC2626)'
                        : isSuccess
                        ? 'linear-gradient(90deg, #1B4332, #40916C)'
                        : 'linear-gradient(90deg, #1B4332, #40916C, #74C69D)',
                      boxShadow: isRunning ? '0 0 8px rgba(64,145,108,0.5)' : 'none',
                    }} />
                  {isRunning && (
                    <div className="absolute inset-y-0 rounded-full"
                      style={{
                        left: `${Math.max(0, progress.pct - 15)}%`,
                        width: '15%',
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                        animation: 'shimmer 1.5s ease-in-out infinite',
                      }} />
                  )}
                </div>

                <div className="flex gap-1 mt-1">
                  {PIPELINE_STEPS.map((step, i) => {
                    const done   = isSuccess || (!isFailure && i < progress.stepIdx);
                    const active = !isSuccess && !isFailure && i === progress.stepIdx;
                    return (
                      <div key={i} title={step.label} className="flex-1 h-1 rounded-full transition-all duration-500"
                        style={{
                          background: isFailure
                            ? (i <= Math.max(0, progress.stepIdx) ? '#FECACA' : '#F3F4F6')
                            : done ? '#40916C' : active ? '#74C69D' : '#E5E7EB',
                        }} />
                    );
                  })}
                </div>

                <div className="hidden md:grid" style={{ gridTemplateColumns: `repeat(${PIPELINE_STEPS.length}, 1fr)` }}>
                  {PIPELINE_STEPS.map((step, i) => {
                    const done   = isSuccess || (!isFailure && i < progress.stepIdx);
                    const active = !isSuccess && !isFailure && i === progress.stepIdx;
                    return (
                      <div key={i} className="flex justify-center" title={step.label}>
                        <step.Icon className="w-3 h-3" style={{
                          color: isFailure ? '#FECACA' : done ? '#40916C' : active ? '#1B4332' : '#D1D5DB',
                        }} strokeWidth={active ? 2.5 : 1.5} />
                      </div>
                    );
                  })}
                </div>

                {isRunning && latestRun && (
                  <p className="text-xs text-right" style={{ color: '#9CA3AF' }}>
                    Iniciado {timeAgo(latestRun.created_at)} · tempo médio ~11 min
                  </p>
                )}
              </div>
            )}

            {!isRunning && !isSuccess && !isFailure && !triggering && runs.length === 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {['Pesagens', 'Desmamas', 'IATFs', 'Vendas', 'Mortes', 'Compras', 'Transferências', 'Nascimentos', 'Estoque', 'Financeiro'].map(s => (
                  <span key={s} className="text-xs px-2.5 py-1 rounded-full"
                    style={{ background: '#D8F3DC', color: '#1B4332' }}>{s}</span>
                ))}
              </div>
            )}
          </div>

          {latestRun && (
            <a href={latestRun.html_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-between px-6 py-3 border-t text-xs transition-colors hover:bg-gray-50"
              style={{ borderColor: '#F3F4F6', color: '#6B7280' }}>
              <span>Ver log completo no GitHub Actions</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        {/* Logs */}
        <div>
          <h2 className="font-bold text-sm mb-2 flex items-center gap-2" style={{ color: '#1B4332' }}>
            Logs
            {isRunning && (
              <span className="text-xs px-2 py-0.5 rounded-full"
                style={{ background: '#FFFBEB', color: '#C49A00', border: '1px solid #FDE68A' }}>
                ao vivo · atualiza a cada 5s
              </span>
            )}
          </h2>
          <LogViewer logs={logs} isRunning={isRunning || triggering} />
        </div>

        {/* Histórico colapsável */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: '#E5E7EB' }}>
          <div className="flex items-center justify-between px-5 py-4 border-b hover:bg-gray-50 transition-colors cursor-pointer"
            style={{ borderColor: showHistory ? '#F3F4F6' : 'transparent' }}
            onClick={() => setShowHistory(h => !h)}>
            <span className="flex items-center gap-2 font-semibold text-sm" style={{ color: '#1B4332' }}>
              <History className="w-4 h-4" />
              Histórico de Execuções
              {runs.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#D8F3DC', color: '#2D6A4F' }}>
                  {runs.length}
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span role="button" tabIndex={0}
                onClick={e => { e.stopPropagation(); fetchStatus(); }}
                onKeyDown={e => e.key === 'Enter' && (e.stopPropagation(), fetchStatus())}
                className="p-1.5 rounded-lg transition-colors hover:bg-gray-100 cursor-pointer" title="Atualizar">
                <RefreshCw className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
              </span>
              {showHistory ? <ChevronUp className="w-4 h-4" style={{ color: '#9CA3AF' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#9CA3AF' }} />}
            </div>
          </div>

          {showHistory && (
            <div className="border-t px-4 pb-4 pt-3 space-y-2" style={{ borderColor: '#F3F4F6' }}>
              {runs.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: '#9CA3AF' }}>Nenhuma execução registrada</p>
              ) : runs.slice(0, 10).map(run => (
                <a key={run.id} href={run.html_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 rounded-xl border transition-all hover:shadow-sm group"
                  style={{ borderColor: '#F3F4F6', background: '#FAFAFA' }}>
                  <div className="flex-shrink-0">
                    {run.status === 'completed' && run.conclusion === 'success' && <CheckCircle2 className="w-4.5 h-4.5" style={{ color: '#40916C' }} />}
                    {run.status === 'completed' && run.conclusion === 'failure' && <AlertTriangle className="w-4.5 h-4.5" style={{ color: '#DC2626' }} />}
                    {(run.status === 'in_progress' || run.status === 'queued') && <RefreshCw className="w-4.5 h-4.5 spinner" style={{ color: '#C49A00' }} />}
                    {run.status === 'completed' && !run.conclusion && <Clock className="w-4.5 h-4.5" style={{ color: '#9CA3AF' }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: '#1A2E23' }}>
                      {run.status === 'queued' ? 'Enfileirado' :
                       run.status === 'in_progress' ? 'Executando agora' :
                       run.conclusion === 'success' ? 'Concluído com sucesso' :
                       run.conclusion === 'failure' ? 'Falha na execução' :
                       run.conclusion === 'cancelled' ? 'Cancelado' : 'Concluído'}
                    </p>
                    <p className="text-xs" style={{ color: '#9CA3AF' }}>{formatDate(run.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0" style={{ color: '#D1D5DB' }}>
                    <span className="text-xs">{timeAgo(run.created_at)}</span>
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </main>

      <footer className="mt-8 py-5 text-center text-xs border-t" style={{ color: '#9CA3AF', borderColor: '#E5E7EB' }}>
        Destak Agropecuária · Cockpit de Gestão de Rebanho
      </footer>

      <style>{`
        @keyframes shimmer {
          0%   { opacity: 0; }
          50%  { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
