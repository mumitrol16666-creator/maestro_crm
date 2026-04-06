const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  
  let filePath;
  // Serve static assets directly from frontend directory
  if (urlPath.startsWith('/css/') || urlPath.startsWith('/js/') || urlPath.startsWith('/assets/')) {
    filePath = path.join(__dirname, urlPath);
  } else {
    // Serve HTML files from public directory with extensionless routing
    if (urlPath === '/' || urlPath === '') {
      urlPath = '/index';
    }
    
    // Check if it's explicitly requesting an .html file
    if (urlPath.endsWith('.html')) {
        filePath = path.join(__dirname, 'public', urlPath);
    } else {
        // Assume extensionless path
        filePath = path.join(__dirname, 'public', urlPath + '.html');
    }
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log(`404 Not Found: ${filePath}`);
      res.writeHead(404);
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
}).listen(8000, '0.0.0.0', () => {
    console.log('✅ Frontend Nginx-Mock Server running at http://localhost:8000');
});
