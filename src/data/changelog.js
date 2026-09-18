// src/data/changelog.js
//
// Conteúdo do popup "O que há de novo" (ver ChangelogModal.jsx) — mostrado
// uma vez pra cada usuário quando `user.lastSeenChangelogVersion` (coluna
// last_seen_changelog_version) é diferente de CURRENT_CHANGELOG_VERSION.
// Pra lançar uma nova leva de novidades: adicione um novo item no TOPO de
// CHANGELOG_ENTRIES com uma versão nova — o popup volta a aparecer pra todo
// mundo automaticamente, sem precisar de nenhuma migração ou reset manual.

export const CHANGELOG_ENTRIES = [
  {
    version: '1.1.0',
    title: 'Novidades de hoje',
    sections: [
      {
        emoji: '🎯',
        title: 'Ajustes e lógica nas questões de ordenação',
        items: [
          'Corrigimos a ordem lógica dos gabaritos em fluxos fiscais (agora ações de verificação/classificação vêm antes do ajuste final).',
        ],
      },
      {
        emoji: '📍',
        title: 'Localização exata e transparência nos reports',
        items: [
          'As questões reportadas agora exibem a localização exata no curso (ex: Estagiário · Lição 2/38).',
          'O Painel do Gestor agora mostra o nome e o comentário de quem reportou o erro.',
          'Agradecimento: quando uma questão reportada é corrigida pela equipe, quem avisou recebe uma notificação especial de agradecimento!',
        ],
      },
      {
        emoji: '💾',
        title: 'Persistência de progresso ao pular lições',
        items: [
          'Corrigimos o salvamento: ao pular lições por acertos seguidos ou voltar depois, o app agora vai direto pra última lição liberada, sem voltar ao início.',
          'Ao concluir uma lição, a tela rola automaticamente direto pra próxima lição destravada.',
        ],
      },
      {
        emoji: '❤️',
        title: 'Vidas ilimitadas e correção de carteira',
        items: [
          'Ajustamos a verificação de saldo de gemas/diamantes na tela de recarga de vidas.',
          'Contas Fundador/Master agora têm vidas ilimitadas pra testar e navegar livremente.',
        ],
      },
      {
        emoji: '🎨',
        title: 'Melhorias visuais e de navegação',
        items: [
          'Aumentamos o contraste dos botões do menu inferior — as abas inativas agora ficam bem visíveis.',
          'Adicionamos um botão ✕ (Sair) durante o quiz pra voltar pra Home quando quiser.',
        ],
      },
    ],
  },
];

export const CURRENT_CHANGELOG_VERSION = CHANGELOG_ENTRIES[0].version;
