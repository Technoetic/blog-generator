# 비유 블로그 생성기

BizRouter + Gemini 2.5 Flash Lite 기반 6-Agent 파이프라인으로 비유 블로그를 자동 생성하고 Blogger에 발행합니다.

## 실행

```bash
# 1. 빌드
python build.py

# 2. 서버 시작
python server.py

# 3. 브라우저 접속
# http://localhost:9090/index.html
```

## 구조

```
src/
├── index.html          ← 엔트리 HTML
├── css/main.css        ← 스타일
└── js/
    ├── config.js       ← API 키, 모델 설정
    ├── ApiClient.js    ← BizRouter API, 이미지 생성, Imgur
    ├── BlogAssembler.js ← 마크다운→HTML, 블로그 조립
    ├── PipelineUI.js   ← Phase 상태, 탭, 비용 표시
    ├── AuthManager.js  ← Google OAuth2, Blogger API
    ├── Pipeline.js     ← 파이프라인 오케스트레이터
    └── app.js          ← 엔트리포인트

server.py               ← 정적 파일 + Imgur 프록시 서버
build.py                ← src/ → dist/index.html 번들러
```

## 파이프라인

1. **Phase 1** — 웹 검색 + 주제 분석 + 비유 선정
2. **Phase 2a** — 비유설계 + 검증
3. **Phase 2b** — 글작성 + 이미지프롬프트 (병렬)
4. **Phase 3a** — 검증 (재시도 최대 2회)
5. **Phase 3b** — 팩트체크
6. **Phase 3c** — 이미지 생성 + Imgur 업로드 + 조립
7. **Phase 4** — 품질 평가
8. **Phase 5** — Blogger 발행
