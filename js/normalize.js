export function shuffle(ids, rng = Math.random) {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Refaz o ranking do zero a partir das respostas. Assim "Voltar" é só encurtar o histórico.
export function rankState(order, history) {
  const tiers = [];
  const total = order.length;
  let h = 0;
  let index = 0;

  if (total > 0) {
    tiers.push([order[0]]);
    index = 1;
  }

  while (index < total) {
    const newId = order[index];
    let lo = 0;
    let hi = tiers.length;
    let placed = false;
    let steps = 0;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (h >= history.length) {
        const expected = Math.max(1, Math.ceil(Math.log2(tiers.length + 1)));
        const partial = Math.min(steps / expected, 0.9);
        return {
          tiers,
          question: { newId, compareId: tiers[mid][0] },
          done: false,
          progress: (index - 1 + partial) / Math.max(1, total - 1),
        };
      }
      const answer = history[h++];
      steps++;
      if (answer === 'tie') {
        tiers[mid].push(newId);
        placed = true;
        break;
      }
      if (answer === 'new') lo = mid + 1;
      else hi = mid;
    }

    if (!placed) tiers.splice(lo, 0, [newId]);
    index++;
  }

  return { tiers, question: null, done: true, progress: 1 };
}

// PAVA ponderado: sequência não decrescente mais próxima de z em mínimos quadrados.
function pava(z, weights) {
  const blocks = [];
  for (let i = 0; i < z.length; i++) {
    blocks.push({ value: z[i], weight: weights[i], count: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const b = blocks.pop();
      const a = blocks.pop();
      const weight = a.weight + b.weight;
      blocks.push({ value: (a.value * a.weight + b.value * b.weight) / weight, weight, count: a.count + b.count });
    }
  }
  const out = [];
  for (const b of blocks) for (let i = 0; i < b.count; i++) out.push(b.value);
  return out;
}

export function adjustTiers(tiers, scores, max, g = 1) {
  const k = tiers.length;
  if (k === 0) return { scores: {}, error: null };

  const y = tiers.map((tier) => tier.reduce((sum, id) => sum + scores[id], 0) / tier.length);
  const n = tiers.map((tier) => tier.length);
  const z = y.map((value, i) => value - i * g);
  const w = pava(z, n).map((value) => Math.round(value));
  const v = w.map((value, i) => value + i * g);

  v[k - 1] = Math.min(v[k - 1], max);
  for (let i = k - 2; i >= 0; i--) v[i] = Math.min(v[i], v[i + 1] - g);
  v[0] = Math.max(v[0], 0);
  for (let i = 1; i < k; i++) v[i] = Math.max(v[i], v[i - 1] + g);

  if (v[k - 1] > max) {
    return {
      scores: {},
      error: `Há níveis demais para a escala: ${k} níveis diferentes não cabem entre 0 e ${max / 10} com diferença mínima de 0,1.`,
    };
  }

  const out = {};
  tiers.forEach((tier, i) => {
    for (const id of tier) out[id] = v[i];
  });
  return { scores: out, error: null };
}

export function diffScores(oldScores, newScores, ids) {
  const keys = ids ?? Object.keys(newScores);
  const out = [];
  for (const id of keys) {
    if (!(id in newScores)) continue;
    if (oldScores[id] !== newScores[id]) out.push({ id, from: oldScores[id], to: newScores[id] });
  }
  return out;
}
