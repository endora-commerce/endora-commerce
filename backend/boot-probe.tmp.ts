import { composeApp } from './src/composition.js';

const handle = await composeApp();
console.log('[probe] composeApp() returned — boot hooks ran without throwing');
await handle.dispose();
process.exit(0);
