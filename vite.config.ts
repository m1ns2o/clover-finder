import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'KakaoTalk_Photo_2026-04-28-10-35-11.jpeg', 'istockphoto-2195234499-612x612.jpg'],
      manifest: {
        id: '/',
        name: 'Clover Logic Lab',
        short_name: 'Clover Lab',
        description: '카메라로 분석한 클로버 데이터를 Python 조건문으로 검사하는 모바일 학습 앱',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        theme_color: '#0f5132',
        background_color: '#f5faf6',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'portrait-primary',
        categories: ['education', 'productivity', 'utilities'],
        prefer_related_applications: false,
        handle_links: 'preferred',
        launch_handler: {
          client_mode: 'focus-existing'
        },
        shortcuts: [
          {
            name: '클로버 검사 시작',
            short_name: '검사',
            description: '저장된 조건문으로 클로버 사진을 검사합니다.',
            url: '/'
          },
          {
            name: '개인정보 보호 안내',
            short_name: '개인정보',
            description: '카메라와 이미지 처리 방식 안내를 확인합니다.',
            url: '/privacy.html'
          }
        ],
        screenshots: [
          {
            src: '/screenshots/mobile-home.png',
            sizes: '540x960',
            type: 'image/png',
            form_factor: 'narrow',
            label: '조건문 코드 에디터'
          },
          {
            src: '/screenshots/mobile-result.png',
            sizes: '540x960',
            type: 'image/png',
            form_factor: 'narrow',
            label: '클로버 분석 결과'
          }
        ],
        icons: [
          {
            src: '/pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webmanifest}'],
        globIgnores: ['**/opencv-*.js'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
