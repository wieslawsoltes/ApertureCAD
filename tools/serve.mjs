import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..'), port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wgsl': 'text/plain', '.dxf': 'application/dxf', '.svg': 'image/svg+xml', '.png': 'image/png', '.zip': 'application/zip' };
http.createServer((req, res) => { try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/')
        pathname = '/dist/index.html';
    let file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file).pipe(res);
}
catch {
    res.writeHead(400);
    res.end('Bad request');
} }).listen(port, process.env.HOST || '127.0.0.1', () => console.log('Aperture CAD: http://localhost:' + port));
