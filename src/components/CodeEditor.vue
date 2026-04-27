<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { lineNumbers } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const props = defineProps<{
  modelValue: string
  issues?: { line: number; message: string }[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const host = ref<HTMLElement | null>(null)
let editor: EditorView | null = null

const cloverEditorTheme = EditorView.theme({
  '&': {
    color: '#173522',
    backgroundColor: '#fbfff8'
  },
  '.cm-content': {
    caretColor: '#087a48'
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#087a48'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#caefd8'
  },
  '.cm-gutters': {
    color: '#6d947a',
    backgroundColor: '#eef8f0',
    borderRightColor: '#cde7d5'
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: '#ecf9ef'
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    color: '#0b6f45',
    backgroundColor: '#d8f5df'
  }
})

const cloverHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#087a48', fontWeight: '800' },
  { tag: [tags.name, tags.variableName], color: '#173522' },
  { tag: tags.number, color: '#2f8c3b', fontWeight: '700' },
  { tag: [tags.bool, tags.atom], color: '#6d7412', fontWeight: '700' },
  { tag: tags.string, color: '#007f63' },
  { tag: tags.operator, color: '#315c43' },
  { tag: tags.punctuation, color: '#63816e' },
  { tag: tags.comment, color: '#6d947a', fontStyle: 'italic' }
])

onMounted(() => {
  if (!host.value) {
    return
  }

  editor = new EditorView({
    parent: host.value,
    doc: props.modelValue,
    extensions: [
      lineNumbers(),
      history(),
      indentOnInput(),
      python(),
      cloverEditorTheme,
      syntaxHighlighting(cloverHighlightStyle),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          emit('update:modelValue', update.state.doc.toString())
        }
      })
    ]
  })
})

watch(() => props.modelValue, value => {
  if (!editor || value === editor.state.doc.toString()) {
    return
  }

  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: value
    }
  })
})

onBeforeUnmount(() => {
  editor?.destroy()
  editor = null
})
</script>

<template>
  <section class="editor-shell" aria-label="Python 조건문 코드 에디터">
    <div class="editor-toolbar">
      <span class="editor-dot" aria-hidden="true"></span>
      <span class="editor-title">Python 조건문</span>
      <span class="editor-save-state">자동 저장</span>
    </div>
    <div ref="host" class="code-editor"></div>
    <ul v-if="issues?.length" class="issue-list" aria-live="polite">
      <li v-for="issue in issues" :key="`${issue.line}-${issue.message}`">
        <b>{{ issue.line }}줄</b>
        {{ issue.message }}
      </li>
    </ul>
  </section>
</template>
