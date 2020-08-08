import psTree from 'ps-tree';

function kill(pid)
{
  return new Promise((resolve, reject) =>
  {
    // search for any grandchildren
    psTree(pid, (err, children) =>
    {
      if (err)
        reject(err);

      // kill any grandchildren
      children?.forEach(({ PID }) => process.kill(PID, 'SIGINT'));

      // kill the original child
      process.kill(pid, 'SIGINT');

      resolve();
    });
  });
}

kill(process.argv[2]);