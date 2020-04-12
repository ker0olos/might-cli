import { join } from 'path';

export function path(s)
{
  return join(process.cwd(), `./${s}`);
}

/**
* @param { MightStep } step
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
* @param { MightStep[] } steps
*/
export function stepsToString(steps, separator)
{
  separator = separator || ' 🠮 ';

  return steps.map(serializeStep).join(separator);
}

export function wait(seconds)
{
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

export function roundTime(start, end)
{
  const num = (end - start) / 1000;

  return Math.round((num + Number.EPSILON) * 100) / 100;
}