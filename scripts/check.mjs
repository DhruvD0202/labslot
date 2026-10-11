import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(name);
    else if (/\.(m?js)$/.test(name)) {
      const result = spawnSync(process.execPath, ['--check',name], { stdio:'inherit', windowsHide:true });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const directory of ['server','scripts','tests','client/src']) await check(directory);
console.log('JavaScript syntax checks passed.');
