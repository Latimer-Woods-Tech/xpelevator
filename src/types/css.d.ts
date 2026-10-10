// Global stylesheet side-effect imports (e.g. `import './globals.css'` in the
// root layout). Next's own ambient declarations live in the generated, git-
// ignored `next-env.d.ts`, which does not exist on a clean checkout, and
// TypeScript 7 checks side-effect imports by default
// (`noUncheckedSideEffectImports`), so declare the module shape here.
declare module '*.css';
