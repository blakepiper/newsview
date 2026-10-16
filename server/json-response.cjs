const { gzip } = require('node:zlib');
const { createHash } = require('node:crypto');
// Hash the uncompressed representation so a refresh can return 304 before gzip.
function jsonResponses(req, res, next) {
  const original = res.json.bind(res);
  res.json = value => {
    const body = JSON.stringify(value);
    if (body === undefined) return original(value);
    const etag = `W/"${createHash('sha1').update(body).digest('base64')}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'private, no-cache');
    res.vary('Accept-Encoding');
    res.type('json');
    if (req.fresh) return res.status(304).end();
    if (Buffer.byteLength(body) < 1024 || req.acceptsEncodings('gzip') !== 'gzip') return res.send(body);
    gzip(body, { level: 4 }, (error, compressed) => {
      if (res.destroyed) return;
      if (error) return res.send(body);
      res.set('Content-Encoding', 'gzip');
      res.send(compressed);
    });
    return res;
  };
  next();
}
module.exports = { jsonResponses };
