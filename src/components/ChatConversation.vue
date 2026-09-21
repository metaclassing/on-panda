<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { Edit, Refresh } from '@element-plus/icons-vue'
import Message from './Message.vue'
import OnPandaResponsePanel from './OnPandaResponsePanel.vue'
import MessageAsTextRender from './widgets/MessageAsTextRender.vue'
import { messageToSeq } from '../utils/chatUtils.js'

const props = defineProps({ responseState: { type: Object, required: true } })
const { messages, newRoundMessage, finalMessage, operationCenter, pandaState, agenticLoopStatus, tokens } = props.responseState
const transcript = ref(null)
const composerMessage = ref(null)
const editingIndex = ref(null)
const history = computed(() => messages.value.map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role !== 'system' && messageToSeq(message, { includeFinishReason: false })))
const hasResponse = computed(() => Boolean(messageToSeq(finalMessage.value, { includeFinishReason: false }) || agenticLoopStatus.running))

watch(() => [tokens.value.length, messages.value.length], async () => {
    const el = transcript.value
    const atBottom = el && el.scrollHeight - el.scrollTop - el.clientHeight < 140
    await nextTick()
    if (atBottom) el.scrollTop = el.scrollHeight
})
watch(() => pandaState.currentDialogKey.value, async () => {
    editingIndex.value = null
    await nextTick()
    if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight
})
function composerKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.isComposing || event.target.tagName !== 'TEXTAREA') return
    event.preventDefault()
    if (!agenticLoopStatus.running) composerMessage.value?.submit()
}
</script>

<template>
    <main class="chat-main">
        <div ref="transcript" class="chat-transcript">
            <div v-if="!history.length && !hasResponse" class="chat-empty-state">
                <h2>Start a conversation.</h2>
                <p>Send a message. Open Tokens on a reply to explore a different generation.</p>
            </div>
            <article v-for="{ message, index } in history" :key="index" class="chat-message" :class="`chat-message-${message.role}`">
                <div class="chat-message-heading"><strong>{{ message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Assistant' : message.role }}</strong>
                    <div class="chat-message-actions">
                    <el-button v-if="message.role === 'assistant'" :icon="Refresh" size="small"
                        :aria-label="`Regenerate response ${index + 1}`" :disabled="agenticLoopStatus.running"
                        @click="operationCenter.generateNew({ messageIndex: index, fromUser: true })">Regenerate</el-button>
                    <el-button :icon="Edit" size="small" :aria-label="`Edit message ${index + 1}`" :disabled="agenticLoopStatus.running"
                        @click="editingIndex = editingIndex === index ? null : index" />
                    </div>
                </div>
                <Message v-if="editingIndex === index" :message="message" :messageIndex="index" :operationCenter="operationCenter" />
                <MessageAsTextRender v-else :messageAsText="messageToSeq(message, { includeFinishReason: false })" initReasoningDisplayMode="close" />
            </article>
            <article v-if="hasResponse" class="chat-message chat-message-assistant active-response">
                <OnPandaResponsePanel :responseState="responseState" chat-layout />
            </article>
            <div id="browser-agent-interaction-area"></div>
        </div>
        <section class="chat-composer" aria-label="Message composer" @keydown.capture="composerKeydown">
            <fieldset :disabled="agenticLoopStatus.running">
                <Message ref="composerMessage" :message="newRoundMessage" :messageIndex="-2" placeholder="Message your model…" hide-primary-action
                    @sendButton="operationCenter.startNewRound()" @deleteMessage="newRoundMessage.content = ''" />
            </fieldset>
        </section>
    </main>
</template>
