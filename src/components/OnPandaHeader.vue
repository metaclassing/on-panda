<template>
    <header class="app-header">
        <div class="app-brand"><span aria-hidden="true">🐼</span> <strong>onPanda</strong><span class="app-subtitle">Token explorer</span></div>
        <div class="app-header-actions">
            <el-button v-if="isWebApp" size="small" class="theme-toggle" :aria-pressed="isDark"
                aria-label="Toggle dark mode" @click="toggleTheme">
                {{ isDark ? '☾ Dark' : '☀ Light' }}
            </el-button>
            <LanguageSwitcher />
            <el-button :icon="Setting" size="small" aria-label="Open settings" @click="$emit('openSettings')">Settings</el-button>
        </div>
    </header>
</template>

<script setup>
import { ref } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import LanguageSwitcher from './widgets/LanguageSwitcher.vue'

defineEmits(['openSettings'])
const isWebApp = window.isOnPandaWeb
const isDark = ref(document.documentElement.classList.contains('dark'))
function toggleTheme() {
    isDark.value = !isDark.value
    document.documentElement.classList.toggle('dark', isDark.value)
    document.documentElement.style.cssText = ''
    try { localStorage.setItem('onPandaTheme', isDark.value ? 'dark' : 'light') } catch {}
}
</script>
