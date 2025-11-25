# 3D_inter: 로컬 환경 설정 및 외부 접속 가이드

이 문서는 Vercel 플랫폼 없이, 개인 컴퓨터에서 전체 애플리케이션(프런트엔드, API 서버, 3D 변환 Worker)을 실행하고 `ngrok`을 통해 외부 네트워크에서 접속하는 방법을 안내합니다.

## 사전 준비

-   [Conda](https://docs.conda.io/projects/conda/en/latest/user-guide/install/index.html)가 설치되어 있어야 합니다.
-   [Node.js와 npm](https://nodejs.org/en/download/)이 설치되어 있어야 합니다.
-   [ngrok](https://ngrok.com/download) 계정이 있고, CLI가 설치 및 인증되어 있어야 합니다.

---

## 1단계: 환경 설정

Python 기반의 백엔드(API, Worker)와 Node.js 기반의 프런트엔드를 위한 환경을 설정합니다.

### A. 백엔드 (API + Worker) Conda 가상환경 설정

API 서버와 Worker는 같은 Python 환경을 공유할 수 있습니다. `3d-inter-env`라는 이름의 통합 가상환경 하나만 생성하겠습니다.

**새 터미널**을 열고 아래 명령어를 순서대로 실행하세요.

1.  **Conda 가상환경 생성 (최초 1회):**
    ```bash
    conda create -n 3d-inter-env python=3.11 -y
    ```

2.  **가상환경 활성화:**
    ```bash
    conda activate 3d-inter-env
    ```
    *(이제 터미널 프롬프트 앞에 `(3d-inter-env)`가 보입니다.)*

3.  **필요한 Python 라이브러리 설치:**
    ```bash
    # API 서버용 라이브러리 설치
    pip install -r api/requirements.txt

    # Worker 서버용 라이브러리 설치
    pip install -r worker/worker_requirements.txt
    ```

4.  **로컬 `vggt` 라이브러리 설치 (필수):**
    Python이 `vggt` 폴더를 라이브러리로 인식하도록 '편집 가능 모드'로 설치합니다.
    *(이 명령어는 반드시 프로젝트 최상위 폴더(`3D_inter/`)에서 실행해야 합니다.)*
    ```bash
    pip install -e ./vggt
    ```

### B. 프런트엔드 (Node.js) 설정

**다른 새 터미널**을 열고 프로젝트 최상위 폴더(`3D_inter/`)에서 아래 명령어를 실행하세요.

```bash
npm install
```

---

## 2단계: 애플리케이션 실행

**총 4개의 터미널**이 필요합니다. 각 터미널은 각각의 서버와 `ngrok`을 담당합니다.

### 터미널 1: Worker 서버 실행

1.  가상환경을 활성화합니다.
    ```bash
    conda activate 3d-inter-env
    ```
2.  `worker` 폴더로 이동하여 서버를 시작합니다.
    ```bash
    cd worker
    uvicorn worker:app --host 0.0.0.0 --port 8001
    ```
    *(모델을 로드하는 데 시간이 걸릴 수 있습니다.)*

### 터미널 2: API 서버 실행

1.  가상환경을 활성화합니다.
    ```bash
    conda activate 3d-inter-env
    ```
2.  `api` 폴더로 이동하여 Worker를 바라보도록 환경 변수를 설정하고 서버를 시작합니다.
    ```bash
    cd api
    WORKER_URL=http://localhost:8001 uvicorn index:app --host 0.0.0.0 --port 8000
    ```

### 터미널 3: 프런트엔드 서버 실행

1.  프로젝트 최상위 폴더로 이동합니다.
2.  개발 서버를 시작합니다.
    ```bash
    npm run dev
    ```

---

## 3단계: `ngrok`으로 외부 접속 허용

위 3개의 서버가 모두 실행 중인 상태에서, **네 번째 새 터미널**을 엽니다.

1.  `ngrok`을 실행하여 프런트엔드 서버(포트 3000)를 외부에 노출시킵니다.
    ```bash
    ngrok http 3000
    ```
2.  `ngrok` 실행 화면에 나타나는 `Forwarding` 주소 (예: `https://xxxxxxxx.ngrok-free.app`)를 복사합니다.

### 최종 접속

이제 핸드폰, 태블릿 등 외부 기기에서 복사한 **`ngrok` 주소**로 접속하면, 개인 컴퓨터에서 실행 중인 3D 변환 애플리케이션을 사용할 수 있습니다.
