export function validateRuntimeConfig(input: { mode: 'local' | 'demo_remote'; url: string; publishableKey: string; allowedDemoHosts: string[] }): { url: string; publishableKey: string } {
  let url: URL;
  try { url = new URL(input.url); } catch { throw Error('Invalid public Supabase host (VITE_SUPABASE_URL)'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Invalid public Supabase host');
  if (input.mode === 'local') {
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Local mode requires HTTP loopback host');
  } else if (input.mode === 'demo_remote') {
    if (url.protocol !== 'https:' || url.port || !input.allowedDemoHosts.includes(url.hostname) || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Demo host must be explicitly approved with HTTPS');
  } else throw Error('Invalid public runtime mode');
  // Host approval precedes even reading the supplied public credential.
  const publishableKey = input.publishableKey?.trim();
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey ?? '');
  if (!publicKey && publishableKey?.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(publishableKey.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))) as { role?: unknown };
      publicKey = payload.role === 'anon';
    } catch { /* Unknown/malformed credentials fail closed. Never echo keys. */ }
  }
  if (!publicKey || !publishableKey) throw Error('Frontend requires a public key (VITE_SUPABASE_PUBLISHABLE_KEY), never an administrative credential');
  return { url: url.origin, publishableKey };
}
