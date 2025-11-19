"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { uploadVideo, fetchConvertedModel } from "@/lib/api";
import type { ModelType } from "@/components/ConvertedModelViewer";

const ConvertedModelViewer = dynamic(
  () => import("@/components/ConvertedModelViewer").then((mod) => mod.ConvertedModelViewer),
  { ssr: false },
);

type Stage = "locked" | "record" | "review" | "viewer";
type RecordingStatus = "idle" | "recording" | "processing";
type ToastTone = "info" | "error";


const ACCESS_PASSWORD = "2025jhyw";
const MAX_DURATION_MS = 60_000;

function formatTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function HomePage() {
  const [stage, setStage] = useState<Stage>("locked");
  const [passwordError, setPasswordError] = useState("");


  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isCameraLoading, setIsCameraLoading] = useState(false);

  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoSource, setVideoSource] = useState<"recorded" | "uploaded" | null>(null);
  const [processingResult, setProcessingResult] = useState(false);

  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelType, setModelType] = useState<ModelType>("obj");
  const [modelLabel, setModelLabel] = useState("Demo model");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);

  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const autoStartRef = useRef(false);
  const handleStartRecordingRef = useRef<() => void>(() => {});

  const resetRecordingState = useCallback(() => {
    setVideoBlob(null);
    setVideoSource(null);
    setElapsedMs(0);
    setRecordingStatus("idle");
  }, []);

  const cleanupTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    cleanupTimer();
    recorderRef.current?.stop();
    recorderRef.current = null;
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setMediaStream(null);
  }, [cleanupTimer]);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const openCamera = useCallback(
    async (autoStart = false) => {
      stopStream();
      resetRecordingState();
      autoStartRef.current = autoStart;
      setModelLoading(false);

      if (typeof window !== "undefined" && !window.isSecureContext) {
        showToast("모바일에서는 HTTPS(보안 연결)에서만 카메라를 사용할 수 있습니다.", "error");
        setStage("locked");
        return false;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        showToast("이 기기에서는 카메라 API를 사용할 수 없습니다. 동영상 파일을 업로드하여 진행할 수 있습니다.", "info");
        setStage("record");
        return false;
      }

      setStage("record");
      setIsCameraLoading(true);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            width: { ideal: 1080 },
            height: { ideal: 1920 },
          },
          audio: true,
        });

        mediaStreamRef.current = stream;
        setMediaStream(stream);
        setIsCameraLoading(false);

        if (autoStartRef.current) {
          autoStartRef.current = false;
          setTimeout(() => {
            handleStartRecordingRef.current();
          }, 50);
        }

        return true;
      } catch (error) {
        setIsCameraLoading(false);
        console.error("camera permission error", error);
        const errorName = (error as DOMException | Error)?.name ?? "Error";
        if (errorName === "NotAllowedError") {
          showToast("카메라 권한을 허용해주세요. 브라우저 설정에서 변경 가능합니다. 또는 동영상 파일을 업로드하여 진행할 수 있습니다.", "error");
        } else if (errorName === "NotFoundError") {
          showToast("사용 가능한 카메라를 찾을 수 없습니다. 동영상 파일을 업로드하여 진행할 수 있습니다.", "error");
        } else {
          showToast("카메라 접근 권한이 필요합니다. 동영상 파일을 업로드하여 진행할 수 있습니다.", "error");
        }
        setStage("record");
        return false;
      }
    },
    [resetRecordingState, showToast, stopStream],
  );

  const handleStartRecording = useCallback(() => {
    const stream = mediaStreamRef.current;
    if (!stream) {
      showToast("카메라 스트림을 찾을 수 없습니다.", "error");
      return;
    }

    try {
      const mimeTypes = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/mp4",
      ];
      const selectedMime = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        cleanupTimer();
        const blob = new Blob(chunks, { type: recorder.mimeType });
        setVideoBlob(blob);
        setVideoSource("recorded");
        setRecordingStatus("idle");
        setStage("review");
      };

      recorderRef.current = recorder;
      setVideoBlob(null);
      setRecordingStatus("recording");
      setElapsedMs(0);
      recorder.start(500);

      timerRef.current = setInterval(() => {
        setElapsedMs((prev) => {
          const next = prev + 1000;
          if (next >= MAX_DURATION_MS) {
            recorder.stop();
            return MAX_DURATION_MS;
          }
          return next;
        });
      }, 1000);
    } catch (error) {
      console.error("recording error", error);
      showToast("녹화를 시작할 수 없습니다.", "error");
    }
  }, [cleanupTimer, showToast]);

  useEffect(() => {
    handleStartRecordingRef.current = handleStartRecording;
  }, [handleStartRecording]);

  useEffect(() => {
    return () => {
      stopStream();
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, [stopStream]);

  useEffect(() => {
    if (stage !== "record") {
      stopStream();
    }
  }, [stage, stopStream]);

  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      void videoRef.current.play().catch(() => {
        /* autoplay restrictions */
      });
    }
  }, [mediaStream]);

  useEffect(() => {
    if (isFullscreen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
    return undefined;
  }, [isFullscreen]);



  const handlePasswordSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = passwordInputRef.current?.value?.trim() ?? "";
      if (value === ACCESS_PASSWORD) {
        setPasswordError("");
        passwordInputRef.current?.blur();
        await openCamera();
        return;
      }
      setPasswordError("비밀번호가 올바르지 않습니다.");
    },
    [openCamera],
  );

  const handlePasswordChange = useCallback(() => {
    if (passwordError) {
      setPasswordError("");
    }
  }, [passwordError]);

  const handleStopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const videoPreviewUrl = useMemo(() => {
    if (!videoBlob) {
      return null;
    }
    return URL.createObjectURL(videoBlob);
  }, [videoBlob]);

  useEffect(() => {
    if (!videoPreviewUrl) {
      return undefined;
    }
    return () => {
      URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  const handleReviewReset = useCallback(
    (autoStart: boolean) => {
      void openCamera(autoStart);
    },
    [openCamera],
  );

  const handleFileSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith("video/")) {
      showToast("동영상 파일만 선택할 수 있습니다.", "error");
      event.target.value = "";
      return;
    }
    setVideoBlob(file);
    setVideoSource("uploaded");
    setStage("review");
    event.target.value = "";
  }, [showToast]);

  const handleConfirm = useCallback(async () => {
    if (!videoBlob) {
      showToast("변환할 영상이 없습니다.", "error");
      return;
    }
    setProcessingResult(true);
    setRecordingStatus("processing");
    
    try {
      // Step 1: Upload the video and get an ID
      const { uploadId } = await uploadVideo(videoBlob);
      
      setStage("viewer");
      setModelLoading(true);
      showToast("업로드 완료! 모델 변환을 시작합니다. 시간이 다소 걸릴 수 있습니다.", "info");

      // Step 2: Poll for the result
      const model = await fetchConvertedModel(uploadId);
      
      setModelUrl(model.url);
      setModelType(model.type);
      setModelLabel(model.label);

    } catch (error) {
      console.error("processing error", error);
      showToast(error instanceof Error ? error.message : "모델을 가져오는데 실패했습니다.", "error");
      await openCamera(); // Go back to recording on failure
    } finally {
      setProcessingResult(false);
      setRecordingStatus("idle");
      // setModelLoading(false) is handled by the ConvertedModelViewer's onLoaded callback
    }
  }, [videoBlob, showToast, openCamera]);

  const handleBackToRecording = useCallback(() => {
    setModelUrl(null);
    setModelLoading(false);
    void openCamera();
  }, [openCamera]);



  const renderPasswordGate = () => (
    <form
      onSubmit={handlePasswordSubmit}
      className="flex flex-1 flex-col justify-center gap-6 md:mx-auto md:max-w-sm"
      autoComplete="off"
      suppressHydrationWarning
    >
      <header className="space-y-2 text-center">
        <p className="text-sm uppercase tracking-[0.4em] text-slate-400">Welcome</p>
        <h1 className="text-3xl font-semibold text-white">3D Reconstruction</h1>
        <p className="text-sm text-slate-400">
          비밀번호를 입력하면 촬영 화면으로 이동합니다.
        </p>
      </header>
      <label className="flex flex-col gap-2">
        <span className="text-sm text-slate-300">비밀번호</span>
        <input
          ref={passwordInputRef}
          type="password"
          className="rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-base text-white placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          placeholder="비밀번호 입력"
          onChange={handlePasswordChange}
          autoFocus
          autoComplete="off"
        />
        {passwordError ? (
          <span className="text-sm text-rose-400">{passwordError}</span>
        ) : (
          <span className="text-xs text-slate-500">힌트: 2025jhyw</span>
        )}
      </label>
      <button
        type="submit"
        className="rounded-xl bg-sky-500 py-3 text-base font-semibold text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.99]"
      >
        입장하기
      </button>
    </form>
  );

  const renderRecording = () => (
    <section className="flex flex-1 flex-col gap-6 md:flex-row md:items-start md:gap-10">
      <div className="flex w-full flex-col gap-4 md:max-w-sm lg:max-w-md">
        <header className="flex items-center justify-between text-sm text-slate-300">
          <span className="font-medium text-white">촬영 준비 완료</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white transition hover:border-sky-400"
          >
            파일 업로드
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </header>
        <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-gradient-to-bl from-slate-950 via-black to-slate-900 shadow-inner shadow-sky-500/10">
          {isCameraLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-300">카메라 준비 중…</div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />
          )}
          {recordingStatus === "recording" && (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
              <span className="size-2 rounded-full bg-rose-500 animate-pulse" />
              {formatTime(elapsedMs)} / 01:00
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 md:justify-center">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200 shadow-lg shadow-sky-500/10 md:max-w-sm">
          <p className="text-sm font-semibold text-white">촬영 가이드</p>
          <ul className="mt-2 space-y-2 text-xs text-slate-300">
            <li>· 녹화 시작 시 자동으로 1분 타이머가 작동합니다.</li>
            <li>· 파일 업로드 버튼으로 기존 영상을 대신 사용할 수 있습니다.</li>
            <li>· 촬영이 끝나면 아래에서 확인/재시도를 선택하세요.</li>
          </ul>
        </div>
        {recordingStatus !== "recording" ? (
          <button
            type="button"
            onClick={handleStartRecording}
            className="rounded-full bg-sky-500 py-4 text-lg font-semibold text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-600"
            disabled={isCameraLoading}
          >
            촬영 시작
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStopRecording}
            className="rounded-full bg-rose-500 py-4 text-lg font-semibold text-white shadow-lg shadow-rose-500/30 transition active:scale-[0.99]"
          >
            끝남
          </button>
        )}
        <p className="text-center text-xs text-slate-400 md:text-left">
          최대 1분, 1080p까지 녹화 가능 · 음성 포함
        </p>
      </div>
    </section>
  );

  const renderReview = () => (
    <section className="flex flex-1 flex-col gap-6 md:flex-row md:items-start md:gap-10">
      <div className="flex w-full flex-col gap-4 md:max-w-sm lg:max-w-md">
        <header className="space-y-1">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Preview</p>
          <h2 className="text-xl font-semibold text-white md:text-2xl">
            {videoSource === "uploaded" ? "업로드한 영상" : "방금 녹화한 영상"}
          </h2>
          <p className="text-xs text-slate-400 md:text-sm">
            재생을 다시 확인한 뒤, 변환을 시작하거나 재촬영할 수 있습니다.
          </p>
        </header>
        <div className="aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black">
          {videoPreviewUrl ? (
            <video src={videoPreviewUrl} controls playsInline className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-300">
              미리보기를 불러오는 중…
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 md:justify-center">
        <div className="grid grid-cols-3 gap-2 text-sm font-semibold text-white md:max-w-sm">
          <button
            type="button"
            onClick={() => handleReviewReset(false)}
            className="rounded-full border border-white/20 px-3 py-3 text-slate-200 transition hover:border-white/40"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => handleReviewReset(true)}
            className="rounded-full border border-white/10 bg-black/40 px-3 py-3 transition hover:border-white/40"
          >
            재시도
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-full bg-sky-500 px-3 py-3 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-600"
            disabled={processingResult}
          >
            {processingResult ? "처리 중" : "확인"}
          </button>
        </div>
        <p className="text-center text-xs text-slate-400 md:text-left md:text-sm">
          실제 변환은 아직 연결되지 않았습니다. FastAPI 연동 시 자동 업로드됩니다.
        </p>
      </div>
    </section>
  );

  const renderViewer = () => (
    <section className="flex flex-1 flex-col gap-6 md:grid md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start md:gap-10">
      <header className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Demo Result</p>
          <button
            type="button"
            onClick={() => setIsFullscreen(true)}
            className="rounded-full border border-white/20 px-3 py-1 text-xs text-white transition hover:border-sky-400"
          >
            전체화면
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {modelLabel.split("·").map((token, index) => (
            <span
              key={`${token}-${index}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                index === 0
                  ? "bg-sky-500/10 text-sky-300"
                  : "border border-white/15 text-slate-200"
              }`}
            >
              {token.trim()}
            </span>
          ))}
        </div>
        <p className="text-sm text-slate-300 md:text-base">
          터치로 회전, 핀치로 확대/축소할 수 있습니다. FastAPI 전환 시 API 베이스 URL만 교체하면 됩니다.
        </p>
        <div className="hidden rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300 md:block">
          <p className="font-semibold text-white">Tip</p>
          <ul className="mt-2 space-y-1 text-slate-400">
            <li>· 두 손가락으로 줌, 한 손가락 드래그로 회전</li>
            <li>· 모델이 로드되는 동안에는 위 영역에 로딩 배지가 표시됩니다.</li>
            <li>· 다시 촬영하기를 누르면 즉시 카메라가 준비됩니다.</li>
          </ul>
        </div>
      </header>
      <div className="flex flex-col gap-6">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-950 to-black shadow-inner shadow-sky-500/10">
          {modelUrl ? (
            <>
              <ConvertedModelViewer
                key={modelUrl}
                modelUrl={modelUrl}
                modelType={modelType}
                onLoaded={() => {
                  setModelLoading(false);
                  showToast("3D 뷰어가 준비되었습니다.");
                }}
              />
              {modelLoading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/85 backdrop-blur-sm">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
                  <p className="text-sm font-medium text-slate-200">모델 로딩 중…</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-300">
              모델 정보를 불러오는 중…
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleBackToRecording}
            className="rounded-full border border-white/20 py-3 text-sm font-semibold text-white transition hover:border-white/40"
          >
            다시 촬영하기
          </button>
          <p className="text-center text-xs text-slate-400">
            API 연동 시 `uploadVideo()`와 `fetchConvertedModel()` 구현만 교체하면 됩니다.
          </p>
        </div>
      </div>
      {isFullscreen && modelUrl && (
        <div className="fixed inset-0 z-50 bg-black/90 p-4">
          <div className="mx-auto flex h-full max-w-3xl flex-col">
            <div className="flex items-center justify-between text-white">
              <span className="text-sm text-slate-200">터치로 회전 · 두 손으로 확대</span>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="rounded-full border border-white/20 px-3 py-1 text-xs hover:border-white/40"
              >
                닫기
              </button>
            </div>
            <div className="mt-2 flex-1 overflow-hidden rounded-2xl bg-slate-950">
              <ConvertedModelViewer modelUrl={modelUrl} modelType={modelType} />
            </div>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <div className="min-h-dvh bg-slate-950 text-white">
      {toast && (
        <div
          className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg ${
            toast.tone === "error"
              ? "bg-rose-500 text-white shadow-rose-500/30"
              : "bg-white/10 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-8 px-5 pb-10 md:px-10 lg:px-12">
        <div className="pt-6 text-center text-xs uppercase tracking-[0.3em] text-slate-500 md:flex md:items-center md:justify-between md:text-left">
          <span>3D Reconstruction</span>
          <span className="mt-2 block text-[10px] text-slate-600 md:mt-0 md:text-xs">
            모바일 최적화 · 테이블·데스크톱 레이아웃 자동 적용
          </span>
        </div>
        {stage === "locked" && renderPasswordGate()}
        {stage === "record" && renderRecording()}
        {stage === "review" && renderReview()}
        {stage === "viewer" && renderViewer()}
      </main>
    </div>
  );
}
