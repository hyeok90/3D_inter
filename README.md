# 3D Reconstruction Web Application

이 프로젝트는 동영상을 업로드하여 3D 모델을 생성하는 웹 애플리케이션입니다. Next.js 프론트엔드, Vercel에 배포되는 메인 백엔드(FastAPI), 그리고 별도의 GPU 서버에서 동작하는 워커(Worker)로 구성된 아키텍처를 가집니다.

## 아키텍처 개요

1.  **프론트엔드 (Next.js)**: 사용자가 동영상을 녹화하거나 업로드하는 UI. Vercel에 배포됩니다.
2.  **메인 백엔드 (FastAPI on Vercel)**: 프론트엔드의 요청을 받아 파일 업로드를 처리하고, 작업 ID를 발급한 뒤 GPU 워커에게 3D 변환을 요청합니다.
3.  **GPU 워커 (FastAPI on GPU Server)**: 메인 백엔드의 요청을 받아 실제 3D 모델 변환 작업을 수행하고, 완료되면 웹훅(webhook)을 통해 메인 백엔드에 결과를 다시 보내줍니다.

---

## 🚀 Vercel 프로덕션 배포 가이드

### 1단계: GPU 서버에서 '워커' 실행하기

> **목표:** GPU 서버에서 3D 변환을 수행하는 워커 프로그램을 실행합니다.  
> **위치:** GPU 서버의 터미널

1.  **코드 내려받기 (최초 1회)**
    ```bash
    git clone https://github.com/hyeok90/3D_inter.git
    cd 3D_inter
    ```
    이미 받았다면, 최신 코드를 `pull` 합니다.
    ```bash
    # 3D_inter 프로젝트 폴더로 이동
    cd ~/3D_inter 
    git pull origin main
    ```

2.  **Conda 가상환경 생성 및 활성화 (최초 1회)**
    *(이 프로젝트는 Python 3.11 버전에 맞춰져 있습니다.)*
    ```bash
    # 'server'라는 이름으로 Python 3.11 버전의 conda 환경 생성
    conda create -n server python=3.11 -y

    # 가상환경 활성화
    conda activate server
    ```

3.  **필수 라이브러리 설치**
    *(가상환경이 활성화된 상태에서 실행하세요.)*
    ```bash
    # 1. 워커 실행에 필요한 라이브러리 설치
    pip install -r worker/worker_requirements.txt

    # 2. vggt 라이브러리를 '편집 가능 모드'로 설치 (핵심 단계)
    pip install -e vggt
    ```

4.  **워커 서버 실행**
    *(이 터미널은 계속 켜두어야 합니다.)*
    ```bash
    uvicorn worker.worker:app --host 0.0.0.0 --port 8001
    ```
    > "Model loaded successfully" 메시지가 나오면 성공입니다. (최초 실행 시 모델 다운로드로 오래 걸릴 수 있습니다.)

---

### 2단계: 워커 서버를 외부 인터넷에 노출시키기

GPU 서버의 환경에 따라 아래 두 가지 방법 중 하나를 선택합니다.

*   **A) AWS, GCP 등 공인 IP가 있는 클라우드 서버의 경우**
    1.  서버의 공인 IP 주소를 확인합니다. 워커 주소는 `http://<서버_공인_IP>:8001` 이 됩니다.
    2.  클라우드 서비스의 '보안 그룹' 또는 '방화벽' 설정에서 **8001번 포트**의 TCP 트래픽을 허용(Inbound)해야 합니다.

*   **B) 개인 PC 등 공인 IP가 없는 로컬 서버의 경우 (`ngrok` 사용)**
    1.  별도의 새 터미널을 열고 `ngrok`을 실행합니다. (이 터미널도 계속 켜두어야 합니다.)
        ```bash
        # ngrok 다운로드 폴더로 이동 후 실행
        ./ngrok http 8001
        ```
    2.  화면에 나타나는 `Forwarding` 주소( `https://...` )를 복사합니다. 이 주소가 워커의 공개 주소가 됩니다.

---

### 3단계: Vercel 프로젝트 설정 및 배포

> **목표:** 메인 앱이 워커와 통신할 수 있도록 Vercel 설정을 완료합니다.  
> **위치:** [Vercel 웹사이트](https://vercel.com)

1.  **Vercel 프로젝트 대시보드**로 이동하여 **Settings -> Environment Variables** 메뉴로 갑니다.
2.  아래 두 개의 환경 변수가 올바르게 설정되었는지 확인하고 저장합니다.
    *   `WORKER_API_URL`: **2단계**에서 확보한 워커의 공개 주소 (예: `http://<공인_IP>:8001` 또는 `https://...ngrok-free.dev`)
    *   `NEXT_PUBLIC_ACCESS_PASSWORD`: 원하는 접속 비밀번호

3.  **Vercel Storage 탭**에서 **KV (Redis)** 데이터베이스가 프로젝트에 연결되어 있는지 확인합니다.

4.  메인 PC에서 모든 최신 코드를 `git push` 한 뒤, Vercel 대시보드의 **Deployments** 탭에서 가장 최신 배포를 **Redeploy** 합니다.

---

### 4단계: 최종 테스트

모든 배포가 완료되면, Vercel에서 제공하는 최종 앱 주소 (예: `https://3d-inter.vercel.app`)에 접속하여 모든 기능이 정상적으로 동작하는지 확인합니다.

---
---

## 💻 로컬 개발 및 디버깅 환경 설정

> **목표:** Vercel 배포 없이, 로컬 컴퓨터 한 대에서 전체 시스템(프론트엔드, 백엔드, 워커)을 실행하고 디버깅합니다.

로컬에서 실행하려면 **총 3개의 터미널**이 필요합니다.

### 터미널 1: GPU 워커 실행

1.  프로젝트 폴더로 이동합니다: `cd /path/to/your/3D_inter`
2.  Conda 가상환경을 활성화합니다: `conda activate server`
3.  워커 서버를 실행합니다. (이 터미널은 계속 켜두어야 합니다.)
    ```bash
    uvicorn worker.worker:app --host 0.0.0.0 --port 8001
    ```

### 터미널 2: 메인 백엔드 실행

1.  프로젝트 폴더로 이동합니다: `cd /path/to/your/3D_inter`
2.  (선택) 백엔드용 가상환경이 있다면 활성화합니다. 없다면 워커와 같은 `server` 환경을 사용해도 무방합니다: `conda activate server`
3.  메인 백엔드가 워커(`localhost:8001`)를 찾을 수 있도록 환경 변수를 설정하고 서버를 실행합니다. (이 터미널은 계속 켜두어야 합니다.)
    ```bash
    export WORKER_API_URL=http://localhost:8001
    uvicorn backend.main:app --host 0.0.0.0 --port 8000
    ```

### 터미널 3: 프론트엔드 실행

1.  프로젝트 폴더로 이동합니다: `cd /path/to/your/3D_inter`
2.  프론트엔드 개발 서버를 실행합니다. (이 터미널은 계속 켜두어야 합니다.)
    ```bash
    npm run dev
    ```

### 최종 접속

*   웹 브라우저에서 `http://localhost:3000` 으로 접속합니다.
*   프론트엔드는 `.env.local` 파일 덕분에 메인 백엔드(`localhost:8000`)를 자동으로 찾아가고, 메인 백엔드는 `WORKER_API_URL` 환경 변수 덕분에 GPU 워커(`localhost:8001`)를 찾아가게 됩니다.
*   이제 각 터미널에 출력되는 로그를 실시간으로 확인하며 디버깅할 수 있습니다.