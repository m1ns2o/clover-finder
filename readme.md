# Clover Logic Lab

Nuxt를 제거하고 Vue/Vite로 다시 구축한 모바일 PWA입니다.

## 기능

- 첫 화면에서 바로 Python 조건문 코드 에디터 표시
- 작성 코드 localStorage 자동 저장
- 재방문 시 저장된 코드 자동 로드
- 실행 버튼으로 카메라 촬영 UI 열기
- 카메라 촬영 또는 네이티브 이미지 업로드로 클로버 분석
- 기본 테스트용 클로버 이미지 제공
- OpenCV.js 런타임을 백그라운드에서 지연 로드하고, 준비되면 HSV 마스크/contour 분석 사용
- OpenCV.js 로드 실패 또는 지연 시 Canvas fallback 사용
- 업로드 이미지는 분석용/표시용으로 축소해 모바일 브라우저 멈춤 방지
- 분석된 잎 후보를 결과 이미지 위에 원형 마커로 표시
- `잎_개수`, `잎_크기` 두 변수로 조건 평가
- PWA / 모바일 최적화 UI

## 카메라 동작 조건

브라우저 카메라는 보안 컨텍스트에서만 동작합니다.

- 로컬 개발: `http://localhost:4173` 또는 `http://localhost:4187`
- 휴대폰 실기기 테스트: HTTPS 배포 URL 권장
- 같은 와이파이의 `http://192.168.x.x` 주소에서는 카메라가 막힐 수 있으며, 이 경우 이미지 업로드 또는 기본 테스트 이미지를 사용합니다.
- Android Chrome의 PWA 설치 버튼도 HTTPS 배포 URL에서 확인해야 합니다. 같은 와이파이의 `http://192.168.x.x` 주소는 설치 가능 앱으로 보이지 않을 수 있습니다.

## 실행

```bash
pnpm install
pnpm dev
```

## Netlify 배포

`netlify.toml`에 Netlify 빌드 설정을 포함했습니다.

- Build command: `pnpm build`
- Publish directory: `dist`
- Node: `22`
- pnpm: `10.33.2`

Netlify 대시보드에서 저장소를 연결하면 위 설정이 자동으로 적용됩니다. 카메라 기능은 HTTPS에서 동작하므로 Netlify 배포 URL에서는 바로 테스트할 수 있습니다.

## 검증

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm exec playwright test
```
