// Anonymous page-view counts with Cloudflare Web Analytics (free, no cookies,
// no personal data). Only page loads are counted – never sound, scores or
// settings. Paste the site token from the Cloudflare dashboard below; while it
// is empty nothing is loaded. It also never loads on localhost or test pages.

export const CLOUDFLARE_TOKEN = '140ee2dd27624f5fa40d23dd564b97e8';

export const ANALYTICS_ON = !!CLOUDFLARE_TOKEN && /\.github\.io$/i.test(location.hostname);

export function startAnalytics() {
  if (!ANALYTICS_ON) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token: CLOUDFLARE_TOKEN }));
  document.head.appendChild(s);
}
