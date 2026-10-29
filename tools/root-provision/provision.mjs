// Compatibility entrypoint. The executable lives next to sheet-import's
// node_modules so @supabase/supabase-js resolves without a second install.
await import('../sheet-import/root-provision.mjs');
