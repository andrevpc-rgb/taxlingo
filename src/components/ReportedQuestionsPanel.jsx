// src/components/ReportedQuestionsPanel.jsx
//
// Aba "Questões Reportadas" do Painel de Contingência (só master) — lista as
// perguntas que colaboradores marcaram com "Reportar erro" no Quiz (ver
// QuizEngine.jsx: motivo opcional), agrupadas por questão com contagem,
// quem reportou (nome/e-mail) e o motivo de cada um (ver api.fetchQuestionReports
// — join com `users`). "Marcar como Corrigida" arquiva todos os reports
// pendentes daquela questão de uma vez (ver api.resolveQuestionReports).

import React, { useEffect, useState } from 'react';
import { Flag, RefreshCcw, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Search } from 'lucide-react';
import * as api from '../lib/api';
import QuestionReviewModal from './QuestionReviewModal';

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function ReportDetail({ report }) {
  return (
    <p className="text-[11px] leading-snug text-amber-700">
      <span className="font-bold">{report.reporterName}</span>
      {report.reporterEmail && <span className="text-amber-500"> ({report.reporterEmail})</span>}
      {report.reason && (
        <>
          {' — '}
          <span className="italic">"{report.reason}"</span>
        </>
      )}
      <span className="ml-1 text-amber-400">· {formatDate(report.createdAt)}</span>
    </p>
  );
}

function ReportCard({ report, resolving, onResolve, onReview }) {
  const [expanded, setExpanded] = useState(false);
  const [latest, ...rest] = report.reports;

  return (
    <div className="rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-700">{report.questionText}</p>
          <p className="mt-0.5 text-[11px] text-amber-600">
            {report.questionId} · {report.count === 1 ? '1 report' : `${report.count} reports`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            type="button"
            onClick={onReview}
            className="flex items-center justify-center gap-1 rounded-lg border-2 border-sky-200 bg-white px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-sky-600 hover:border-sky-300"
          >
            <Search className="h-3 w-3" />
            Revisar Questão
          </button>
          <button
            type="button"
            onClick={onResolve}
            disabled={resolving}
            className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
          >
            {resolving ? '...' : 'Marcar como Corrigida'}
          </button>
        </div>
      </div>

      <div className="mt-2 space-y-1 border-t border-amber-200 pt-2">
        {latest && <ReportDetail report={latest} />}
        {expanded && rest.map((r) => <ReportDetail key={r.id} report={r} />)}
        {rest.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-bold text-amber-500 hover:text-amber-700"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? 'Ocultar' : `Ver mais ${rest.length === 1 ? '1 report' : `${rest.length} reports`}`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ReportedQuestionsPanel() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);
  const [reviewing, setReviewing] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await api.fetchQuestionReports());
    } catch (err) {
      setError(err.message || 'Não foi possível carregar as questões reportadas.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleResolve = async (questionId) => {
    setResolvingId(questionId);
    setError(null);
    try {
      await api.resolveQuestionReports(questionId);
      setReports((prev) => prev?.filter((r) => r.questionId !== questionId) ?? null);
    } catch (err) {
      setError(err.message || 'Não foi possível marcar como corrigida.');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-slate-600">
          <Flag className="h-4 w-4" />
          Questões Reportadas
        </p>
        <button type="button" onClick={load} className="text-slate-400 hover:text-slate-600" aria-label="Recarregar">
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
      {loading && !reports && <p className="text-xs text-slate-400">Carregando...</p>}
      {reports && reports.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          Nenhuma questão reportada no momento.
        </p>
      )}

      {reports && reports.length > 0 && (
        <div className="space-y-2">
          {reports.map((report) => (
            <ReportCard
              key={report.questionId}
              report={report}
              resolving={resolvingId === report.questionId}
              onResolve={() => handleResolve(report.questionId)}
              onReview={() => setReviewing(report)}
            />
          ))}
        </div>
      )}

      {reviewing && (
        <QuestionReviewModal
          questionId={reviewing.questionId}
          questionText={reviewing.questionText}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
