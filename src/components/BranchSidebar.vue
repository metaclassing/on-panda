<script setup>
import { computed } from 'vue'

const props = defineProps({ responseState: { type: Object, required: true } })
const emit = defineEmits(['newConversation'])
const { pandaState, agenticLoopStatus } = props.responseState
const rows = computed(() => {
    const all = pandaState.allDialogs.value
    const current = String(pandaState.currentDialogKey.value)
    const nodes = pandaState.dialogKeys.value.map(key => {
        const stored = all[key]
        const dialog = String(key) === current ? pandaState.dialogComputed.value : stored
        const operation = stored.operations?.find(op => ['continue_with_chosen', 'continue_with_input', 'generate_new', 'new_conversation', 'start_new_round'].includes(op.operator)) || stored.operations?.[0] || {}
        const answer = dialog?.messages?.findLast(message => message.role === 'assistant')
        const user = dialog?.messages?.findLast(message => message.role === 'user')
        const forced = operation.continue_with_chosen?.token ?? operation.continue_with_input?.input_patch
        const preview = typeof answer?.content === 'string' && answer.content
            || typeof answer?.reasoning === 'string' && answer.reasoning
            || typeof user?.content === 'string' && user.content || 'Ready for a message'
        const labels = { generate_new: 'Regenerated', start_new_round: 'Reply', edit_prompt: 'Edited prompt', new_conversation: 'New conversation', continue_generating: 'Continued' }
        return {
            key: String(key), parent: String(stored.operations?.[0]?.parent || ''),
            active: String(key) === current, deleted: !(key in pandaState.pandaTree.value.dialogs),
            forced, label: forced !== undefined ? `Forced ${JSON.stringify(forced)}` : labels[operation.operator] || 'Original',
            preview: preview.replace(/\s+/g, ' ').slice(0, 120),
        }
    }).filter(node => !node.deleted)
    const byKey = new Map(nodes.map(node => [node.key, node]))
    return nodes.map(node => {
        let parent = byKey.get(node.parent), depth = 0
        const seen = new Set([node.key])
        while (parent && !seen.has(parent.key)) {
            seen.add(parent.key)
            depth++
            parent = byKey.get(parent.parent)
        }
        return { ...node, depth: Math.min(depth, 3) }
    })
})
function select(key) {
    if (agenticLoopStatus.running) return
    pandaState.switchDialogByIndex(pandaState.dialogKeys.value.indexOf(Number(key)))
}
</script>

<template>
    <aside class="branch-sidebar" aria-label="Conversation branches">
        <button class="new-conversation-button" :disabled="agenticLoopStatus.running" @click="emit('newConversation')">＋ New conversation</button>
        <div class="branch-sidebar-heading">Branches <span>{{ rows.length }}</span></div>
        <p class="branch-sidebar-help">Choose a token alternative to fork a reply. Earlier versions stay here.</p>
        <nav class="branch-list">
            <button v-for="row in rows" :key="row.key" type="button" class="branch-card"
                :class="{ active: row.active }" :aria-current="row.active ? 'page' : undefined"
                :aria-label="`Branch ${row.key}: ${row.label}`" :disabled="agenticLoopStatus.running"
                :style="{ marginLeft: `${row.depth * 8}px` }" @click="select(row.key)">
                <span class="branch-card-meta">#{{ row.key }} <span v-if="row.parent && row.parent !== row.key && row.parent !== 'null'">↳ from #{{ row.parent }}</span></span>
                <strong>{{ row.label }}</strong>
                <span class="branch-preview">{{ row.preview }}</span>
            </button>
        </nav>
        <div class="branch-session-actions"><slot /></div>
    </aside>
</template>
