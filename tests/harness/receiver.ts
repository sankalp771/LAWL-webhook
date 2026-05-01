import { createServer } from 'http';

const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/hook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      console.log('[RECEIVED]', body);
      if (req.headers['x-webhook-signature']) {
        console.log('[SIGNATURE]', req.headers['x-webhook-signature']);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(4000, () => {
  console.log('Mock receiver listening on http://localhost:4000/hook');
});
