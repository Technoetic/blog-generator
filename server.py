"""로컬 서버 — 정적 파일 + Imgur/BizRouter/Blogger 프록시 + 웹 검색"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import re
import urllib.request
import urllib.error
import urllib.parse
import os
import time

PORT = int(os.environ.get('PORT', 9090))
BIZROUTER_KEY = os.environ.get('BIZROUTER_KEY', '')
BIZROUTER_URL = 'https://api.bizrouter.ai/v1/chat/completions'

GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET', '')
GOOGLE_REFRESH_TOKEN = os.environ.get('GOOGLE_REFRESH_TOKEN', '')
BLOGGER_BLOG_ID = os.environ.get('BLOGGER_BLOG_ID', '')
ACCESS_PASSWORD = os.environ.get('ACCESS_PASSWORD', '')

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist'))

# 메모리 캐시: access_token + 만료시각
_token_cache = {'access_token': None, 'expires_at': 0}


def _refresh_access_token():
    """refresh_token으로 새 access_token 발급. 만료 5분 전까지 캐시 사용."""
    if _token_cache['access_token'] and _token_cache['expires_at'] > time.time() + 300:
        return _token_cache['access_token']
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN):
        raise RuntimeError('Google OAuth 환경변수 미설정')
    data = urllib.parse.urlencode({
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'refresh_token': GOOGLE_REFRESH_TOKEN,
        'grant_type': 'refresh_token',
    }).encode()
    req = urllib.request.Request('https://oauth2.googleapis.com/token', data=data, method='POST')
    with urllib.request.urlopen(req, timeout=30) as resp:
        tok = json.loads(resp.read())
    _token_cache['access_token'] = tok['access_token']
    _token_cache['expires_at'] = time.time() + int(tok.get('expires_in', 3600))
    return _token_cache['access_token']


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.end_headers()
    handler.wfile.write(body)


class Handler(SimpleHTTPRequestHandler):
    def _check_password(self):
        """X-Access-Password 헤더 검증."""
        if not ACCESS_PASSWORD:
            return True  # 비어있으면 게이트 비활성
        return self.headers.get('X-Access-Password', '') == ACCESS_PASSWORD

    def do_POST(self):
        if self.path == '/api/auth/unlock':
            self._handle_unlock()
        elif self.path == '/api/imgur-upload':
            if not self._check_password():
                _json_response(self, 401, {'error': 'unauthorized'})
                return
            self._handle_imgur()
        elif self.path == '/api/bizrouter':
            if not self._check_password():
                _json_response(self, 401, {'error': 'unauthorized'})
                return
            self._handle_bizrouter()
        elif self.path == '/api/blogger/post':
            if not self._check_password():
                _json_response(self, 401, {'error': 'unauthorized'})
                return
            self._handle_blogger_post()
        elif self.path == '/api/search':
            if not self._check_password():
                _json_response(self, 401, {'error': 'unauthorized'})
                return
            self._handle_search()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_search(self):
        try:
            n = int(self.headers.get('Content-Length', 0))
            body_in = json.loads(self.rfile.read(n) or b'{}')
            query = body_in.get('query', '').strip()
            if not query:
                _json_response(self, 400, {'error': 'query 없음'})
                return
            q = urllib.parse.quote(query)
            req = urllib.request.Request(
                f'https://html.duckduckgo.com/html/?q={q}',
                headers={'User-Agent': 'Mozilla/5.0 (compatible; BlogGenerator/1.0)'}
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                html = resp.read().decode('utf-8', errors='replace')
            titles = re.findall(r'<a[^>]*class="result__a"[^>]*>(.*?)</a>', html, re.DOTALL)
            snippets = re.findall(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', html, re.DOTALL)
            results = []
            for i, t in enumerate(titles[:8]):
                title_clean = re.sub(r'<[^>]+>', '', t).strip()
                snippet_clean = re.sub(r'<[^>]+>', '', snippets[i]).strip() if i < len(snippets) else ''
                results.append({'title': title_clean, 'snippet': snippet_clean})
            _json_response(self, 200, {'query': query, 'results': results})
        except Exception as e:
            _json_response(self, 500, {'error': str(e)})

    def _handle_unlock(self):
        try:
            n = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(n) or b'{}')
            ok = body.get('password', '') == ACCESS_PASSWORD
            _json_response(self, 200 if ok else 401, {'ok': ok})
        except Exception as e:
            _json_response(self, 500, {'error': str(e)})

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

    def _handle_blogger_post(self):
        if not BLOGGER_BLOG_ID:
            _json_response(self, 500, {'error': 'BLOGGER_BLOG_ID 환경변수 미설정'})
            return
        try:
            n = int(self.headers.get('Content-Length', 0))
            body_in = json.loads(self.rfile.read(n) or b'{}')
            title = body_in.get('title', '')
            content = body_in.get('content', '')
            labels = body_in.get('labels', [])
            is_draft = bool(body_in.get('isDraft', True))

            access_token = _refresh_access_token()
            payload = json.dumps({
                'kind': 'blogger#post',
                'title': title,
                'content': content,
                'labels': labels,
            }).encode()
            url = f'https://www.googleapis.com/blogger/v3/blogs/{BLOGGER_BLOG_ID}/posts/?isDraft={"true" if is_draft else "false"}'
            req = urllib.request.Request(
                url, data=payload, method='POST',
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {access_token}',
                },
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read())
            _json_response(self, 200, {
                'id': result.get('id'),
                'url': result.get('url'),
                'isDraft': is_draft,
            })
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if hasattr(e, 'read') else ''
            _json_response(self, e.code, {'error': err_body})
        except Exception as e:
            _json_response(self, 500, {'error': str(e)})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Access-Password')
        self.send_header('Content-Length', '0')
        self.end_headers()


if __name__ == '__main__':
    print(f'서버 시작: http://localhost:{PORT}')
    print(f'정적 파일: {os.getcwd()}')
    print(f'프록시: /api/imgur-upload, /api/bizrouter, /api/blogger/post, /api/auth/unlock')
    print(f'  BIZROUTER_KEY: {"설정됨" if BIZROUTER_KEY else "미설정"}')
    print(f'  GOOGLE_REFRESH_TOKEN: {"설정됨" if GOOGLE_REFRESH_TOKEN else "미설정"}')
    print(f'  BLOGGER_BLOG_ID: {BLOGGER_BLOG_ID or "미설정"}')
    print(f'  ACCESS_PASSWORD: {"설정됨" if ACCESS_PASSWORD else "미설정 (게이트 비활성)"}')
    HTTPServer(('', PORT), Handler).serve_forever()
