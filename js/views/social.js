import { screenHead, emptyState, add } from '../ui.js';

// Aba reservada para a parte social, que ainda vai ser feita.
export async function render(root) {
  add(root, screenHead('Social'), emptyState('Em breve', null));
}
