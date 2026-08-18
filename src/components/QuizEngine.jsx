// src/components/QuizEngine.jsx
import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Heart,
  PartyPopper,
  ClipboardCheck,
  Zap,
  SkipForward,
  Lock,
  Clock,
} from 'lucide-react';
import { useGame, getHeartRegenInfo } from '../context/GameContext.jsx';
import { playCorrect, playIncorrect, playLessonComplete, playPromotion } from '../utils/sound';
import {
  QUESTION_TYPES,
  LESSON_TYPES,
  EXAM_PASS_THRESHOLD,
  HEART_REFILL_ONE_COST,
  HEART_REFILL_FULL_COST,
} from '../data/mockData';
import PacciMascot from './PacciMascot';

// ---------------------------------------------------------------------------
// Sub-componentes por tipo de questão
// ---------------------------------------------------------------------------

function OptionList({ options, selected, disabled, onSelect, correctAnswer, isAnswered }) {
  return (
    <div className="grid gap-3">
      {options.map((option) => {
        const isSelected = selected === option;
        const isCorrectOption = isAnswered && option === correctAnswer;
        const isWrongSelected = isAnswered && isSelected && option !== correctAnswer;

        let stateClasses = 'border-slate-200 bg-white hover:border-slate-300';
        if (isSelected && !isAnswered) stateClasses = 'border-sky-400 bg-sky-50';
        if (isCorrectOption) stateClasses = 'border-emerald-400 bg-emerald-50';
        if (isWrongSelected) stateClasses = 'border-rose-400 bg-rose-50';

        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(option)}
            className={`min-h-[3rem] rounded-2xl border-2 px-4 py-3 text-left text-sm font-bold text-slate-700 transition-colors active:scale-[0.99] disabled:cursor-default disabled:active:scale-100 ${stateClasses}`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function TrueFalseChoice({ value, disabled, onSelect, correctAnswer, isAnswered }) {
  const choices = [
    { label: 'Certo', value: true },
    { label: 'Errado', value: false },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {choices.map((choice) => {
        const isSelected = value === choice.value;
        const isCorrectChoice = isAnswered && choice.value === correctAnswer;
        const isWrongSelected = isAnswered && isSelected && choice.value !== correctAnswer;

        let stateClasses = 'border-slate-200 bg-white hover:border-slate-300';
        if (isSelected && !isAnswered) stateClasses = 'border-sky-400 bg-sky-50';
        if (isCorrectChoice) stateClasses = 'border-emerald-400 bg-emerald-50';
        if (isWrongSelected) stateClasses = 'border-rose-400 bg-rose-50';

        return (
          <button
            key={choice.label}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(choice.value)}
            className={`min-h-[3.25rem] rounded-2xl border-2 px-4 py-4 text-center text-sm font-extrabold uppercase tracking-wide text-slate-700 transition-colors active:scale-[0.99] disabled:cursor-default disabled:active:scale-100 ${stateClasses}`}
          >
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}

function OrderingBuilder({ options, selected, disabled, onChange }) {
  const chosen = selected ?? [];
  const remaining = options.filter((option) => !chosen.includes(option));

  const addItem = (item) => {
    if (disabled) return;
    onChange([...chosen, item]);
  };
  const removeItem = (index) => {
    if (disabled) return;
    onChange(chosen.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Sua ordem</p>
        <div className="flex min-h-[3.5rem] flex-wrap gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-3">
          {chosen.length === 0 && (
            <span className="text-sm text-slate-400">Toque nas opções abaixo, na ordem correta.</span>
          )}
          {chosen.map((item, index) => (
            <button
              key={`${item}-${index}`}
              type="button"
              disabled={disabled}
              onClick={() => removeItem(index)}
              className="flex min-h-[2.5rem] items-center gap-2 rounded-xl border-2 border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 disabled:cursor-default"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-[10px] text-white">
                {index + 1}
              </span>
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {remaining.map((item) => (
          <button
            key={item}
            type="button"
            disabled={disabled}
            onClick={() => addItem(item)}
            className="min-h-[2.5rem] rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 active:scale-[0.98] disabled:cursor-default disabled:active:scale-100"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function TextInputAnswer({ value, disabled, onChange }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Digite sua resposta..."
      autoComplete="off"
      autoCapitalize="off"
      spellCheck={false}
      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 outline-none transition-colors focus:border-sky-400 disabled:cursor-default"
    />
  );
}

// ---------------------------------------------------------------------------
// Verificação de "pode enviar" por tipo de questão
// ---------------------------------------------------------------------------
function canSubmit(question, draftAnswer) {
  if (!question) return false;
  switch (question.type) {
    case QUESTION_TYPES.TRUE_FALSE:
      return draftAnswer === true || draftAnswer === false;
    case QUESTION_TYPES.ORDERING:
      return Array.isArray(draftAnswer) && draftAnswer.length === question.options.length;
    case QUESTION_TYPES.TEXT_INPUT:
      return typeof draftAnswer === 'string' && draftAnswer.trim().length > 0;
    case QUESTION_TYPES.MULTIPLE_CHOICE:
    case QUESTION_TYPES.FILL_BLANK:
    default:
      return Boolean(draftAnswer);
  }
}

function formatCorrectAnswer(question) {
  if (question.type === QUESTION_TYPES.TRUE_FALSE) {
    return question.correctAnswer ? 'Certo' : 'Errado';
  }
  if (question.type === QUESTION_TYPES.ORDERING) {
    return question.correctAnswer.join(' → ');
  }
  return String(question.correctAnswer);
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

// Bônus de Ofensiva (a cada 7 dias seguidos) — mesmo aviso em qualquer tela
// de conclusão que tiver disparado o marco (ver applyDailyStreak).
function StreakBonusBadge({ amount }) {
  if (!amount) return null;
  return (
    <p className="mt-1 flex items-center justify-center gap-1.5 rounded-xl bg-orange-50 px-3 py-1.5 text-xs font-extrabold text-orange-600">
      🔥 Bônus de Ofensiva: +{amount}💎
    </p>
  );
}

function formatCountdown(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`;
}

// Opções de recarga com gemas — usadas na tela de "sem vidas" (a recarga
// instantânea e grátis foi removida; agora só volta com o tempo ou gemas).
function HeartRefillOptions() {
  const { user, buyHeartRefill } = useGame();
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const { missing, msUntilNext } = getHeartRegenInfo(user);
  const canBuyOne = missing > 0 && user.gems >= HEART_REFILL_ONE_COST;
  const canBuyFull = missing > 0 && user.gems >= HEART_REFILL_FULL_COST;

  if (missing <= 0) {
    return <p className="text-sm font-bold text-emerald-600">Vidas cheias! Pode continuar.</p>;
  }

  return (
    <div className="w-full space-y-2.5">
      {msUntilNext !== null && (
        <p className="flex items-center justify-center gap-1 text-sm font-bold text-slate-500">
          <Clock className="h-4 w-4" />
          Próxima vida em {formatCountdown(msUntilNext)}
        </p>
      )}
      <button
        type="button"
        disabled={!canBuyOne}
        onClick={() => buyHeartRefill('one')}
        className="w-full rounded-2xl bg-rose-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#be123c] transition-transform active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
      >
        Recarregar 1 vida — {HEART_REFILL_ONE_COST}💎
      </button>
      {missing > 1 && (
        <button
          type="button"
          disabled={!canBuyFull}
          onClick={() => buyHeartRefill('full')}
          className="w-full rounded-2xl border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-rose-600 transition-transform active:translate-y-0.5 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
        >
          Recarregar todas — {HEART_REFILL_FULL_COST}💎
        </button>
      )}
      <p className="text-xs font-medium text-slate-400">Você tem {user.gems}💎</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de confirmação do Exame de Transição
// ---------------------------------------------------------------------------
function ExamIntroModal({ totalQuestions, onStart, onCancel }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="w-full max-w-sm rounded-3xl border-2 border-indigo-200 bg-white p-6 text-center shadow-xl">
        <ClipboardCheck className="mx-auto mb-3 h-12 w-12 text-indigo-500" />
        <h2 className="text-lg font-extrabold text-slate-800">Exame de Transição de Nível</h2>
        <p className="mt-2 text-sm font-medium text-slate-500">
          São <span className="font-extrabold text-slate-700">{totalQuestions} questões</span> cobrindo tudo
          o que você aprendeu neste nível. Você precisa de{' '}
          <span className="font-extrabold text-indigo-600">{pct(EXAM_PASS_THRESHOLD)}</span> de aproveitamento
          para desbloquear o próximo nível de carreira.
        </p>
        <p className="mt-2 text-xs font-bold text-slate-400">Suas vidas não são consumidas neste exame.</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-2xl border-2 border-slate-200 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-slate-600"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onStart}
            className="flex-1 rounded-2xl bg-indigo-500 px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#3730a3] active:translate-y-0.5 active:shadow-none"
          >
            Começar Exame
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function QuizEngine({ onExit }) {
  const {
    currentQuestion,
    currentLessonType,
    lessonId,
    totalQuestions,
    masteredCount,
    draftAnswer,
    isAnswered,
    isCorrect,
    pacciMood,
    lessonComplete,
    gameOver,
    sessionXp,
    correctCount,
    wrongCount,
    perfectLessonStreak,
    accelerationAvailable,
    pendingAccelerationTest,
    accelerationResult,
    examResult,
    isDailyReview,
    justPromotedLevelId,
    lessonGemsEarned,
    streakBonusGems,
    setDraftAnswer,
    submitAnswer,
    nextQuestion,
    restartLesson,
    startAccelerationTest,
    declineAcceleration,
    startDailyReview,
  } = useGame();

  // A "Lição de Revisão" não existe no banco de lições — reiniciá-la
  // significa sortear novas questões, não recarregar a mesma lição.
  const handleRestart = isDailyReview ? startDailyReview : restartLesson;

  // Efeitos sonoros: toca uma vez por resposta (o efeito só reage à
  // TRANSIÇÃO de isAnswered pra true, não fica retocando em cada re-render).
  useEffect(() => {
    if (!isAnswered) return;
    if (isCorrect) playCorrect();
    else playIncorrect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnswered]);

  // Efeito sonoro de fim de lição: fanfarra padrão pra qualquer conclusão
  // vitoriosa (lição regular, revisão diária, Teste de Aceleração, exame
  // aprovado), e o som especial de promoção quando o exame aprovado destrava
  // o próximo nível de carreira. Exame reprovado fica em silêncio — não é
  // uma vitória pra comemorar.
  useEffect(() => {
    if (!lessonComplete) return;
    if (examResult && !examResult.passed) return;
    if (justPromotedLevelId) playPromotion();
    else playLessonComplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonComplete]);

  const [confirmedExamLessonId, setConfirmedExamLessonId] = useState(null);
  const isExam = currentLessonType === LESSON_TYPES.EXAM;
  const examNeedsConfirmation = isExam && !lessonComplete && !gameOver && confirmedExamLessonId !== lessonId;

  if (gameOver) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <PacciMascot mood="sad" size="lg" message="Ohh não! Suas vidas acabaram... mas não desiste, tesoro!" />
        <HeartRefillOptions />
        <button
          type="button"
          onClick={onExit}
          className="mt-1 rounded-2xl border-2 border-slate-200 px-5 py-2.5 text-sm font-extrabold uppercase tracking-wide text-slate-600"
        >
          Sair
        </button>
      </div>
    );
  }

  if (lessonComplete) {
    // --- Resultado do Exame de Transição -----------------------------------
    if (examResult) {
      return (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
          {examResult.passed ? (
            <PartyPopper className="h-14 w-14 text-amber-400" />
          ) : (
            <Lock className="h-14 w-14 text-slate-300" />
          )}
          <h2 className="text-2xl font-extrabold text-slate-800">
            {examResult.passed ? 'Exame aprovado!' : 'Quase lá!'}
          </h2>
          <PacciMascot
            mood={examResult.passed ? 'happy' : 'sad'}
            size="lg"
            message={
              examResult.passed
                ? 'Complimenti! Você desbloqueou o próximo nível de carreira!'
                : `Faltou pouco, tesoro! Precisa de ${pct(examResult.requiredPct)}, você fez ${pct(examResult.scorePct)}. Bora tentar de novo?`
            }
          />
          <div className="mt-2 flex gap-4 text-sm font-bold">
            <span
              className={`rounded-xl px-3 py-1.5 ${
                examResult.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              }`}
            >
              Seu resultado: {pct(examResult.scorePct)}
            </span>
            <span className="rounded-xl bg-indigo-50 px-3 py-1.5 text-indigo-700">
              Necessário: {pct(examResult.requiredPct)}
            </span>
          </div>

          {examResult.passed && lessonGemsEarned > 0 && (
            <div className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
              <span className="text-2xl" aria-hidden="true">🎁</span>
              <div className="text-left">
                <p className="text-sm font-extrabold text-amber-700">Baú de Recompensa!</p>
                <p className="text-xs font-bold text-amber-600">+{lessonGemsEarned} Gemas por concluir o nível</p>
              </div>
            </div>
          )}
          <StreakBonusBadge amount={streakBonusGems} />

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={restartLesson}
              className="rounded-2xl border-2 border-slate-200 px-5 py-3 text-sm font-extrabold uppercase tracking-wide text-slate-600"
            >
              Refazer Exame
            </button>
            <button
              type="button"
              onClick={onExit}
              className="rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] active:translate-y-0.5 active:shadow-none"
            >
              Continuar
            </button>
          </div>
        </div>
      );
    }

    // --- Resultado do Teste de Aceleração -----------------------------------
    if (accelerationResult) {
      return (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
          <SkipForward className="h-14 w-14 text-violet-400" />
          <h2 className="text-2xl font-extrabold text-slate-800">
            {accelerationResult.passed ? 'Você acelerou!' : 'Boa tentativa!'}
          </h2>
          <PacciMascot
            mood={accelerationResult.passed ? 'happy' : 'neutral'}
            size="lg"
            message={
              accelerationResult.passed
                ? `Velocissimo! Você pulou ${accelerationResult.skippedCount} lições de uma vez!`
                : 'Não foi dessa vez, mas essa lição já contou normalmente. Segue o jogo!'
            }
          />
          <div className="mt-2 flex gap-4 text-sm font-bold">
            <span className="rounded-xl bg-sky-50 px-3 py-1.5 text-sky-700">+{sessionXp} XP</span>
            {lessonGemsEarned > 0 && (
              <span className="rounded-xl bg-cyan-50 px-3 py-1.5 text-cyan-700">+{lessonGemsEarned}💎</span>
            )}
          </div>
          <StreakBonusBadge amount={streakBonusGems} />
          <button
            type="button"
            onClick={onExit}
            className="mt-4 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] active:translate-y-0.5 active:shadow-none"
          >
            Continuar
          </button>
        </div>
      );
    }

    // --- Lição regular concluída (com possível oferta de aceleração) -------
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
        <PartyPopper className="h-14 w-14 text-amber-400" />
        <h2 className="text-2xl font-extrabold text-slate-800">Lição concluída!</h2>
        <PacciMascot mood="happy" size="lg" message="Bravissimo! Você mandou bem demais nessa lição!" />
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-sm font-bold">
          <span className="rounded-xl bg-sky-50 px-3 py-1.5 text-sky-700">+{sessionXp} XP</span>
          {lessonGemsEarned > 0 && (
            <span className="rounded-xl bg-cyan-50 px-3 py-1.5 text-cyan-700">
              +{lessonGemsEarned}💎{wrongCount === 0 && <span className="ml-1 text-[10px] font-extrabold uppercase text-cyan-500">Perfeita!</span>}
            </span>
          )}
          <span className="rounded-xl bg-emerald-50 px-3 py-1.5 text-emerald-700">{correctCount} acertos</span>
          <span className="rounded-xl bg-rose-50 px-3 py-1.5 text-rose-700">{wrongCount} erros</span>
        </div>
        <StreakBonusBadge amount={streakBonusGems} />

        {accelerationAvailable && (
          <div className="mt-2 w-full rounded-2xl border-2 border-violet-200 bg-violet-50 p-4">
            <p className="flex items-center justify-center gap-1.5 text-sm font-extrabold text-violet-700">
              <Zap className="h-4 w-4 fill-violet-500 text-violet-500" />
              3 lições perfeitas seguidas!
            </p>
            <p className="mt-1 text-xs font-medium text-violet-500">
              Acerte pelo menos {pct(EXAM_PASS_THRESHOLD)} de um Teste de Aceleração e pule 2 lições de uma vez.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={declineAcceleration}
                className="flex-1 rounded-xl border-2 border-violet-200 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-violet-600"
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={startAccelerationTest}
                className="flex-1 rounded-xl bg-violet-500 px-3 py-2 text-xs font-extrabold uppercase tracking-wide text-white"
              >
                Testar para Avançar
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={handleRestart}
            className="rounded-2xl border-2 border-slate-200 px-5 py-3 text-sm font-extrabold uppercase tracking-wide text-slate-600"
          >
            Refazer
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_#047857] active:translate-y-0.5 active:shadow-none"
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-slate-400">
        Nenhuma questão disponível para esta lição ainda.
      </div>
    );
  }

  if (examNeedsConfirmation) {
    return (
      <ExamIntroModal
        totalQuestions={totalQuestions}
        onStart={() => setConfirmedExamLessonId(lessonId)}
        onCancel={onExit}
      />
    );
  }

  // Só conta como progresso quando a resposta certa é confirmada — uma
  // pergunta errada não avança a barra, ela volta pro final da fila.
  const displayMastered = masteredCount + (isAnswered && isCorrect ? 1 : 0);
  const progressPct = totalQuestions > 0 ? Math.round((displayMastered / totalQuestions) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 pb-32 pt-4 sm:max-w-2xl sm:pt-6">
      {isExam && (
        <div className="flex items-center gap-2 rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-indigo-600">
          <ClipboardCheck className="h-4 w-4" />
          Exame de Transição · precisa de {pct(EXAM_PASS_THRESHOLD)} para passar · vidas não contam aqui
        </div>
      )}

      {pendingAccelerationTest && (
        <div className="flex items-center gap-2 rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-violet-600">
          <Zap className="h-4 w-4 fill-violet-500 text-violet-500" />
          Teste de Aceleração · acerte {pct(EXAM_PASS_THRESHOLD)} e pule 2 lições
        </div>
      )}

      {/* Barra de progresso da lição */}
      <div className="flex items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="flex items-center gap-1 text-xs font-bold text-slate-400">
          {isExam ? (
            <ClipboardCheck className="h-4 w-4 text-indigo-400" />
          ) : (
            <Heart className="h-4 w-4 fill-rose-400 text-rose-400" />
          )}
          {displayMastered}/{totalQuestions}
        </span>
      </div>

      {perfectLessonStreak > 0 && !isExam && (
        <p className="flex items-center gap-1 text-xs font-bold text-violet-500">
          <Zap className="h-3.5 w-3.5 fill-violet-400 text-violet-400" />
          {perfectLessonStreak} lição(ões) perfeita(s) seguida(s)
        </p>
      )}

      {/* Cenário + Pacci */}
      <PacciMascot mood={pacciMood} message={currentQuestion.scenario} size="md" />

      {/* Pergunta */}
      <div>
        <span className="mb-2 inline-block rounded-full bg-slate-100 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
          {currentQuestion.level?.replace('_', ' ')}
        </span>
        <h2 className="text-lg font-extrabold leading-snug text-slate-800">{currentQuestion.question}</h2>
      </div>

      {/* Corpo da questão, por tipo */}
      {currentQuestion.type === QUESTION_TYPES.MULTIPLE_CHOICE && (
        <OptionList
          options={currentQuestion.options}
          selected={draftAnswer}
          disabled={isAnswered}
          onSelect={setDraftAnswer}
          correctAnswer={currentQuestion.correctAnswer}
          isAnswered={isAnswered}
        />
      )}

      {currentQuestion.type === QUESTION_TYPES.FILL_BLANK && (
        <OptionList
          options={currentQuestion.options}
          selected={draftAnswer}
          disabled={isAnswered}
          onSelect={setDraftAnswer}
          correctAnswer={currentQuestion.correctAnswer}
          isAnswered={isAnswered}
        />
      )}

      {currentQuestion.type === QUESTION_TYPES.TRUE_FALSE && (
        <TrueFalseChoice
          value={draftAnswer}
          disabled={isAnswered}
          onSelect={setDraftAnswer}
          correctAnswer={currentQuestion.correctAnswer}
          isAnswered={isAnswered}
        />
      )}

      {currentQuestion.type === QUESTION_TYPES.ORDERING && (
        <OrderingBuilder
          options={currentQuestion.options}
          selected={draftAnswer}
          disabled={isAnswered}
          onChange={setDraftAnswer}
        />
      )}

      {currentQuestion.type === QUESTION_TYPES.TEXT_INPUT && (
        <TextInputAnswer value={draftAnswer} disabled={isAnswered} onChange={setDraftAnswer} />
      )}

      {/* Rodapé de verificação */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 border-t-2 px-4 pt-4 transition-colors ${
          !isAnswered
            ? 'border-slate-200 bg-white'
            : isCorrect
            ? 'border-emerald-200 bg-emerald-50'
            : 'border-rose-200 bg-rose-50'
        }`}
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-md flex-col gap-3 sm:max-w-2xl">
          {isAnswered && (
            <div className="flex items-start gap-3">
              {isCorrect ? (
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-500" />
              ) : (
                <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-rose-500" />
              )}
              <div>
                <p className={`text-sm font-extrabold ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {isCorrect ? 'Boa! Resposta certa.' : `Resposta certa: ${formatCorrectAnswer(currentQuestion)}`}
                </p>
                <p className="text-xs font-medium text-slate-500">{currentQuestion.explanation}</p>
                {currentQuestion.pacciTip && (
                  <p className="mt-1 text-xs font-bold text-emerald-600">🧑‍🍳 Pacci: {currentQuestion.pacciTip}</p>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!isAnswered && !canSubmit(currentQuestion, draftAnswer)}
            onClick={isAnswered ? nextQuestion : submitAnswer}
            className={`w-full rounded-2xl px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_0_rgba(0,0,0,0.15)] transition-transform active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none ${
              !isAnswered
                ? 'bg-emerald-500 shadow-[0_4px_0_0_#047857]'
                : isCorrect
                ? 'bg-emerald-500 shadow-[0_4px_0_0_#047857]'
                : 'bg-rose-500 shadow-[0_4px_0_0_#be123c]'
            }`}
          >
            {isAnswered ? 'Continuar' : 'Verificar'}
          </button>
        </div>
      </div>
    </div>
  );
}
