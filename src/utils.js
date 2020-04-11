import { join } from 'path';

export function path(s)
{
  return join(process.cwd(), `./${s}`);
}