// src/utils/sound.js
//
// Efeitos sonoros do jogo. Implementado com a Web Audio API nativa
// (osciladores sintetizados), não Howler.js/arquivos de áudio: este projeto
// não tem nenhum asset de áudio disponível pra empacotar, e sintetizar os
// sons evita precisar baixar/licenciar arquivos externos só pra um bipe de
// acerto/erro. Se no futuro você tiver arquivos .mp3/.ogg de verdade, é só
// trocar o corpo de cada play*() por `new Audio(url).play()` — as funções
// exportadas (playCorrect, playIncorrect, ...) continuam as mesmas pro resto
// do app, ninguém mais precisa mudar.

const MUTE_STORAGE_KEY = 'taxlingo_sound_muted';

let audioCtx = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  // Navegadores suspendem o contexto até um gesto do usuário (clique,
  // toque) — cada chamada de play*() já acontece em resposta a um clique
  // real (responder pergunta, tocar em vidas...), então só precisamos
  // garantir que ele volte a rodar se ainda estiver suspenso.
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function isSoundMuted() {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSoundMuted(muted) {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Sem localStorage disponível — o mudo simplesmente não persiste entre sessões.
  }
}

// Toca uma única nota: sobe e desce em volume (envelope) pra não estalar no
// início/fim, o problema clássico de tocar uma onda "crua" com Web Audio.
function playNote(ctx, { freq, startTime, duration, type = 'sine', peakGain = 0.18 }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

// Toca uma sequência de notas em cadeia, cada uma começando `gap` segundos
// depois da anterior — é o bloco de montar dos efeitos "compostos"
// (fanfarra, acorde de promoção).
function playSequence(notes, { gap = 0.09, type = 'sine', peakGain = 0.18 } = {}) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  notes.forEach((freq, i) => {
    playNote(ctx, { freq, startTime: now + i * gap, duration: 0.16, type, peakGain });
  });
}

function withMuteGuard(fn) {
  return (...args) => {
    if (isSoundMuted()) return;
    try {
      fn(...args);
    } catch {
      // Áudio é um "nice to have" — nunca deve quebrar o jogo se o
      // navegador recusar tocar por algum motivo (autoplay policy etc.).
    }
  };
}

// Resposta correta: dois tons ascendentes, suave e curto.
export const playCorrect = withMuteGuard(() => {
  playSequence([659.25, 880], { gap: 0.09, type: 'sine', peakGain: 0.16 }); // Mi5 -> Lá5
});

// Resposta incorreta: um único tom curto e grave, tipo "buzz".
export const playIncorrect = withMuteGuard(() => {
  const ctx = getAudioContext();
  if (!ctx) return;
  playNote(ctx, { freq: 155, startTime: ctx.currentTime, duration: 0.22, type: 'sawtooth', peakGain: 0.14 });
});

// Conclusão de lição: pequena fanfarra ascendente (arpejo maior).
export const playLessonComplete = withMuteGuard(() => {
  playSequence([523.25, 659.25, 783.99, 1046.5], { gap: 0.1, type: 'triangle', peakGain: 0.17 }); // Dó5-Mi5-Sol5-Dó6
});

// Promoção de cargo (subiu de nível de carreira): acorde maior mais robusto
// e longo, claramente "maior" que o fanfarrão de lição normal.
export const playPromotion = withMuteGuard(() => {
  const ctx = getAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  // Acorde de Dó maior (Dó-Mi-Sol) tocado junto, seguido de um Dó oitava acima.
  [523.25, 659.25, 783.99].forEach((freq) => {
    playNote(ctx, { freq, startTime: now, duration: 0.5, type: 'triangle', peakGain: 0.14 });
  });
  playNote(ctx, { freq: 1046.5, startTime: now + 0.22, duration: 0.45, type: 'triangle', peakGain: 0.18 });
});
