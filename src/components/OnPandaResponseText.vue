<template>
    <button v-if="reasoningPatches.length" class="reasoning-toggle" type="button"
        :aria-expanded="reasoningExpanded" @click="toggleReasoning">
        <span aria-hidden="true">{{ reasoningExpanded ? '▾' : '▸' }}</span>
        Reasoning <span class="reasoning-count">{{ reasoningTokenCount ? `· ${reasoningTokenCount.toLocaleString()} tokens` : '' }}</span>
        <span class="reasoning-toggle-action">{{ reasoningExpanded ? 'Hide' : 'Show' }}</span>
    </button>
    <p ref="onPandaResponseTextRef" class="OnPandaResponseText onPandaContainers"
        style="white-space: pre-wrap;cursor: default; 
    overflow-wrap: anywhere;">
        <span class="PatchSpan" v-for="patch in patches"
            v-show="reasoningExpanded || !isReasoningPatch(patch)"
            :class="{ 'reasoning-patch': isReasoningPatch(patch) }"
            :key="`t${pandaState.uuid.value}-d${pandaState.currentDialogKey.value}-p${patch.index}:${patch.patch}`"
            :style='{
                "border-bottom": "3px solid " + probToColor(patch.prob),
                ...(patch.tokens.some(t => t.bifurcationPoint) ? { "background-color": "#e99" } : {}),
                ...(patch.tokens.some(t => t.pruned) ? { "text-decoration": "line-through", "color": "#777" } : {}),
                ...(patch.tokens.some(t => t.selected) ? { "background-color": "#3064ce", "color": "#fff" } : {}),
                ...(isReasoningPatch(patch) ? { "color": "var(--panda-muted, #757575)" } : {}),
                // ...(patch.tokens.some(t => t.delta?.reasoning) ? { "text-decoration": "underline dotted #999" } : {}),
                // ...(patch.tokens.some(t => t.delta?.reasoning) ? { "background": "linear-gradient(to bottom, transparent 85%, #09f5 85%)" } : {}),
                // ...(patch.tokens.some(t => t.modifiedByEditSelection) ? { "border-bottom": "3px solid #09f" } : {}),
                ...(patch.tokens.some(t => t.modifiedByEditSelection) ? { "background-color": "skyblue" } : {}),  // avoid conflict with probToColor
            }' :patch-index="patch.index" v-html="patchToSpanHTML(patch)" @mouseenter="handleMouseEnterPatchSpan"
            @mouseleave="handleMouseLeavePatchSpan" @mousedown="handleMouseDownPatchSpan($event, patch)"
            @dblclick.prevent="setFloatInputPatch($event, patch)">
        </span>
        <el-tooltip
            v-if="tokens.length && tokens[tokens.length - 1].finish_reason == 'length'"
            :content="t('tooltips.continueGenerating')" placement="bottom">
            <el-button :icon="DArrowRight" size="small" @click="operationCenter.continueGenerating()"
                style="margin-left: 10px;height: 16px" />
        </el-tooltip>
    </p>

    <div v-if="floatPatchPanel.visible" class="token-picker-bridge" aria-hidden="true"
        @mouseenter="keepTokenPickerOpen" @mouseleave="scheduleTokenPickerClose"
        :style="{ left: `${pickerBridge.x}px`, top: `${pickerBridge.y}px`, width: `${pickerBridge.width}px`, height: `${pickerBridge.height}px` }" />
    <div @mouseenter="keepTokenPickerOpen" @mouseleave="scheduleTokenPickerClose"
        ref="floatPatchPanelRef" class="token-picker"
        style="position: fixed; box-sizing: border-box; background-color: var(--panda-surface, #eee); z-index: 10; max-width: calc(100vw - 16px); overflow: auto; overscroll-behavior: contain;" :style="{
            left: `${floatPatchPanel.x}px`,
            top: `${floatPatchPanel.y}px`,
            maxHeight: `${floatPatchPanel.maxHeight}px`,
        }" v-if="floatPatchPanel.visible">
        <!-- `padding-top: 4px` to avoid next line's token activate @mouseover  -->
        <div class="token-picker-toolbar">
            <button type="button" class="token-popup-close" aria-label="Close token picker"
                title="Close token picker (Esc)" @pointerdown.stop.prevent="closeFloatPatchPanel"
                @click.stop="closeFloatPatchPanel">Close ×</button>
        </div>
        <div class="floatPatchPanel" style="position: relative;">
            <div v-for="token in activatePatch?.tokens?.filter(shouldRenderTokenPanel)"
                class="tokenPanel" style="vertical-align:top; display: inline-block; padding: 5px;padding-left: 0px;">
                <div class="floatPatchPanelHead" style="border-bottom: 2px solid #ccc;">
                    <span class="tokenSpan" v-html="escapeHTML(truncateTokenSpanText(tokenTextToHtml(getTokenDisplayText(token))))"
                        @mouseover="activateLogprobItem = token?.logprobs?.content?.[0] ?? {}; activateToken = token" />
                </div>
                <div class="tokenLogprobItems">
                    <div v-for="logprobItem in (token?.logprobs?.content?.[0]?.top_logprobs || []).concat([{ finish_reason: 'stop' }])"
                        class="token-candidate" @contextmenu.prevent
                        @mousedown="(event) => handleLogprobItemClick(event, token, logprobItem)"
                        @mouseover="activateLogprobItem = logprobItem; activateToken = token">
                        <span class="tokenSpan">{{ (logprobItem.finish_reason &&
                            `&lt;|${logprobItem.finish_reason}|&gt;`) || truncateTokenSpanText(tokenTextToHtml(logprobItem.token)) }}</span>
                        <span v-if="logprobItem.logprob !== undefined"
                            :style='{ "background-color": probToColor(Math.exp(logprobItem.logprob), 0.18) }'
                            style="float: right;white-space: pre-wrap;font-family: Monospace;">:{{
                                (Math.exp(logprobItem.logprob) * 100).toFixed(1).toString().padStart(5, ' ') }}%</span>
                    </div>
                </div>
            </div>
            <footer class="tokenPanel" style="min-height: 24px; padding: 5px;">
                <span v-if="activateToken.tokenInfo" style="font-family: Monospace;"> info:
                    {{ JSON.stringify(activateToken.tokenInfo) }}<br>
                </span>
                <span v-if="activateLogprobItem.logprob" style="font-family: Monospace;"> {{
                    (-Math.log2(Math.exp(activateLogprobItem.logprob))).toFixed(2) }} bit
                    <br>
                    {{ formatProbabilityPercent(Math.exp(activateLogprobItem.logprob)) }}%<br>
                </span>
                <span v-if="activateLogprobItem.bytes" style="font-family: Monospace;"> bytes:
                    [{{ typeof activateLogprobItem.bytes === "object" ? activateLogprobItem.bytes.join(',') :
                        activateLogprobItem.bytes }}]
                    <br>
                </span>
                <span v-if="getDisplayTokenIds(activateLogprobItem, activateToken)" style="font-family: Monospace;">
                    tokens:
                    [{{ formatTokenIds(getDisplayTokenIds(activateLogprobItem, activateToken)) }}]
                    <br>
                </span>
                <span v-if="activateLogprobItem.token_piece" style="font-family: Monospace;"> token_piece:
                    "{{ activateLogprobItem.token_piece }}"
                </span>
            </footer>
        </div>
    </div>


    <div ref="floatInputPatchRef" class="floatInputPatch" v-show="floatInputPatch.visible" :style="{
        left: `${floatInputPatch.x}px`,
        top: `${floatInputPatch.y}px`,
    }" style="display: flex; position: fixed">
        <textarea type="text" :placeholder="t('placeholders.submitEnter')" style="height: 25px; width:auto;"
            class="floatInputPatchInput" @focus="$event.target.select()"
            @keydown.enter="if (!$event.shiftKey) { operationCenter.continueWithInput(floatInputPatch.attachedPatch.tokens[0], $event.target.value, null); floatInputPatch.visible = false; $event.preventDefault() }" />
    </div>
    <div v-show="!floatInputPatch.visible">
        <SelectedTextPanel :selectedTextState="selectedTextState" :operationCenter="operationCenter" />
    </div>
</template>

<script setup>

import { ref, computed, watch, inject, nextTick, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

import { useGlobalStore } from '../stores/globalStore.js'
import { useEventListener, closeFloatPanelMeta, copyToClipboard, escapeHTML } from '../utils/commonUtils.js'
import { tokenToDisplayString, tokensToPatches } from '../utils/chatUtils.js'
import { probToColor } from '../utils/userInterfaceUtils.js'
import { SelectedTextStateClosure } from '../stores/SelectedTextState.js'

import SelectedTextPanel from './SelectedTextPanel.vue'
import { DArrowRight, Close } from '@element-plus/icons-vue'

const props = defineProps({
    responseState: {
        type: Object,
        description: 'The response state object',
    },
})

const responseState = props.responseState
const pandaState = responseState.pandaState
const tokens = responseState.viewTokens
const operationCenter = responseState.operationCenter

const globalStore = useGlobalStore()
var isMobile = computed(() => globalStore.isMobile)

const { t } = useI18n()



const onPandaResponseTextRef = ref(null);

function createSpanInPatchSpanHTML(textContent) {
    const span = document.createElement('span')
    span.className = 'spanInPatchSpan'  // .spanInPatchSpan CSS not work?
    span.textContent = textContent
    span.style['color'] = "rgb(180,180,180)"
    span.style['fontSize'] = "small"
    span.style['user-select'] = "none"
    span.style['-webkit-user-select'] = "none"  // for safari
    span.style['margin-left'] = "10px"
    // inline-block to prevent text-decoration: line-through from parent node
    span.style['display'] = "inline-block"
    span.style['text-decoration'] = "none"
    return span.outerHTML
}


function replaceNewlinesWithSpans(str) {
    const regex = /\n/g;
    return str.replace(regex, (match) => {
        return createSpanInPatchSpanHTML('↵') + '<br>'
    });
}

function appendFinishReason(token) {
    if (token.finish_reason) {
        return createSpanInPatchSpanHTML(`<|${token.finish_reason}|>`)
    }
    return ""
}

const getTokenDisplayText = (token) => tokenToDisplayString(token, tokens.value)

const shouldRenderTokenPanel = (token) => token.finish_reason || getTokenDisplayText(token) ||
    token.logprobs?.content?.length

const tokenToSpanHTML = (token) => {
    const displayText = getTokenDisplayText(token)
    html = ""
    if (displayText) {
        var html = escapeHTML(displayText)
        html = replaceNewlinesWithSpans(html)
    }
    html = html + appendFinishReason(token)
    return html
}

const patchToSpanHTML = (patch) => {
    return patch.tokens.map(token => tokenToSpanHTML(token)).join("")
}

const patches = computed(() => tokensToPatches(tokens.value));
// Retain the original patches and indices: folding must not change token edits.
const reasoningPatchIndexes = computed(() => {
    const indexes = new Set()
    const template = responseState.viewResponseTemplate.value
    const message = responseState.finalMessage.value
    if (template.responseTemplateType === 'plain_text' && message.reasoning) {
        // Plain-text templates deliberately keep protocol markers in content.
        // Use the template's source mapping instead of modifying token channels.
        const { templatedPrompt, keyPathPromptMapping } = template.apply(message)
        const reasoning = keyPathPromptMapping.find(mapping => mapping.keyPath[0] === 'reasoning')
        if (!reasoning) return indexes
        const closedPrefix = template.apply({
            role: message.role, reasoning: message.reasoning, finish_reason: 'reasoning_end',
        }).templatedPrompt
        const end = templatedPrompt.startsWith(closedPrefix) ? closedPrefix.length : reasoning.textEnd
        const start = keyPathPromptMapping[0] === reasoning ? 0 : reasoning.textStart
        let offset = 0
        for (const patch of patches.value) {
            const next = offset + patch.patch.length
            if (next > offset && offset >= start && next <= end) indexes.add(patch.index)
            offset = next
        }
    } else {
        for (const patch of patches.value) {
            if (patch.tokens.some(token => token.delta?.reasoning)
                && patch.tokens.every(token => !token.delta?.content && !token.delta?.tool_calls?.length)) {
                indexes.add(patch.index)
            }
        }
    }
    return indexes
})
const isReasoningPatch = patch => reasoningPatchIndexes.value.has(patch.index)
const reasoningPatches = computed(() => patches.value.filter(isReasoningPatch))
const reasoningTokenCount = computed(() => reasoningPatches.value.reduce((count, patch) =>
    count + patch.tokens.reduce((n, token) => n + (token.logprobs?.content?.filter(item =>
        typeof item.logprob === 'number').length || 0), 0), 0))
const reasoningExpanded = ref(false)
function toggleReasoning() {
    closeFloatPatchPanel()
    floatInputPatch.value.visible = false
    selectedTextState.floatSelectedOperationPanel.value.visible = false
    reasoningExpanded.value = !reasoningExpanded.value
}
watch(() => pandaState.currentDialogKey.value, () => {
    reasoningExpanded.value = false
    closeFloatPatchPanel()
    floatInputPatch.value.visible = false
})

const selectedTextState = SelectedTextStateClosure({
    onPandaResponseTextRef,
    patches,
    tokens,
    isMobile,
})


const handleMouseEnterPatchSpan = (event) => {
    if (event.buttons === 1) {
        return // If left mouse button is pressed, don't open panel
    }
    keepTokenPickerOpen()

    const patchIndex = event.target.attributes["patch-index"].value
    const patch = patches.value[parseInt(patchIndex)]

    event.target.classList.add('ActivatePatchSpan')
    patch.target = event.target
    activatePatch.value = patch
    if (isMobile.value) {
        // Prevents false touches due to web size changes
        setTimeout(() => setFloatPatchPanelBelow(event.target), 1)
    } else {
        setFloatPatchPanelBelow(event.target)
    }
}

function handleMouseLeavePatchSpan(event) {
    scheduleTokenPickerClose()
}

let pickerHideTimer
function keepTokenPickerOpen() {
    clearTimeout(pickerHideTimer)
    floatPatchPanel.value.waitingToHide = false
}
function scheduleTokenPickerClose() {
    clearTimeout(pickerHideTimer)
    floatPatchPanel.value.waitingToHide = true
    pickerHideTimer = setTimeout(closeFloatPatchPanel, 300)
}
onBeforeUnmount(() => clearTimeout(pickerHideTimer))

function isEventForCopy(event) {
    // if the event is triggered with the Alt key or middle mouse button, copy the text
    return event.altKey || event.button == 1;
}

function isEventForPatchReplacement(event) {
    // if the event is triggered with the Ctrl key or right mouse button, replace the patch
    return event.ctrlKey || event.button == 2;
}

function handleMouseDownPatchSpan(event, patch) {
    if (isEventForCopy(event)) {
        var patchText = patch.patch
        copyToClipboard(patchText).then(() => {
            ElMessage.success(`Copied "${patchText}" to clipboard`)
        })
    }
}

function closeFloatPatchPanel() {
    clearTimeout(pickerHideTimer)
    activatePatch.value.target?.classList.remove('ActivatePatchSpan')
    floatPatchPanel.value.visible = false;
    floatPatchPanel.value.waitingToHide = false;
    activatePatch.value = {}
}

function usingLogprobItemReplacePatch(logprobItem) {
    const patchIndex = Number(activatePatch.value?.target?.attributes?.["patch-index"]?.value)
    const patch = patches.value?.[patchIndex]
    const patchTokens = patch?.tokens
    if (!patchTokens?.length) {
        return
    }
    operationCenter?.editSelection(patchTokens, logprobItem)
    setTimeout(() => {
        const updatedPatch = patches.value?.[patchIndex]
        updatedPatch.target = activatePatch.value?.target
        activatePatch.value = updatedPatch
        floatPatchPanel.value.waitingToHide = false
        floatPatchPanel.value.visible = true
    }, 1)
}

function handleLogprobItemClick(event, token, logprobItem) {
    if (isEventForPatchReplacement(event)) {
        event.preventDefault()
        usingLogprobItemReplacePatch(logprobItem)
    } else if (isEventForCopy(event)) {
        var tokenText = logprobItem.token
        copyToClipboard(tokenText).then(() => {
            ElMessage.success(`Copied "${tokenText}" to clipboard`)
        })
    } else {
        operationCenter.continueWithChosen(token, logprobItem);
    }
}

// floatPatchPanel
const activatePatch = ref({})
const activateLogprobItem = ref({})
const activateToken = ref({})
const tokenTextToHtml = (tokenText) => {
    if (tokenText === undefined) {
        return "undefined"
    }
    if (tokenText === "") {
        return "<|unsee|>"
    }
    return JSON.stringify(tokenText)
}

function truncateTokenSpanText(text) {
    if (text.length <= 50) {
        return text
    }
    return `${text.slice(0, 15)}...<|omitted|>...${text.slice(-15)}`
}

const formatProbabilityPercent = (prob) => {
    const num = prob * 100
    const str = num.toLocaleString('en-US', {
        useGrouping: false,
        minimumFractionDigits: 0,
        maximumFractionDigits: 10
    })
    return str
}

const formatTokenIds = (tokenIds) => {
    if (Array.isArray(tokenIds)) {
        return tokenIds.join(',')
    }
    return ""
}

const getDisplayTokenIds = (logprobItem, token) => {
    if (Array.isArray(logprobItem?.token_ids)) {
        return logprobItem.token_ids
    }
    if (Array.isArray(logprobItem?.top_logprobs) && Array.isArray(token?.token_ids)) {
        return token.token_ids
    }
    return null
}


const floatPatchPanel = ref({
    visible: false,
    waitingToHide: false,
    x: 0,
    y: 0,
    maxHeight: 400,
})

const floatPatchPanelRef = ref(null)
const pickerBridge = ref({ x: 0, y: 0, width: 0, height: 0 })

function updatePickerBridge(anchor, panel, placeBelow) {
    // Cover the gap and the narrow strip beside an offset menu. A diagonal
    // approach to a candidate must not land on tokens in the line underneath.
    const left = Math.max(0, Math.min(anchor.left, panel.left) - 2)
    const right = Math.min(window.innerWidth, Math.max(anchor.right, panel.right) + 2)
    const top = placeBelow ? anchor.bottom : panel.top
    const bottom = placeBelow ? panel.bottom : anchor.top
    pickerBridge.value = { x: left, y: top, width: right - left, height: Math.max(0, bottom - top) }
}


// exceptTouch=true to avoide touch device close floatPatchPanel by click on another patchSpan
closeFloatPanelMeta(floatPatchPanelRef, closeFloatPatchPanel, true, true)

watch(activatePatch, function watchActivatePatch(newValue, oldValue) {
    activateLogprobItem.value = {}
    activateToken.value = {}
    oldValue.target?.classList.remove('ActivatePatchSpan')
});

function setFloatPatchPanelBelow(element) {
    element = element || document.querySelector('.ActivatePatchSpan')
    if (!element) {
        return
    }
    const anchor = element.getBoundingClientRect()
    const margin = 8, gap = 12
    if (anchor.bottom <= margin || anchor.top >= window.innerHeight - margin || !element.getClientRects().length) {
        closeFloatPatchPanel()
        return
    }
    const below = Math.max(0, window.innerHeight - anchor.bottom - gap - margin)
    const above = Math.max(0, anchor.top - gap - margin)
    // Constrain the menu to one side of its token, including its first paint.
    // A tall candidate list scrolls inside that space instead of covering text.
    const placeBelow = below >= 300 || below >= above
    const maxHeight = placeBelow ? below : above
    floatPatchPanel.value.maxHeight = maxHeight
    floatPatchPanel.value.x = Math.max(margin, anchor.left + 12)
    floatPatchPanel.value.y = placeBelow ? anchor.bottom + gap : anchor.top - gap - maxHeight
    updatePickerBridge(anchor, {
        left: floatPatchPanel.value.x, right: floatPatchPanel.value.x + 200,
        top: floatPatchPanel.value.y, bottom: floatPatchPanel.value.y + maxHeight,
    }, placeBelow)
    floatPatchPanel.value.waitingToHide = false;
    floatPatchPanel.value.visible = true;
    nextTick(() => {
        if (!floatPatchPanel.value.visible || activatePatch.value.target !== element || !element.isConnected || !floatPatchPanelRef.value) return
        const panel = floatPatchPanelRef.value.getBoundingClientRect()
        floatPatchPanel.value.x = Math.max(margin, Math.min(anchor.left + 12, window.innerWidth - panel.width - margin))
        floatPatchPanel.value.y = placeBelow ? anchor.bottom + gap : anchor.top - panel.height - gap
        updatePickerBridge(anchor, {
            left: floatPatchPanel.value.x, right: floatPatchPanel.value.x + panel.width,
            top: floatPatchPanel.value.y, bottom: floatPatchPanel.value.y + panel.height,
        }, placeBelow)
    })
}


const floatInputPatch = ref({
    visible: false,
    attachedPatch: undefined,
    x: 0,
    y: 0,
})

const floatInputPatchRef = ref(null)

closeFloatPanelMeta(floatInputPatchRef, () => {
    floatInputPatch.value.visible = false
})

function setFloatInputPatch(event, patch) {
    // keep floatPatchPanel on， don't know why need setTimeout
    setTimeout(() => {
        activatePatch.value = patch
        floatPatchPanel.value.waitingToHide = false;
        floatPatchPanel.value.visible = true;
    }, 20)

    const cellRect = event.target.getBoundingClientRect();
    floatInputPatch.value.attachedPatch = patch

    floatInputPatch.value.x = cellRect.left - 3
    floatInputPatch.value.y = cellRect.top - 5
    floatInputPatch.value.visible = true;
    setTimeout(() => {
        document.querySelector('.floatInputPatchInput').value = patch?.patch;
        document.querySelector('.floatInputPatchInput').focus()
    }, 2)

}

function handleReactiveFunctions(event) {
    if (event?.target instanceof Node && floatPatchPanelRef.value?.contains(event.target)) return
    if (floatPatchPanel.value.visible) setFloatPatchPanelBelow(activatePatch.value.target)
    selectedTextState.setFloatSelectedOperationPanelBelow()
}

// register handleReactiveFunctions to handleScrollDivFunctions
const handleScrollDivFunctions = inject('handleScrollDivFunctions', [])
handleScrollDivFunctions.push(handleReactiveFunctions)

responseState.registerInResponseText({ closeFloatPatchPanel })

useEventListener(window, 'resize', handleReactiveFunctions)
useEventListener(window, 'scroll', handleReactiveFunctions, { capture: true, passive: true })

</script>

<style scoped>
.token-picker-bridge { position: fixed; z-index: 9; }
.token-picker { min-width: 180px; border: 1px solid var(--el-border-color, #ccc); border-radius: 6px; }
.token-picker-toolbar { position: sticky; top: 0; z-index: 1; display: flex; justify-content: flex-end; padding: 4px; background: var(--panda-surface, #eee); }
.reasoning-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--el-border-color, #ddd);
    border-radius: 6px;
    background: var(--el-fill-color-light, #f5f7fa);
    color: var(--el-text-color-regular, #606266);
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: 13px;
}
.reasoning-toggle-action { margin-left: auto; color: var(--el-color-primary, #409eff); }
.reasoning-count { color: var(--panda-muted, #757575); }
.token-candidate { display: block; background: var(--panda-surface, #eee); cursor: pointer; }
.token-candidate:hover { background: var(--panda-hover, #ddd); }
.token-candidate .tokenSpan { color: var(--el-text-color-primary, #444); }
.floatPatchPanelHead .tokenLogprobItems {
    display: block;
}

.tokenPanel {
    border: 1px solid #ccc;
    padding: 0px;
    border: 1px solid #ccc;
    border-radius: 5px;
    background-color: #f9f9f9;
}

.PatchSpan {
    box-shadow: inset -1px 0 rgb(200, 200, 200);
}

.tokenSpan {
    white-space: pre-wrap;
    font-family: Monospace;
}

.PatchSpan {
    white-space: pre-wrap;
    margin: 0;
    padding: 0;
    display: inline;
}

.ActivatePatchSpan {
    background-color: #ccc;
    border-radius: 4px;
}
</style>
