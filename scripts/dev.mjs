import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function startDev() {
  const children = [
    spawn(process.execPath, ['--watch','server/index.js'], { stdio:'inherit', windowsHide:true }),
    spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1'], { stdio:'inherit', windowsHide:true }),
  ];
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; for (const child of children) child.kill(); };
  for (const child of children) child.on('exit', code => { if (!stopping) { stop(); process.exitCode = code || 0; } });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return stop;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startDev();
