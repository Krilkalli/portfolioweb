const FUNCTIONAL_BLOCKS_LABEL = 'Функциональные блоки:';

function normalizeFunctionalBlocks(blocks) {
  return [...new Set((Array.isArray(blocks) ? blocks : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

function stripFunctionalBlocks(description) {
  return String(description || '')
    .split(/\r?\n/)
    .filter(line => !line.trim().toLowerCase().startsWith(FUNCTIONAL_BLOCKS_LABEL.toLowerCase()))
    .join('\n')
    .trim();
}

function composeProjectDescription(description, blocks) {
  const base = stripFunctionalBlocks(description);
  const normalizedBlocks = normalizeFunctionalBlocks(blocks);
  const functionalLine = normalizedBlocks.length
    ? `${FUNCTIONAL_BLOCKS_LABEL} ${normalizedBlocks.join(', ')}`
    : '';
  return [base, functionalLine].filter(Boolean).join('\n');
}

module.exports = { composeProjectDescription, stripFunctionalBlocks, normalizeFunctionalBlocks };
