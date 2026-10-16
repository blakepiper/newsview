function logApiRequests(req, res, next) {
  const pathname = req.originalUrl.split('?')[0];
  if (pathname.startsWith('/api/')) {
    const started = performance.now();
    res.once('finish', () => {
      // Successful animation tiles are noisy; keep every feed request and tile failure.
      if (pathname === '/api/radar/tile' && res.statusCode < 400) return;
      console.log(`[API] ${req.method} ${pathname} ${res.statusCode} ${Math.round(performance.now() - started)}ms`);
    });
  }
  next();
}
module.exports = { logApiRequests };
