"""로컬 서버 — 정적 파일 + Imgur 프록시"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import urllib.request
import urllib.parse
import os

PORT = int(os.environ.get('PORT', 9090))
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist'))

class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/imgur-upload':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body)
                base64_image = data.get('image', '')

                req_data = urllib.parse.urlencode({'image': base64_image, 'type': 'base64'}).encode()
                req = urllib.request.Request(
                    'https://api.imgur.com/3/image',
                    data=req_data,
                    headers={'Authorization': 'Client-ID 546c25a59c58ad7'}
                )

                with urllib.request.urlopen(req, timeout=120) as resp:
                    result = json.loads(resp.read())
                    link = result.get('data', {}).get('link', '')

                response = json.dumps({'link': link}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(response)
            except Exception as e:
                response = json.dumps({'error': str(e)}).encode()
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(response)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(response)
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Content-Length', '0')
        self.end_headers()

if __name__ == '__main__':
    print(f'서버 시작: http://localhost:{PORT}')
    print(f'정적 파일: {os.getcwd()}')
    print(f'Imgur 프록시: POST /api/imgur-upload')
    HTTPServer(('', PORT), Handler).serve_forever()
