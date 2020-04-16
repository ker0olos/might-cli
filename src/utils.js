/**
* @param { import('./runner.js').Step } step
*/
export function serializeStep(step)
{
  if (step.action === 'wait')
    return `Wait ${step.value}s`;
  else if (step.action === 'select')
    return `Select ${step.value}`;
  else if (step.action === 'click')
    return 'Click';
  else if (step.action === 'type')
    return `Type ${step.value}`;
}

/**
* @param { import('./runner.js').Step[] } steps
*/
export function stepsToString(steps, separator)
{
  separator = separator || ' 🠮 ';

  return steps.map(serializeStep).join(separator);
}