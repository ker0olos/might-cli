import psTree from 'ps-tree';

function kill(pid: number | string)
{
  return new Promise<void>((resolve, reject) =>
  {
    // search for any grandchildren
    psTree(pid, (err: unknown, children: { PID: number }[]) =>
    {
      if (err)
        reject(err);

      // kill any grandchildren
      children?.forEach(({ PID }) => process.kill(PID, 'SIGINT'));

      // kill the original child
      process.kill(pid as number, 'SIGINT');

      resolve();
    });
  });
}

kill(process.argv[2]);