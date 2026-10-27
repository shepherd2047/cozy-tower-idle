// bun --preload: resolve `import ... from 'cc'` to the stub so module files load without the engine.
import { plugin } from 'bun';
import * as stub from './cc-stub';
plugin({ name: 'cc-stub', setup(b) { b.module('cc', () => ({ exports: stub as any, loader: 'object' })); } });
