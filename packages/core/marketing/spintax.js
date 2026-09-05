/**
 * Resolves spintax strings (e.g. "{Hi|Hello} {{firstName}}") into randomized output.
 * Supports nested spintax.
 */

function parseSpintax(text, randomFn = Math.random) {
  if (typeof text !== 'string') return text;
  
  let result = text;
  
  // Regex to match innermost spintax blocks: {opt1|opt2|opt3}
  const regex = /\{([^{}]+)\}/g;
  
  while (regex.test(result)) {
    result = result.replace(regex, (match, inner) => {
      const options = inner.split('|');
      const selected = options[Math.floor(randomFn() * options.length)];
      return selected;
    });
  }
  
  return result;
}

/**
 * Injects variables and then evaluates spintax.
 */
export function compileTemplate(template, variables = {}, randomFn = Math.random) {
  let result = template;
  
  // Inject variables first e.g. {{firstName}}
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }
  
  // Evaluate spintax
  return parseSpintax(result, randomFn);
}
