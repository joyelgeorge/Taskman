import { createHash } from 'node:crypto';
import { droneFetch } from './fetch.js';

const hash = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

const stripCdata = value => String(value ?? '')
  .replace(/^\s*<!\[CDATA\[/, '')
  .replace(/\]\]>\s*$/, '')
  .trim();

const decode = value => stripCdata(value)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&amp;/g, '&');

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? decode(match[1]) : null;
}

function linkOf(block) {
  const direct = tag(block, 'link');
  if (direct) return direct;
  // Atom puts the URL in an attribute rather than the element body.
  const href = block.match(/<link[^>]*\shref=["']([^"']+)["']/i);
  return href ? decode(href[1]) : null;
}

/** Reads an RSS 2.0 or Atom feed. Hand-parsed so the package stays dependency-free. */
export const rssDrone = {
  kind: 'rss',

  async collect(drone, { fetchImpl } = {}) {
    const { text, latencyMs } = await droneFetch(drone.targetUrl, {
      fetchImpl,
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8' }
    });

    const blocks = text.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
    if (!blocks.length && !/<(rss|feed)\b/i.test(text)) {
      throw new Error('response did not look like an RSS or Atom feed');
    }

    const limit = Number(drone.config?.limit || 50);
    const signals = blocks.slice(0, limit).map(block => {
      const title = tag(block, 'title');
      const url = linkOf(block);
      const guid = tag(block, 'guid') || tag(block, 'id') || url || title;
      return {
        fingerprint: hash(guid),
        kind: drone.config?.kind || 'feed_item',
        title: title ? title.slice(0, 500) : null,
        url: url ? url.slice(0, 1000) : null,
        payload: {
          guid,
          publishedAt: tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated'),
          summary: (tag(block, 'description') || tag(block, 'summary') || '').slice(0, 2000)
        },
        observedAt: new Date().toISOString()
      };
    });

    return { signals, meta: { latencyMs, itemsSeen: blocks.length } };
  }
};
