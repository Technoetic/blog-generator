"""로컬 서버 — 정적 파일 + Imgur 프록시 + BizRouter 프록시"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import urllib.request
import urllib.error
import urllib.parse
import os

PORT = int(os.environ.get('PORT', 9090))
BIZROUTER_KEY = os.environ.get('BIZROUTER_KEY', '')
BIZROUTER_URL = 'https://api.bizrouter.ai/v1/chat/completions'
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist'))


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.end_headers()
    handler.wfile.write(body)


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/api/imgur-upload':
            self._handle_imgur()
        elif self.path == '/api/bizrouter':
            self._handle_bizrouter()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_imgur(self):
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
            _json_response(self, 200, {'link': link})
        except Exception as e:
            _json_response(self, 500, {'error': str(e)})

    def _handle_bizrouter(self):
        if not BIZROUTER_KEY:
            _json_response(self, 500, {'error': 'BIZROUTER_KEY 환경변수 미설정'})
            return
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            req = urllib.request.Request(
                BIZROUTER_URL,
                data=body,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {BIZROUTER_KEY}',
                },
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            err_body = e.read() if hasattr(e, 'read') else b''
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(err_body)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(err_body)
        except Exception as e:
            _json_response(self, 500, {'error': str(e)})

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
    print(f'BizRouter 프록시: POST /api/bizrouter (키: {"설정됨" if BIZROUTER_KEY else "미설정"})')
    HTTPServer(('', PORT), Handler).serve_forever()
