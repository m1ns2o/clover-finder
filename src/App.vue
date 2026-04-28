<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Camera, CheckCircle2, Code2, Download, Leaf, Play, RotateCcw, Upload, XCircle } from 'lucide-vue-next'
import CodeEditor from '@/components/CodeEditor.vue'
import { defaultProgramSource, localizeProgramSource, parseConditionProgram, runConditionProgram } from '@/lib/conditionRunner'
import { loadSavedCode, saveCode } from '@/lib/storage'
import { analyzeImage, captureVideoFrame, preloadOpenCv } from '@/lib/vision'
import type { CloverAnalysis } from '@/types/clover'
import type { ProgramIssue, RunTrace } from '@/types/condition'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed', platform: string }>
}

const sourceCode = ref(localizeProgramSource(loadSavedCode(defaultProgramSource)))
const parseIssues = ref<ProgramIssue[]>([])
const runTrace = ref<RunTrace | null>(null)
const analysis = ref<CloverAnalysis | null>(null)
const captureOpen = ref(false)
const installSheetOpen = ref(false)
const installPrompt = ref<BeforeInstallPromptEvent | null>(null)
const isStandalone = ref(false)
const isIosDevice = ref(false)
const isAndroidDevice = ref(false)
const cameraError = ref('')
const isCameraReady = ref(false)
const isAnalyzing = ref(false)
const statusMessage = ref('코드를 작성한 뒤 실행을 눌러 클로버를 검사하세요.')
const videoRef = ref<HTMLVideoElement | null>(null)
let stream: MediaStream | null = null

const metricsRows = computed(() => {
  const metrics = analysis.value?.metrics
  if (!metrics) {
    return []
  }

  return [
    ['잎_개수', `${metrics.leaf_count}개`],
    ['잎_크기', `${metrics.avg_leaf_size}`]
  ]
})

const selectedResult = computed(() => runTrace.value?.result ?? '아직 실행 결과가 없습니다.')
const isPositiveResult = computed(() => {
  const text = selectedResult.value
  return /적합|행운|성공|맞음|통과/.test(text) && !/않|아님|실패/.test(text)
})
const canInstall = computed(() => Boolean(installPrompt.value) && !isStandalone.value)
const canShowInstallHelp = computed(() => !isStandalone.value && (canInstall.value || isIosDevice.value || isAndroidDevice.value))

watch(sourceCode, value => {
  saveCode(value)
  parseIssues.value = []
})

async function openCapture(): Promise<void> {
  const parseResult = parseConditionProgram(sourceCode.value)
  parseIssues.value = parseResult.issues

  if (!parseResult.program) {
    statusMessage.value = '코드에서 먼저 고칠 부분을 확인하세요.'
    return
  }

  captureOpen.value = true
  analysis.value = null
  runTrace.value = null
  statusMessage.value = '카메라 또는 이미지 업로드로 클로버를 준비하세요.'
  await nextTick()
  await startCamera()
}

async function startCamera(): Promise<void> {
  stopCamera()
  cameraError.value = ''
  isCameraReady.value = false

  if (!window.isSecureContext) {
    cameraError.value = '카메라는 HTTPS 또는 localhost에서만 실행됩니다. 이미지 업로드를 사용하세요.'
    return
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    cameraError.value = '이 브라우저는 카메라 실행을 지원하지 않습니다. 이미지 업로드를 사용하세요.'
    return
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 1600 }
      },
      audio: false
    })

    if (videoRef.value) {
      videoRef.value.srcObject = stream
      await videoRef.value.play()
      isCameraReady.value = true
    }
  } catch {
    cameraError.value = '카메라 권한을 얻지 못했습니다. 업로드를 사용하세요.'
  }
}

async function captureCurrentFrame(): Promise<void> {
  if (!videoRef.value) {
    return
  }

  try {
    const blob = await captureVideoFrame(videoRef.value)
    await analyzeAndRun(blob)
  } catch {
    statusMessage.value = '촬영 이미지를 가져오지 못했습니다. 잠시 뒤 다시 촬영하거나 업로드를 사용하세요.'
  }
}

async function analyzeAndRun(input: Blob | string): Promise<void> {
  const parseResult = parseConditionProgram(sourceCode.value)
  parseIssues.value = parseResult.issues

  if (!parseResult.program) {
    statusMessage.value = '코드에서 먼저 고칠 부분을 확인하세요.'
    return
  }

  isAnalyzing.value = true
  statusMessage.value = '클로버 이미지를 분석하는 중입니다.'
  await waitForUi()

  try {
    const nextAnalysis = await analyzeImage(input)
    analysis.value = nextAnalysis
    runTrace.value = runConditionProgram(parseResult.program, nextAnalysis.metrics)
    statusMessage.value = nextAnalysis.message
    captureOpen.value = false
    stopCamera()
  } catch {
    statusMessage.value = '이미지를 분석하지 못했습니다. 더 밝은 배경의 사진을 촬영하거나 업로드하세요.'
  } finally {
    isAnalyzing.value = false
  }
}

async function handleUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }

  statusMessage.value = `${file.name} 이미지를 준비하는 중입니다.`
  await analyzeAndRun(file)
  input.value = ''
}

async function reopenCapture(): Promise<void> {
  await openCapture()
}

function closeCapture(): void {
  captureOpen.value = false
  stopCamera()
}

function stopCamera(): void {
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  isCameraReady.value = false

  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
}

function waitForUi(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => resolve())
  })
}

async function installPwa(): Promise<void> {
  const promptEvent = installPrompt.value
  if (!promptEvent) {
    installSheetOpen.value = true
    return
  }

  await promptEvent.prompt()
  await promptEvent.userChoice
  installPrompt.value = null
}

function closeInstallSheet(): void {
  installSheetOpen.value = false
}

function updateStandaloneState(): void {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  isStandalone.value = window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true
}

function updatePlatformState(): void {
  const userAgent = window.navigator.userAgent
  const platform = window.navigator.platform
  const iPadOnModernSafari = platform === 'MacIntel' && window.navigator.maxTouchPoints > 1

  isIosDevice.value = /iPad|iPhone|iPod/.test(userAgent) || iPadOnModernSafari
  isAndroidDevice.value = /Android/.test(userAgent)
}

function handleBeforeInstallPrompt(event: Event): void {
  event.preventDefault()
  installPrompt.value = event as BeforeInstallPromptEvent
}

function handleAppInstalled(): void {
  installPrompt.value = null
  isStandalone.value = true
}

onMounted(() => {
  updateStandaloneState()
  updatePlatformState()
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.addEventListener('appinstalled', handleAppInstalled)
  void preloadOpenCv()
})

onBeforeUnmount(() => {
  stopCamera()
  window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  window.removeEventListener('appinstalled', handleAppInstalled)
})
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand-mark" aria-hidden="true">
        <Leaf :size="22" />
      </div>
      <div>
        <p class="eyebrow">Clover Logic Lab</p>
        <h1>조건문으로 클로버 판정하기</h1>
      </div>
      <button v-if="canShowInstallHelp" type="button" class="install-button" @click="installPwa">
        <Download :size="17" />
        설치
      </button>
    </header>

    <section class="workbench">
      <div class="coach-line">
        <Code2 :size="18" />
        <span>잎_개수와 잎_크기만 사용해 조건을 작성하세요.</span>
      </div>
      <p class="status-line">{{ statusMessage }}</p>

      <CodeEditor v-model="sourceCode" :issues="parseIssues" />

      <div class="hint-strip" aria-label="사용 가능한 변수">
        <span>잎_개수</span>
        <span>잎_크기</span>
      </div>
    </section>

    <section v-if="analysis && runTrace" class="result-panel" aria-live="polite">
      <div class="result-card" :class="{ positive: isPositiveResult }">
        <component :is="isPositiveResult ? CheckCircle2 : XCircle" :size="24" />
        <div>
          <p>실행 결과</p>
          <strong>{{ selectedResult }}</strong>
        </div>
      </div>

      <div class="result-image-frame" :style="{ aspectRatio: `${analysis.imageWidth} / ${analysis.imageHeight}` }">
        <img :src="analysis.imageUrl" alt="분석에 사용한 클로버 이미지" class="result-image" />
        <span
          v-for="(region, index) in analysis.regions"
          :key="region.id"
          class="leaf-marker"
          :style="{
            left: `${region.xPercent}%`,
            top: `${region.yPercent}%`,
            width: `${region.radiusPercent * 2}%`
          }"
          :aria-label="`${index + 1}번 잎 후보`"
        >
          <span>{{ index + 1 }}</span>
        </span>
      </div>

      <div class="metrics-grid">
        <div v-for="[label, value] in metricsRows" :key="label">
          <span>{{ label }}</span>
          <strong>{{ value }}</strong>
        </div>
      </div>

      <ol class="trace-list" aria-label="조건문 실행 흐름">
        <li
          v-for="evaluation in runTrace.evaluations"
          :key="evaluation.branchId"
          :class="{ passed: evaluation.passed, skipped: evaluation.skipped }"
        >
          <span>{{ evaluation.label }}</span>
          <code>{{ evaluation.conditionSource || 'else' }}</code>
          <b>{{ evaluation.skipped ? '건너뜀' : evaluation.passed ? 'True' : 'False' }}</b>
        </li>
      </ol>

      <p class="analysis-note">
        {{ statusMessage }} · {{ analysis.analyzer === 'opencv' ? 'OpenCV.js' : 'Canvas fallback' }}
        · confidence {{ Math.round(analysis.confidence * 100) }}%
      </p>
    </section>

    <div class="run-bar" :class="{ docked: !analysis }">
      <button type="button" class="secondary-button" aria-label="다시 촬영하기" :disabled="isAnalyzing" @click="reopenCapture">
        <RotateCcw :size="20" />
      </button>
      <button type="button" class="run-button" :disabled="isAnalyzing" @click="openCapture">
        <Play :size="21" />
        {{ isAnalyzing ? '분석 중' : '실행' }}
      </button>
    </div>

    <section v-if="captureOpen" class="capture-sheet" aria-label="클로버 촬영">
      <div class="sheet-head">
        <div>
          <p class="eyebrow">Capture</p>
          <h2>클로버를 중앙에 놓고 촬영</h2>
        </div>
        <button type="button" class="close-button" @click="closeCapture">닫기</button>
      </div>

      <div class="camera-frame">
        <video ref="videoRef" autoplay muted playsinline></video>
        <div class="camera-guide" aria-hidden="true"></div>
        <div v-if="cameraError" class="camera-fallback">
          <Camera :size="28" />
          <p>{{ cameraError }}</p>
        </div>
      </div>

      <p class="capture-copy">흰 배경 위에 잎을 펼쳐 놓으면 분석이 가장 안정적입니다.</p>

      <div class="capture-actions">
        <button type="button" class="run-button capture-primary" :disabled="!isCameraReady || isAnalyzing" @click="captureCurrentFrame">
          <Camera :size="20" />
          촬영
        </button>
        <label class="secondary-action upload-action" :class="{ disabled: isAnalyzing }">
          <Upload :size="19" />
          업로드
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*" :disabled="isAnalyzing" @change="handleUpload" />
        </label>
      </div>
    </section>

    <section v-if="installSheetOpen" class="install-sheet" aria-label="앱 설치 안내">
      <div class="sheet-head">
        <div>
          <p class="eyebrow">Install</p>
          <h2>홈 화면에 설치</h2>
        </div>
        <button type="button" class="close-button" @click="closeInstallSheet">닫기</button>
      </div>

      <div class="install-guide">
        <template v-if="isIosDevice">
          <p><b>iPhone/iPad</b></p>
          <ol>
            <li>Safari에서 이 주소를 엽니다.</li>
            <li>공유 버튼을 누릅니다.</li>
            <li>홈 화면에 추가를 선택합니다.</li>
          </ol>
        </template>
        <template v-else>
          <p><b>Android</b></p>
          <ol>
            <li>Chrome 또는 Samsung Internet에서 HTTPS 주소를 엽니다.</li>
            <li>브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택합니다.</li>
            <li>기존 설치 실패 기록이 있으면 사이트 데이터를 삭제한 뒤 다시 시도합니다.</li>
          </ol>
        </template>
        <a href="/privacy.html" target="_blank" rel="noreferrer">개인정보 보호 안내 열기</a>
      </div>
    </section>
  </main>
</template>
