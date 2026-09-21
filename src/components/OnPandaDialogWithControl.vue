<script setup>
import { ref, onMounted, computed } from 'vue'
import { duplicateWindow, deepCopy } from '../utils/commonUtils.js'
import { defaultMessages } from '../stores/responseState.js'
import { useI18n } from 'vue-i18n'

import DataControlPanel from './DataControlPanel.vue'
import ControlParameterPanel from './ControlParameterPanel.vue'
import OnPandaDialogPanel from './OnPandaDialogPanel.vue'
import ToolManagePanel from './ToolManagePanel.vue'
import BranchSidebar from './BranchSidebar.vue'
import ChatConversation from './ChatConversation.vue'
import Message from './Message.vue'
const { t } = useI18n()

const props = defineProps({
    dialogWithControlState: {
        type: Object,
        required: true
    }
})

const { responseState, controlParameterState, toolManageState } = props.dialogWithControlState
const settingsOpen = ref(false)
const chatMode = ref(true)
const systemMessages = computed(() => responseState.messages.value.map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'system'))
const hasTools = computed(() => toolManageState.visibleToolConfigItems.value.length
    || toolManageState.currentDialogTools.value.length)
defineExpose({ openSettings: () => { settingsOpen.value = true } })

function newConversation() {
    const { pandaState, messages, setGenerationTokens, newRoundMessage } = responseState
    if (responseState.agenticLoopStatus.running) return
    pandaState.beforeOperation()
    messages.value = deepCopy(defaultMessages)
    setGenerationTokens([])
    newRoundMessage.value = { role: 'user', content: '' }
    pandaState.afterOperation({ operator: 'new_conversation', on_policy: false }, true)
}


function duplicateWindowWithModelName(modelName) {
    localStorage.setItem('modelNameForDuplicateWindow', modelName)
    duplicateWindow(responseState.pandaState)
}

const onPandaDialogPanelRef = ref(null)
onMounted(() => {
    responseState.onPandaContainerRef.value = onPandaDialogPanelRef.value
})
</script>

<template>
    <div class="onPandaDialogWithControl onPandaContainers" :class="chatMode ? 'chat-layout' : 'workbench-layout'" ref="onPandaDialogPanelRef">
        <template v-if="chatMode">
            <BranchSidebar :responseState="responseState" @new-conversation="newConversation">
                <details class="session-tools"><summary>Session tools</summary>
                    <DataControlPanel :responseState="responseState" :autoFollow="false" />
                </details>
            </BranchSidebar>
            <ChatConversation :responseState="responseState" />
        </template>
        <OnPandaDialogPanel v-else :responseState="responseState">
            <template #beforeNewRoundMessageSlot>
                <div id="browser-agent-interaction-area"></div>
                <DataControlPanel :responseState="responseState" />
            </template>
        </OnPandaDialogPanel>

        <el-drawer v-model="settingsOpen" title="Model & generation" direction="rtl"
            size="min(640px, 95vw)" append-to-body class="settings-drawer">
            <el-switch v-model="chatMode" active-text="Chat interface" inactive-text="Workbench" />
            <el-divider content-position="left">System prompt</el-divider>
            <details class="system-prompt-disclosure"><summary>Edit system prompt</summary>
                <Message v-for="{ message, index } in systemMessages" :key="index"
                    :message="message" :messageIndex="index" :operationCenter="responseState.operationCenter" />
            </details>
            <el-divider content-position="left">Model & sampling</el-divider>
            <ControlParameterPanel :controlParameterState="controlParameterState" :responseState="responseState"
                @dblclickModelTag="responseState.operationCenter.generateNew()"
                @duplicateWindowWithModelName="duplicateWindowWithModelName" />
            <el-divider content-position="left">Tools</el-divider>
            <p v-if="!hasTools" class="tools-empty-state">No tools connected. Tools let the model call functions or MCP services; chat and token editing work without them.</p>
            <ToolManagePanel v-if="hasTools" :responseState="responseState" :toolManageState="toolManageState" />
        </el-drawer>
    </div>
</template>
