#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
function collect(root, demo = false) {
  const tasks = demo ? ['analysis-01','facts-01','red-01'] : fs.readdirSync(root).filter((x) => fs.statSync(path.join(root,x)).isDirectory());
  const configs = ['A','B','C']; const key = {}; const rows = [];
  tasks.forEach((task, index) => { const order = configs.slice().sort(() => (index % 2 ? 1 : -1)); key[task] = Object.fromEntries(order.map((config, position) => [`blind-${position + 1}`, config])); rows.push(`| ${task} | ${order.map((config) => `[blind-${order.indexOf(config)+1}](results/${task}/${config}.md)`).join(' | ')} |`); });
  fs.writeFileSync(path.join(root, 'comparison.md'), `# Blind comparison\n\n| Task | Answers |\n|---|---|\n${rows.join('\n')}\n`); fs.writeFileSync(path.join(root, 'key.json'), JSON.stringify(key, null, 2));
}
const demo = process.argv.includes('--demo'); const target = process.argv[process.argv.indexOf('--input') + 1] || path.join(process.cwd(), 'benchmarks', 'runs'); fs.mkdirSync(target, { recursive: true }); collect(target, demo); console.log(`comparison written to ${target}`);
