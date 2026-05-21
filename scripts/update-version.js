import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const versionFile = path.join(__dirname, '..', 'public', 'version.json');

try {
  let versionData = { version: '1.0.0', buildTime: Date.now(), message: 'Build update' };

  if (fs.existsSync(versionFile)) {
    const currentData = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    versionData = { ...versionData, ...currentData };
  }

  versionData.buildTime = Date.now();
  versionData.message = `Build ${new Date().toISOString()}`;

  fs.writeFileSync(versionFile, JSON.stringify(versionData, null, 2));

  console.log(`Version updated: ${versionData.version} (${new Date(versionData.buildTime).toLocaleString()})`);
} catch (error) {
  console.error('Failed to update version:', error);
  process.exit(1);
}
