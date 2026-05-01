<div align="center">

# 비유 블로그 생성기

### 7-Agent 오케스트레이션 × 비유 적합도 독립 판정 × 손그림 다이어그램 × 자동 발행

[![Live Demo](https://img.shields.io/badge/라이브_데모-Railway-blueviolet?style=for-the-badge)](https://blog-generator-production-5f73.up.railway.app/index.html)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![JavaScript](https://img.shields.io/badge/Vanilla_JS-ES2024-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org)
[![Gemini](https://img.shields.io/badge/Gemini_2.5-Flash_Lite-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev)
[![Blogger](https://img.shields.io/badge/Blogger-API_v3-FF5722?style=for-the-badge&logo=blogger&logoColor=white)](https://developers.google.com/blogger)
[![Excalidraw](https://img.shields.io/badge/Excalidraw-Hand_Drawn-6965DB?style=for-the-badge)](https://excalidraw.com)

<br/>

**기술 주제 한 줄**을 입력하면 **7개 AI 에이전트**(Gemini 2.5 + Claude Haiku 4.5 cross-vendor)가 비유 설계 → 적합도 4차원 독립 판정 → 글쓰기 → 팩트체크 → 평가까지 자동으로 수행하고,<br/>
elkjs 직교 라우팅으로 박스 침범 없는 손그림 다이어그램과 AI 생성 이미지(Vision 검증)가 포함된 완성된 블로그 포스트를 **Blogger에 즉시 발행**합니다.

[<img src="assets/playnow.gif" width="440" alt="지금 생성하기">](https://blog-generator-production-5f73.up.railway.app/index.html)

[핵심 기능](#-핵심-기능) | [에이전트 아키텍처](#-에이전트-아키텍처) | [파이프라인 흐름](#-파이프라인-흐름) | [실행 방법](#-실행-방법)

<br/>

<img src="assets/intro.gif" width="100%" alt="7-Agent 파이프라인 카드 애니메이션">

</div>

---

## 목차

- [프로젝트 소개](#-프로젝트-소개)
- [프로젝트 요약](#-프로젝트-요약)
- [핵심 기능](#-핵심-기능)
- [에이전트 아키텍처](#-에이전트-아키텍처)
- [파이프라인 흐름](#-파이프라인-흐름)
- [기술 스택](#-기술-스택)
- [Excalidraw 손그림 렌더링](#-excalidraw-손그림-렌더링)
- [신뢰성 보장](#-신뢰성-보장)
- [프로젝트 구조](#-프로젝트-구조)
- [실행 방법](#-실행-방법)
- [팀 소개](#-팀-소개)
- [참고 자료](#-참고-자료)

---

## 프로젝트 소개

> [!IMPORTANT]
> **"쉬운 비유는 전문가만 안다"** — 기술을 다른 세계의 구조로 1:1 매핑하는 건 자동화가 어려운 작업입니다. 본 프로젝트는 이를 **7개 전문 에이전트의 병렬 오케스트레이션**으로 해결합니다.

사용자가 기술 주제를 입력하면, **비유 설계 / 글 작성 / 이미지 프롬프트 / 검증 / 팩트체크 / 평가 / 적합도 판정** 역할을 분리한 7개 LLM 에이전트가 단계별로 협력합니다. 최종 출력물에는 **Excalidraw 손그림 다이어그램**(한글 Gaegu 폰트), **AI 생성 이미지 3장**, **마크다운 테이블**이 포함되고, Blogger API로 즉시 발행됩니다.

### 문제 정의 & 해결책

```mermaid
graph LR
    subgraph problems["기존 AI 블로그 생성의 문제"]
        P1["단일 LLM 호출은<br/>깊이가 얕음"]
        P2["비유가 표면적이고<br/>구조 매핑이 없음"]
        P3["기술적 오류가<br/>검증 없이 노출"]
        P4["다이어그램이<br/>텍스트 박스로 대체"]
        P5["수작업 복사/붙여넣기<br/>블로그 발행"]
    end

    subgraph solutions["본 프로젝트의 해결책"]
        S1["7 Agent 파이프라인<br/>역할 분리 + 재시도"]
        S2["Agent ① 비유설계<br/>+ Agent ④ 검증 게이트"]
        S3["Agent ⑥ 팩트체크<br/>Perplexity Sonar 웹 검색"]
        S4["mermaid → Excalidraw<br/>손그림 PNG 자동 변환"]
        S5["Blogger API v3<br/>Refresh Token 자동 발행"]
    end

    P1 --> S1
    P2 --> S2
    P3 --> S3
    P4 --> S4
    P5 --> S5

    style P1 fill:#ff6b6b,color:#fff
    style P2 fill:#ff6b6b,color:#fff
    style P3 fill:#ff6b6b,color:#fff
    style P4 fill:#ff6b6b,color:#fff
    style P5 fill:#ff6b6b,color:#fff
    style S1 fill:#51cf66,color:#fff
    style S2 fill:#51cf66,color:#fff
    style S3 fill:#51cf66,color:#fff
    style S4 fill:#51cf66,color:#fff
    style S5 fill:#51cf66,color:#fff
```

---

## 프로젝트 요약

본 프로젝트는 **기술 키워드 한 줄**을 입력하면 그림과 다이어그램이 포함된 완성된 한국어 블로그를 Blogger에 자동 발행하는 **엔드투엔드 AI 블로그 생성 플랫폼**입니다.

**7개 에이전트 오케스트레이션** 파이프라인 — 비유설계 / 글작성 / 이미지프롬프트 / 검증 / 평가 / 팩트체크 / 적합도판정 — 가 순차 실행되며 일부 단계는 병렬로 돌아갑니다. 각 에이전트는 Gemini 2.5 Flash (Lite)에서 **역할에 맞는 thinking budget과 temperature**로 독립 최적화되어 있습니다. 글작성 에이전트가 내놓은 모든 `mermaid` 코드블록은 **Excalidraw 손그림 렌더러**로 브라우저에서 PNG로 래스터화되고, 한글은 **Gaegu 손글씨 폰트**로 표시된 뒤 Imgur에 업로드되어 블로그에 삽입됩니다.

Phase 1에서는 **2-tier 웹 검색**(DuckDuckGo HTML 스크래핑 → 실패 시 Perplexity Sonar 자동 fallback)으로 LLM 컷오프/환각 문제를 선제 차단합니다. 검증 에이전트는 **4단계 품질 게이트**(조사 → 측정 → 근거 → 판정)를 강제하고, 팩트체크 에이전트는 모든 기술 주장을 검증하며, 평가 에이전트는 7개 루브릭으로 최종 블로그를 채점합니다. 실패한 에이전트는 **실패 사유를 feedback으로 주입받아** 2~3회 개별 재시도됩니다. 최종 포스트는 **Blogger API v3의 Refresh Token 플로우**로 자동 발행됩니다.

---

## 핵심 기능

<div align="center">
<img src="assets/mid.gif" width="90%" alt="7 에이전트 순차 실행 + Excalidraw 변환">
</div>

<br/>

### 1. 주제 → 블로그 자동 생성

기술 주제 한 줄 입력 → 3~5분 안에 완성된 블로그가 Blogger에 발행됩니다.

| 입력 | 자동 수행 | 출력 |
|:---:|:---|:---|
| `"MCP 서버"` | Phase 1~5 (7 Agent 순차/병렬) | Blogger 포스트 URL |
| 톤 오버라이드 | `친근` / `전문` / `유머` | 톤 맞춤 본문 |
| 비율 오버라이드 | `16:9` / `1:1` / `4:3` / `9:16` | AI 이미지 3장 |

### 2. 7-Agent 오케스트레이션

> [!TIP]
> 각 에이전트는 **역할·온도·thinking budget**이 전부 다릅니다. 구현 에이전트는 창의성(temp 0.7), 검증·평가는 결정론적(temp 0.0). Agent ⑦은 **cross-vendor**(Anthropic Claude Haiku)로 Gemini 자기검증 편향 회피.

| # | 에이전트 | 역할 | Model | temp | thinking | 비고 |
|:---:|:---|:---|:---|:---:|:---:|:---|
| ① | **비유설계** | 비유↔기술 구조 매핑 | Gemini Flash | 0.7 | 2048 | 3회 재시도 + alternatives feedback + 비유 거부권 |
| ② | **글작성** | 한국어 본문 생성 | Gemini Flash | 0.7 | 2048 | 5게이트 검증 + 2회 재시도 |
| ③ | **이미지프롬프트** | intro/middle/outro | Gemini Lite | 0.7 | 0 | 영문 프롬프트, 비유 세계관 시각 요소 강제, 기술 용어 직접 묘사 금지 |
| ④ | **검증** | 4단계 명세 검증 (A·B) | Gemini Lite | 0.0 | 2048 | A6 본질 매핑 + B15 mermaid 16자/8노드/4단계 룰 |
| ⑤ | **평가** | 7-rubric 품질 채점 | Gemini Lite | 0.0 | 2048 | 가중 평균 ≥ 3.5 통과 |
| ⑥ | **팩트체크** | 기술 사실 확인 + 비유 매핑 검증 | **Perplexity Sonar** | 0.0 | — | **내장 웹 검색** (실시간 grounding) |
| ⑦ | **적합도판정** | 비유 본질 매핑 4차원 독립 평가 | **Claude Haiku 4.5** | 0.0 | 4096 | **cross-vendor**(자기검증 편향 회피) + 입력/메커니즘/출력/갈등 |

### 3. Excalidraw 손그림 렌더링

> [!NOTE]
> 작성 에이전트가 출력한 `mermaid` 코드블록을 **브라우저에서 실시간**으로 Excalidraw 손그림 PNG로 변환합니다. 한글은 Gaegu 손글씨 폰트로 렌더링되고, 박스마다 파스텔 컬러 6색이 자동 로테이션됩니다.

```mermaid
flowchart TD
    M["writer 출력<br/>mermaid 블록"] --> P["parseMermaidToExcalidraw"]
    P --> S["label → text element<br/>재구성 (한글 보존)"]
    S --> C["pastel palette<br/>+ hachure fill"]
    C --> SVG["exportToSvg<br/>+ Gaegu 주입"]
    SVG --> PNG["canvas.drawImage<br/>→ PNG"]
    PNG --> IMG["imgur 업로드"]
    IMG --> BLOG["Blogger HTML<br/>img src=..."]

    style M fill:#4c6ef5,color:#fff
    style BLOG fill:#40c057,color:#fff
```

### 4. 신뢰성 게이트

| Gate | 시점 | 담당 | 조건 | 실패 시 |
|:---|:---|:---|:---|:---|
| **적합도 P1** | Phase 1 | Agent ⑦ (Claude Haiku) | 4차원 본질 매핑 평균 ≥ 8 | 후보 3개 추가 생성 (최대 2회) |
| **검증 A** | Phase 2a | Agent ④ | fitness ≥ 7, mapping 완전성, A6 본질 매핑 | Agent ① 재시도 (3회) + alternatives 명시 |
| **적합도 P2a** | Phase 2a | Agent ⑦ | Designer가 비유 변경 시만 재평가 (스킵 최적화) | Agent ① 재시도 |
| **검증 B** | Phase 3a | Agent ④ | 테이블 2+, 다이어그램 2+, B15 mermaid 16자/8노드/4단계 | 원인 에이전트 재실행 |
| **팩트체크** | Phase 3b | Agent ⑥ | 기술 주장 F1~F4 통과 | Agent ② 재실행 |
| **Vision** | Phase 3c | Gemini Vision | 이미지가 비유 세계관 시각 요소 포함 | 7회 재시도 (실패 시 fallback 발행) |
| **평가** | Phase 4 | Agent ⑤ | 가중 평균 ≥ 3.5 | 구현 에이전트 재실행 (2회) |

**다이어그램 자동 보정 (BlogAssembler)**:
- **cycle 자동 제거** (`removedArrowIds`): DFS gray-set으로 back edge 검출 → 무효화 → DAG 강제
- **고립 노드 제거** (`isolatedIds`): in/out degree 0 박스 자동 제외
- **elkjs ORTHOGONAL 라우팅**: 박스 침범 0건 보장 (직교 엣지 라우터)
- **clampOutsideBox + HEAD_GAP=12**: 화살표 머리 박스 외부 정확히 닿음
- **edgeNode=100**: bend 직선 박스 외곽선 평행 라우팅 차단
- **edge label 비활성화**: 박스 코너 겹침/세로 회전 결함 차단

**제목 환각 차단**:
- **R0**: 영문자/특수문자/한자 차단 ("Untitle:" 같은 영어 환각 즉시 차단)
- **R1~R9**: 길이 6~14자, topic 중복, 동사 종결, 추상어+구체 모호 결합 등 9개 룰
- **자동 필터링**: Designer 출력 후 6~14자 위반 후보 자동 제거 (B13 FAIL 사전 차단)
- **L1~L6 다층 방어**: cumulativePool + LLM-as-Judge + 사용자 거부권

### 5. 웹 검색으로 LLM 컷오프 극복 (2-tier Fallback)

> [!IMPORTANT]
> Gemini 지식 컷오프 이후의 기술이나 잘 알려지지 않은 한국어 표기(예: "오픈클로")는 LLM이 유사한 다른 용어(OpenCL)로 대체하는 환각이 발생합니다. Phase 1에서 **2단계 실시간 웹 검색**으로 이를 선제 차단합니다.

```mermaid
flowchart TD
    U["사용자 입력<br/>오픈클로"] --> DG["/api/search<br/>DuckDuckGo 스크래핑"]
    DG -->|결과 있음| E["canonical_name 추출<br/>빈도 카운트 threshold 3+"]
    DG -->|0건/실패| SONAR["Perplexity Sonar<br/>내장 웹 검색"]
    SONAR --> E2["canonical_name<br/>+ 검색 결과 4~6건"]
    E --> T["topic 교체"]
    E2 --> T
    T --> LLM["6 Agent에 정확한 컨텍스트 전달"]

    style DG fill:#339af0,color:#fff
    style SONAR fill:#f76707,color:#fff
    style T fill:#40c057,color:#fff
    style LLM fill:#7950f2,color:#fff
```

| 레이어 | 엔진 | 비용 | 트리거 |
|:---|:---|:---|:---|
| **1차** | DuckDuckGo HTML 스크래핑 | 무료 | 항상 |
| **2차** | Perplexity Sonar (BizRouter) | ~₩8/건 | 1차가 0건 반환 시 |

**단계별 로직:**

| 단계 | 설명 |
|:---|:---|
| 1차 검색 | DuckDuckGo HTML 페이지 스크래핑 (API 키 불필요) |
| canonical 추출 | title + snippet에서 `[A-Z][a-zA-Z0-9]+` 빈도 카운트, 3회 이상이면 채택 |
| 한글 우선 로직 | 사용자 입력에 영문 3자+ 있으면 추출 스킵 (이미 정식 명칭) |
| **2차 Sonar fallback** | DuckDuckGo 공백 시 Perplexity Sonar(내장 웹 검색) 자동 호출 |
| 3차 방어 | 이것도 실패하면 Agent ⑥ 팩트체크가 최종 차단 |

**실측 검증**: "런웨이ML" (DuckDuckGo 0건) → Sonar가 `canonical=Runway ML` + 공식사이트 4건 반환

### 6. Blogger API 자동 발행

- **Refresh Token 플로우** — 토큰 서버 저장, 5분 버퍼 자동 갱신
- **마크다운 → HTML** — 인라인 스타일 주입 (Blogger `<style>` sanitize 우회)
- **테이블 헤더 자동 보정** — LLM이 header 누락 시 sentinel 삽입 → 후처리 제거

### 7. 게임 UX — 진행감 + 쾌감

> [!TIP]
> 5분이 걸릴 수도 있는 파이프라인을 **게임 점수판처럼** 만들어 사용자가 멈춘 게 아닌지 의심할 일이 없습니다.

- **글래스모피즘 UI** — 라디얼 그라데이션 배경 + 24px 블러 + saturate(180%)
- **Phase 게이지 % 표시** — 예상 시간 기반 점근(95% asymptotic) 진행도
- **전체 % 라이브 카운트** — 매초 0.1% 단위 부드러운 업데이트
- **토큰/비용 ticker** — 매초 phase별 예상 rate로 가산, 실측 도달 시 snap + 골드 펄스 + delta 토스트
- **스테이지 클리어 4중 콤보** — 아이콘 1.35× 글로우, 행 그린 sweep, sparkle 8개 폭발, "✦ CLEAR!" 토스트
- **필살기 발동 모달** — 발행 완료 시 화면 플래시 + 별빛 광선 + 컨페티 40개 + 모달 슬램 + "QUEST CLEAR / BLOG PUBLISHED!" 골드 텍스트 + Stat 카드 (TOKENS/COST/TIME)
- **취소 버튼** — 진행 중 즉시 abort (AbortController)
- **sub-status 라이브** — 예: `intro 생성 3/7 · middle 대기 8s (4/7) · outro ✓`

---

## 에이전트 아키텍처

```mermaid
graph TB
    subgraph client["클라이언트 — Browser"]
        UI["index.html<br/>(글래스모피즘 UI)"]
        PIPE["Pipeline.js<br/>오케스트레이터 + AbortController"]
        ASM["BlogAssembler.js<br/>마크다운 + Excalidraw 변환"]
        UI_MGR["PipelineUI.js<br/>게이지/sub-status/필살기 모달"]
        AUTH["AuthManager.js<br/>Blogger 수동 발행"]
    end

    subgraph server["Python http.server — Railway<br/>(ThreadingHTTPServer, 요청별 스레드)"]
        BIZ["/api/bizrouter<br/>LLM 게이트웨이 프록시"]
        IMG["/api/imgur-upload<br/>서버측 7회 재시도"]
        SRCH["/api/search<br/>DuckDuckGo 스크래핑"]
        BLOG_P["/api/blogger/post<br/>Refresh Token 자동갱신"]
    end

    subgraph external["외부 API"]
        BR[("BizRouter<br/>OpenAI 호환 게이트웨이")]
        GM[("Gemini 2.5 Flash/Lite<br/>비유설계/글작성/검증/평가")]
        SONAR[("Perplexity Sonar<br/>Phase 1 fallback + Phase 3b 팩트체크<br/>내장 웹 검색")]
        NB[("Nano Banana<br/>이미지 생성 (7회 재시도)")]
        IMGUR[("Imgur API<br/>이미지 호스팅")]
        BLOGGER[("Blogger API v3<br/>OAuth2")]
    end

    UI --> PIPE
    PIPE --> ASM
    PIPE --> UI_MGR
    PIPE --> BIZ
    PIPE --> IMG
    PIPE --> SRCH
    AUTH --> BLOG_P
    BIZ --> BR
    BR --> GM
    BR --> SONAR
    BR --> NB
    IMG --> IMGUR
    BLOG_P --> BLOGGER

    style client fill:#1a1a2e,color:#fff
    style server fill:#16213e,color:#fff
    style external fill:#533483,color:#fff
```

> [!NOTE]
> 모든 API 키는 **Python http.server 프록시**에 격리됩니다. 클라이언트는 `BIZROUTER_KEY`, `IMGUR_CLIENT_ID`, `GOOGLE_REFRESH_TOKEN`을 절대 알지 못합니다. ThreadingHTTPServer 덕에 이미지 3장 병렬 업로드 시에도 서버측 retry가 다른 요청을 블록하지 않습니다.

---

## 파이프라인 흐름

### 전체 7-Agent 오케스트레이션

```mermaid
flowchart TD
    USER["사용자 입력<br/>기술 주제"] --> P1["Phase 1<br/>DuckDuckGo → Sonar fallback<br/>+ 비유 후보 3개 생성"]
    P1 --> AGENT7A["Agent ⑦ Adequacy<br/>4차원 본질 매핑 평가<br/>최고점 < 8 시 후보 재생성"]
    AGENT7A --> CTX["컨텍스트 패킷<br/>(최고점 비유)"]
    CTX --> AGENT1["Agent ①<br/>비유설계 (거부권 가능)"]

    AGENT1 --> SKIP{"Designer가<br/>Phase 1 비유 그대로?<br/>+ 점수 ≥ 8?"}
    SKIP -->|YES| AGENT4A["Agent ④<br/>검증 A"]
    SKIP -->|NO| AGENT7B["Agent ⑦<br/>Adequacy 재평가"]
    AGENT7B -->|PASS| AGENT4A
    AGENT7B -->|FAIL| AGENT1

    AGENT4A -->|PASS| PAR["Phase 2b<br/>병렬 실행"]
    AGENT4A -->|FAIL| AGENT1

    PAR --> AGENT2["Agent ②<br/>글작성"]
    PAR --> AGENT3["Agent ③<br/>이미지 프롬프트"]

    AGENT2 & AGENT3 --> AGENT4B["Agent ④<br/>검증 B"]
    AGENT4B -->|PASS| AGENT6["Agent ⑥<br/>팩트체크"]
    AGENT4B -->|FAIL| AGENT2

    AGENT6 -->|PASS| P3C["Phase 3c<br/>이미지 생성 + Vision 검증<br/>+ mermaid → Excalidraw + cycle 자동 제거"]
    AGENT6 -->|FAIL| AGENT2

    P3C --> AGENT5["Agent ⑤<br/>평가 (7 rubric)"]
    AGENT5 -->|PASS| P5["Phase 5<br/>Blogger 발행"]
    AGENT5 -->|IMPROVE| AGENT2

    P5 --> URL["Blogger URL"]

    style USER fill:#4c6ef5,color:#fff
    style AGENT7A fill:#06b6d4,color:#fff
    style AGENT7B fill:#06b6d4,color:#fff
    style AGENT1 fill:#fab005,color:#000
    style AGENT2 fill:#fab005,color:#000
    style AGENT3 fill:#fab005,color:#000
    style AGENT4A fill:#e03131,color:#fff
    style AGENT4B fill:#e03131,color:#fff
    style AGENT6 fill:#7950f2,color:#fff
    style AGENT5 fill:#845ef7,color:#fff
    style URL fill:#40c057,color:#fff
```

### Phase별 요약

| Phase | 이름 | 담당 | 결과물 |
|:---:|:---|:---|:---|
| **1** | 웹 검색 + 비유 후보 3개 + 4차원 적합도 평가 + 최고점 선택 (< 8 시 재생성) | Orchestrator + Agent ⑦ | 컨텍스트 패킷 |
| **2a** | 비유설계 + Adequacy 재평가(스킵 가능) + 검증 A | Agent ① → ⑦ → ④ | 설계서 |
| **2b** | 글작성 + 이미지프롬프트 (병렬) | Agent ② + ③ | 본문 + 프롬프트 |
| **3a** | 검증 B (16자/8노드/4단계 + cycle 자동 제거 신뢰) | Agent ④ | verdict + fail list |
| **3b** | 팩트체크 | Agent ⑥ | PASS/FAIL |
| **3c** | 이미지 생성 + Vision 검증 + mermaid → Excalidraw (elkjs 직교 + cycle 자동 제거 + 고립 노드 제거) | Pipeline | 최종 조립물 |
| **4** | 품질 평가 | Agent ⑤ | 점수 + 개선안 |
| **5** | Blogger 발행 | AuthManager | 포스트 URL |

### AI 챗봇 계열 시퀀스 (Phase 2a 검증 재시도)

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant A1 as Agent ① Designer
    participant A4 as Agent ④ Verifier

    O->>A1: 컨텍스트 패킷
    A1-->>O: 설계서 (fitness 5)
    O->>A4: 검증 요청
    A4-->>O: FAIL (fitness < 7)
    rect rgb(60, 60, 180)
      O->>A1: 재시도 + fail_summary
      A1-->>O: 설계서 (fitness 8)
      O->>A4: 재검증
      A4-->>O: PASS
    end
    O->>O: Phase 2b 진행
```

---

## 기술 스택

```mermaid
graph TD
    subgraph frontend["프론트엔드"]
        VJS["Vanilla JS<br/>7 Class 모듈"]
        UI_MGR["PipelineUI.js<br/>게이지/필살기 모달/ticker"]
        GLASS["글래스모피즘<br/>backdrop-filter blur(24px)"]
        MARKED["marked.js"]
        EXCAL["Excalidraw<br/>mermaid-to-excalidraw"]
        ELK["elkjs 0.9.3<br/>ORTHOGONAL 직교 라우팅"]
        GAEGU["Gaegu Font<br/>Google Fonts"]
        ABORT["AbortController<br/>취소 + fetch timeout"]
    end

    subgraph backendStack["백엔드"]
        PY["Python 3.11<br/>http.server"]
        THR["ThreadingHTTPServer<br/>요청별 스레드"]
        PROXY["Proxy Handlers<br/>CORS + 키 격리"]
        IMGRTR["Imgur 7회 retry<br/>지수 백오프"]
    end

    subgraph aiStack["AI / LLM"]
        BIZ["BizRouter<br/>OpenAI 호환 게이트웨이"]
        GM2["Gemini 2.5 Flash<br/>설계/작성"]
        GM["Gemini 2.5 Flash Lite<br/>검증/평가/이미지프롬프트"]
        CLAUDE["Claude Haiku 4.5<br/>Adequacy Judge (cross-vendor)"]
        SONAR["Perplexity Sonar<br/>웹 검색 (내장)"]
        NB["Nano Banana<br/>gemini-2.5-flash-image"]
        VISION["Gemini Vision<br/>이미지-비유 일치 검증"]
    end

    subgraph infra["인프라 / DevOps"]
        RAIL["Railway"]
        DOCK["Docker"]
        PW["Playwright<br/>E2E 테스트"]
    end

    style frontend fill:#264653,color:#fff
    style backendStack fill:#2a9d8f,color:#fff
    style aiStack fill:#e9c46a,color:#000
    style infra fill:#e76f51,color:#fff
```

| 분류 | 기술 | 용도 |
|:---|:---|:---|
| **프론트엔드** | Vanilla JavaScript (ES2024) | 7개 Class 모듈 (Pipeline, BlogAssembler, ApiClient, PipelineUI 등) |
| | 글래스모피즘 CSS | `backdrop-filter: blur(24px) saturate(180%)` + 라디얼 그라데이션 배경 |
| | 게임 UX (CSS keyframes) | Phase 게이지/필살기 모달/sparkle 폭발/스테이지 클리어 콤보 |
| | AbortController + fetch timeout | 90s LLM / 60s 이미지 / 180s 업로드 + 사용자 취소 |
| | marked.js | 마크다운 → HTML 변환 |
| | `@excalidraw/mermaid-to-excalidraw` | mermaid → Excalidraw skeleton |
| | `@excalidraw/excalidraw` | SVG/Canvas 렌더링 |
| | **`elkjs` 0.9.3** | ORTHOGONAL 직교 엣지 라우팅 (박스 침범 0건 보장) |
| | Gaegu (Google Fonts) | 한글 손글씨 폰트 |
| **백엔드** | Python 3.11 `http.server` | 경량 정적 파일 + 프록시 |
| | **ThreadingHTTPServer** | 요청별 스레드 — 이미지 3장 병렬 업로드 블로킹 차단 |
| | Imgur 서버측 7회 재시도 | 누적 ~2분 백오프 (502/500 자동 회복) |
| | refresh_token flow | Blogger OAuth2 자동 갱신 |
| | DuckDuckGo HTML 스크래핑 | 주제 조사 1차 (무료, 무인증) |
| **LLM / AI** | BizRouter | OpenAI 호환 LLM 게이트웨이 |
| | Gemini 2.5 Flash | 비유설계 · 글작성 (심층 추론) |
| | Gemini 2.5 Flash Lite | 검증 · 평가 · 이미지프롬프트 (저지연 · 결정론) |
| | **Claude Haiku 4.5** | Adequacy Judge — 비유 본질 매핑 4차원 독립 판정 (cross-vendor) |
| | **Perplexity Sonar** | Phase 1 fallback + Phase 3b 팩트체크 (내장 웹 검색) |
| | **Nano Banana** (`gemini-2.5-flash-image`) | intro/middle/outro 이미지 생성 (7회 재시도) |
| | **Gemini Vision** | 이미지-비유 일치 검증 (3c) |
| **인프라** | Railway | 배포 (Docker + 환경변수) |
| | Docker | 컨테이너화 |
| | Playwright | E2E 스크립트 자동 테스트 |

---

## Excalidraw 손그림 렌더링

> [!IMPORTANT]
> 9번의 재검토 끝에 도달한 핵심 발견: `mermaid-to-excalidraw`는 라벨을 **속성으로만** 저장합니다. 한글이 렌더링 안 되는 건 폰트 문제가 아니라 **라벨이 text element로 확장되지 않아서**였습니다.

### 변환 파이프라인

```mermaid
flowchart TD
    MD["writer 출력<br/>&#96;&#96;&#96;mermaid graph TD..."] --> PARSE["mermaid-to-excalidraw<br/>parseMermaidToExcalidraw"]
    PARSE --> SK["skeleton 재구성<br/>label → text element"]
    SK --> STYLE["스타일 주입<br/>pastel 6색 + hachure + roughness 2"]
    STYLE --> CONT{"컨테이너?"}
    CONT -->|예| DASH["dashed 테두리<br/>배경 투명"]
    CONT -->|아니오| FILL["파스텔 채움<br/>두꺼운 테두리"]
    DASH & FILL --> CONV["convertToExcalidrawElements"]
    CONV --> SVG["exportToSvg"]
    SVG --> FONT["text[ko] → Gaegu 주입"]
    FONT --> RAST["SVG → Image → Canvas.drawImage"]
    RAST --> PNG["PNG dataURL"]
    PNG --> IMGUR["/api/imgur-upload"]
    IMGUR --> OUT["Blogger HTML &lt;img&gt;"]

    style MD fill:#4c6ef5,color:#fff
    style SK fill:#7950f2,color:#fff
    style FONT fill:#f76707,color:#fff
    style OUT fill:#40c057,color:#fff
```

### 컬러 팔레트

| Blue | Amber | Green | Pink | Indigo | Orange |
|:---:|:---:|:---:|:---:|:---:|:---:|
| `#dbeafe` | `#fef3c7` | `#dcfce7` | `#fce7f3` | `#e0e7ff` | `#ffedd5` |

### Sanitize 재시도

> [!WARNING]
> `A[Node.js (런타임)]`처럼 라벨에 `()`가 들어가면 mermaid 파서가 SQE 에러를 냅니다. 1차 실패 시 자동으로 괄호/따옴표/콜론을 제거한 뒤 재시도합니다.

```mermaid
flowchart LR
    TRY1["1차 파싱"] -->|OK| DONE["렌더링"]
    TRY1 -->|Parse Error| SAN["_sanitizeMermaid<br/>() {} : &lt; &gt; 제거"]
    SAN --> TRY2["2차 파싱"]
    TRY2 -->|OK| DONE
    TRY2 -->|Fail| FB["bullet 목록<br/>fallback"]
```

---

## 신뢰성 보장

### 재시도 정책

| 컴포넌트 | 재시도 | 전략 |
|:---|:---:|:---|
| Agent ① 비유설계 | 3회 | `fail_summary` feedback 주입 |
| Agent ② 글작성 | 2회 | 길이 2500+ / mermaid 2+ / 헤딩 4+ / corrupted(JSON-in-JSON, wsFlood) 검증 |
| Agent ③ 이미지 프롬프트 | 1회 | 단순 재호출 |
| LLM API (503 / 429 / 504) | 3회 | 지수 백오프 (2s → 4s → 8s) |
| Phase 1 웹 검색 | 2-tier | DuckDuckGo → Perplexity Sonar |
| Phase 3b 팩트체크 | — | Sonar 내장 웹 검색 (학습 지식 의존 X) |
| Nano Banana 이미지 생성 | 7회 | 지수 백오프 (2/4/8/15/30/60s) — 7회 모두 Vision FAIL 시 마지막 생성 이미지로 fallback (`bestFallbackRes`), 발행 진행 보장 |
| Imgur 업로드 (서버) | 7회 | 누적 ~2분 백오프 (502/500 자동 회복) |
| mermaid 파싱 | 2회 | sanitize → diamond/circle 강제 사각형화 → bullet fallback |
| fetch 타임아웃 | — | LLM 90s / 이미지 60s / 업로드 180s (AbortController) |
| 팝업 차단 (window.open) | — | 게임 victory 모달 + 클릭 → 새 탭 |
| 사용자 취소 | — | AbortController + `_checkCancelled()` 가드 |

### 외부 의존성 다운 시 fallback 정책

> [!IMPORTANT]
> 외부 API/CDN 다운 시 파이프라인이 무한 대기·하드 에러로 막히지 않도록, 각 의존성마다 명시적인 fallback 경로를 둡니다. 모든 fallback은 **품질 표시(Vision 일치도 낮음 등)**와 함께 발행을 진행해 사용자가 결과물을 받게 합니다.

| 외부 의존성 | 다운 감지 | Fallback 경로 |
|:---|:---|:---|
| **BizRouter** (LLM 게이트웨이) | 502/503/504 | `ApiClient.callAgent`가 지수 백오프(2s→4s→8s)로 3회 재시도, 그래도 실패면 사용자에게 에러 토스트 + Phase 중단 (재시도 정책의 안전 종료) |
| **Gemini Vision** 이미지 검증 | 7회 모두 FAIL | 마지막 생성 이미지를 `bestFallbackRes`로 보관 → "Vision 일치도 낮음" 표시 + 발행 진행 (`Pipeline.js _generateImageWithRetry`) |
| **Nano Banana** 이미지 생성 | 응답 비어있음 | 7회 지수 백오프 — 그래도 이미지 자체가 0건이면 throw (Vision FAIL과 구분) |
| **DuckDuckGo** 검색 | 결과 0건/HTML 변경 | Perplexity Sonar(BizRouter 내장 웹 검색)로 자동 fallback (`_runWebSearch` 2-tier) |
| **Perplexity Sonar** | API 실패 | LLM 학습 지식으로 fallback (Phase 1 비유 후보 생성은 계속 진행) |
| **elkjs CDN** (esm.sh) | 로드 실패 | unpkg.com mirror로 자동 재시도 (`BlogAssembler.js`) → 둘 다 실패 시 visibility graph + Dijkstra → 최후엔 직선 fallback |
| **Imgur** 업로드 | 502/500 | 서버측 7회 재시도 (누적 ~2분 백오프) → 그래도 실패면 throw (수동 확인) |
| **Claude Haiku** Adequacy Judge | 호출 실패 | "judge 호출 실패 폴백" 분기 — Adequacy 점수 미설정 + Verify A로 직진 (차단하지 않음) |
| **Claude Haiku** 마크다운 응답 | JSON 대신 표 형식 | 정규식으로 점수 추출 fallback (`_runPhase1CandidateScoring`) |
| **mermaid 파서** | Parse Error | `_sanitizeMermaid`로 `() {} : <>` 제거 후 2차 시도 → 최종엔 bullet 목록 fallback |
| **Blogger API** 발행 | 401/토큰만료 | Refresh Token으로 자동 갱신 (5분 버퍼) → 그래도 실패면 사용자에게 수동 발행 모달 |

### 테이블 렌더링 자동 보정

LLM이 마크다운 테이블 헤더 구분선(`|---|---|`)을 빠뜨리는 확률적 실패를 **후처리 레벨에서 차단**합니다.

```mermaid
flowchart TD
    MD["마크다운"] --> DET["_fixTables<br/>연속 | 라인 감지"]
    DET --> CHK{"구분선 있음?"}
    CHK -->|예| PASS["그대로 통과"]
    CHK -->|아니오| SENT["zhdrsntz<br/>sentinel 삽입"]
    SENT --> MARKED["marked.parse"]
    MARKED --> POST["thead sentinel<br/>regex 제거"]
    POST --> HTML["깨끗한 table"]
    PASS --> HTML

    style SENT fill:#fab005,color:#000
    style POST fill:#40c057,color:#fff
```

### 5 키워드 스트레스 테스트

| # | 키워드 | 결과 | 생성 시간 | 테이블 | mermaid |
|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | Playwright | ✅ | 150s | 13 | 2 |
| 2 | MCP 서버 | ✅ | 297s | 14 | 2 |
| 3 | Node.js | ✅ | 185s | 11 | 2 |
| 4 | API | ✅ | 151s | 11 | 2 |
| 5 | 오픈클로 | ✅ | 161s | 14 | 2 |

> **성공률 5/5** — sanitize 재시도 / 검증 재시도 / 후처리 보정 모두 실제 트래픽에서 검증됨.

---

## 프로젝트 구조

```
blog-generator/
├── Dockerfile                 # Railway 배포용
├── server.py                  # Python http.server 프록시
│                              # - /api/bizrouter (LLM 게이트웨이)
│                              # - /api/imgur-upload
│                              # - /api/search (DuckDuckGo)
│                              # - /api/blogger/post (refresh token)
├── build.py                   # src/ → dist/index.html 번들러
├── dist/
│   └── index.html             # 번들된 SPA (CSS + JS 인라인)
└── src/
    ├── index.html             # 엔트리포인트
    ├── css/
    │   └── main.css           # 메인 스타일
    └── js/
        ├── config.js          # 모델 / API URL 설정
        ├── app.js             # 전역 바인딩 (window.pipeline 노출)
        ├── Pipeline.js        # 7-Agent 오케스트레이터 (Phase 1~5)
        ├── ApiClient.js       # BizRouter 호출 + 503 재시도
        ├── BlogAssembler.js   # 마크다운 + Excalidraw 변환
        ├── AuthManager.js     # Blogger 발행
        └── PipelineUI.js      # Phase 상태 / 비용 표시
```

---

## 실행 방법

### 사전 요구사항

> [!WARNING]
> `BIZROUTER_KEY`와 Blogger `GOOGLE_REFRESH_TOKEN`이 필요합니다. 없으면 LLM 호출과 발행이 동작하지 않습니다.

- Python 3.11+
- BizRouter API 키
- Google OAuth2 Client ID/Secret + Refresh Token (Blogger 발행용)
- Imgur Client ID (다이어그램 업로드용)

### 로컬 개발

```bash
# 1. 저장소 클론
git clone https://github.com/Technoetic/blog-generator.git
cd blog-generator

# 2. 환경 변수 설정
export BIZROUTER_KEY="your-key"
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
export GOOGLE_REFRESH_TOKEN="..."
export BLOGGER_BLOG_ID="..."
export IMGUR_CLIENT_ID="..."

# 3. 번들
python build.py   # src/ → dist/index.html

# 4. 서버 시작
python server.py

# 5. 브라우저 접속
open http://localhost:9090/index.html
```

### Docker 실행

```bash
docker build -t blog-generator .
docker run -p 9090:9090 \
  -e BIZROUTER_KEY=... \
  -e GOOGLE_REFRESH_TOKEN=... \
  -e BLOGGER_BLOG_ID=... \
  -e IMGUR_CLIENT_ID=... \
  blog-generator
```

### Railway 배포

> [!NOTE]
> `Dockerfile`이 포함돼 있어 `railway up` 한 번으로 자동 빌드됩니다. 환경 변수만 Railway 대시보드에 설정해 주세요.

```bash
railway variables --set BIZROUTER_KEY=... \
  --set GOOGLE_REFRESH_TOKEN=... \
  --set BLOGGER_BLOG_ID=... \
  --set IMGUR_CLIENT_ID=...
railway up
```

### 배포 흐름

```mermaid
graph TD
    DEV["로컬 개발"] -->|git push| GH["GitHub"]
    GH -->|webhook| RAIL["Railway"]
    RAIL -->|Dockerfile| BLD["Docker 빌드"]
    BLD --> UV["python server.py"]
    UV --> PROXY["프록시 엔드포인트<br/>준비 완료"]
    PROXY --> LIVE["라이브 배포"]

    style DEV fill:#339af0,color:#fff
    style RAIL fill:#7950f2,color:#fff
    style LIVE fill:#40c057,color:#fff
```

### 환경 변수

| Env | Required | Description |
|:---|:---:|:---|
| `BIZROUTER_KEY` | ✓ | LLM 게이트웨이 API 키 |
| `GOOGLE_CLIENT_ID` | ✓ | OAuth2 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | ✓ | OAuth2 클라이언트 시크릿 |
| `GOOGLE_REFRESH_TOKEN` | ✓ | Blogger API 리프레시 토큰 |
| `BLOGGER_BLOG_ID` | ✓ | 대상 블로그 ID |
| `IMGUR_CLIENT_ID` | ✓ | Imgur 익명 업로드 클라이언트 |
| `PORT` | | 서버 포트 (기본 9090) |

---

## 사용 예시

**기본 사용**

```
"API 게이트웨이"에 대한 비유 블로그를 작성해줘
```

**톤 + 비율 오버라이드**

```
"API 게이트웨이"에 대한 비유 블로그를 작성해줘 (톤: 전문, 비율: 4:3)
```

**완료 후**: 화면 중앙에 🎉 **블로그 발행 완료** 모달이 뜹니다. `[블로그 열기]` 버튼 클릭 → 새 탭에서 Blogger 포스트가 열립니다.



---

## 참고 자료

<details>
<summary><b>핵심 개념 & 논문</b></summary>

| 주제 | 설명 |
|:---|:---|
| **Structure Mapping Theory** (Gentner, 1983) | 비유를 기술↔대응 구조의 일관된 매핑으로 해석하는 이론 — Agent ①의 토대 |
| **LLM-as-Judge** (Zheng et al., 2023) | LLM이 다른 LLM의 출력을 평가 — Agent ④⑤의 토대 |
| **Tool Use / Function Calling** (Schick et al., 2023) | LLM이 외부 도구를 호출하는 패턴 — Agent ⑥ + `google_search` |
| **Prompt Caching** (Anthropic, 2024) | 불변 프롬프트 앞단 고정으로 캐시 적중률 최적화 — messages 배열 순서 설계 |

</details>

<details>
<summary><b>기술 참고</b></summary>

- [BizRouter](https://bizrouter.ai) — OpenAI 호환 LLM 게이트웨이
- [Gemini API](https://ai.google.dev)
- [Blogger API v3](https://developers.google.com/blogger)
- [mermaid-to-excalidraw](https://github.com/excalidraw/mermaid-to-excalidraw)
- [Excalidraw](https://excalidraw.com)
- [Gaegu Font](https://fonts.google.com/specimen/Gaegu)

</details>

---

<div align="center">

<img src="assets/footer.gif" width="90%" alt="6 Agent 셀러브레이션 — Blog Published!"/>

<br/>

**비유로 배우는 기술 블로그 — 읽는 이의 머릿속에 이미 그려진 그림을 활용합니다**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.app)

</div>
