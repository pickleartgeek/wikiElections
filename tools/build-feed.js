// Build feed.xml (Atom) from data/articles.json.   node tools/build-feed.js https://your.site/path/
// Site URL: first argument, or SITE_URL env, or "siteUrl" in data/site-config.json.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), { FEED_build } = require('../assets/js/feed.js');
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/site-config.json'), 'utf8')); } catch (e) {}
const site = process.argv[2] || process.env.SITE_URL || cfg.siteUrl;
if (!site) { console.error('Need a site URL: node tools/build-feed.js https://example.github.io/repo/'); process.exit(1); }
const arts = JSON.parse(fs.readFileSync(path.join(root, 'data/articles.json'), 'utf8')).articles || [];
fs.writeFileSync(path.join(root, 'feed.xml'), FEED_build(arts, site));
console.log('wrote feed.xml');
