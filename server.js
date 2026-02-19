// LEGACY SHIM
// This file was deprecated to avoid split backend logic (server.js vs app.js).
// Single source of truth is now app.js.
// Kept only for backward compatibility with old scripts/tools.
console.warn('[DEPRECATED] server.js is a compatibility shim. Use app.js as backend entrypoint.');
require('./app');
