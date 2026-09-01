// src/components/ReportedQuestionsPanel.jsx
//
// Aba "Questões Reportadas" do Painel de Contingência (só master) — lista as
// perguntas que colaboradores marcaram com "Reportar erro" no Quiz (ver
// QuizEngine.jsx: 1 clique, sem texto), agrupadas por questão com contagem e
// data do último report. "Marcar como Corrigida" arquiva todos os reports
// pendentes daquela questão de uma vez (ver api.resolveQuestionReports).

import React, { useEffect, useState } from 'react';
import { Flag, RefreshCcw, AlertCircle, CheckCircle2 } from 'lucide-react';
import * as api from '../lib/api';

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ReportedQuestionsPanel() {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);

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
            <div
              key={report.questionId}
              className="flex items-start justify-between gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold text-amber-700">{report.questionText}</p>
                <p className="mt-0.5 text-[11px] text-amber-600">
                  {report.questionId} · {report.count === 1 ? '1 report' : `${report.count} reports`} · último em{' '}
                  {formatDate(report.lastReportedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleResolve(report.questionId)}
                disabled={resolvingId === report.questionId}
                className="shrink-0 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
              >
                {resolvingId === report.questionId ? '...' : 'Marcar como Corrigida'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
