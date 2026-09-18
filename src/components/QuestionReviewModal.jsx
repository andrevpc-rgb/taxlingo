// src/components/QuestionReviewModal.jsx
//
// Modal "🔍 Revisar Questão" da aba Questões Reportadas (Painel de
// Contingência, master) — mostra o enunciado/alternativas/gabarito completos
// da questão reportada (busca direto na tabela `questions`, ver
// api.fetchQuestionById) e permite editar o gabarito ali mesmo (JSON —
// não existe editor visual por tipo de questão, mas dá pra corrigir sem
// precisar abrir o SQL Editor do Supabase). "Marcar como Corrigida" some
// daqui pra reforçar o mesmo botão que já existe no card, sem duplicar ação.

import React, { useEffect, useState } from 'react';
import { X, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import * as api from '../lib/api';

const TYPE_LABELS = {
  multiple_choice: 'Múltipla escolha',
  true_false: 'Certo ou Errado',
  ordering: 'Ordenação',
  fill_blank: 'Completar lacuna',
  text_input: 'Digitar resposta',
};

function formatCurrentAnswer(question) {
  if (question.type === 'true_false') return question.correctAnswer ? 'Certo' : 'Errado';
  if (Array.isArray(question.correctAnswer)) return question.correctAnswer.join(' → ');
  return String(question.correctAnswer);
}

export default function QuestionReviewModal({ questionId, questionText, onClose }) {
  const [question, setQuestion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.fetchQuestionById(questionId);
        if (cancelled) return;
        setQuestion(data);
        if (data) setEditValue(JSON.stringify(data.correctAnswer));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Não foi possível carregar a questão.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  const handleSaveGabarito = async () => {
    let parsed;
    try {
      parsed = JSON.parse(editValue);
    } catch {
      setSaveError('JSON inválido — confira as aspas/vírgulas antes de salvar.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateQuestionCorrectAnswer(questionId, parsed);
      setQuestion((prev) => (prev ? { ...prev, correctAnswer: parsed } : prev));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setSaveError(err.message || 'Não foi possível salvar o gabarito.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="pr-8 text-xs font-extrabold uppercase tracking-wide text-slate-400">
          {questionId} {question && `· ${TYPE_LABELS[question.type] ?? question.type}`}
        </p>

        {loading && (
          <p className="mt-4 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando questão...
          </p>
        )}

        {error && (
          <p className="mt-4 flex items-center gap-1.5 text-sm font-bold text-rose-600">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {!loading && !error && !question && (
          <p className="mt-4 text-sm font-bold text-amber-600">
            Essa questão não existe mais na tabela <code>questions</code> — pode já ter sido removida ou substituída.
            Texto reportado originalmente: "{questionText}"
          </p>
        )}

        {question && (
          <div className="mt-3 space-y-4">
            {question.scenario && (
              <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm italic text-slate-500">{question.scenario}</p>
            )}
            <p className="text-base font-bold text-slate-800">{question.question}</p>

            {Array.isArray(question.options) && question.options.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Alternativas</p>
                {question.options.map((option, idx) => (
                  <p key={idx} className="rounded-lg border-2 border-slate-100 px-3 py-1.5 text-sm text-slate-600">
                    {option}
                  </p>
                ))}
              </div>
            )}

            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Gabarito atual no banco</p>
              <p className="mt-1 rounded-lg border-2 border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700">
                {formatCurrentAnswer(question)}
              </p>
            </div>

            {question.explanation && (
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Explicação</p>
                <p className="mt-1 text-sm text-slate-500">{question.explanation}</p>
              </div>
            )}

            <div className="rounded-2xl border-2 border-slate-200 p-3">
              <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Editar Gabarito (JSON)</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Ex.: "Verdadeiro", true, "Alternativa B" ou ["passo 1", "passo 2", "passo 3"].
              </p>
              <textarea
                value={editValue}
                onChange={(event) => setEditValue(event.target.value)}
                rows={3}
                className="mt-2 w-full resize-none rounded-xl border-2 border-slate-200 px-3 py-2 font-mono text-sm text-slate-700 outline-none focus:border-sky-300"
              />
              {saveError && <p className="mt-1.5 text-xs font-bold text-rose-600">{saveError}</p>}
              {saved && (
                <p className="mt-1.5 flex items-center gap-1 text-xs font-bold text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Gabarito atualizado!
                </p>
              )}
              <button
                type="button"
                onClick={handleSaveGabarito}
                disabled={saving}
                className="mt-2 rounded-xl bg-sky-500 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white disabled:opacity-60"
              >
                {saving ? 'Salvando...' : 'Salvar Gabarito'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
