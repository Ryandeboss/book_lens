<script setup lang="ts">
defineProps<{
  id: string;
  pageNumber: number;
  modelValue: string;
  confidence?: number;
}>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <div class="page-editor">
    <label :for="id">Page {{ pageNumber }} — Extracted text</label>
    <p v-if="confidence !== undefined" class="scan-hint">
      OCR confidence: {{ Math.round(confidence) }}%
    </p>
    <textarea
      :id="id"
      :value="modelValue"
      rows="12"
      spellcheck="true"
      @input="
        $emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)
      "
    />
  </div>
</template>
