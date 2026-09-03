const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const requiredPackages = ['express', 'vite', 'svelte'];
const dependenciesReady = requiredPackages.every((packageName) =>
  fs.existsSync(path.join(projectRoot, 'node_modules', packageName))
);

if (!dependenciesReady) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCommand, ['install'], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
}
