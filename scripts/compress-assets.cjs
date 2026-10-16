const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
function visit(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isDirectory()) visit(file);
    else if (/\.(?:js|css|html|svg)$/.test(file)) fs.writeFileSync(file + '.gz', gzipSync(fs.readFileSync(file), { level: 9 }));
  }
}
visit(path.join(__dirname, '../dist'));
